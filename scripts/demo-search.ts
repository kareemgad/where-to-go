#!/usr/bin/env node
/**
 * The vertical slice, end to end, against the seeded fixture world.
 *
 *   npm run demo:search
 *   FIXTURE_CLOCK=2026-10-26T12:00:00Z npm run demo:search
 *
 * Runs the brief's demonstration query — a Friday evening, live music, a budget
 * ceiling — through the real query layer, the real deterministic matcher and
 * the real ranking, then prints the verdict for every fixture with the grounds
 * behind it. Then runs the same code against Cairo with no changes at all: a
 * different currency, timezone, locale and script, which is the second-market
 * acceptance gate (doc 16 scenario 3).
 *
 * Everything shown is fictional demo data and is labelled as such.
 */

import postgres from 'postgres';

import { currency, format, formatBand, money } from '../src/lib/money.ts';
import { fixedClock, localDate, nextWeekdayOnOrAfter, systemClock } from '../src/lib/time.ts';
import { confidenceLabel } from '../src/modules/evidence/confidence.ts';
import { evaluateAcrossDays } from '../src/modules/search/eligibility.ts';
import { resolveWhen } from '../src/modules/search/when.ts';
import { loadTimeBands } from '../src/modules/taxonomy/queries.ts';
import { assembleResponse } from '../src/modules/search/ranking.ts';
import { findCandidates, loadMarketBySlug } from '../src/modules/search/repository.ts';
import type { ConstraintOutcome, SearchRequest, SearchResult } from '../src/modules/search/types.ts';

if (!process.env.DIRECT_URL) {
  console.error('DIRECT_URL is not set.');
  process.exit(1);
}

const clock = process.env.FIXTURE_CLOCK ? fixedClock(process.env.FIXTURE_CLOCK) : systemClock;

const sql = postgres(process.env.DIRECT_URL, {
  max: 1,
  idle_timeout: 10,
  connect_timeout: 15,
  onnotice: () => {},
});

/** Render the machine-readable grounds as prose. The UI does this with i18n. */
function describe(outcome: ConstraintOutcome, locale: string, currencyCode: string): string {
  const g = outcome.grounds;
  switch (g.kind) {
    case 'confirmed_occurrence':
      return 'a performance confirmed for this date';
    case 'no_occurrence_in_window':
      return 'no confirmed performance in this window';
    case 'price_within':
      return `typical spend ${formatBand(
        {
          lowMinor: g.lowMinor,
          highMinor: g.highMinor,
          currency: currency(currencyCode),
          basis: 'per_person',
          includesTax: true,
          includesServiceCharge: false,
        },
        locale,
      )} is inside your budget`;
    case 'price_straddles':
      return `could exceed your budget by up to ${format(
        money(g.overByMinor, currency(currencyCode)),
        locale,
      )}`;
    case 'price_above':
      return `starts ${format(money(g.overByMinor, currency(currencyCode)), locale)} over your budget`;
    case 'price_unknown':
      return 'spend not verified — check with the venue';
    case 'attribute_true':
      return `confirmed (${g.evidenceState})`;
    case 'attribute_false':
      return `not available (${g.evidenceState})`;
    case 'attribute_unknown':
      return 'not verified';
    case 'age_minimum_ok':
      return `minimum age ${g.minimumAge}`;
    case 'age_minimum_too_high':
      return `minimum age ${g.minimumAge}, above the youngest in your party (${g.youngestInParty})`;
    case 'kind_matches':
      return `this is a ${g.key}`;
    case 'kind_mismatch':
      return `not what you asked for; it is ${g.has.join(', ')}`;
    case 'venue_not_open':
      return 'venue is not open';
  }
}

