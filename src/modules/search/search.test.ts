import { describe, expect, it } from 'vitest';

import { currency, priceBand } from '@/lib/money';
import { fixedClock, localDate, localTime, occurrenceFromLocal } from '@/lib/time';
import type { EvidenceState, SourceAuthority } from '@/modules/evidence/confidence';
import { evaluateCandidateOnDay } from './eligibility';
import {
  RANKING_VERSION,
  assembleResponse as assembleDays,
  scoreCandidate as scoreOnDay,
} from './ranking';
import type {
  Attributed,
  Candidate,
  CandidateExperience,
  CandidateOccurrence,
  CandidatePolicies,
  DayEvaluation,
  NoiseBand,
  SearchRequest,
  SearchResponse,
  Verdict,
} from './types';
import { MAX_WINDOW_DAYS, resolveWhen } from './when';
import type { TimeBandHours } from './when';

/**
 * The acceptance table from doc 07 and the brief's vertical-slice section,
 * executed. These run offline against hand-built candidates: the database
 * enforces that an occurrence is confirmed and evidenced, and these assert what
 * the matcher then does with it.
 */

const AED = currency('AED');
const TZ = 'Asia/Dubai';
const FRIDAY = '2026-11-13';
// Midday on the Friday in question, so "upcoming" and "past" are unambiguous.
const CLOCK = fixedClock(`${FRIDAY}T12:00:00Z`);

const known = <T>(value: T, evidenceState: EvidenceState = 'source_claimed'): Attributed<T> => ({
  value,
  evidenceState,
});
const unknown = <T>(): Attributed<T> => ({ value: null, evidenceState: 'unknown' });

function experience(overrides: Partial<CandidateExperience> = {}): CandidateExperience {
  return {
    energy: unknown<number>(),
    conversationFriendliness: unknown<number>(),
    lighting: unknown<number>(),
    seatingComfort: unknown<number>(),
    noiseBand: unknown<NoiseBand>(),
    outdoorSeating: unknown<boolean>(),
    indoorSeating: unknown<boolean>(),
    familyFriendly: unknown<boolean>(),
    wheelchairAccessible: unknown<boolean>(),
    observationCount: 0,
    ...overrides,
  };
}

/** Everything unknown by default: a fixture must opt in to every fact. */
function policies(overrides: Partial<CandidatePolicies> = {}): CandidatePolicies {
  return {
    licensed: unknown<boolean>(),
    alcoholFree: unknown<boolean>(),
    halal: unknown<boolean>(),
    takesReservations: unknown<boolean>(),
    openPastMidnight: unknown<boolean>(),
    minimumAge: unknown<number>(),
    ...overrides,
  };
}

function occurrence(
  startTime: string,
  durationMinutes: number,
  genreTags: string[],
  options: {
    date?: string;
    evidenceState?: EvidenceState;
    sourceAuthority?: SourceAuthority;
  } = {},
) {
  const { occurrence: time } = occurrenceFromLocal({
    date: options.date ?? FRIDAY,
    startTime,
    durationMinutes,
    timezone: TZ,
    sourceExpression: `Fri ${startTime}`,
  });
  return {
    id: `occ-${startTime}-${options.date ?? FRIDAY}`,
    title: 'Fictional Set',
    genreTags,
    performanceType: 'live_band',
    artist: null,
    time,
    evidenceState: options.evidenceState ?? ('source_claimed' as EvidenceState),
    sourceAuthority: options.sourceAuthority ?? ('venue_attested' as SourceAuthority),
  };
}

function priceOf(low: number, high: number, evidenceState: EvidenceState = 'source_claimed') {
  return {
    band: priceBand({
      lowMinor: low,
      highMinor: high,
      currency: AED,
      basis: 'per_person' as const,
      includesTax: true,
      includesServiceCharge: false,
    }),
    evidenceState,
  };
}

/**
 * A candidate.
 *
 * `occurrence` is a convenience for the common single-night fixture; a venue
 * with a programme across several nights passes `occurrences` instead. Both
 * end up in the same array, because the engine evaluates per day and the
 * repository no longer picks a night on the venue's behalf.
 */
function candidate(
  overrides: Partial<Candidate> &
    Pick<Candidate, 'venueSlug'> & { occurrence?: CandidateOccurrence | null },
): Candidate {
  const { occurrence, ...rest } = overrides;
  return {
    venueId: `id-${overrides.venueSlug}`,
    displayName: overrides.venueSlug,
    isDemoData: true,
    bookingUrl: 'https://example.invalid/reserve',
    neighborhoodId: null,
    distanceMeters: null,
    experience: experience(),
    policies: policies(),
    kinds: [],
    tags: [],
    price: null,
    occurrences: occurrence ? [occurrence] : [],
    ...rest,
  };
}

