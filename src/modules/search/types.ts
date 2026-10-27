/**
 * Search contract.
 *
 * Nothing here carries a default market, currency, timezone or locale: all four
 * arrive on the request, read from the market record (ADR-009). A request
 * without them does not typecheck, which is the cheapest possible enforcement.
 */

import type { CurrencyCode, PriceBand, PriceBasis } from '@/lib/money';
import type { EvidenceState, SourceAuthority } from '@/modules/evidence/confidence';
import type { LocalDate, OccurrenceTime } from '@/lib/time';
import type { ResolvedWhen } from './when';

/**
 * The ten things a user can require rather than prefer.
 *
 * A list rather than ten booleans: the UI shows a count of unconfirmed
 * candidates beside each one, and iterating a fixed list is what makes that
 * possible without naming all ten in three more places.
 *
 * Every one of these is tri-state in evaluation (ADR-011). Unknown is never a
 * pass — `live_performance` is the only one that can fail outright on absence,
 * because "no confirmed performance" is a fact about our evidence rather than
 * a gap in it.
 */
export type MustHave =
  | 'live_performance'
  | 'outdoor_seating'
  | 'indoor_seating'
  | 'wheelchair_accessible'
  | 'kids_welcome'
  | 'licensed'
  | 'alcohol_free'
  | 'halal'
  | 'takes_reservations'
  | 'open_past_midnight';

export const MUST_HAVES: readonly MustHave[] = [
  'live_performance',
  'outdoor_seating',
  'indoor_seating',
  'wheelchair_accessible',
  'kids_welcome',
  'licensed',
  'alcohol_free',
  'halal',
  'takes_reservations',
  'open_past_midnight',
];

/**
 * Who is coming, in bands.
 *
 * Bands about companions, never the user's own age, and never stored: the
 * selection lives in the URL for the life of one search. Only the two bands
 * with a minimum-age consequence gate anything; the other two are context the
 * soft signals use.
 */
export type AgeBand = 'kids' | 'teens' | 'adults_only' | 'seniors';

/**
 * The youngest age each band implies, for comparison against a venue's
 * minimum admission age. Deliberately conservative: a thirteen-year-old
 * refused at the door is a worse outcome than a venue missing from a list.
 */
export const YOUNGEST_IN_BAND: Readonly<Record<AgeBand, number | null>> = {
  kids: 0,
  teens: 13,
  // Neither constrains a minimum age.
  adults_only: null,
  seniors: null,
};

export interface SoftPreferences {
  /**
   * Vocabulary keys, not free text. The parser resolves what the user typed
   * onto these before the engine sees it, so matching compares meanings
   * rather than spellings.
   */
  readonly experienceTags: readonly string[];
  /** One of the four bands, or omitted for no preference. */
  readonly noiseLevel?: NoiseBand;
  /** 1-5; omitted means no preference rather than "don't care about it". */
  readonly energy?: number;
  readonly prefersOutdoor?: boolean;
}

export interface SearchRequest {
  readonly marketId: string;
  /** From the market record, never a constant. */
  readonly timezone: string;
  readonly currency: CurrencyCode;
  /** BCP 47, from market_locales. */
  readonly locale: string;

  /**
   * Already resolved into days and a clock window. The request carries the
   * answer rather than the question, so eligibility needs neither a clock nor
   * the market's band table to decide what "this weekend" meant.
   */
  readonly when: ResolvedWhen;

  /** Optional. Absent means group fit is not scored, not that the party is 4. */
  readonly partySize?: number;
  /**
   * Budget ceiling in the market's own currency. Never a converted figure: FX
   * is a presentation estimate and must not decide eligibility (doc 10).
   */
  readonly budgetCeilingMinor?: number;
  readonly budgetRangeLowMinor?: number;
  readonly budgetBasis: PriceBasis;

  readonly neighborhoodId?: string;

  readonly mustHaves: readonly MustHave[];
  /** Outing kinds the user will accept. Empty means no preference. */
  readonly outingKinds: readonly string[];
  /** Who is coming. Empty means unstated, which constrains nothing. */
  readonly ageBands: readonly AgeBand[];
  readonly softPreferences: SoftPreferences;
}

/** A published attribute with the evidence behind it, as search reads it. */
export interface Attributed<T> {
  readonly value: T | null;
  readonly evidenceState: EvidenceState;
}

