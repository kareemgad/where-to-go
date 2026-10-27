/**
 * Deterministic eligibility. No model, no heuristics, no scoring — this decides
 * only whether a candidate may be offered at all, and it runs before ranking
 * (doc 03 step 1, doc 13).
 *
 * The two rules that matter:
 *
 *  1. An unknown is never a pass. If a hard constraint cannot be evaluated,
 *     the candidate becomes `needs_confirmation` — shown in a separate,
 *     collapsed section, excluded from the shortlist count (ADR-011). It does
 *     not quietly join the ranked list.
 *
 *  2. A failure beats an unknown. One definite `fail` excludes the candidate
 *     however many other constraints passed, because a hard constraint is a
 *     requirement and not a weighting.
 */

import { compareToCeiling, money, priceBand } from '@/lib/money';
import { hasEnded, overlapsWindow, searchWindow } from '@/lib/time';
import type { Clock, LocalDate } from '@/lib/time';
import { satisfiesHardConstraint } from '@/modules/evidence/confidence';
import { YOUNGEST_IN_BAND } from './types';
import type {
  Attributed,
  Candidate,
  CandidateOccurrence,
  ConstraintOutcome,
  DayEvaluation,
  MustHave,
  SearchRequest,
  Verdict,
} from './types';

/**
 * Evaluate one boolean published attribute against a requirement.
 *
 * Three outcomes, not two. `true` with weak evidence is still unconfirmed:
 * a conflicting or stale accessibility claim is exactly the case where
 * promising a wheelchair user step-free access would be worst.
 */
function evaluateBoolean(
  attribute: Attributed<boolean>,
): Pick<ConstraintOutcome, 'outcome' | 'grounds'> {
  if (attribute.value === null || !satisfiesHardConstraint(attribute.evidenceState)) {
    return { outcome: 'unconfirmed', grounds: { kind: 'attribute_unknown' } };
  }
  if (attribute.value) {
    return {
      outcome: 'pass',
      grounds: { kind: 'attribute_true', evidenceState: attribute.evidenceState },
    };
  }
  return {
    outcome: 'fail',
    grounds: { kind: 'attribute_false', evidenceState: attribute.evidenceState },
  };
}

/**
 * Where each must-have reads its answer from.
 *
 * A table rather than a switch so the list of must-haves, the UI controls and
 * the unconfirmed counts all iterate the same thing. `live_performance` is
 * absent because it is the one that depends on the day.
 */
const BOOLEAN_SOURCES: Readonly<
  Record<Exclude<MustHave, 'live_performance'>, (c: Candidate) => Attributed<boolean>>
> = {
  outdoor_seating: (c) => c.experience.outdoorSeating,
  indoor_seating: (c) => c.experience.indoorSeating,
  wheelchair_accessible: (c) => c.experience.wheelchairAccessible,
  kids_welcome: (c) => c.experience.familyFriendly,
  licensed: (c) => c.policies.licensed,
  alcohol_free: (c) => c.policies.alcoholFree,
  halal: (c) => c.policies.halal,
  takes_reservations: (c) => c.policies.takesReservations,
  open_past_midnight: (c) => c.policies.openPastMidnight,
};

/**
 * The first recommendable occurrence overlapping one day's window.
 *
 * Picked here rather than in SQL because the window rule — overlap not
 * containment, late-night ranges rolling into the next day — already lives in
 * lib/time, and a second copy of it in a query would be a second chance to
 * disagree about what "Friday 22:00 to 02:00" means.
 */
function occurrenceOnDay(
  candidate: Candidate,
  request: SearchRequest,
  date: LocalDate,
  clock: Clock,
): CandidateOccurrence | null {
  const window = searchWindow({
    date,
    fromTime: request.when.fromTime,
    toTime: request.when.toTime,
    timezone: request.timezone,
  });

  const usable = candidate.occurrences
    .filter(
      (o) =>
        satisfiesHardConstraint(o.evidenceState) &&
        !hasEnded(o.time, clock) &&
        overlapsWindow(o.time, window),
    )
    .sort((a, b) => a.time.startsAt.getTime() - b.time.startsAt.getTime());

  return usable[0] ?? null;
}

