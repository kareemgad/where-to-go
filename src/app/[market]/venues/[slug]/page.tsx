import Link from 'next/link';
import { notFound } from 'next/navigation';

import { db } from '@/db/client';
import { currency, formatBand, priceBand } from '@/lib/money';
import { localDate, localTime, systemClock } from '@/lib/time';
import { confidenceLabel } from '@/modules/evidence/confidence';
import type { EvidenceState, SourceAuthority } from '@/modules/evidence/confidence';
import { copyFor } from '@/modules/i18n/copy';
import { loadMarketBySlug } from '@/modules/markets/queries';
import { ConfidenceChip, DemoBanner } from '@/app/_components/evidence';

/**
 * Venue detail.
 *
 * Every attribute shows its provenance beside it, and an attribute with no
 * evidence says so rather than being omitted. Omitting unknowns would read as
 * a clean profile; stating them is the point (doc 02: "For unknown data, show
 * 'Not verified' and offer 'Check with venue'").
 */

interface VenueRow {
  id: string;
  slug: string;
  displayName: string;
  status: string;
  timezone: string;
  bookingUrl: string | null;
  website: string | null;
  isDemoData: boolean;
  energy: number | null;
  energyState: EvidenceState;
  conversation: number | null;
  conversationState: EvidenceState;
  seating: number | null;
  seatingState: EvidenceState;
  noiseBand: 'quiet' | 'moderate' | 'loud' | null;
  noiseBandState: EvidenceState;
  outdoor: boolean | null;
  outdoorState: EvidenceState;
  family: boolean | null;
  familyState: EvidenceState;
  accessible: boolean | null;
  accessibleState: EvidenceState;
  observationCount: number;
}

interface OccurrenceRow {
  id: string;
  title: string;
  artist: string | null;
  genreTags: string[];
  localStartDate: Date;
  localStartTime: string;
  localEndDate: Date;
  localEndTime: string;
  timezone: string;
  sourceExpression: string | null;
  evidenceState: EvidenceState;
  sourceAuthority: SourceAuthority | null;
}

/** One attribute row: the value, or an explicit "not verified". */
function AttributeRow({
  label,
  value,
  state,
  locale,
}: {
  label: string;
  value: string | null;
  state: EvidenceState;
  locale: string;
}) {
  const copy = copyFor(locale);
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-neutral-200 py-2 last:border-0">
      <span className="text-sm text-neutral-600">{label}</span>
      <span className="flex items-center gap-2 text-sm">
        {value === null ? (
          <span className="text-neutral-500 italic">{copy.notVerified}</span>
        ) : (
          <span className="font-medium text-neutral-900">{value}</span>
        )}
        {value === null ? null : (
          <ConfidenceChip
            label={confidenceLabel('published', state, 'venue_attested')}
            locale={locale}
          />
        )}
      </span>
    </div>
  );
}

