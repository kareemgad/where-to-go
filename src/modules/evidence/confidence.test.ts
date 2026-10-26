import { describe, expect, it } from 'vitest';

import {
  CLAIM_LIFECYCLE_STATES,
  EVIDENCE_STATES,
  SOURCE_AUTHORITIES,
  type ConfidenceLabel,
  confidenceLabel,
  evidenceWeight,
  isRenderable,
  satisfiesHardConstraint,
} from './confidence';

/**
 * These are the invariants, not the lookup table. The full 315-combination
 * comparison against the SQL function lives in
 * scripts/verify-confidence-parity.ts, which needs a database; what belongs
 * here are the properties that must hold however the clauses are rearranged.
 */
describe('confidenceLabel invariants', () => {
  const every = (fn: (combo: {
    lifecycle: (typeof CLAIM_LIFECYCLE_STATES)[number];
    evidence: (typeof EVIDENCE_STATES)[number];
    authority: (typeof SOURCE_AUTHORITIES)[number];
    label: ConfidenceLabel;
  }) => void) => {
    for (const lifecycle of CLAIM_LIFECYCLE_STATES) {
      for (const evidence of EVIDENCE_STATES) {
        for (const authority of SOURCE_AUTHORITIES) {
          fn({ lifecycle, evidence, authority, label: confidenceLabel(lifecycle, evidence, authority) });
        }
      }
    }
  };

  it('covers every combination without returning undefined', () => {
    let count = 0;
    every(({ label }) => {
      expect(label).toBeTruthy();
      count += 1;
    });
    expect(count).toBe(9 * 7 * 5);
  });

  it('never calls a venue attestation independently verified (brief C4)', () => {
    // The single most important property here. An operator confirming their
    // own Friday band must never render as though an editor checked it.
    every(({ authority, label }) => {
      if (authority === 'venue_attested') {
        expect(label).not.toBe('editor_verified');
      }
    });
  });

  it('never presents an AI extraction as verified by anyone', () => {
    every(({ authority, label }) => {
      if (authority === 'ai_extracted') {
        expect(label).not.toBe('editor_verified');
        expect(label).not.toBe('venue_confirmed');
      }
    });
  });

  it('never presents a visitor report as verified', () => {
    every(({ authority, label }) => {
      if (authority === 'visitor_reported') {
        expect(label).not.toBe('editor_verified');
        expect(label).not.toBe('venue_confirmed');
      }
    });
  });

  it('hides anything rejected or withdrawn, whatever the evidence says', () => {
    every(({ lifecycle, evidence, label }) => {
      if (lifecycle === 'rejected' || lifecycle === 'withdrawn' || evidence === 'rejected') {
        expect(label).toBe('not_shown');
      }
    });
  });

  it('surfaces a conflict rather than resolving it', () => {
    // Doc 16 scenario 5: never averaged, never decided in favour of the newer
    // or more confident source.
    every(({ lifecycle, evidence, label }) => {
      if (
        evidence === 'conflicting' &&
        lifecycle !== 'rejected' &&
        lifecycle !== 'withdrawn'
      ) {
        expect(label).toBe('conflicting');
      }
    });
  });

  it('downgrades stale evidence to needs_recheck rather than dropping it', () => {
    every(({ lifecycle, evidence, label }) => {
      if (
        evidence === 'stale' &&
        lifecycle !== 'rejected' &&
        lifecycle !== 'withdrawn'
      ) {
        expect(label).toBe('needs_recheck');
      }
    });
  });

  it('is a pure function of its three arguments', () => {
    const a = confidenceLabel('published', 'verified', 'editor_checked');
    const b = confidenceLabel('published', 'verified', 'editor_checked');
    expect(a).toBe(b);
  });

  it('labels the documented cases as doc 06 expects', () => {
    expect(confidenceLabel('published', 'verified', 'editor_checked')).toBe('editor_verified');
    expect(confidenceLabel('published', 'verified', 'authorized_feed')).toBe('editor_verified');
    expect(confidenceLabel('published', 'source_claimed', 'venue_attested')).toBe('venue_confirmed');
    expect(confidenceLabel('published', 'source_claimed', 'visitor_reported')).toBe('visitor_reported');
    expect(confidenceLabel('published', 'source_claimed', 'ai_extracted')).toBe('unverified_estimate');
    expect(confidenceLabel('published', 'unknown', 'editor_checked')).toBe('unknown');
  });
});

describe('isRenderable', () => {
  it('excludes exactly not_shown', () => {
    expect(isRenderable('not_shown')).toBe(false);
    expect(isRenderable('unknown')).toBe(true);
    expect(isRenderable('conflicting')).toBe(true);
  });
});

describe('satisfiesHardConstraint', () => {
  it('accepts a venue attestation and better', () => {
    // Brief C4: venue-attested evidence is good enough to satisfy a date or
    // live-music constraint, even though it is not independent verification.
    expect(satisfiesHardConstraint('source_claimed')).toBe(true);
    expect(satisfiesHardConstraint('corroborated')).toBe(true);
    expect(satisfiesHardConstraint('verified')).toBe(true);
  });

  it('refuses unknown, conflicting, stale and rejected', () => {
    // Doc 13: an unknown must never silently count as a pass.
    expect(satisfiesHardConstraint('unknown')).toBe(false);
    expect(satisfiesHardConstraint('conflicting')).toBe(false);
    expect(satisfiesHardConstraint('stale')).toBe(false);
    expect(satisfiesHardConstraint('rejected')).toBe(false);
  });

  it('covers every evidence state', () => {
    for (const state of EVIDENCE_STATES) {
      expect(typeof satisfiesHardConstraint(state)).toBe('boolean');
    }
  });
});

describe('evidenceWeight', () => {
  it('orders evidence from verified down to none', () => {
    expect(evidenceWeight('verified')).toBeGreaterThan(evidenceWeight('corroborated'));
    expect(evidenceWeight('corroborated')).toBeGreaterThan(evidenceWeight('source_claimed'));
    expect(evidenceWeight('source_claimed')).toBeGreaterThan(evidenceWeight('stale'));
    expect(evidenceWeight('stale')).toBeGreaterThan(evidenceWeight('unknown'));
  });

  it('gives no credit to unknown, conflicting or rejected evidence', () => {
    expect(evidenceWeight('unknown')).toBe(0);
    expect(evidenceWeight('conflicting')).toBe(0);
    expect(evidenceWeight('rejected')).toBe(0);
  });

  it('stays within 0..1 for every state', () => {
    for (const state of EVIDENCE_STATES) {
      const weight = evidenceWeight(state);
      expect(weight).toBeGreaterThanOrEqual(0);
      expect(weight).toBeLessThanOrEqual(1);
    }
  });
});
