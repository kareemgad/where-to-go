import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { db } from '@/db/client';
import { currency, formatBand } from '@/lib/money';
import { formatLocalDay, formatLocalRange, systemClock } from '@/lib/time';
import { confidenceLabel } from '@/modules/evidence/confidence';
import { copyFor } from '@/modules/i18n/copy';
import { loadMarketBySlug, marketDisplayName } from '@/modules/markets/queries';
import { describeOutcome, describeRelaxation } from '@/modules/search/describe';
import { evaluateAcrossDays } from '@/modules/search/eligibility';
import { parseWhenParam, resolveWhen } from '@/modules/search/when';
import {
  loadExperienceTags,
  loadOutingKinds,
  loadTimeBands,
} from '@/modules/taxonomy/queries';
import { assembleResponse } from '@/modules/search/ranking';
import { findCandidates } from '@/modules/search/repository';
import { MUST_HAVES } from '@/modules/search/types';
import type { SearchRequest, SearchResult } from '@/modules/search/types';
import { ChatPanel } from '@/app/_components/chat';
import { RefinePanel } from '@/app/_components/refine';
import { toHref } from '@/modules/intent/query';
import type { SearchQuery } from '@/modules/intent/query';
import {
  CompletenessMeter,
  ConfidenceChip,
  DemoBanner,
  OutcomeList,
} from '@/app/_components/evidence';

/**
 * Results.
 *
 * Three sections, never interleaved: the shortlist, the candidates whose
 * requirements we could not confirm (collapsed, and excluded from the
 * shortlist count — ADR-011), and the ones ruled out with the reason stated.
 * A hard constraint is never silently dropped to fill the page (doc 02 AC09).
 */

/**
 * Query validation. Doc 14 requires typed validation on requests; an invalid
 * date or budget must fail safely rather than reaching the matcher (doc 07).
 */
const QuerySchema = z.object({
  // tonight | tomorrow | weekend | nextN | a date | a date range.
  when: z.string().min(1).max(40).default('tonight'),
  band: z.enum(['brunch', 'afternoon', 'evening', 'late_night']).optional(),
  // Optional, with no default. A party of four nobody asked for would shape
  // the shortlist on an assumption the user never made.
  party: z.coerce.number().int().min(1).max(20).optional(),
  // Whole units in the market's currency, converted to minor units below.
  budget: z.coerce.number().min(0).max(1_000_000).optional(),
  // Comma-separated vocabulary keys. Unknown keys are dropped rather than
  // rejected: a stale shared link should still search, minus the term that no
  // longer exists, rather than failing outright.
  tags: z.string().max(400).optional(),
  must: z.string().max(400).optional(),
  kinds: z.string().max(400).optional(),
  who: z.string().max(100).optional(),
  noise: z.enum(['quiet', 'moderate', 'lively', 'loud']).optional(),
  // Carried from a chat turn so the page can show what was understood without
  // holding a session. Display only: none of these reach the matcher.
  said: z.string().max(300).optional(),
  ask: z.string().max(100).optional(),
  missed: z.string().max(300).optional(),
});

/** Comma-separated keys from a URL, folded and filtered against a whitelist. */
function keysFrom<T extends string>(raw: string | undefined, allowed: readonly T[]): T[] {
  if (!raw) return [];
  const permitted = new Set<string>(allowed);
  const seen = new Set<T>();
  for (const part of raw.split(',')) {
    const key = part.trim().toLowerCase();
    if (permitted.has(key)) seen.add(key as T);
  }
  return [...seen];
}

const AGE_BANDS = ['kids', 'teens', 'adults_only', 'seniors'] as const;