/** The global default band hours, as migration 0024 seeds them. */
const BANDS: TimeBandHours[] = [
  { key: 'brunch', startsLocal: '10:00', endsLocal: '14:00' },
  { key: 'afternoon', startsLocal: '14:00', endsLocal: '17:00' },
  { key: 'evening', startsLocal: '19:00', endsLocal: '23:00' },
  { key: 'late_night', startsLocal: '22:00', endsLocal: '03:00' },
];

/** Dubai's weekend. Cairo's is Friday and Saturday; neither is assumed. */
const WEEKEND_SAT_SUN = [6, 7];
const WEEKEND_FRI_SAT = [5, 6];

/**
 * Evaluate against the request's first day.
 *
 * Most assertions here are about one night, and reading a day out of the
 * window at each call site would bury what they are actually testing.
 */
function evaluateCandidate(
  c: Candidate,
  r: SearchRequest,
  clock: typeof CLOCK,
): DayEvaluation {
  const day = r.when.days[0];
  if (!day) throw new Error('the request has no days');
  return evaluateCandidateOnDay(c, r, day, clock);
}

/** Score against the candidate's first occurrence, if it has one. */
function scoreCandidate(c: Candidate, r: SearchRequest) {
  return scoreOnDay(c, c.occurrences[0] ?? null, r);
}

/** Assemble from single-day evaluations, as most of these fixtures are. */
function assembleResponse(
  evaluated: readonly { candidate: Candidate; date?: string; verdict: Verdict; outcomes: DayEvaluation['outcomes']; occurrence: CandidateOccurrence | null }[],
  r: SearchRequest,
  shortlistSize?: number,
): SearchResponse {
  const entries = evaluated.map((e) => ({
    candidate: e.candidate,
    days: [
      {
        date: localDate(e.date ?? FRIDAY),
        verdict: e.verdict,
        outcomes: e.outcomes,
        occurrence: e.occurrence,
      },
    ],
  }));
  return shortlistSize === undefined
    ? assembleDays(entries, r, undefined)
    : assembleDays(entries, r, shortlistSize);
}

/** Friday 19:00-23:00, four adults, live music, AED 300 ceiling. */
function baseRequest(overrides: Partial<SearchRequest> = {}): SearchRequest {
  return {
    marketId: 'market-dubai',
    timezone: TZ,
    currency: AED,
    locale: 'en-AE',
    when: {
      days: [localDate(FRIDAY)],
      fromTime: localTime('19:00'),
      toTime: localTime('23:00'),
      bandKey: 'evening',
      truncatedFrom: null,
    },
    partySize: 4,
    budgetCeilingMinor: 30000,
    budgetBasis: 'per_person',
    hardConstraints: {
      liveMusic: true,
      wheelchairAccessible: false,
      outdoorSeating: false,
      familyFriendly: false,
      quietEnoughToTalk: false,
    },
    softPreferences: { genres: ['jazz'] },
    ...overrides,
  };
}

const verdictOf = (c: Candidate, r: SearchRequest = baseRequest()): Verdict =>
  evaluateCandidate(c, r, CLOCK).verdict;

// ---------------------------------------------------------------------------