/** The youngest age the stated party implies, or null if none is implied. */
function youngestInParty(request: SearchRequest): number | null {
  const ages = request.ageBands
    .map((band) => YOUNGEST_IN_BAND[band])
    .filter((age): age is number => age !== null);
  return ages.length === 0 ? null : Math.min(...ages);
}

/**
 * Judge one candidate against one day of the window.
 *
 * Everything except the live-performance constraint is a property of the venue
 * and does not vary by day, but it is re-evaluated per day anyway: a result
 * carries the outcomes that justify it, and outcomes computed against a
 * different day than the one shown would be an explanation of something else.
 */
export function evaluateCandidateOnDay(
  candidate: Candidate,
  request: SearchRequest,
  date: LocalDate,
  clock: Clock,
): DayEvaluation {
  const outcomes: ConstraintOutcome[] = [];
  const occurrence = occurrenceOnDay(candidate, request, date, clock);
  const required = new Set(request.mustHaves);

  // --- a live performance on this date, in this window ---------------------
  if (required.has('live_performance')) {
    // Doc 02 AC01 and AC02 together: a venue with no confirmed performance on
    // this date is excluded, and a past occurrence is never upcoming. The
    // repository only returns recommendable occurrences, so an empty result
    // here means the venue failed the confirmed-plus-evidence gate — including
    // the scheduled-but-unconfirmed case ADR-010 exists to exclude.
    outcomes.push(
      occurrence
        ? {
            constraint: 'live_performance',
            outcome: 'pass',
            grounds: { kind: 'confirmed_occurrence', occurrenceId: occurrence.id },
          }
        : {
            constraint: 'live_performance',
            outcome: 'fail',
            grounds: { kind: 'no_occurrence_in_window' },
          },
    );
  }

  // --- the nine stored must-haves ------------------------------------------
  for (const [key, read] of Object.entries(BOOLEAN_SOURCES) as [
    Exclude<MustHave, 'live_performance'>,
    (c: Candidate) => Attributed<boolean>,
  ][]) {
    if (!required.has(key)) continue;
    outcomes.push({ constraint: key, ...evaluateBoolean(read(candidate)) });
  }

  // --- minimum admission age -----------------------------------------------
  const youngest = youngestInParty(request);
  if (youngest !== null) {
    const minimumAge = candidate.policies.minimumAge;
    if (minimumAge.value === null || !satisfiesHardConstraint(minimumAge.evidenceState)) {
      // Nobody has told us the door policy. Turning up with a thirteen-year-old
      // and being refused is the outcome this refuses to risk silently.
      outcomes.push({
        constraint: 'minimum_age',
        outcome: 'unconfirmed',
        grounds: { kind: 'attribute_unknown' },
      });
    } else if (minimumAge.value > youngest) {
      outcomes.push({
        constraint: 'minimum_age',
        outcome: 'fail',
        grounds: {
          kind: 'age_minimum_too_high',
          minimumAge: minimumAge.value,
          youngestInParty: youngest,
        },
      });
    } else {
      outcomes.push({
        constraint: 'minimum_age',
        outcome: 'pass',
        grounds: { kind: 'age_minimum_ok', minimumAge: minimumAge.value },
      });
    }
  }

  // --- outing type ----------------------------------------------------------
  if (request.outingKinds.length > 0) {
    const wanted = new Set(request.outingKinds);
    const credible = candidate.kinds.filter((k) => satisfiesHardConstraint(k.evidenceState));
    const hit = credible.find((k) => wanted.has(k.key));

    if (hit) {
      outcomes.push({
        constraint: 'outing_type',
        outcome: 'pass',
        grounds: { kind: 'kind_matches', key: hit.key },
      });
    } else if (credible.length === 0) {
      outcomes.push({
        constraint: 'outing_type',
        outcome: 'unconfirmed',
        grounds: { kind: 'attribute_unknown' },
      });
    } else {
      // We know what this place is, and it is not what was asked for.
      outcomes.push({
        constraint: 'outing_type',
        outcome: 'fail',
        grounds: { kind: 'kind_mismatch', has: credible.map((k) => k.key) },
      });
    }
  }

  // --- budget ceiling ------------------------------------------------------
  if (request.budgetCeilingMinor !== undefined) {
    const ceiling = money(request.budgetCeilingMinor, request.currency);

    if (candidate.price === null || !satisfiesHardConstraint(candidate.price.evidenceState)) {
      // No credible price evidence. Not "cheap", not "expensive" — unknown.
      // Doc 02 AC04: shown as unknown and never guaranteed under budget.
      outcomes.push({
        constraint: 'budget',
        outcome: 'unconfirmed',
        grounds: { kind: 'price_unknown' },
      });
    } else {
      const band = priceBand({
        lowMinor: candidate.price.band.lowMinor,
        highMinor: candidate.price.band.highMinor,
        currency: candidate.price.band.currency,
        basis: candidate.price.band.basis,
        includesTax: candidate.price.band.includesTax,
        includesServiceCharge: candidate.price.band.includesServiceCharge,
      });

      if (band.currency !== request.currency || band.basis !== request.budgetBasis) {
        // Refusing to compare is the correct answer, not an error to swallow:
        // a per-person band against a minimum spend is a category mismatch,
        // and a converted amount must not gate eligibility.
        outcomes.push({
          constraint: 'budget',
          outcome: 'unconfirmed',
          grounds: { kind: 'price_unknown' },
        });
      } else {
        const comparison = compareToCeiling(band, ceiling, request.budgetBasis);
        if (comparison.kind === 'within') {
          outcomes.push({
            constraint: 'budget',
            outcome: 'pass',
            grounds: {
              kind: 'price_within',
              lowMinor: band.lowMinor,
              highMinor: band.highMinor,
            },
          });
        } else if (comparison.kind === 'straddles') {
          // Known to possibly exceed. Distinct from unknown (brief C5).
          outcomes.push({
            constraint: 'budget',
            outcome: 'unconfirmed',
            grounds: { kind: 'price_straddles', overByMinor: comparison.overBy.amountMinor },
          });
        } else {
          outcomes.push({
            constraint: 'budget',
            outcome: 'fail',
            grounds: { kind: 'price_above', overByMinor: comparison.overBy.amountMinor },
          });
        }
      }
    }
  }

  const verdict: Verdict = outcomes.some((o) => o.outcome === 'fail')
    ? 'excluded'
    : outcomes.some((o) => o.outcome === 'unconfirmed')
      ? 'needs_confirmation'
      : 'eligible';

  return { date, verdict, outcomes, occurrence };
}

