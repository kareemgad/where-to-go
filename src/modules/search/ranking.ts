/**
 * Deterministic ranking. Runs only on candidates that already passed
 * eligibility (doc 03 steps 1-3). No model participates: an LLM may phrase the
 * explanation, but the ordering is arithmetic over stored values, and the
 * ranking version is recorded so any result can be reproduced.
 *
 * Weights are doc 03's tunable defaults. Two subtleties the specification left
 * open, resolved here:
 *
 *  - Gap G1. Two different things can make a component unscoreable: the user
 *    expressed no preference, or we have no evidence. They are not the same.
 *    A preference the user never stated is dropped from the denominator — it
 *    is not the venue's fault nobody asked. Evidence we lack scores zero
 *    against the full denominator, and is reported separately as information
 *    completeness, so a thinly documented venue reads as "we know little"
 *    rather than "it is poor".
 *
 *  - Gap G2. Budget is a hard ceiling in eligibility and a soft signal here.
 *    To avoid counting it twice, this scores position *within* the user's
 *    stated range, not distance from the ceiling.
 */

import { positionInRange, money } from '@/lib/money';
import { evidenceWeight } from '@/modules/evidence/confidence';
import type { EvidenceState } from '@/modules/evidence/confidence';
import type {
  Candidate,
  CandidateOccurrence,
  ConstraintKey,
  DayEvaluation,
  Relaxation,
  ScoreComponent,
  SearchRequest,
  SearchResponse,
  SearchResult,
  Verdict,
} from './types';

/** Bumped whenever weights or formulas change, and stored with every result. */
export const RANKING_VERSION = 'v0.1.0';

const WEIGHTS = {
  music: 0.3,
  atmosphere: 0.25,
  budget: 0.2,
  distance: 0.1,
  seating_access: 0.1,
  freshness: 0.05,
} as const;