describe('the vertical-slice acceptance table', () => {
  const jazzLoft = candidate({
    venueSlug: 'jazz-loft-test',
    price: priceOf(18000, 26000),
    occurrence: occurrence('20:00', 180, ['jazz']),
    experience: experience({
      conversationFriendliness: known(3),
      energy: known(3),
      wheelchairAccessible: known(true),
      observationCount: 4,
    }),
  });

  it('Jazz Loft is eligible: live jazz on the date, inside budget', () => {
    expect(verdictOf(jazzLoft)).toBe('eligible');
  });

  it('Quiet Courtyard is excluded: no live music (AC01)', () => {
    // The best conversation score in the set does not rescue it. A hard
    // constraint is a requirement, not a weighting.
    const quietCourtyard = candidate({
      venueSlug: 'quiet-courtyard-test',
      price: priceOf(12000, 22000),
      occurrence: null,
      experience: experience({ conversationFriendliness: known(5, 'corroborated') }),
    });
    expect(verdictOf(quietCourtyard)).toBe('excluded');
  });

  it('Rock Stage needs confirmation: 220-350 straddles a 300 ceiling (brief C5)', () => {
    const rockStage = candidate({
      venueSlug: 'rock-stage-test',
      price: priceOf(22000, 35000),
      occurrence: occurrence('21:00', 180, ['rock']),
      experience: experience({ conversationFriendliness: known(1) }),
    });
    const { verdict, outcomes } = evaluateCandidate(rockStage, baseRequest(), CLOCK);
    expect(verdict).toBe('needs_confirmation');

    const budget = outcomes.find((o) => o.constraint === 'budget');
    expect(budget?.outcome).toBe('unconfirmed');
    // Specifically straddling, not unknown: these are different states and the
    // user-facing copy differs.
    expect(budget?.grounds.kind).toBe('price_straddles');
    if (budget?.grounds.kind === 'price_straddles') {
      expect(budget.grounds.overByMinor).toBe(5000);
    }
  });

  it('Unknown Price needs confirmation for a different reason', () => {
    const unknownPrice = candidate({
      venueSlug: 'unknown-price-test',
      price: null,
      occurrence: occurrence('20:30', 150, ['arabic', 'oud'], {
        evidenceState: 'verified',
        sourceAuthority: 'editor_checked',
      }),
    });
    const { verdict, outcomes } = evaluateCandidate(unknownPrice, baseRequest(), CLOCK);
    expect(verdict).toBe('needs_confirmation');

    const budget = outcomes.find((o) => o.constraint === 'budget');
    // Not "straddles". No evidence is not evidence of a high price.
    expect(budget?.grounds.kind).toBe('price_unknown');
  });

  it('Expired Gig is excluded: its only occurrence has ended (AC02)', () => {
    const expired = candidate({
      venueSlug: 'expired-gig-test',
      price: priceOf(20000, 25000),
      occurrence: occurrence('21:00', 180, ['jazz'], { date: '2026-11-05' }),
    });
    expect(verdictOf(expired)).toBe('excluded');
  });

  it('Midnight Crossing is eligible: a 22:00-02:00 set answers a Friday query', () => {
    const midnight = candidate({
      venueSlug: 'midnight-crossing-test',
      price: priceOf(15000, 24000),
      occurrence: occurrence('22:00', 240, ['jazz', 'soul']),
    });
    expect(verdictOf(midnight)).toBe('eligible');
  });

  it('Scheduled Only is excluded: a rule is not evidence for a date (ADR-010)', () => {
    // The repository never returns an unconfirmed occurrence, so the matcher
    // sees null. This asserts the matcher does not invent one, and is the
    // single most important exclusion in the set.
    const scheduledOnly = candidate({
      venueSlug: 'scheduled-only-test',
      price: priceOf(17000, 25000),
      occurrence: null,
    });
    expect(verdictOf(scheduledOnly)).toBe('excluded');
  });

  it('Conflicting evidence cannot satisfy the live-music constraint', () => {
    const conflicting = candidate({
      venueSlug: 'conflicting-times-test',
      price: priceOf(19000, 26000),
      occurrence: occurrence('19:00', 180, ['jazz'], { evidenceState: 'conflicting' }),
    });
    // Doc 16 scenario 5: never resolved in the venue's favour.
    expect(verdictOf(conflicting)).toBe('excluded');
  });

  it('Stale evidence cannot satisfy it either', () => {
    const stale = candidate({
      venueSlug: 'stale-evidence-test',
      price: priceOf(19000, 26000),
      occurrence: occurrence('20:00', 180, ['jazz'], { evidenceState: 'stale' }),
    });
    expect(verdictOf(stale)).toBe('excluded');
  });
});