/**
 * Judge a candidate against every day of the window.
 *
 * One evaluation per day, and the caller decides which day to show. Returning
 * the best day from here would mean deciding "best" without the score, and
 * ordering is ranking's job, not eligibility's.
 */
export function evaluateAcrossDays(
  candidate: Candidate,
  request: SearchRequest,
  clock: Clock,
): DayEvaluation[] {
  return request.when.days.map((date) => evaluateCandidateOnDay(candidate, request, date, clock));
}

/**
 * How many candidates each must-have could not decide, whether or not it is
 * currently switched on.
 *
 * Shown beside the controls so a filter that would quietly move half the
 * catalogue into the collapsed section says so before it is switched on. Run
 * against every must-have independently, because the question is "what would
 * this one cost me", not "what did the combination cost me".
 */
export function unconfirmedCounts(
  candidates: readonly Candidate[],
  mustHaves: readonly MustHave[],
): Partial<Record<MustHave, number>> {
  const counts: Partial<Record<MustHave, number>> = {};
  for (const key of mustHaves) {
    if (key === 'live_performance') continue; // decided per day, not per venue
    const read = BOOLEAN_SOURCES[key];
    counts[key] = candidates.filter((c) => {
      const attribute = read(c);
      return attribute.value === null || !satisfiesHardConstraint(attribute.evidenceState);
    }).length;
  }
  return counts;
}