export default async function VenueDetail({
  params,
}: {
  params: Promise<{ market: string; slug: string }>;
}) {
  const { market: marketSlug, slug } = await params;
  const sql = db();
  const market = await loadMarketBySlug(sql, marketSlug);
  if (!market) notFound();

  const copy = copyFor(market.defaultLocale);

  const venues = await sql<VenueRow[]>`
    select
      v.id, v.slug, v.status, v.timezone,
      coalesce(pn.name, v.reference_name)          as "displayName",
      v.booking_url                                as "bookingUrl",
      v.website,
      v.is_demo_data                               as "isDemoData",
      ve.energy, ve.energy_state                   as "energyState",
      ve.conversation_friendliness                 as "conversation",
      ve.conversation_friendliness_state           as "conversationState",
      ve.seating_comfort                           as "seating",
      ve.seating_comfort_state                     as "seatingState",
      ve.noise_band                                as "noiseBand",
      ve.noise_band_state                          as "noiseBandState",
      ve.outdoor_seating                           as "outdoor",
      ve.outdoor_seating_state                     as "outdoorState",
      ve.family_friendly                           as "family",
      ve.family_friendly_state                     as "familyState",
      ve.wheelchair_accessible                     as "accessible",
      ve.wheelchair_accessible_state               as "accessibleState",
      coalesce(ve.observation_count, 0)            as "observationCount"
    from venues v
    join markets m on m.id = v.canonical_market_id and m.status = 'live'
    left join venue_experience ve on ve.venue_id = v.id
    left join place_names pn
      on pn.place_kind = 'venue' and pn.place_id = v.id
     and pn.locale = ${market.defaultLocale} and pn.is_preferred
    where m.slug = ${marketSlug}
      and v.slug = ${slug}
      and v.status <> 'permanently_closed'
  `;

  const venue = venues[0];
  if (!venue) notFound();

  // Only publishable occurrences, still upcoming. A scheduled-but-unconfirmed
  // night is absent by design (ADR-010): the venue page is not a loophole
  // around the recommendability rule.
  const occurrences = await sql<OccurrenceRow[]>`
    select
      p.id, p.title, p.artist,
      p.genre_tags        as "genreTags",
      p.local_start_date  as "localStartDate",
      p.local_start_time  as "localStartTime",
      p.local_end_date    as "localEndDate",
      p.local_end_time    as "localEndTime",
      p.timezone,
      p.source_expression as "sourceExpression",
      p.evidence_state    as "evidenceState",
      p.source_authority  as "sourceAuthority"
    from publishable_occurrences p
    where p.venue_id = ${venue.id}
      and p.ends_at > ${systemClock.now()}
    order by p.starts_at
    limit 10
  `;

  const prices = await sql<
    {
      lowMinor: string;
      highMinor: string;
      currency: string;
      basis: 'per_person';
      includesTax: boolean;
      includesServiceCharge: boolean;
      evidenceState: EvidenceState;
      observedAt: Date;
    }[]
  >`
    select
      amount_minor_low          as "lowMinor",
      amount_minor_high         as "highMinor",
      currency,
      price_basis               as "basis",
      includes_tax              as "includesTax",
      includes_service_charge   as "includesServiceCharge",
      evidence_state            as "evidenceState",
      observed_at               as "observedAt"
    from price_points
    where subject_kind = 'venue' and subject_id = ${venue.id}
      and (valid_until is null or valid_until > ${systemClock.now()})
    order by observed_at desc
    limit 1
  `;
  const price = prices[0];

  const handoff = new URLSearchParams();
  handoff.set('ranking', 'detail');

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link href={`/${marketSlug}`} className="text-sm text-neutral-600 underline">
        ← {copy.findNight}
      </Link>

      <h1 className="mt-4 text-3xl font-semibold tracking-tight text-neutral-900">
        {venue.displayName}
      </h1>
      <p className="mt-1 font-mono text-xs text-neutral-500">{venue.timezone}</p>

      {venue.isDemoData ? (
        <div className="mt-6">
          <DemoBanner locale={market.defaultLocale} />
        </div>
      ) : null}

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          {copy.spend}
        </h2>
        <p className="mt-2 text-sm">
          {price ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-neutral-900">
                {formatBand(
                  priceBand({
                    lowMinor: Number(price.lowMinor),
                    highMinor: Number(price.highMinor),
                    currency: currency(price.currency),
                    basis: price.basis,
                    includesTax: price.includesTax,
                    includesServiceCharge: price.includesServiceCharge,
                  }),
                  market.defaultLocale,
                )}{' '}
                {copy.perPerson}
              </span>
              <ConfidenceChip
                label={confidenceLabel('published', price.evidenceState, 'venue_attested')}
                locale={market.defaultLocale}
              />
              <span className="text-xs text-neutral-500">
                {copy.lastChecked} {price.observedAt.toISOString().slice(0, 10)}
              </span>
            </span>
          ) : (
            <span className="text-amber-800">
              {copy.spendUnverified} — {copy.checkWithVenue}
            </span>
          )}
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          {copy.atmosphere}
        </h2>
        <div className="mt-2">
          <AttributeRow
            label={copy.conversation}
            value={venue.conversation === null ? null : `${venue.conversation}/5`}
            state={venue.conversationState}
            locale={market.defaultLocale}
          />
          <AttributeRow
            label={copy.energy}
            value={venue.energy === null ? null : `${venue.energy}/5`}
            state={venue.energyState}
            locale={market.defaultLocale}
          />
          <AttributeRow
            label={copy.noise}
            value={venue.noiseBand === null ? null : (copy.noiseBands[venue.noiseBand] ?? null)}
            state={venue.noiseBandState}
            locale={market.defaultLocale}
          />
          <AttributeRow
            label={copy.seating}
            value={venue.seating === null ? null : `${venue.seating}/5`}
            state={venue.seatingState}
            locale={market.defaultLocale}
          />
          <AttributeRow
            label={copy.outdoor}
            value={venue.outdoor === null ? null : venue.outdoor ? '✓' : '✕'}
            state={venue.outdoorState}
            locale={market.defaultLocale}
          />
          <AttributeRow
            label={copy.accessible}
            value={venue.accessible === null ? null : venue.accessible ? '✓' : '✕'}
            state={venue.accessibleState}
            locale={market.defaultLocale}
          />
          <AttributeRow
            label={copy.familyFriendly}
            value={venue.family === null ? null : venue.family ? '✓' : '✕'}
            state={venue.familyState}
            locale={market.defaultLocale}
          />
        </div>
        {venue.observationCount > 0 ? (
          <p className="mt-2 text-xs text-neutral-500">
            {venue.observationCount} {copy.observations}
          </p>
        ) : null}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          {/* "Confirmed", not "upcoming": a scheduled-but-unevidenced night is
              deliberately absent from this list (ADR-010), and the heading
              should say what the list actually contains. */}
          {copy.upcomingPerformances}
        </h2>
        {occurrences.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-600">{copy.noConfirmedPerformance}</p>
        ) : (
          <ul className="mt-2 space-y-3">
            {occurrences.map((o) => {
              const crosses =
                o.localEndDate.toISOString().slice(0, 10) !==
                o.localStartDate.toISOString().slice(0, 10);
              return (
                <li key={o.id} className="rounded-md border border-neutral-200 p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium text-neutral-900">{o.title}</span>
                    <ConfidenceChip
                      label={confidenceLabel(
                        'published',
                        o.evidenceState,
                        o.sourceAuthority ?? 'ai_extracted',
                      )}
                      locale={market.defaultLocale}
                    />
                  </div>
                  <p className="mt-1 text-sm text-neutral-700">
                    {localDate(o.localStartDate.toISOString().slice(0, 10))}{' '}
                    {localTime(String(o.localStartTime).slice(0, 5))}–
                    {localTime(String(o.localEndTime).slice(0, 5))}
                    {crosses ? (
                      <span className="ms-1 text-xs text-neutral-500">
                        ({copy.crossesMidnight})
                      </span>
                    ) : null}
                    <span className="ms-2 font-mono text-xs text-neutral-500">{o.timezone}</span>
                  </p>
                  {o.artist ? (
                    <p className="text-sm text-neutral-600">{o.artist}</p>
                  ) : null}
                  {o.genreTags.length > 0 ? (
                    <p className="mt-1 flex flex-wrap gap-1">
                      {o.genreTags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-700"
                        >
                          {tag}
                        </span>
                      ))}
                    </p>
                  ) : null}
                  {o.sourceExpression ? (
                    <p className="mt-1 text-xs text-neutral-500">
                      {copy.sourceSaid}: “{o.sourceExpression}”
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <footer className="mt-10 border-t border-neutral-200 pt-6">
        {venue.bookingUrl || venue.website ? (
          <>
            <a
              href={`/${marketSlug}/go/${venue.slug}?${handoff.toString()}`}
              rel="noopener noreferrer nofollow"
              className="inline-block rounded-md bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
            >
              {copy.bookExternally} ↗
            </a>
            <p className="mt-2 text-xs text-neutral-500">{copy.externalNote}</p>
          </>
        ) : (
          <p className="text-sm text-neutral-600">{copy.noBookingLink}</p>
        )}
      </footer>
    </main>
  );
}