describe('unknown is never a silent pass (doc 13)', () => {
  const base = candidate({
    venueSlug: 'accessibility-unknown-test',
    price: priceOf(14000, 21000),
    occurrence: occurrence('19:30', 150, ['acoustic']),
    experience: experience({ conversationFriendliness: known(4) }),
  });

  it('unknown accessibility becomes needs_confirmation, not eligible', () => {
    const request = baseRequest({
      hardConstraints: {
        liveMusic: true,
        wheelchairAccessible: true,
        outdoorSeating: false,
        familyFriendly: false,
        quietEnoughToTalk: false,
      },
    });
    const { verdict, outcomes } = evaluateCandidate(base, request, CLOCK);
    expect(verdict).toBe('needs_confirmation');
    expect(
      outcomes.find((o) => o.constraint === 'wheelchair_accessible')?.grounds.kind,
    ).toBe('attribute_unknown');
  });

  it('known-false accessibility is excluded outright', () => {
    const inaccessible = candidate({
      ...base,
      venueSlug: 'inaccessible-test',
      experience: experience({
        conversationFriendliness: known(4),
        wheelchairAccessible: known(false),
      }),
    });
    const request = baseRequest({
      hardConstraints: {
        liveMusic: true,
        wheelchairAccessible: true,
        outdoorSeating: false,
        familyFriendly: false,
        quietEnoughToTalk: false,
      },
    });
    expect(verdictOf(inaccessible, request)).toBe('excluded');
  });

  it('a conflicting accessibility claim is unconfirmed, not a pass', () => {
    // The worst case to get wrong: promising step-free access on disputed
    // evidence.
    const disputed = candidate({
      ...base,
      venueSlug: 'disputed-access-test',
      experience: experience({
        conversationFriendliness: known(4),
        wheelchairAccessible: known(true, 'conflicting'),
      }),
    });
    const request = baseRequest({
      hardConstraints: {
        liveMusic: true,
        wheelchairAccessible: true,
        outdoorSeating: false,
        familyFriendly: false,
        quietEnoughToTalk: false,
      },
    });
    expect(verdictOf(disputed, request)).toBe('needs_confirmation');
  });

  it('a failure beats an unknown', () => {
    const both = candidate({
      venueSlug: 'fail-and-unknown-test',
      price: priceOf(40000, 50000), // definitely over the ceiling
      occurrence: occurrence('20:00', 180, ['jazz']),
      experience: experience({ wheelchairAccessible: unknown<boolean>() }),
    });
    const request = baseRequest({
      hardConstraints: {
        liveMusic: true,
        wheelchairAccessible: true,
        outdoorSeating: false,
        familyFriendly: false,
        quietEnoughToTalk: false,
      },
    });
    expect(verdictOf(both, request)).toBe('excluded');
  });
});

describe('quiet conversation as a hard constraint (doc 16 scenario 2)', () => {
  const request = baseRequest({
    hardConstraints: {
      liveMusic: true,
      wheelchairAccessible: false,
      outdoorSeating: false,
      familyFriendly: false,
      quietEnoughToTalk: true,
    },
  });

  it('excludes a venue with a stored low conversation score', () => {
    const loud = candidate({
      venueSlug: 'loud-test',
      price: priceOf(18000, 24000),
      occurrence: occurrence('20:00', 180, ['rock']),
      experience: experience({ conversationFriendliness: known(1) }),
    });
    expect(verdictOf(loud, request)).toBe('excluded');
  });

  it('flags an unknown conversation score rather than excluding or passing it', () => {
    const silent = candidate({
      venueSlug: 'no-conversation-data-test',
      price: priceOf(18000, 24000),
      occurrence: occurrence('20:00', 180, ['jazz']),
    });
    expect(verdictOf(silent, request)).toBe('needs_confirmation');
  });
});

describe('scoring (gaps G1 and G2)', () => {
  const request = baseRequest({
    budgetRangeLowMinor: 15000,
    softPreferences: { genres: ['jazz'], conversationFriendliness: 4 },
  });

  it('does not reward missing evidence', () => {
    const documented = candidate({
      venueSlug: 'documented-test',
      price: priceOf(18000, 22000),
      occurrence: occurrence('20:00', 180, ['jazz']),
      experience: experience({ conversationFriendliness: known(4) }),
    });
    const sparse = candidate({
      venueSlug: 'sparse-test',
      price: priceOf(18000, 22000),
      occurrence: occurrence('20:00', 180, ['jazz']),
      experience: experience(), // nothing known
    });

    const a = scoreCandidate(documented, request);
    const b = scoreCandidate(sparse, request);
    expect(a.score).toBeGreaterThan(b.score);
    // And the gap is visible as missing information, not as a quality judgement.
    expect(a.informationCompleteness).toBeGreaterThan(b.informationCompleteness);
  });

  it('drops a preference the user never expressed from the denominator', () => {
    // Not the venue's fault nobody asked about distance.
    const c = candidate({
      venueSlug: 'no-distance-test',
      price: priceOf(18000, 22000),
      occurrence: occurrence('20:00', 180, ['jazz']),
      experience: experience({ conversationFriendliness: known(4) }),
    });
    const { components } = scoreCandidate(c, request);
    expect(components.find((x) => x.key === 'distance')).toBeUndefined();
    expect(components.find((x) => x.key === 'music')).toBeDefined();
  });

  it('scores a genre match above a genre miss', () => {
    const match = candidate({
      venueSlug: 'genre-match-test',
      price: priceOf(18000, 22000),
      occurrence: occurrence('20:00', 180, ['jazz']),
    });
    const miss = candidate({
      venueSlug: 'genre-miss-test',
      price: priceOf(18000, 22000),
      occurrence: occurrence('20:00', 180, ['rock']),
    });
    expect(scoreCandidate(match, request).score).toBeGreaterThan(
      scoreCandidate(miss, request).score,
    );
  });

  it('keeps every score within 0..1 and records the ranking version', () => {
    const c = candidate({
      venueSlug: 'bounds-test',
      price: priceOf(18000, 22000),
      occurrence: occurrence('20:00', 180, ['jazz']),
      experience: experience({ conversationFriendliness: known(4) }),
    });
    const { score } = scoreCandidate(c, request);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
    expect(RANKING_VERSION).toMatch(/^v\d+\.\d+\.\d+$/);
  });
});

