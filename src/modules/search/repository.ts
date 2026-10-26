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
import type { Attributed, Candidate, SearchRequest } from './types';

/** Market configuration, read from the record rather than assumed (ADR-009). */
export interface MarketRecord {
  readonly id: string;
  readonly slug: string;
  readonly timezone: string;
  readonly currency: string;
  readonly defaultLocale: string;
}

export async function loadMarketBySlug(sql: Sql, slug: string): Promise<MarketRecord | null> {
  const rows = await sql<MarketRecord[]>`
    select id, slug, timezone, currency, default_locale as "defaultLocale"
    from markets
    where slug = ${slug} and status = 'live'
  `;
  return rows[0] ?? null;
}

const attributed = <T>(value: T | null, state: string): Attributed<T> => ({
  value,
  evidenceState: state as EvidenceState,
});

export async function findCandidates(
  sql: Sql,
  request: SearchRequest,
  clock: Clock,
): Promise<Candidate[]> {
  const window = searchWindow({
    date: request.date,
    fromTime: request.fromTime,
    toTime: request.toTime,
    timezone: request.timezone,
  });
  const bounds = searchWindowBounds(window);
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
      ve.family_friendly, ve.family_friendly_state,
      ve.wheelchair_accessible, ve.wheelchair_accessible_state,
      coalesce(ve.observation_count, 0)               as observation_count,

      pp.amount_minor_low, pp.amount_minor_high, pp.currency as price_currency,
      pp.price_basis, pp.includes_tax, pp.includes_service_charge,
      pp.evidence_state                               as price_evidence_state,

      occ.id                                          as occurrence_id,
      occ.title                                       as occurrence_title,
      occ.genre_tags,
      occ.performance_type,
      occ.artist,
      occ.starts_at, occ.ends_at, occ.timezone        as occurrence_timezone,
      occ.local_start_date, occ.local_start_time,
      occ.local_end_date, occ.local_end_time,
      occ.source_expression,
      occ.evidence_state                              as occurrence_evidence_state,
      occ.source_authority                            as occurrence_source_authority
    from venues v
    join markets m
      on m.id = v.canonical_market_id and m.status = 'live'
    left join venue_locations vl on vl.venue_id = v.id
    left join venue_experience ve on ve.venue_id = v.id
    left join neighborhoods nh on nh.id = ${neighborhoodId}::uuid
    left join place_names pn
      on pn.place_kind = 'venue'
     and pn.place_id = v.id
     and pn.locale = ${request.locale}
     and pn.is_preferred
    -- The earliest recommendable occurrence overlapping the window. The view
    -- supplies the confirmed-and-evidenced gate; this adds only the date range.
    left join lateral (
      select p.*
      from publishable_occurrences p
      where p.venue_id = v.id
        and p.ends_at > ${now}
        and p.starts_at < ${bounds.endsAt}
        and p.ends_at > ${bounds.startsAt}
      order by p.starts_at
      limit 1
    ) occ on true
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

  return rows.map((row) => {
    const hasPrice = row['amount_minor_low'] !== null && row['amount_minor_low'] !== undefined;

    const occurrenceId = row['occurrence_id'];
    const occurrence =
      occurrenceId === null || occurrenceId === undefined
        ? null
        : {
            id: String(occurrenceId),
            title: String(row['occurrence_title']),
            genreTags: (row['genre_tags'] as string[] | null) ?? [],
            performanceType: String(row['performance_type']),
            artist: (row['artist'] as string | null) ?? null,
            time: {
              startsAt: row['starts_at'] as Date,
              endsAt: row['ends_at'] as Date,
              timezone: String(row['occurrence_timezone']),
              localStartDate: localDate(
                (row['local_start_date'] as Date).toISOString().slice(0, 10),
              ),
              localStartTime: localTime(String(row['local_start_time']).slice(0, 5)),
              localEndDate: localDate((row['local_end_date'] as Date).toISOString().slice(0, 10)),
              localEndTime: localTime(String(row['local_end_time']).slice(0, 5)),
              sourceExpression: (row['source_expression'] as string | null) ?? null,
            },
            evidenceState: row['occurrence_evidence_state'] as EvidenceState,
            sourceAuthority: (row['occurrence_source_authority'] as SourceAuthority | null) ?? null,
          };

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
          (row['noise_band'] as 'quiet' | 'moderate' | 'loud' | null) ?? null,
          String(row['noise_band_state'] ?? 'unknown'),
        ),
        outdoorSeating: attributed(
          row['outdoor_seating'] === null ? null : Boolean(row['outdoor_seating']),
          String(row['outdoor_seating_state'] ?? 'unknown'),
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
      occurrence,
    };

    return candidate;
  });
}