/** Four bands, so the UI never offers a distinction the data cannot make. */
export type NoiseBand = 'quiet' | 'moderate' | 'lively' | 'loud';

export interface CandidateExperience {
  readonly energy: Attributed<number>;
  readonly conversationFriendliness: Attributed<number>;
  readonly lighting: Attributed<number>;
  readonly seatingComfort: Attributed<number>;
  readonly noiseBand: Attributed<NoiseBand>;
  readonly outdoorSeating: Attributed<boolean>;
  readonly indoorSeating: Attributed<boolean>;
  readonly familyFriendly: Attributed<boolean>;
  readonly wheelchairAccessible: Attributed<boolean>;
  readonly observationCount: number;
}

/**
 * Policy facts a visitor may plan an evening around.
 *
 * Tri-state like everything else: `value === null` is an absence of evidence,
 * never a quiet no. `minimumAge` of 0 is the verified statement that there is
 * no minimum, which is a different and more useful claim than not knowing.
 */
export interface CandidatePolicies {
  readonly licensed: Attributed<boolean>;
  readonly alcoholFree: Attributed<boolean>;
  readonly halal: Attributed<boolean>;
  readonly takesReservations: Attributed<boolean>;
  readonly openPastMidnight: Attributed<boolean>;
  readonly minimumAge: Attributed<number>;
}

export type ExperienceFacet = 'music' | 'setting' | 'occasion' | 'activity';

/** A tag asserted about a venue, with the evidence behind the assertion. */
export interface CandidateTag {
  readonly key: string;
  readonly facet: ExperienceFacet;
  readonly evidenceState: EvidenceState;
}

export interface CandidateKind {
  readonly key: string;
  readonly isPrimary: boolean;
  readonly evidenceState: EvidenceState;
}

export interface CandidateOccurrence {
  readonly id: string;
  readonly title: string;
  /** As the source wrote them, kept verbatim for display and audit. */
  readonly genreTags: readonly string[];
  /** The same programme resolved onto vocabulary keys, for matching. */
  readonly experienceTags: readonly string[];
  readonly performanceType: string;
  readonly artist: string | null;
  readonly time: OccurrenceTime;
  readonly evidenceState: EvidenceState;
  readonly sourceAuthority: SourceAuthority | null;
}

export interface Candidate {
  readonly venueId: string;
  readonly venueSlug: string;
  /** Localised for the request's locale, falling back to reference_name. */
  readonly displayName: string;
  readonly isDemoData: boolean;
  readonly bookingUrl: string | null;
  readonly neighborhoodId: string | null;
  readonly distanceMeters: number | null;
  readonly experience: CandidateExperience;
  readonly policies: CandidatePolicies;
  /** What this place is. Many kinds are possible; at most one is primary. */
  readonly kinds: readonly CandidateKind[];
  /** Experience tags asserted about the venue, each with its own evidence. */
  readonly tags: readonly CandidateTag[];
  readonly price: { readonly band: PriceBand; readonly evidenceState: EvidenceState } | null;
  /**
   * Every recommendable occurrence anywhere in the searched window, not one.
   * A venue is evaluated per day and returned on its best one, which it cannot
   * be if the repository has already picked a day on its behalf.
   */
  readonly occurrences: readonly CandidateOccurrence[];
}

/**
 * Tri-state eligibility (ADR-011, brief C5).
 *
 * The middle state exists because "we know this might exceed your budget" and
 * "we have no idea what this costs" are both failures to prove a constraint,
 * and neither is a pass — but hard-excluding both throws away most of a young
 * catalogue.
 */
export type Verdict = 'eligible' | 'needs_confirmation' | 'excluded';

export type ConstraintKey = MustHave | 'budget' | 'minimum_age' | 'outing_type' | 'venue_open';

