/**
 * Turn machine-readable constraint grounds into prose.
 *
 * Doc 13: "Explanation must reference stored claims, not generative
 * invention." So the explanation is assembled here from the typed grounds the
 * matcher produced, with every number substituted from a stored value. An LLM
 * may later rephrase this output; it may never be the source of it, and
 * nothing here calls one.
 *
 * Lives in the module rather than in a page so the CLI demo and the web UI
 * cannot drift into describing the same verdict differently.
 */

import { currency as toCurrency, format, formatBand, money } from '@/lib/money';
import { copyFor } from '@/modules/i18n/copy';
import type { ConstraintOutcome, Relaxation } from './types';

export interface DescribedOutcome {
  readonly mark: 'pass' | 'fail' | 'unconfirmed';
  readonly label: string;
  readonly detail: string;
}

export function describeOutcome(
  outcome: ConstraintOutcome,
  locale: string,
  currencyCode: string,
): DescribedOutcome {
  const copy = copyFor(locale);
  const label = copy.constraints[outcome.constraint] ?? outcome.constraint;
  const code = toCurrency(currencyCode);
  const g = outcome.grounds;

  const detail = ((): string => {
    switch (g.kind) {
      case 'confirmed_occurrence':
        return copy.confirmedForThisDate;
      case 'no_occurrence_in_window':
        return copy.noConfirmedPerformance;
      case 'price_within':
        return formatBand(
          {
            lowMinor: g.lowMinor,
            highMinor: g.highMinor,
            currency: code,
            basis: 'per_person',
            includesTax: true,
            includesServiceCharge: false,
          },
          locale,
        );
      case 'price_straddles':
        return `+${format(money(g.overByMinor, code), locale)}`;
      case 'price_above':
        return `+${format(money(g.overByMinor, code), locale)}`;
      case 'price_unknown':
        return copy.checkWithVenue;
      case 'attribute_true':
        // Names the provenance, not just "yes": whose word this is matters
        // most for the constraints people rely on (brief C4).
        return `${copy.availableHere} (${
          copy.confidence[g.evidenceState === 'verified' ? 'editor_verified' : 'venue_confirmed'] ?? ''
        })`;
      case 'attribute_false':
        return copy.notVerified;
      case 'attribute_unknown':
        return copy.notVerified;
      case 'noise_acceptable':
        return `${g.score}/5`;
      case 'noise_too_loud':
        return `${g.score}/5`;
      case 'venue_not_open':
        return copy.excluded;
    }
  })();

  return { mark: outcome.outcome, label, detail };
}

export function describeRelaxation(
  relaxation: Relaxation,
  locale: string,
  currencyCode: string,
): string {
  const copy = copyFor(locale);
  const code = toCurrency(currencyCode);
  const label = copy.constraints[relaxation.constraint] ?? relaxation.constraint;

  switch (relaxation.suggestion.kind) {
    case 'raise_budget':
      return `${label}: ${copy.raiseBudgetTo} ${format(money(relaxation.suggestion.toMinor, code), locale)}`;
    case 'try_another_date':
      return `${label}: ${copy.tryAnotherDate}`;
    case 'widen_time_window':
      return `${label}: ${copy.widenWindow}`;
    case 'drop_constraint':
      return `${label}: ${copy.dropRequirement}`;
  }
}
