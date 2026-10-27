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
import type { Clock } from '@/lib/time';
import { satisfiesHardConstraint } from '@/modules/evidence/confidence';
import type { Attributed } from './types';
import type {
  Candidate,
  CandidateOccurrence,
  ConstraintOutcome,
  DayEvaluation,
  SearchRequest,
  Verdict,
} from './types';
import type { LocalDate } from '@/lib/time';

/**
 * Evaluate one boolean published attribute against a requirement.
 *
 * Three outcomes, not two. `true` with weak evidence is still unconfirmed:
 * a conflicting or stale accessibility claim is exactly the case where
 * promising a wheelchair user step-free access would be worst.
 */
function evaluateBoolean(
  attribute: Attributed<boolean>,
  required: boolean,
): Pick<ConstraintOutcome, 'outcome' | 'grounds'> {
  if (!required) {
    return { outcome: 'pass', grounds: { kind: 'attribute_true', evidenceState: attribute.evidenceState } };
  }
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

/**
 * Judge one candidate against one day of the window.
 *
 * Everything except the live-music constraint is a property of the venue and
 * does not vary by day, but it is re-evaluated per day anyway: a result
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

  // --- live music on this date, in this window -----------------------------
  if (request.hardConstraints.liveMusic) {
    // Doc 02 AC01 and AC02 together: a venue with no confirmed performance on
    // this date is excluded, and a past occurrence is never upcoming. The
    // repository only returns recommendable occurrences, so an empty result
    // here means the venue failed the confirmed-plus-evidence gate — including
    // the scheduled-but-unconfirmed case ADR-010 exists to exclude.
    outcomes.push(
      occurrence
        ? {
            constraint: 'live_music',
            outcome: 'pass',
            grounds: { kind: 'confirmed_occurrence', occurrenceId: occurrence.id },
          }
        : {
            constraint: 'live_music',
            outcome: 'fail',
            grounds: { kind: 'no_occurrence_in_window' },
          },
    );
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

  // --- boolean access and amenity constraints ------------------------------
  if (request.hardConstraints.wheelchairAccessible) {
    outcomes.push({
      constraint: 'wheelchair_accessible',
      ...evaluateBoolean(candidate.experience.wheelchairAccessible, true),
    });
  }
  if (request.hardConstraints.outdoorSeating) {
    outcomes.push({
      constraint: 'outdoor_seating',
      ...evaluateBoolean(candidate.experience.outdoorSeating, true),
    });
  }
  if (request.hardConstraints.familyFriendly) {
    outcomes.push({
      constraint: 'family_friendly',
      ...evaluateBoolean(candidate.experience.familyFriendly, true),
    });
  }

  // --- quiet enough to hold a conversation ---------------------------------
  if (request.hardConstraints.quietEnoughToTalk) {
    const conversation = candidate.experience.conversationFriendliness;
    if (conversation.value === null || !satisfiesHardConstraint(conversation.evidenceState)) {
      outcomes.push({
        constraint: 'quiet_enough_to_talk',
        outcome: 'unconfirmed',
        grounds: { kind: 'attribute_unknown' },
      });
    } else if (conversation.value >= 3) {
      outcomes.push({
        constraint: 'quiet_enough_to_talk',
        outcome: 'pass',
        grounds: { kind: 'noise_acceptable', score: conversation.value },
      });
    } else {
      // Doc 16 scenario 2: exclude verified high-noise venues when quiet
      // conversation is a requirement. Never invent a sound measurement — this
      // is a stored conversation score, not a decibel reading.
      outcomes.push({
        constraint: 'quiet_enough_to_talk',
        outcome: 'fail',
        grounds: { kind: 'noise_too_loud', score: conversation.value },
      });
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