describe('assembling the response', () => {
  const request = baseRequest();

  const build = (slugs: { slug: string; verdict: Verdict }[]) =>
    slugs.map(({ slug, verdict }) => {
      const c =
        verdict === 'eligible'
          ? candidate({
              venueSlug: slug,
              price: priceOf(18000, 24000),
              occurrence: occurrence('20:00', 180, ['jazz']),
            })
          : verdict === 'needs_confirmation'
            ? candidate({
                venueSlug: slug,
                price: null,
                occurrence: occurrence('20:00', 180, ['jazz']),
              })
            : candidate({ venueSlug: slug, occurrence: null });
      return evaluateCandidate(c, request, CLOCK) as never as {
        candidate: Candidate;
        verdict: Verdict;
        outcomes: never[];
      };
    });

  it('keeps needs_confirmation out of the shortlist (ADR-011)', () => {
    const evaluated = [
      candidate({
        venueSlug: 'a-eligible',
        price: priceOf(18000, 24000),
        occurrence: occurrence('20:00', 180, ['jazz']),
      }),
      candidate({
        venueSlug: 'b-unknown-price',
        price: null,
        occurrence: occurrence('20:00', 180, ['jazz']),
      }),
      candidate({ venueSlug: 'c-no-music', occurrence: null }),
    ].map((c) => ({ candidate: c, ...evaluateCandidate(c, request, CLOCK) }));

    const response = assembleResponse(evaluated, request);

    expect(response.eligible.map((r) => r.candidate.venueSlug)).toEqual(['a-eligible']);
    expect(response.needsConfirmation.map((r) => r.candidate.venueSlug)).toEqual([
      'b-unknown-price',
    ]);
    expect(response.excluded.map((r) => r.candidate.venueSlug)).toEqual(['c-no-music']);
    // The shortlist count excludes the unproven candidate entirely.
    expect(response.eligible).toHaveLength(1);
  });

  it('caps the shortlist at five', () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      candidate({
        venueSlug: `v-${i}`,
        price: priceOf(18000, 24000),
        occurrence: occurrence('20:00', 180, ['jazz']),
      }),
    ).map((c) => ({ candidate: c, ...evaluateCandidate(c, request, CLOCK) }));

    expect(assembleResponse(many, request).eligible).toHaveLength(5);
  });

  it('explains a zero-result search instead of inventing matches (AC09)', () => {
    const evaluated = [
      candidate({ venueSlug: 'no-music-a', occurrence: null }),
      candidate({ venueSlug: 'no-music-b', occurrence: null }),
      candidate({
        venueSlug: 'too-dear',
        price: priceOf(40000, 50000),
        occurrence: occurrence('20:00', 180, ['jazz']),
      }),
    ].map((c) => ({ candidate: c, ...evaluateCandidate(c, request, CLOCK) }));

    const response = assembleResponse(evaluated, request);
    expect(response.eligible).toHaveLength(0);
    expect(response.relaxations.length).toBeGreaterThan(0);

    // The most commonly blocking constraint is reported first.
    expect(response.relaxations[0]?.constraint).toBe('live_music');

    const budget = response.relaxations.find((r) => r.constraint === 'budget');
    expect(budget?.suggestion.kind).toBe('raise_budget');
    if (budget?.suggestion.kind === 'raise_budget') {
      // Concretely what it would take, not a vague "try a higher budget".
      expect(budget.suggestion.toMinor).toBe(40000);
    }
  });

  it('offers no relaxations when results were found', () => {
    const evaluated = [
      candidate({
        venueSlug: 'fine',
        price: priceOf(18000, 24000),
        occurrence: occurrence('20:00', 180, ['jazz']),
      }),
    ].map((c) => ({ candidate: c, ...evaluateCandidate(c, request, CLOCK) }));

    expect(assembleResponse(evaluated, request).relaxations).toHaveLength(0);
  });

  it('orders ties deterministically', () => {
    const identical = ['z-venue', 'a-venue', 'm-venue'].map((slug) =>
      candidate({
        venueSlug: slug,
        price: priceOf(18000, 24000),
        occurrence: occurrence('20:00', 180, ['jazz']),
      }),
    ).map((c) => ({ candidate: c, ...evaluateCandidate(c, request, CLOCK) }));

    const first = assembleResponse(identical, request).eligible.map((r) => r.candidate.venueSlug);
    const second = assembleResponse(identical, request).eligible.map((r) => r.candidate.venueSlug);
    expect(first).toEqual(second);
    expect(first).toEqual(['a-venue', 'm-venue', 'z-venue']);
  });

  void build;
});