/** A component the user's request makes relevant, scored or not. */
interface Scored {
  key: ScoreComponent['key'];
  /** 0..1, or null when we have no evidence to score it. */
  normalised: number | null;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** How close a 1-5 stored value sits to a 1-5 preference. */
function closeness(actual: number, preferred: number): number {
  return clamp01(1 - Math.abs(actual - preferred) / 4);
}

function scoreMusic(
  occurrence: CandidateOccurrence | null,
  request: SearchRequest,
): Scored | null {
  const wanted = request.softPreferences.genres;
  if (wanted.length === 0) return null; // no preference stated

  if (occurrence === null) return { key: 'music', normalised: 0 };

  const tags = new Set(occurrence.genreTags.map((t) => t.toLowerCase()));
  const hits = wanted.filter((g) => tags.has(g.toLowerCase())).length;
  return { key: 'music', normalised: clamp01(hits / wanted.length) };
}

function scoreAtmosphere(candidate: Candidate, request: SearchRequest): Scored | null {
  const { conversationFriendliness, energy } = request.softPreferences;
  if (conversationFriendliness === undefined && energy === undefined) return null;

  const parts: number[] = [];
  if (conversationFriendliness !== undefined) {
    const actual = candidate.experience.conversationFriendliness;
    if (actual.value !== null) parts.push(closeness(actual.value, conversationFriendliness));
  }
  if (energy !== undefined) {
    const actual = candidate.experience.energy;
    if (actual.value !== null) parts.push(closeness(actual.value, energy));
  }
  if (parts.length === 0) return { key: 'atmosphere', normalised: null }; // asked, no evidence
  return { key: 'atmosphere', normalised: parts.reduce((a, b) => a + b, 0) / parts.length };
}

function scoreBudget(candidate: Candidate, request: SearchRequest): Scored | null {
  if (request.budgetCeilingMinor === undefined) return null;
  if (candidate.price === null) return { key: 'budget', normalised: null };

  const ceiling = request.budgetCeilingMinor;
  const low = request.budgetRangeLowMinor;

  // Gap G2: when a range was stated, score position inside it. The ceiling has
  // already done its work in eligibility and must not be re-applied here.
  if (low !== undefined) {
    const within = positionInRange(
      candidate.price.band,
      money(low, request.currency),
      money(ceiling, request.currency),
    );
    return { key: 'budget', normalised: within };
  }

  const midpoint = (candidate.price.band.lowMinor + candidate.price.band.highMinor) / 2;
  return { key: 'budget', normalised: clamp01(1 - midpoint / ceiling) };
}

function scoreDistance(candidate: Candidate, request: SearchRequest): Scored | null {
  // Gap G3: distance is measured from the selected neighbourhood centroid. With
  // no neighbourhood chosen there is nothing to measure from, so the weight is
  // redistributed rather than guessed.
  if (request.neighborhoodId === undefined) return null;
  if (candidate.distanceMeters === null) return { key: 'distance', normalised: null };

  // 3km is treated as the edge of "nearby"; beyond that the signal flattens.
  return { key: 'distance', normalised: clamp01(1 - candidate.distanceMeters / 3000) };
}

function scoreSeatingAccess(candidate: Candidate, request: SearchRequest): Scored | null {
  const prefersOutdoor = request.softPreferences.prefersOutdoor;
  if (prefersOutdoor === undefined) return null;

  const outdoor = candidate.experience.outdoorSeating;
  const seating = candidate.experience.seatingComfort;

  const parts: number[] = [];
  if (outdoor.value !== null) parts.push(outdoor.value === prefersOutdoor ? 1 : 0);
  if (seating.value !== null) parts.push((seating.value - 1) / 4);

  if (parts.length === 0) return { key: 'seating_access', normalised: null };
  return { key: 'seating_access', normalised: parts.reduce((a, b) => a + b, 0) / parts.length };
}

function scoreFreshness(candidate: Candidate, occurrence: CandidateOccurrence | null): Scored {
  // Doc 03 step 4: penalise stale or unverified evidence. Always applicable,
  // because freshness is a property of what we hold rather than of what the
  // user asked for.
  const states: EvidenceState[] = [];
  if (occurrence) states.push(occurrence.evidenceState);
  if (candidate.price) states.push(candidate.price.evidenceState);
  states.push(candidate.experience.conversationFriendliness.evidenceState);

  const weights = states.map(evidenceWeight);
  return {
    key: 'freshness',
    normalised: weights.reduce((a, b) => a + b, 0) / weights.length,
  };
}

/**
 * Score one candidate as it stands on one day.
 *
 * The occurrence is passed in rather than read from the candidate, because a
 * venue in a fourteen-day window has as many occurrences as it has nights and
 * the score belongs to the night being offered.
 */
export function scoreCandidate(
  candidate: Candidate,
  occurrence: CandidateOccurrence | null,
  request: SearchRequest,
): { score: number; components: ScoreComponent[]; informationCompleteness: number } {
  const scored: Scored[] = [
    scoreMusic(occurrence, request),
    scoreAtmosphere(candidate, request),
    scoreBudget(candidate, request),
    scoreDistance(candidate, request),
    scoreSeatingAccess(candidate, request),
    scoreFreshness(candidate, occurrence),
  ].filter((s): s is Scored => s !== null);

  const components: ScoreComponent[] = scored.map((s) => {
    const weight = WEIGHTS[s.key];
    return {
      key: s.key,
      weight,
      normalised: s.normalised,
      // A component we cannot score contributes nothing. It is not assumed
      // average, and it is certainly not assumed good.
      contribution: s.normalised === null ? 0 : s.normalised * weight,
    };
  });

  const denominator = components.reduce((sum, c) => sum + c.weight, 0);
  if (denominator === 0) {
    return { score: 0, components, informationCompleteness: 0 };
  }

  const total = components.reduce((sum, c) => sum + c.contribution, 0);
  const evidenced = components
    .filter((c) => c.normalised !== null)
    .reduce((sum, c) => sum + c.weight, 0);

  return {
    score: total / denominator,
    components,
    informationCompleteness: evidenced / denominator,
  };
}

/**
 * What a user could change to get results. Only reported when something was
 * actually blocked — never a generic nudge, and never by dropping a hard
 * constraint silently (doc 02 AC09).
 */
export function buildRelaxations(
  results: readonly SearchResult[],
  request: SearchRequest,
): Relaxation[] {
  const blocked = new Map<ConstraintKey, number>();
  let highestAffordableMinor: number | null = null;

  for (const result of results) {
    if (result.verdict === 'eligible') continue;
    for (const outcome of result.outcomes) {
      if (outcome.outcome === 'pass') continue;

      // A relaxation must plausibly change the answer, or it is noise dressed
      // as help. Raising a budget ceiling fixes a price that is too high and a
      // band that straddles the ceiling; it does nothing whatsoever for a price
      // nobody has evidence for. Those candidates are already surfaced in the
      // needs-confirmation section, which is the honest route to them.
      if (outcome.grounds.kind === 'price_unknown') continue;

      blocked.set(outcome.constraint, (blocked.get(outcome.constraint) ?? 0) + 1);

      if (outcome.grounds.kind === 'price_above' || outcome.grounds.kind === 'price_straddles') {
        const needed = (request.budgetCeilingMinor ?? 0) + outcome.grounds.overByMinor;
        if (highestAffordableMinor === null || needed < highestAffordableMinor) {
          highestAffordableMinor = needed;
        }
      }
    }
  }

  const relaxations: Relaxation[] = [];
  for (const [constraint, blockedCount] of blocked) {
    if (constraint === 'budget' && highestAffordableMinor !== null) {
      relaxations.push({
        constraint,
        blockedCount,
        suggestion: { kind: 'raise_budget', toMinor: highestAffordableMinor },
      });
    } else if (constraint === 'live_music') {
      relaxations.push({
        constraint,
        blockedCount,
        suggestion: { kind: 'try_another_date' },
      });
    } else {
      relaxations.push({ constraint, blockedCount, suggestion: { kind: 'drop_constraint' } });
    }
  }

  return relaxations.sort((a, b) => b.blockedCount - a.blockedCount);
}

/** Worse verdicts sort later. A venue is offered on the best day it has. */
const VERDICT_RANK: Record<Verdict, number> = {
  eligible: 0,
  needs_confirmation: 1,
  excluded: 2,
};

export interface CandidateDays {
  readonly candidate: Candidate;
  readonly days: readonly DayEvaluation[];
}

/**
 * Collapse a candidate's per-day evaluations into the one result to show.
 *
 * Best verdict first, then highest score, then earliest date. Scoring before
 * choosing is the point: with a fourteen-day window the first matching night
 * is rarely the best one, and picking by date would quietly bury a strong
 * Saturday behind a thin Tuesday.
 *
 * The other days reaching that same verdict are carried alongside, so a venue
 * that works on four nights does not read as working on one.
 */
function bestDay(
  entry: CandidateDays,
  request: SearchRequest,
): SearchResult | null {
  if (entry.days.length === 0) return null;

  const bestRank = Math.min(...entry.days.map((d) => VERDICT_RANK[d.verdict]));
  const tier = entry.days.filter((d) => VERDICT_RANK[d.verdict] === bestRank);

  const scoredTier = tier.map((day) => ({
    day,
    ...scoreCandidate(entry.candidate, day.occurrence, request),
  }));

  scoredTier.sort((a, b) => b.score - a.score || a.day.date.localeCompare(b.day.date));
  const chosen = scoredTier[0];
  if (!chosen) return null;

  return {
    candidate: entry.candidate,
    verdict: chosen.day.verdict,
    outcomes: chosen.day.outcomes,
    matchedDate: chosen.day.date,
    occurrence: chosen.day.occurrence,
    otherMatchingDates: tier
      .map((d) => d.date)
      .filter((date) => date !== chosen.day.date)
      .sort(),
    score: chosen.score,
    components: chosen.components,
    informationCompleteness: chosen.informationCompleteness,
    rankingVersion: RANKING_VERSION,
  };
}

/**
 * Assemble the response: ranked within each verdict bucket, never across them.
 *
 * ADR-011: needs_confirmation candidates are a separate, collapsed section and
 * are excluded from the three-to-five shortlist. Interleaving them by score
 * would make an unproven candidate outrank a proven one, which is precisely
 * the inflation of apparent coverage the brief warned about.
 *
 * Each venue appears exactly once, on its best day.
 */
export function assembleResponse(
  evaluated: readonly CandidateDays[],
  request: SearchRequest,
  shortlistSize = 5,
): SearchResponse {
  const scoredResults = evaluated
    .map((entry) => bestDay(entry, request))
    .filter((r): r is SearchResult => r !== null);

  const byScore = (a: SearchResult, b: SearchResult) =>
    b.score - a.score ||
    // Deterministic tie-break, so the same query never reorders between runs.
    a.candidate.venueSlug.localeCompare(b.candidate.venueSlug);

  const eligible = scoredResults.filter((r) => r.verdict === 'eligible').sort(byScore);
  const needsConfirmation = scoredResults
    .filter((r) => r.verdict === 'needs_confirmation')
    .sort(byScore);
  const excluded = scoredResults.filter((r) => r.verdict === 'excluded').sort(byScore);

  return {
    eligible: eligible.slice(0, shortlistSize),
    needsConfirmation,
    excluded,
    relaxations: eligible.length === 0 ? buildRelaxations(scoredResults, request) : [],
    rankingVersion: RANKING_VERSION,
    truncatedFromDays: request.when.truncatedFrom,
  };
}
