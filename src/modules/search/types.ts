/**
 * Search contract.
 *
 * Nothing here carries a default market, currency, timezone or locale: all four
 * arrive on the request, read from the market record (ADR-009). A request
 * without them does not typecheck, which is the cheapest possible enforcement.
 */

import type { CurrencyCode, PriceBand, PriceBasis } from '@/lib/money';
import type { EvidenceState, SourceAuthority } from '@/modules/evidence/confidence';
import type { LocalDate, LocalTime, OccurrenceTime } from '@/lib/time';

/** A constraint the user requires, as opposed to a preference they'd like. */
export interface HardConstraints {
  /** Doc 02: a live performance in the window, with evidence for that date. */
  readonly liveMusic: boolean;
  readonly wheelchairAccessible: boolean;
  readonly outdoorSeating: boolean;
  readonly familyFriendly: boolean;
  /** Conversation score of 3 or better. */
  readonly quietEnoughToTalk: boolean;
}

export interface SoftPreferences {
  /** Lowercase genre tags. Preference, never a hard filter (doc 03). */
  readonly genres: readonly string[];
  /** 1-5; omitted means no preference rather than "don't care about it". */
  readonly conversationFriendliness?: number;
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

  readonly date: LocalDate;
  readonly fromTime: LocalTime;
  readonly toTime: LocalTime;

  readonly partySize?: number;
  /**
   * Budget ceiling in the market's own currency. Never a converted figure: FX
   * is a presentation estimate and must not decide eligibility (doc 10).
   */
  readonly budgetCeilingMinor?: number;
  readonly budgetRangeLowMinor?: number;
  readonly budgetBasis: PriceBasis;

  readonly neighborhoodId?: string;

  readonly hardConstraints: HardConstraints;
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
  readonly genreTags: readonly string[];
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
  /** Null when the venue has no recommendable occurrence in the window. */
  readonly occurrence: CandidateOccurrence | null;
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

export type ConstraintKey =
  | 'live_music'
  | 'budget'
  | 'wheelchair_accessible'
  | 'outdoor_seating'
  | 'family_friendly'
  | 'quiet_enough_to_talk'
  | 'venue_open';

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
    | { readonly kind: 'noise_acceptable'; readonly score: number }
    | { readonly kind: 'noise_too_loud'; readonly score: number }
    | { readonly kind: 'venue_not_open' };
}

export interface ScoreComponent {
  readonly key: 'music' | 'atmosphere' | 'budget' | 'distance' | 'seating_access' | 'freshness';
  readonly weight: number;
  /** 0..1, or null when there was no evidence to score. */
  readonly normalised: number | null;
  readonly contribution: number;
}

export interface SearchResult {
  readonly candidate: Candidate;
  readonly verdict: Verdict;
  readonly outcomes: readonly ConstraintOutcome[];
  readonly score: number;
  readonly components: readonly ScoreComponent[];
  /**
   * Share of the scoring weight that had evidence behind it. Surfaced
   * separately rather than hidden inside the score (gap G1), so a thinly
   * documented venue reads as "we know little" rather than "it is poor".
   */
  readonly informationCompleteness: number;
  readonly rankingVersion: string;
}

export interface SearchResponse {
  readonly eligible: readonly SearchResult[];
  readonly needsConfirmation: readonly SearchResult[];
  readonly excluded: readonly SearchResult[];
  /** Why a zero-result search returned nothing, and what would change it. */
  readonly relaxations: readonly Relaxation[];
  readonly rankingVersion: string;
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