// ===========================================================================
// the when-window
// ===========================================================================

/**
 * Resolving when.
 *
 * Every assertion here passes the market's zone and weekend days in, because
 * the point of the module is that it holds neither. A suite that only ever
 * exercised one market would not notice the day a Dubai assumption was baked
 * into shared logic, which is the failure ADR-009 exists to prevent.
 */
describe('resolveWhen', () => {
  const DUBAI = 'Asia/Dubai';
  const CAIRO = 'Africa/Cairo';
  const LONDON = 'Europe/London';

  const resolve = (
    when: Parameters<typeof resolveWhen>[0]['when'],
    options: {
      timezone?: string;
      weekendDays?: number[];
      band?: string;
      clock?: typeof CLOCK;
    } = {},
  ) =>
    resolveWhen({
      when,
      bands: BANDS,
      timezone: options.timezone ?? DUBAI,
      weekendDays: options.weekendDays ?? WEEKEND_SAT_SUN,
      clock: options.clock ?? CLOCK,
      ...(options.band !== undefined ? { band: options.band } : {}),
    });

  it('resolves an exact date to that one day', () => {
    const resolved = resolve({ kind: 'date', date: localDate(FRIDAY) });
    expect(resolved.days).toEqual([FRIDAY]);
    expect(resolved.truncatedFrom).toBeNull();
  });

  it('defaults to the market evening', () => {
    const resolved = resolve({ kind: 'date', date: localDate(FRIDAY) });
    expect(resolved.bandKey).toBe('evening');
    expect(resolved.fromTime).toBe('19:00');
    expect(resolved.toTime).toBe('23:00');
  });

  it('honours an explicit band, including one crossing midnight', () => {
    const resolved = resolve({ kind: 'date', date: localDate(FRIDAY) }, { band: 'late_night' });
    expect(resolved.fromTime).toBe('22:00');
    // Earlier than the start: late night means tonight into tomorrow.
    expect(resolved.toTime).toBe('03:00');
  });

  it('falls back to evening rather than failing on an unknown band', () => {
    const resolved = resolve({ kind: 'date', date: localDate(FRIDAY) }, { band: 'nonsense' });
    expect(resolved.bandKey).toBe('evening');
  });

  it('resolves tonight in the market zone, not the system zone', () => {
    // 22:00 UTC is already the next day in Dubai (UTC+4) and not yet in
    // London. A resolver reading the server clock would hand one of the two
    // markets yesterday's shortlist.
    const lateClock = fixedClock('2026-11-13T22:00:00Z');
    expect(
      resolve(
        { kind: 'relative', phrase: { name: 'tonight' } },
        { timezone: DUBAI, clock: lateClock },
      ).days,
    ).toEqual(['2026-11-14']);
    expect(
      resolve(
        { kind: 'relative', phrase: { name: 'tonight' } },
        { timezone: LONDON, clock: lateClock },
      ).days,
    ).toEqual(['2026-11-13']);
  });

  it('resolves tomorrow one calendar day on', () => {
    expect(resolve({ kind: 'relative', phrase: { name: 'tomorrow' } }).days).toEqual([
      '2026-11-14',
    ]);
  });

  // The second-market test that matters most: the weekend is not the same
  // days in both pilot markets, and resolving it to Saturday and Sunday in
  // shared logic would be wrong in Cairo every single week.
  it('resolves this weekend to the days the market calls the weekend', () => {
    // CLOCK is midday on Friday 13 November 2026.
    const dubai = resolve(
      { kind: 'relative', phrase: { name: 'this_weekend' } },
      { timezone: DUBAI, weekendDays: WEEKEND_SAT_SUN },
    );
    const cairo = resolve(
      { kind: 'relative', phrase: { name: 'this_weekend' } },
      { timezone: CAIRO, weekendDays: WEEKEND_FRI_SAT },
    );

    expect(dubai.days).toEqual(['2026-11-14', '2026-11-15']);
    // Asked on a Friday, the Cairo weekend includes that same Friday.
    expect(cairo.days).toEqual(['2026-11-13', '2026-11-14']);
    expect(dubai.days).not.toEqual(cairo.days);
  });

  it('includes today when today is already a weekend day', () => {
    const saturday = fixedClock('2026-11-14T12:00:00Z');
    const resolved = resolve(
      { kind: 'relative', phrase: { name: 'this_weekend' } },
      { clock: saturday },
    );
    expect(resolved.days[0]).toBe('2026-11-14');
  });

  it('counts "next N days" inclusive of today', () => {
    const resolved = resolve({ kind: 'relative', phrase: { name: 'next_days', days: 3 } });
    expect(resolved.days).toEqual(['2026-11-13', '2026-11-14', '2026-11-15']);
  });

  it('rejects a nonsensical day count rather than guessing', () => {
    expect(() => resolve({ kind: 'relative', phrase: { name: 'next_days', days: 0 } })).toThrow();
    expect(() => resolve({ kind: 'relative', phrase: { name: 'next_days', days: 2.5 } })).toThrow();
  });

  it('resolves an explicit range inclusively', () => {
    const resolved = resolve({
      kind: 'range',
      from: localDate('2026-11-13'),
      to: localDate('2026-11-16'),
    });
    expect(resolved.days).toHaveLength(4);
    expect(resolved.days.at(-1)).toBe('2026-11-16');
  });

  it('refuses a range that ends before it starts', () => {
    expect(() =>
      resolve({ kind: 'range', from: localDate('2026-11-16'), to: localDate('2026-11-13') }),
    ).toThrow();
  });

  describe('the fourteen-day cap', () => {
    it('truncates a longer run and says how long was asked for', () => {
      const resolved = resolve({ kind: 'relative', phrase: { name: 'next_days', days: 30 } });
      expect(resolved.days).toHaveLength(MAX_WINDOW_DAYS);
      // The number asked for, not the number returned: a search that quietly
      // answers a narrower question is worse than one that says so.
      expect(resolved.truncatedFrom).toBe(30);
    });

    it('truncates a long explicit range the same way', () => {
      const resolved = resolve({
        kind: 'range',
        from: localDate('2026-11-01'),
        to: localDate('2026-11-30'),
      });
      expect(resolved.days).toHaveLength(MAX_WINDOW_DAYS);
      expect(resolved.truncatedFrom).toBe(30);
      expect(resolved.days.at(-1)).toBe('2026-11-14');
    });

    it('reports nothing when the window is exactly at the cap', () => {
      const resolved = resolve({
        kind: 'relative',
        phrase: { name: 'next_days', days: MAX_WINDOW_DAYS },
      });
      expect(resolved.days).toHaveLength(MAX_WINDOW_DAYS);
      expect(resolved.truncatedFrom).toBeNull();
    });
  });

  describe('daylight saving', () => {
    // Days are added as calendar days in the market zone. Adding 86,400,000
    // milliseconds instead would drop or repeat a date on the two transitions
    // a year, which is a wrong shortlist on exactly two nights.
    it('spans a spring-forward transition without skipping a date', () => {
      // British Summer Time begins on 29 March 2026.
      const resolved = resolve(
        { kind: 'range', from: localDate('2026-03-27'), to: localDate('2026-03-31') },
        { timezone: LONDON },
      );
      expect(resolved.days).toEqual([
        '2026-03-27',
        '2026-03-28',
        '2026-03-29',
        '2026-03-30',
        '2026-03-31',
      ]);
    });

    it('spans an autumn transition without repeating a date', () => {
      const resolved = resolve(
        { kind: 'range', from: localDate('2026-10-23'), to: localDate('2026-10-27') },
        { timezone: LONDON },
      );
      expect(resolved.days).toEqual([
        '2026-10-23',
        '2026-10-24',
        '2026-10-25',
        '2026-10-26',
        '2026-10-27',
      ]);
      expect(new Set(resolved.days).size).toBe(resolved.days.length);
    });

    it('keeps dates distinct and ascending across a Cairo transition', () => {
      // Egypt observes DST again from 2023. The exact rule is the zone
      // database's business; what this asserts is the property that has to
      // hold whatever the rule turns out to be.
      const resolved = resolve(
        { kind: 'relative', phrase: { name: 'next_days', days: 14 } },
        { timezone: CAIRO, clock: fixedClock('2026-10-24T09:00:00Z') },
      );
      expect(resolved.days).toHaveLength(14);
      expect(new Set(resolved.days).size).toBe(14);
      expect([...resolved.days].sort()).toEqual([...resolved.days]);
    });
  });
});