function ResultCard({
  result,
  marketSlug,
  locale,
  currencyCode,
  tagLabels,
  position,
}: {
  result: SearchResult;
  marketSlug: string;
  locale: string;
  currencyCode: string;
  /** Vocabulary key to display text, so a card never shows a raw key. */
  tagLabels: Readonly<Record<string, string>>;
  position?: number;
}) {
  const copy = copyFor(locale);
  const c = result.candidate;
  // The occurrence on the day this result was matched on, not whichever one
  // the venue happens to list first.
  const occurrence = result.occurrence;

  const handoff = new URLSearchParams();
  if (occurrence) handoff.set('occurrence', occurrence.id);
  if (position !== undefined) handoff.set('position', String(position));
  handoff.set('ranking', result.rankingVersion);

  return (
    <article className="rounded-lg border border-neutral-300 bg-white p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-medium text-neutral-900">
          {position !== undefined ? <span className="text-neutral-400">{position}. </span> : null}
          <Link
            href={`/${marketSlug}/venues/${c.venueSlug}`}
            className="underline decoration-neutral-300 underline-offset-4 hover:decoration-neutral-900"
          >
            {c.displayName}
          </Link>
        </h3>
        {occurrence ? (
          <ConfidenceChip
            label={confidenceLabel(
              'published',
              occurrence.evidenceState,
              occurrence.sourceAuthority ?? 'ai_extracted',
            )}
            locale={locale}
          />
        ) : null}
      </header>

      {occurrence ? (
        <p className="mt-2 text-sm text-neutral-800">
          <span className="font-medium">{occurrence.title}</span>
          {' · '}
          {formatLocalRange(occurrence.time, locale)}
          {occurrence.time.localEndDate !== occurrence.time.localStartDate ? (
            <span className="ms-1 text-xs text-neutral-500">({copy.crossesMidnight})</span>
          ) : null}
        </p>
      ) : null}

      {/* A venue matching four nights should not read as matching one. The
          result is shown on its best night and the rest are named. */}
      {result.otherMatchingDates.length > 0 ? (
        <p className="mt-1 text-xs text-neutral-600">
          {copy.alsoOn}{' '}
          {result.otherMatchingDates
            .map((date) => formatLocalDay(date, occurrence?.time.timezone ?? '', locale))
            .join(' · ')}
        </p>
      ) : null}

      <p className="mt-1 text-sm text-neutral-700">
        {c.price ? (
          <>
            <span className="font-medium">{copy.spend}:</span>{' '}
            {formatBand(c.price.band, locale)} {copy.perPerson}
          </>
        ) : (
          <span className="text-amber-800">
            {copy.spendUnverified} — {copy.checkWithVenue}
          </span>
        )}
      </p>

      <h4 className="mt-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        {copy.whyThisMatches}
      </h4>
      <OutcomeList
        items={result.outcomes.map((o) => describeOutcome(o, locale, currencyCode))}
      />

      {/* What was asked for and found, named. Deliberately not a percentage
          badge: a number invites being read as a probability, and this is
          overlap between two lists of stored claims. */}
      {result.matchedTags.length > 0 ? (
        <p className="mt-2 text-xs text-neutral-700">
          <span className="font-medium">{copy.matchedTags}:</span>{' '}
          {result.matchedTags.map((key) => tagLabels[key] ?? key).join(' · ')}
        </p>
      ) : null}

      <CompletenessMeter fraction={result.informationCompleteness} locale={locale} />

      {occurrence?.time.sourceExpression ? (
        <p className="mt-2 text-xs text-neutral-500">
          {copy.sourceSaid}: “{occurrence.time.sourceExpression}”
        </p>
      ) : null}

      <footer className="mt-4 flex flex-wrap items-center gap-3">
        {c.bookingUrl ? (
          <>
            <a
              href={`/${marketSlug}/go/${c.venueSlug}?${handoff.toString()}`}
              rel="noopener noreferrer nofollow"
              className="rounded-md border border-neutral-900 px-3 py-1.5 text-sm font-medium text-neutral-900 transition hover:bg-neutral-900 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
            >
              {copy.bookExternally} ↗
            </a>
            <span className="text-xs text-neutral-500">{copy.externalNote}</span>
          </>
        ) : (
          <span className="text-xs text-neutral-500">{copy.noBookingLink}</span>
        )}
      </footer>
    </article>
  );
}

