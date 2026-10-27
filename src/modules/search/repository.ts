/**
 * Candidate retrieval.
 *
 * Reads only from the published projection and the publishable_occurrences
 * view — never from claims. That separation is the point of the two-sided
 * model: the view already applies the confirmed-plus-evidence rule, the venue
 * status gate and the live-market gate, so this query cannot accidentally omit
 * one of them.
 *
 * Note what the query does NOT do: it does not decide eligibility. It fetches
 * candidates and their evidence states, and the deterministic matcher in
 * eligibility.ts decides. Pushing eligibility into SQL would make it
 * untestable offline and would scatter the "unknown is never a pass" rule
 * across two languages.
 */

import type { Sql } from 'postgres';

import { currency, priceBand } from '@/lib/money';
import { localDate, localTime, searchWindow, searchWindowBounds } from '@/lib/time';
import type { Clock } from '@/lib/time';
import type { EvidenceState, SourceAuthority } from '@/modules/evidence/confidence';
import type {
  Attributed,
  Candidate,
  CandidateKind,
  CandidateOccurrence,
  CandidateTag,
  NoiseBand,
  SearchRequest,
} from './types';

// Market configuration lives in its own module: it is read by the UI and the
// handoff route as well as by search (ADR-009).
export { loadMarketBySlug, listLiveMarkets } from '@/modules/markets/queries';
export type { MarketRecord } from '@/modules/markets/queries';

const attributed = <T>(value: T | null, state: string): Attributed<T> => ({
  value,
  evidenceState: state as EvidenceState,
});

/** A nullable boolean column and its paired state, read together. */
const boolAttr = (row: Record<string, unknown>, column: string): Attributed<boolean> =>
  attributed(
    row[column] === null || row[column] === undefined ? null : Boolean(row[column]),
    String(row[`${column}_state`] ?? 'unknown'),
  );