function printResult(result: SearchResult, locale: string, currencyCode: string, rank?: number) {
  const c = result.candidate;
  const prefix = rank === undefined ? '    ' : `  ${rank}. `;
  const demo = c.isDemoData ? ' [DEMO DATA]' : '';
  console.log(`${prefix}${c.displayName}${demo}`);
  console.log(
    `       score ${result.score.toFixed(3)}   information ${(result.informationCompleteness * 100).toFixed(0)}% complete`,
  );

  const occurrence = result.occurrence;
  if (occurrence) {
    const t = occurrence.time;
    const label = confidenceLabel(
      'published',
      occurrence.evidenceState,
      occurrence.sourceAuthority ?? 'ai_extracted',
    );
    const crosses = t.localEndDate !== t.localStartDate ? ' (+1 day)' : '';
    console.log(
      `       ${occurrence.title} — ${t.localStartDate} ${t.localStartTime}-${t.localEndTime}${crosses} ${t.timezone}`,
    );
    console.log(
      `       evidence: ${label}${t.sourceExpression ? `, source said "${t.sourceExpression}"` : ''}`,
    );
  }
  if (result.otherMatchingDates.length > 0) {
    console.log(`       also on: ${result.otherMatchingDates.join(', ')}`);
  }

  if (c.price) {
    console.log(`       spend: ${formatBand(c.price.band, locale)} per person (${c.price.evidenceState})`);
  } else {
    console.log('       spend: not verified');
  }

  for (const outcome of result.outcomes) {
    const mark = outcome.outcome === 'pass' ? '+' : outcome.outcome === 'fail' ? 'x' : '?';
    console.log(`       ${mark} ${outcome.constraint}: ${describe(outcome, locale, currencyCode)}`);
  }

  console.log(
    `       ${c.bookingUrl ? `booking handoff: ${c.bookingUrl} (external — no booking is made)` : 'no booking link on file'}`,
  );
}

async function runScenario(marketSlug: string, label: string) {
  const market = await loadMarketBySlug(sql, marketSlug);
  if (!market) {
    console.error(`\nmarket "${marketSlug}" is not live — seed it first.`);
    return;
  }

  // Everything market-specific comes from the record. Nothing below mentions a
  // currency, timezone or locale by name (ADR-009).
  const ceilingMinor = market.currency === 'AED' ? 30000 : 150000;

  const request: SearchRequest = {
    marketId: market.id,
    timezone: market.timezone,
    currency: currency(market.currency),
    locale: market.defaultLocale,
    // The weekend as this market defines it, which is not the same days in
    // both pilot markets. Resolved rather than assumed (ADR-009).
    when: resolveWhen({
      // A week, so the demo exercises the multi-day window and the best-day
      // choice rather than a single night. How "this weekend" differs between
      // the two markets is shown separately below.
      when: { kind: 'relative', phrase: { name: 'next_days', days: 7 } },
      bands: await loadTimeBands(sql, market.id),
      timezone: market.timezone,
      weekendDays: market.weekendDays,
      clock,
    }),
    partySize: 4,
    budgetCeilingMinor: ceilingMinor,
    budgetBasis: 'per_person',
    mustHaves: ['live_performance'],
    outingKinds: [],
    ageBands: [],
    // Vocabulary keys, not free text. 'arabic' is an alias; 'arabic_music' is
    // the term, and the parser is what turns one into the other.
    softPreferences: { experienceTags: ['jazz', 'arabic_music'], noiseLevel: 'moderate' },
  };

  console.log(`\n${'='.repeat(78)}`);
  console.log(`${label}`);
  console.log(`${'='.repeat(78)}`);
  console.log(
    `market ${market.slug} | ${market.timezone} | ${market.currency} | ${market.defaultLocale}`,
  );
  console.log(
    `query: ${request.when.days[0]} -> ${request.when.days.at(-1)} (${request.when.days.length} days) ${request.when.fromTime}-${request.when.toTime}, party of ${request.partySize}, live music required,`,
  );
  console.log(
    `       ceiling ${format(money(ceilingMinor, currency(market.currency)), market.defaultLocale)} per person, prefers jazz or arabic`,
  );

  const candidates = await findCandidates(sql, request, clock);
  const evaluated = candidates.map((candidate) => ({
    candidate,
    days: evaluateAcrossDays(candidate, request, clock),
  }));
  const response = assembleResponse(evaluated, request);

  console.log(`\n  candidates considered: ${candidates.length}`);
  console.log(`  SHORTLIST (${response.eligible.length}) — all hard constraints satisfied`);
  if (response.eligible.length === 0) {
    console.log('    none');
  }
  response.eligible.forEach((r, i) => printResult(r, market.defaultLocale, market.currency, i + 1));

  console.log(
    `\n  NEEDS CONFIRMATION (${response.needsConfirmation.length}) — collapsed by default, not counted in the shortlist`,
  );
  if (response.needsConfirmation.length === 0) console.log('    none');
  response.needsConfirmation.forEach((r) => printResult(r, market.defaultLocale, market.currency));

  console.log(`\n  EXCLUDED (${response.excluded.length}) — with the reason, never silently dropped`);
  for (const r of response.excluded) {
    const failed = r.outcomes.filter((o) => o.outcome === 'fail');
    console.log(
      `    ${r.candidate.displayName}: ${failed
        .map((o) => `${o.constraint} — ${describe(o, market.defaultLocale, market.currency)}`)
        .join('; ')}`,
    );
  }

  if (response.relaxations.length > 0) {
    console.log('\n  WHAT WOULD CHANGE THE RESULT');
    for (const r of response.relaxations) {
      const suggestion =
        r.suggestion.kind === 'raise_budget'
          ? `raise the ceiling to ${format(money(r.suggestion.toMinor, currency(market.currency)), market.defaultLocale)}`
          : r.suggestion.kind === 'try_another_date'
            ? 'try another date'
            : r.suggestion.kind === 'widen_time_window'
              ? 'widen the time window'
              : 'drop this requirement';
      console.log(`    ${r.constraint} blocked ${r.blockedCount}: ${suggestion}`);
    }
  }

  console.log(`\n  ranking version ${response.rankingVersion}`);
}

