/**
 * The three state axes and the single label derived from them.
 *
 * ADR-005 and brief C3: the specification documents used four different
 * vocabularies for "how much do we trust this", conflating three independent
 * questions. They are kept apart here:
 *
 *   lifecycleState   where the claim sits in the workflow        (doc 11)
 *   evidenceState    how strong the evidence is                  (doc 12)
 *   sourceAuthority  who asserted it                             (doc 03)
 *
 * and `confidenceLabel` derives the one user-facing string (doc 06) from them.
 * It is a pure function of the three. It is never stored, never set by an
 * author, and never a model's confidence score — doc 03 is explicit that a
 * global "AI confidence" is misleading, and a number on screen reads as truth.
 *
 * This mirrors app_confidence_label in migration 0004. The two are compared
 * across all 315 combinations by scripts/verify-confidence-parity.ts, because
 * two implementations of one rule will otherwise drift, and the drift would
 * show up as the UI disagreeing with the database about whether something is
 * verified.
 */

export type ClaimLifecycleState =
  | 'candidate'
  | 'extracted'
  | 'validated'
  | 'review_pending'
  | 'approved'
  | 'rejected'
  | 'published'
  | 'stale'
  | 'withdrawn';

export type EvidenceState =
  | 'unknown'
  | 'source_claimed'
  | 'corroborated'
  | 'verified'
  | 'conflicting'
  | 'stale'
  | 'rejected';

export type SourceAuthority =
  | 'venue_attested'
  | 'editor_checked'
  | 'visitor_reported'
  | 'authorized_feed'
  | 'ai_extracted';

export type ConfidenceLabel =
  /** Must not be rendered at all. */
  | 'not_shown'
  /** Credible sources disagree. Surfaced, never silently resolved. */
  | 'conflicting'
  /** Evidence is past its policy validity (doc 12). */
  | 'needs_recheck'
  /** Independently checked by an editor, or from an authorised feed. */
  | 'editor_verified'
  /** The venue's own word. Strong, and not independent verification. */
  | 'venue_confirmed'
  /** A visitor said so. */
  | 'visitor_reported'
  /** One attributed source, or a machine extraction. */
  | 'unverified_estimate'
  /** No credible evidence either way. */
  | 'unknown';

export const CLAIM_LIFECYCLE_STATES: readonly ClaimLifecycleState[] = [
  'candidate',
  'extracted',
  'validated',
  'review_pending',
  'approved',
  'rejected',
  'published',
  'stale',
  'withdrawn',
];

export const EVIDENCE_STATES: readonly EvidenceState[] = [
  'unknown',
  'source_claimed',
  'corroborated',
  'verified',
  'conflicting',
  'stale',
  'rejected',
];

export const SOURCE_AUTHORITIES: readonly SourceAuthority[] = [
  'venue_attested',
  'editor_checked',
  'visitor_reported',
  'authorized_feed',
  'ai_extracted',
];

/**
 * Derive the user-facing label.
 *
 * Clause order matters and is identical to the SQL. Read top to bottom: the
 * disqualifying states come first, so nothing rejected or conflicting can be
 * rescued by a later clause.
 */
export function confidenceLabel(
  lifecycleState: ClaimLifecycleState,
  evidenceState: EvidenceState,
  sourceAuthority: SourceAuthority,
): ConfidenceLabel {
  // Withdrawn or rejected: not a confidence question, a visibility one.
  if (lifecycleState === 'rejected' || lifecycleState === 'withdrawn') return 'not_shown';
  if (evidenceState === 'rejected') return 'not_shown';

  // Doc 16 scenario 5: a disagreement is queued for review, never averaged,
  // never resolved in favour of the newer or the more confident source.
  if (evidenceState === 'conflicting') return 'conflicting';

  // Doc 12: expiry downgrades. It does not delete, and it does not pretend.
  if (evidenceState === 'stale' || lifecycleState === 'stale') return 'needs_recheck';

  // Brief C4. Only an independent check earns the word "verified" in front of
  // a user. An operator confirming their own Friday band is the strongest
  // evidence we will usually have, and it is still the venue's own word.
  if (evidenceState === 'verified' && sourceAuthority === 'editor_checked') {
    return 'editor_verified';
  }
  if (evidenceState === 'verified' && sourceAuthority === 'authorized_feed') {
    return 'editor_verified';
  }
  if (
    (evidenceState === 'verified' || evidenceState === 'corroborated') &&
    sourceAuthority === 'venue_attested'
  ) {
    return 'venue_confirmed';
  }
  // Corroboration earns the editor label only when a human or an authorised
  // feed is behind it. Two machine extractions agreeing is corroboration, and
  // it is emphatically not an editor having checked anything; several visitors
  // agreeing is still visitor-reported. Sample size is conveyed separately by
  // the observation count (doc 12), not by promoting the label.
  if (
    evidenceState === 'corroborated' &&
    (sourceAuthority === 'editor_checked' || sourceAuthority === 'authorized_feed')
  ) {
    return 'editor_verified';
  }

  if (sourceAuthority === 'venue_attested') return 'venue_confirmed';
  if (sourceAuthority === 'visitor_reported') return 'visitor_reported';

  // A machine extraction is a proposal whatever its score (doc 03, doc 11).
  if (sourceAuthority === 'ai_extracted') return 'unverified_estimate';
  if (evidenceState === 'source_claimed') return 'unverified_estimate';

  return 'unknown';
}

/** Labels that must never be rendered. */
export function isRenderable(label: ConfidenceLabel): boolean {
  return label !== 'not_shown';
}

/**
 * May this evidence satisfy a hard constraint?
 *
 * Brief C4: venue attestation counts. Conflicting, stale and absent evidence do
 * not — an unknown is never silently a pass (doc 13). This is the gate used by
 * eligibility, kept next to the label so the two cannot disagree about what
 * "good enough" means.
 */
export function satisfiesHardConstraint(evidenceState: EvidenceState): boolean {
  return (
    evidenceState === 'source_claimed' ||
    evidenceState === 'corroborated' ||
    evidenceState === 'verified'
  );
}

/**
 * Freshness weight for the ranking's 5% freshness component (doc 03).
 * Deliberately coarse: a finer scale would imply precision the evidence does
 * not have.
 */
export function evidenceWeight(evidenceState: EvidenceState): number {
  switch (evidenceState) {
    case 'verified':
      return 1;
    case 'corroborated':
      return 0.8;
    case 'source_claimed':
      return 0.5;
    case 'stale':
      return 0.2;
    case 'unknown':
    case 'conflicting':
    case 'rejected':
      return 0;
  }
}