export async function findCandidates(
  sql: Sql,
  request: SearchRequest,
  clock: Clock,
): Promise<Candidate[]> {
  const { days } = request.when;
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last) {
    // A window with no days cannot match anything, and running the query would
    // be a full table scan to prove it.
    return [];
  }

  // The outer span of the whole window: the start of the first day's band
  // through the end of the last day's. Individual days are filtered in
  // eligibility, where the overlap rule already lives.
  const spanStart = searchWindowBounds(
    searchWindow({
      date: first,
      fromTime: request.when.fromTime,
      toTime: request.when.toTime,
      timezone: request.timezone,
    }),
  ).startsAt;
  const spanEnd = searchWindowBounds(
    searchWindow({
      date: last,
      fromTime: request.when.fromTime,
      toTime: request.when.toTime,
      timezone: request.timezone,
    }),
  ).endsAt;
  const now = clock.now();
  const neighborhoodId = request.neighborhoodId ?? null;

  const rows = await sql<Record<string, unknown>[]>`
    select
      v.id                                            as venue_id,
      v.slug                                          as venue_slug,
      coalesce(pn.name, v.reference_name)             as display_name,
      v.is_demo_data,
      v.booking_url,
      v.neighborhood_id,
      case
        when ${neighborhoodId}::uuid is not null and vl.point is not null and nh.centroid is not null
          then extensions.st_distance(vl.point, nh.centroid)
      end                                             as distance_meters,

      ve.energy, ve.energy_state,
      ve.conversation_friendliness, ve.conversation_friendliness_state,
      ve.lighting, ve.lighting_state,
      ve.seating_comfort, ve.seating_comfort_state,
      ve.noise_band, ve.noise_band_state,
      ve.outdoor_seating, ve.outdoor_seating_state,
      ve.indoor_seating, ve.indoor_seating_state,
      ve.family_friendly, ve.family_friendly_state,
      ve.wheelchair_accessible, ve.wheelchair_accessible_state,
      coalesce(ve.observation_count, 0)               as observation_count,

      vp.licensed, vp.licensed_state,
      vp.alcohol_free, vp.alcohol_free_state,
      vp.halal, vp.halal_state,
      vp.takes_reservations, vp.takes_reservations_state,
      vp.open_past_midnight, vp.open_past_midnight_state,
      vp.minimum_age, vp.minimum_age_state,

      -- Aggregated rather than joined into the row set: a venue with six tags
      -- and two kinds would otherwise multiply into twelve rows, and the price
      -- and occurrence laterals would be evaluated for each of them.
      coalesce(tags.list, '[]'::jsonb)                as experience_tags,
      coalesce(kinds.list, '[]'::jsonb)               as outing_kinds,

      pp.amount_minor_low, pp.amount_minor_high, pp.currency as price_currency,
      pp.price_basis, pp.includes_tax, pp.includes_service_charge,
      pp.evidence_state                               as price_evidence_state
    from venues v
    join markets m
      on m.id = v.canonical_market_id and m.status = 'live'
    left join venue_locations vl on vl.venue_id = v.id
    left join venue_experience ve on ve.venue_id = v.id
    left join venue_policies vp on vp.venue_id = v.id
    left join lateral (
      select jsonb_agg(jsonb_build_object(
        'key', et.key, 'facet', et.facet, 'evidenceState', vet.evidence_state
      ) order by et.facet, et.sort_order) as list
      from venue_experience_tags vet
      join experience_tags et on et.id = vet.tag_id
      where vet.venue_id = v.id
        -- A market extension is only offered where it belongs. Without this a
        -- Cairo-only tag would match against a Dubai venue that cannot have it.
        and (et.market_id is null or et.market_id = ${request.marketId})
    ) tags on true
    left join lateral (
      select jsonb_agg(jsonb_build_object(
        'key', ok.key, 'isPrimary', vk.is_primary, 'evidenceState', vk.evidence_state
      ) order by vk.is_primary desc, ok.sort_order) as list
      from venue_kinds vk
      join outing_kinds ok on ok.id = vk.kind_id
      where vk.venue_id = v.id
        and (ok.market_id is null or ok.market_id = ${request.marketId})
    ) kinds on true
    left join neighborhoods nh on nh.id = ${neighborhoodId}::uuid
    left join place_names pn
      on pn.place_kind = 'venue'
     and pn.place_id = v.id
     and pn.locale = ${request.locale}
     and pn.is_preferred
    -- Most recently observed price that is still inside its validity window.
    left join lateral (
      select q.*
      from price_points q
      where q.subject_kind = 'venue'
        and q.subject_id = v.id
        and (q.valid_until is null or q.valid_until > ${now})
      order by q.observed_at desc
      limit 1
    ) pp on true
    where v.canonical_market_id = ${request.marketId}
      and v.status = 'active'
    order by v.slug
  `;

  // Occurrences in a second query rather than a join. A venue with a nightly
  // programme has fourteen of them across a fourteen-day window, and joining
  // would multiply every venue row by its occurrence count — re-evaluating the
  // price lateral and the tag aggregates once per night.
  const occurrenceRows = await sql<Record<string, unknown>[]>`
    select
      p.id, p.venue_id, p.title, p.genre_tags, p.performance_type, p.artist,
      p.starts_at, p.ends_at, p.timezone,
      p.local_start_date, p.local_start_time, p.local_end_date, p.local_end_time,
      p.source_expression, p.evidence_state, p.source_authority,
      -- The programme's own words resolved onto vocabulary keys. genre_tags
      -- stay exactly as the source wrote them, because that is what evidence
      -- means; matching runs on the keys, because comparing a string a user
      -- typed against a string a venue wrote matches on spelling.
      coalesce((
        select array_agg(distinct r.tag_key)
        from app_resolve_experience_aliases(${request.marketId}, p.genre_tags) r
      ), '{}'::text[])                                as experience_tags
    from publishable_occurrences p
    join venues v on v.id = p.venue_id
    where v.canonical_market_id = ${request.marketId}
      and v.status = 'active'
      -- A past occurrence is never upcoming (doc 02 AC02), and the view has
      -- already applied the confirmed-and-evidenced gate.
      and p.ends_at > ${now}
      and p.starts_at < ${spanEnd}
      and p.ends_at > ${spanStart}
    order by p.venue_id, p.starts_at
  `;

  const byVenue = new Map<string, CandidateOccurrence[]>();
  for (const row of occurrenceRows) {
    const venueId = String(row['venue_id']);
    const list = byVenue.get(venueId) ?? [];
    list.push({
      id: String(row['id']),
      title: String(row['title']),
      genreTags: (row['genre_tags'] as string[] | null) ?? [],
      experienceTags: (row['experience_tags'] as string[] | null) ?? [],
      performanceType: String(row['performance_type']),
      artist: (row['artist'] as string | null) ?? null,
      time: {
        startsAt: row['starts_at'] as Date,
        endsAt: row['ends_at'] as Date,
        timezone: String(row['timezone']),
        localStartDate: localDate((row['local_start_date'] as Date).toISOString().slice(0, 10)),
        localStartTime: localTime(String(row['local_start_time']).slice(0, 5)),
        localEndDate: localDate((row['local_end_date'] as Date).toISOString().slice(0, 10)),
        localEndTime: localTime(String(row['local_end_time']).slice(0, 5)),
        sourceExpression: (row['source_expression'] as string | null) ?? null,
      },
      evidenceState: row['evidence_state'] as EvidenceState,
      sourceAuthority: (row['source_authority'] as SourceAuthority | null) ?? null,
    });
    byVenue.set(venueId, list);
  }

  return rows.map((row) => {
    const hasPrice = row['amount_minor_low'] !== null && row['amount_minor_low'] !== undefined;

    const candidate: Candidate = {
      venueId: String(row['venue_id']),
      venueSlug: String(row['venue_slug']),
      displayName: String(row['display_name']),
      isDemoData: Boolean(row['is_demo_data']),
      bookingUrl: (row['booking_url'] as string | null) ?? null,
      neighborhoodId: (row['neighborhood_id'] as string | null) ?? null,
      distanceMeters:
        row['distance_meters'] === null || row['distance_meters'] === undefined
          ? null
          : Number(row['distance_meters']),
      experience: {
        energy: attributed(
          row['energy'] === null ? null : Number(row['energy']),
          String(row['energy_state'] ?? 'unknown'),
        ),
        conversationFriendliness: attributed(
          row['conversation_friendliness'] === null
            ? null
            : Number(row['conversation_friendliness']),
          String(row['conversation_friendliness_state'] ?? 'unknown'),
        ),
        lighting: attributed(
          row['lighting'] === null ? null : Number(row['lighting']),
          String(row['lighting_state'] ?? 'unknown'),
        ),
        seatingComfort: attributed(
          row['seating_comfort'] === null ? null : Number(row['seating_comfort']),
          String(row['seating_comfort_state'] ?? 'unknown'),
        ),
        noiseBand: attributed(
          (row['noise_band'] as NoiseBand | null) ?? null,
          String(row['noise_band_state'] ?? 'unknown'),
        ),
        outdoorSeating: attributed(
          row['outdoor_seating'] === null ? null : Boolean(row['outdoor_seating']),
          String(row['outdoor_seating_state'] ?? 'unknown'),
        ),
        indoorSeating: attributed(
          row['indoor_seating'] === null ? null : Boolean(row['indoor_seating']),
          String(row['indoor_seating_state'] ?? 'unknown'),
        ),
        familyFriendly: attributed(
          row['family_friendly'] === null ? null : Boolean(row['family_friendly']),
          String(row['family_friendly_state'] ?? 'unknown'),
        ),
        wheelchairAccessible: attributed(
          row['wheelchair_accessible'] === null ? null : Boolean(row['wheelchair_accessible']),
          String(row['wheelchair_accessible_state'] ?? 'unknown'),
        ),
        observationCount: Number(row['observation_count'] ?? 0),
      },
      policies: {
        licensed: boolAttr(row, 'licensed'),
        alcoholFree: boolAttr(row, 'alcohol_free'),
        halal: boolAttr(row, 'halal'),
        takesReservations: boolAttr(row, 'takes_reservations'),
        openPastMidnight: boolAttr(row, 'open_past_midnight'),
        minimumAge: attributed(
          row['minimum_age'] === null || row['minimum_age'] === undefined
            ? null
            : Number(row['minimum_age']),
          String(row['minimum_age_state'] ?? 'unknown'),
        ),
      },
      kinds: (row['outing_kinds'] as CandidateKind[] | null) ?? [],
      tags: (row['experience_tags'] as CandidateTag[] | null) ?? [],
      price: hasPrice
        ? {
            band: priceBand({
              lowMinor: Number(row['amount_minor_low']),
              highMinor: Number(row['amount_minor_high']),
              currency: currency(String(row['price_currency'])),
              basis: row['price_basis'] as 'per_person',
              includesTax: Boolean(row['includes_tax']),
              includesServiceCharge: Boolean(row['includes_service_charge']),
            }),
            evidenceState: row['price_evidence_state'] as EvidenceState,
          }
        : null,
      occurrences: byVenue.get(String(row['venue_id'])) ?? [],
    };

    return candidate;
  });
}