export default async function Discover({
  params,
  searchParams,
}: {
  params: Promise<{ market: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { market: slug } = await params;
  const raw = await searchParams;

  const sql = db();
  const market = await loadMarketBySlug(sql, slug);
  if (!market) notFound();

  const name = await marketDisplayName(sql, market);
  const copy = copyFor(market.defaultLocale);
  const code = currency(market.currency);

  const parsed = QuerySchema.safeParse(raw);
  if (!parsed.success) {
    // Fails safe and says why, rather than guessing at the intent (doc 07).
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-2xl font-semibold text-neutral-900">{name}</h1>
        <div className="mt-6 rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          That search could not be read. Check the dates and the budget.
          <ul className="mt-2 list-disc ps-5">
            {parsed.error.issues.map((issue) => (
              <li key={issue.path.join('.')}>
                {issue.path.join('.') || 'query'}: {issue.message}
              </li>
            ))}
          </ul>
        </div>
        <Link href={`/${market.slug}`} className="mt-6 inline-block text-sm underline">
          {copy.findNight}
        </Link>
      </main>
    );
  }

  const q = parsed.data;
  const exponent = code === 'JPY' ? 0 : 2;
  const whenSpec = parseWhenParam(q.when);
  if (!whenSpec) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-2xl font-semibold text-neutral-900">{name}</h1>
        <div className="mt-6 rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          &ldquo;{q.when}&rdquo; is not a window this search understands. Try a date, a range like
          2026-11-13..2026-11-16, or one of tonight, tomorrow, weekend.
        </div>
        <Link href={`/${market.slug}`} className="mt-6 inline-block text-sm underline">
          {copy.findNight}
        </Link>
      </main>
    );
  }

  const when = resolveWhen({
    when: whenSpec,
    bands: await loadTimeBands(sql, market.id),
    timezone: market.timezone,
    weekendDays: market.weekendDays,
    clock: systemClock,
    ...(q.band !== undefined ? { band: q.band } : {}),
  });

  // The market's own vocabulary, used to validate what arrived in the URL. A
  // key this market does not offer is not a filter, it is a typo or a link
  // from somewhere else.
  const [vocabulary, kinds] = await Promise.all([
    loadExperienceTags(sql, market.id, market.defaultLocale),
    loadOutingKinds(sql, market.id, market.defaultLocale),
  ]);

  const request: SearchRequest = {
    marketId: market.id,
    timezone: market.timezone,
    currency: code,
    locale: market.defaultLocale,
    when,
    budgetBasis: 'per_person',
    mustHaves: keysFrom(q.must, MUST_HAVES),
    outingKinds: keysFrom(
      q.kinds,
      kinds.map((k) => k.key),
    ),
    ageBands: keysFrom(q.who, AGE_BANDS),
    softPreferences: {
      experienceTags: keysFrom(
        q.tags,
        vocabulary.map((t) => t.key),
      ),
      ...(q.noise !== undefined ? { noiseLevel: q.noise } : {}),
    },
    ...(q.party !== undefined ? { partySize: q.party } : {}),
    ...(q.budget !== undefined
      ? { budgetCeilingMinor: Math.round(q.budget * 10 ** exponent) }
      : {}),
  };

  const candidates = await findCandidates(sql, request, systemClock);
  const evaluated = candidates.map((candidate) => ({
    candidate,
    days: evaluateAcrossDays(candidate, request, systemClock),
  }));
  const response = assembleResponse(evaluated, request);

  const anyDemo = candidates.some((c) => c.isDemoData);
  const bands = await loadTimeBands(sql, market.id);
  const tagLabels = Object.fromEntries(vocabulary.map((t) => [t.key, t.label]));
  const kindLabels = Object.fromEntries(kinds.map((k) => [k.key, k.label]));

  // The query as the chat panel edits it, rebuilt from what actually survived
  // validation rather than from the raw parameters: a chip for a term the
  // engine discarded would be a filter the user could not satisfy.
  const currentQuery: SearchQuery = {
    when: q.when,
    band: q.band,
    party: q.party,
    budget: q.budget,
    tags: request.softPreferences.experienceTags,
    mustHaves: request.mustHaves,
    outingKinds: request.outingKinds,
    ageBands: request.ageBands,
    noise: request.softPreferences.noiseLevel,
  };

  // Every term in force, with a way to remove each one (doc 02 P1).
  const chips = [
    ...currentQuery.tags.map((key) => ({
      dimension: 'tag',
      value: key,
      label: tagLabels[key] ?? key,
    })),
    ...currentQuery.mustHaves.map((key) => ({
      dimension: 'must_have',
      value: key,
      label: copy.constraints[key] ?? key,
    })),
    ...currentQuery.outingKinds.map((key) => ({
      dimension: 'outing_kind',
      value: key,
      label: kindLabels[key] ?? key,
    })),
    ...currentQuery.ageBands.map((band) => ({
      dimension: 'age_band',
      value: band,
      label: copy.ageBands[band] ?? band,
    })),
    ...(currentQuery.noise !== undefined
      ? [
          {
            dimension: 'noise',
            value: currentQuery.noise,
            label: `${copy.noiseLevel}: ${copy.noiseBands[currentQuery.noise] ?? currentQuery.noise}`,
          },
        ]
      : []),
    ...(currentQuery.budget !== undefined
      ? [
          {
            dimension: 'budget',
            value: String(currentQuery.budget),
            label: `${copy.budgetCeiling}: ${currentQuery.budget} ${market.currency}`,
          },
        ]
      : []),
    ...(currentQuery.party !== undefined
      ? [
          {
            dimension: 'party',
            value: String(currentQuery.party),
            label: `${copy.partySize}: ${currentQuery.party}`,
          },
        ]
      : []),
  ];

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">{name}</h1>
        <Link href={`/${market.slug}`} className="text-sm text-neutral-600 underline">
          {copy.findNight}
        </Link>
      </div>
      <p className="mt-1 font-mono text-xs text-neutral-500">
        {when.days.length === 1
          ? when.days[0]
          : `${when.days[0]} → ${when.days[when.days.length - 1]} (${when.days.length} days)`}{' '}
        {when.fromTime}–{when.toTime} · {market.timezone} · {market.currency}
        {request.budgetCeilingMinor !== undefined ? ` · ≤ ${q.budget}` : ''}
      </p>
      {response.truncatedFromDays !== null ? (
        <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          You asked for {response.truncatedFromDays} days. A search covers at most{' '}
          {when.days.length}, so these results stop at {when.days[when.days.length - 1]}.
        </p>
      ) : null}

      {anyDemo ? (
        <div className="mt-6">
          <DemoBanner locale={market.defaultLocale} />
        </div>
      ) : null}

      <div className="mt-6">
        <ChatPanel
          marketSlug={market.slug}
          locale={market.defaultLocale}
          query={currentQuery}
          chips={chips}
          said={q.said}
          missed={q.missed}
          question={
            q.ask !== undefined
              ? {
                  prompt: copy.whoIsComingQuestion,
                  answers: (['kids', 'teens', 'adults_only'] as const).map((band) => ({
                    label: copy.ageBands[band] ?? band,
                    href: toHref(market.slug, { ...currentQuery, ageBands: [band] }),
                  })),
                }
              : undefined
          }
        />
      </div>

      <RefinePanel
        marketSlug={market.slug}
        locale={market.defaultLocale}
        currencyCode={market.currency}
        bands={bands}
        vocabulary={vocabulary}
        kinds={kinds}
        unconfirmedByMustHave={response.unconfirmedByMustHave}
        // Opened when nothing matched: the panel is the answer to "why", and
        // making the user find it first would be the wrong default exactly
        // when they need it.
        open={response.eligible.length === 0}
        state={{
          when: q.when,
          band: q.band,
          party: q.party,
          budget: q.budget,
          tags: request.softPreferences.experienceTags,
          mustHaves: request.mustHaves,
          outingKinds: request.outingKinds,
          ageBands: request.ageBands,
          noise: request.softPreferences.noiseLevel,
        }}
      />

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          {copy.shortlist} ({response.eligible.length})
        </h2>

        {response.eligible.length === 0 ? (
          <div className="mt-3 rounded-lg border border-neutral-300 bg-neutral-50 px-4 py-4">
            <p className="text-sm font-medium text-neutral-900">{copy.noResults}</p>
            {response.relaxations.length > 0 ? (
              <>
                <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  {copy.whatWouldHelp}
                </h3>
                <ul className="mt-1 list-disc space-y-1 ps-5 text-sm text-neutral-700">
                  {response.relaxations.map((r) => (
                    <li key={r.constraint}>
                      {describeRelaxation(r, market.defaultLocale, market.currency)}
                      <span className="ms-1 text-xs text-neutral-500">({r.blockedCount})</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        ) : (
          <div className="mt-3 space-y-4">
            {response.eligible.map((result, index) => (
              <ResultCard
                key={result.candidate.venueId}
                result={result}
                marketSlug={market.slug}
                locale={market.defaultLocale}
                currencyCode={market.currency}
                tagLabels={tagLabels}
                position={index + 1}
              />
            ))}
          </div>
        )}
      </section>

      {response.needsConfirmation.length > 0 ? (
        <section className="mt-10">
          {/* Collapsed by default, and never counted in the shortlist (ADR-011). */}
          <details className="rounded-lg border border-amber-300 bg-amber-50/50">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-amber-900">
              {copy.needsConfirmation} ({response.needsConfirmation.length})
            </summary>
            <div className="border-t border-amber-200 px-4 py-4">
              <p className="text-sm text-amber-900">{copy.needsConfirmationNote}</p>
              <div className="mt-4 space-y-4">
                {response.needsConfirmation.map((result) => (
                  <ResultCard
                    key={result.candidate.venueId}
                    result={result}
                    marketSlug={market.slug}
                    locale={market.defaultLocale}
                    currencyCode={market.currency}
                    tagLabels={tagLabels}
                  />
                ))}
              </div>
            </div>
          </details>
        </section>
      ) : null}

      {response.excluded.length > 0 ? (
        <section className="mt-10">
          <details className="rounded-lg border border-neutral-300">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-neutral-700">
              {copy.excluded} ({response.excluded.length})
            </summary>
            <ul className="border-t border-neutral-200 px-4 py-3 text-sm">
              {response.excluded.map((result) => (
                <li key={result.candidate.venueId} className="py-1.5">
                  <span className="font-medium text-neutral-900">
                    {result.candidate.displayName}
                  </span>
                  <span className="text-neutral-600">
                    {' — '}
                    {result.outcomes
                      .filter((o) => o.outcome === 'fail')
                      .map((o) => {
                        const d = describeOutcome(o, market.defaultLocale, market.currency);
                        return `${d.label}: ${d.detail}`;
                      })
                      .join('; ')}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </section>
      ) : null}

      <p className="mt-10 font-mono text-xs text-neutral-400">
        {copy.rankingVersion} {response.rankingVersion} · {candidates.length} considered
      </p>
    </main>
  );
}