describe('per-day eligibility across a window', () => {
  const window = (days: string[], from = '19:00', to = '23:00') => ({
    days: days.map(localDate),
    fromTime: localTime(from),
    toTime: localTime(to),
    bandKey: 'evening',
    truncatedFrom: null,
  });

  const SAT = '2026-11-14';
  const SUN = '2026-11-15';

  it('returns a venue once, on its best day, listing the others', () => {
    const c = candidate({
      venueSlug: 'three-nights',
      occurrences: [
        occurrence('20:00', 180, ['rock'], { date: FRIDAY }),
        occurrence('20:00', 180, ['jazz'], { date: SAT }),
        occurrence('20:00', 180, ['rock'], { date: SUN }),
      ],
      price: priceOf(10000, 20000),
    });
    const request = baseRequest({ when: window([FRIDAY, SAT, SUN]) });

    const days = request.when.days.map((d) => evaluateCandidateOnDay(c, request, d, CLOCK));
    const response = assembleDays([{ candidate: c, days }], request);

    expect(response.eligible).toHaveLength(1);
    const result = response.eligible[0]!;
    // Saturday is the jazz night, and jazz is what the request asked for.
    expect(result.matchedDate).toBe(SAT);
    expect(result.otherMatchingDates).toEqual([FRIDAY, SUN]);
    expect(result.occurrence?.genreTags).toContain('jazz');
  });

  it('prefers an eligible day over one that only needs confirmation', () => {
    const c = candidate({
      venueSlug: 'one-good-night',
      occurrences: [occurrence('20:00', 180, ['jazz'], { date: SAT })],
      price: priceOf(10000, 20000),
    });
    const request = baseRequest({ when: window([FRIDAY, SAT]) });

    const days = request.when.days.map((d) => evaluateCandidateOnDay(c, request, d, CLOCK));
    const response = assembleDays([{ candidate: c, days }], request);

    expect(response.eligible).toHaveLength(1);
    expect(response.eligible[0]!.matchedDate).toBe(SAT);
    // Friday had no performance, so it is not offered as an alternative.
    expect(response.eligible[0]!.otherMatchingDates).toEqual([]);
  });

  it('excludes a venue with no performance anywhere in the window', () => {
    const c = candidate({ venueSlug: 'nothing-on', price: priceOf(10000, 20000) });
    const request = baseRequest({ when: window([FRIDAY, SAT, SUN]) });

    const days = request.when.days.map((d) => evaluateCandidateOnDay(c, request, d, CLOCK));
    const response = assembleDays([{ candidate: c, days }], request);

    expect(response.eligible).toHaveLength(0);
    expect(response.excluded).toHaveLength(1);
    // Still reported against a specific day, so the explanation is about
    // something rather than about nothing.
    expect(response.excluded[0]!.matchedDate).toBe(FRIDAY);
  });

  it('matches a set starting after midnight against a late-night window', () => {
    const c = candidate({
      venueSlug: 'after-midnight',
      // 00:30 on the Saturday belongs to the Friday late-night window.
      occurrences: [occurrence('00:30', 120, ['jazz'], { date: SAT })],
      price: priceOf(10000, 20000),
    });
    const request = baseRequest({ when: window([FRIDAY], '22:00', '03:00') });

    const days = request.when.days.map((d) => evaluateCandidateOnDay(c, request, d, CLOCK));
    expect(days[0]!.verdict).toBe('eligible');
    expect(days[0]!.occurrence).not.toBeNull();
  });

  it('carries the truncation notice onto the response', () => {
    const request = baseRequest({ when: { ...window([FRIDAY]), truncatedFrom: 30 } });
    const response = assembleDays([], request);
    expect(response.truncatedFromDays).toBe(30);
  });
});
