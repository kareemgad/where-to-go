import { describe, expect, it } from 'vitest';

import { currency, priceBand } from '@/lib/money';
import { fixedClock, localDate, localTime, occurrenceFromLocal } from '@/lib/time';
import type { EvidenceState, SourceAuthority } from '@/modules/evidence/confidence';
import { evaluateCandidate } from './eligibility';
import { RANKING_VERSION, assembleResponse, scoreCandidate } from './ranking';
import type {
  Attributed,
  Candidate,
  CandidateExperience,
  SearchRequest,
  Verdict,
} from './types';

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
    noiseBand: unknown<'quiet' | 'moderate' | 'loud'>(),
    outdoorSeating: unknown<boolean>(),
    familyFriendly: unknown<boolean>(),
    wheelchairAccessible: unknown<boolean>(),
    observationCount: 0,
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

function candidate(overrides: Partial<Candidate> & Pick<Candidate, 'venueSlug'>): Candidate {
  return {
    venueId: `id-${overrides.venueSlug}`,
    displayName: overrides.venueSlug,
    isDemoData: true,
    bookingUrl: 'https://example.invalid/reserve',
    neighborhoodId: null,
    distanceMeters: null,
    experience: experience(),
    price: null,
    occurrence: null,
    ...overrides,
  };
}

/** Friday 19:00-23:00, four adults, live music, AED 300 ceiling. */
function baseRequest(overrides: Partial<SearchRequest> = {}): SearchRequest {
  return {
    marketId: 'market-dubai',
    timezone: TZ,
    currency: AED,
    locale: 'en-AE',
    date: localDate(FRIDAY),
    fromTime: localTime('19:00'),
    toTime: localTime('23:00'),
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