try {
  console.log(`clock: ${clock.now().toISOString()}`);
  await runScenario('dubai', 'PILOT MARKET — the brief\'s demonstration query');
  await runScenario(
    'cairo',
    'SECOND MARKET — identical code, no changes (doc 16 scenario 3)',
  );

  // Same phrase, same code, different days. This is doc 10's acceptance gate
  // in four lines: a second market needs configuration, not a core-code fork.
  console.log(`
${'='.repeat(78)}`);
  console.log('ONE PHRASE, TWO MARKETS — "this weekend"');
  console.log(`${'='.repeat(78)}`);
  for (const slug of ['dubai', 'cairo']) {
    const m = await loadMarketBySlug(sql, slug);
    if (!m) continue;
    const resolved = resolveWhen({
      when: { kind: 'relative', phrase: { name: 'this_weekend' } },
      bands: await loadTimeBands(sql, m.id),
      timezone: m.timezone,
      weekendDays: m.weekendDays,
      clock,
    });
    console.log(
      `  ${m.slug.padEnd(6)} weekend days ${JSON.stringify(m.weekendDays)} -> ${resolved.days.join(', ')} (${resolved.fromTime}-${resolved.toTime} ${m.timezone})`,
    );
  }

  // The zero-result path, which must explain itself rather than invent matches.
  const market = await loadMarketBySlug(sql, 'dubai');
  if (market) {
    const request: SearchRequest = {
      marketId: market.id,
      timezone: market.timezone,
      currency: currency(market.currency),
      locale: market.defaultLocale,
      when: resolveWhen({
        when: {
          kind: 'date',
          date: localDate(nextWeekdayOnOrAfter(2, clock, market.timezone)), // a Tuesday
        },
        bands: await loadTimeBands(sql, market.id),
        timezone: market.timezone,
        weekendDays: market.weekendDays,
        clock,
      }),
      budgetCeilingMinor: 5000,
      budgetBasis: 'per_person',
      mustHaves: ['live_performance', 'wheelchair_accessible', 'halal'],
      outingKinds: [],
      ageBands: ['kids'],
      softPreferences: { experienceTags: ['jazz'], noiseLevel: 'quiet' },
    };

    console.log(`\n${'='.repeat(78)}`);
    console.log('ZERO-RESULT PATH — doc 02 AC09');
    console.log(`${'='.repeat(78)}`);
    console.log(
      `query: a Tuesday, live music, step-free, halal, kids coming, ceiling ${format(money(5000, currency(market.currency)), market.defaultLocale)}`,
    );

    const candidates = await findCandidates(sql, request, clock);
    const evaluated = candidates.map((candidate) => ({
      candidate,
      days: evaluateAcrossDays(candidate, request, clock),
    }));
    const response = assembleResponse(evaluated, request);

    console.log(`\n  shortlist: ${response.eligible.length} (expected 0)`);
    console.log('  explanation rather than a fabricated match:');
    for (const r of response.relaxations) {
      console.log(`    ${r.constraint} blocked ${r.blockedCount} candidate(s) — ${r.suggestion.kind}`);
    }
  }

  console.log('\nAll output above is fictional demo data and must never be shown as real venues.');
} catch (error) {
  console.error(`\nDemo failed: ${error instanceof Error ? error.message : String(error)}`);
  if (error instanceof Error && error.stack) console.error(error.stack);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