/** Why a constraint passed, failed, or could not be decided. */
export interface ConstraintOutcome {
  readonly constraint: ConstraintKey;
  readonly outcome: 'pass' | 'fail' | 'unconfirmed';
  /**
   * Machine-readable grounds. Rendered into prose by the UI with the user's
   * locale, never by a language model: explanations must reference stored
   * claims, not generated text (doc 13).
   */
  readonly grounds:
    | { readonly kind: 'confirmed_occurrence'; readonly occurrenceId: string }
    | { readonly kind: 'no_occurrence_in_window' }
    | { readonly kind: 'price_within'; readonly lowMinor: number; readonly highMinor: number }
    | { readonly kind: 'price_straddles'; readonly overByMinor: number }
    | { readonly kind: 'price_above'; readonly overByMinor: number }
    | { readonly kind: 'price_unknown' }
    | { readonly kind: 'attribute_true'; readonly evidenceState: EvidenceState }
    | { readonly kind: 'attribute_false'; readonly evidenceState: EvidenceState }
    | { readonly kind: 'attribute_unknown' }
    | { readonly kind: 'age_minimum_ok'; readonly minimumAge: number }
    | {
        readonly kind: 'age_minimum_too_high';
        readonly minimumAge: number;
        readonly youngestInParty: number;
      }
    | { readonly kind: 'kind_matches'; readonly key: string }
    | { readonly kind: 'kind_mismatch'; readonly has: readonly string[] }
    | { readonly kind: 'venue_not_open' };
}

export interface ScoreComponent {
  readonly key:
    | 'experiences'
    | 'atmosphere'
    | 'budget'
    | 'distance'
    | 'seating_access'
    | 'freshness';
  readonly weight: number;
  /** 0..1, or null when there was no evidence to score. */
  readonly normalised: number | null;
  readonly contribution: number;
}

/** One candidate judged against one day of the window. */
export interface DayEvaluation {
  readonly date: LocalDate;
  readonly verdict: Verdict;
  readonly outcomes: readonly ConstraintOutcome[];
  /** The occurrence that satisfied the day, when one did. */
  readonly occurrence: CandidateOccurrence | null;
}

export interface SearchResult {
  readonly candidate: Candidate;
  readonly verdict: Verdict;
  readonly outcomes: readonly ConstraintOutcome[];
  /** The day this verdict belongs to: a venue is returned once, on its best. */
  readonly matchedDate: LocalDate;
  /** The occurrence on the matched day, when the match rests on one. */
  readonly occurrence: CandidateOccurrence | null;
  /**
   * Other days in the window reaching the same verdict, ascending. Listed so a
   * venue that works on four nights does not look like it works on one.
   */
  readonly otherMatchingDates: readonly LocalDate[];
  readonly score: number;
  readonly components: readonly ScoreComponent[];
  /**
   * Share of the scoring weight that had evidence behind it. Surfaced
   * separately rather than hidden inside the score (gap G1), so a thinly
   * documented venue reads as "we know little" rather than "it is poor".
   */
  readonly informationCompleteness: number;
  /**
   * How much of what the user asked for this place is known to offer: overlap
   * between the chosen tags and the stored ones, weighted by the evidence
   * behind each. Zero to one.
   *
   * Never presented as confidence, and never a model's opinion. It is
   * arithmetic over stored claims, and a venue scores low here either because
   * it does not match or because nobody has told us it does — which is why
   * informationCompleteness is reported beside it rather than folded in.
   */
  readonly matchStrength: number;
  /** Which of the requested tags were found, for the explanation. */
  readonly matchedTags: readonly string[];
  readonly rankingVersion: string;
}

export interface SearchResponse {
  readonly eligible: readonly SearchResult[];
  readonly needsConfirmation: readonly SearchResult[];
  readonly excluded: readonly SearchResult[];
  /** Why a zero-result search returned nothing, and what would change it. */
  readonly relaxations: readonly Relaxation[];
  readonly rankingVersion: string;
  /**
   * Set when the requested window was wider than the cap, carrying the number
   * of days asked for. A search that quietly answers a narrower question than
   * the one asked is worse than one that says so.
   */
  readonly truncatedFromDays: number | null;
  /**
   * Per must-have, how many candidates could not be decided either way.
   * Surfaced beside each control so a filter that would quietly hide half the
   * catalogue says so before it is switched on (ADR-011).
   */
  readonly unconfirmedByMustHave: Readonly<Partial<Record<MustHave, number>>>;
}

export interface Relaxation {
  readonly constraint: ConstraintKey;
  /** How many candidates this single constraint eliminated on its own. */
  readonly blockedCount: number;
  readonly suggestion:
    | { readonly kind: 'raise_budget'; readonly toMinor: number }
    | { readonly kind: 'drop_constraint' }
    | { readonly kind: 'try_another_date' }
    | { readonly kind: 'widen_time_window' };
}
