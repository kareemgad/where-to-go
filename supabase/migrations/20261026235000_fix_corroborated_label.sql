-- Where to Go | 0007 corroborated evidence does not imply an editor checked it
--
-- app_confidence_label in 0004 returned 'editor_verified' for any corroborated
-- claim, whatever its source_authority. So two independent AI extractions
-- agreeing, or several visitors reporting the same thing, would have rendered
-- to a user as "Editor verified" — a claim about human review that nobody had
-- performed. That is the precise failure brief C4 and ADR-005 exist to prevent,
-- and it would have been invisible: the value was plausible and the pipeline
-- had no reason to complain.
--
-- Found by the invariant test in src/modules/evidence/confidence.test.ts
-- ("never presents an AI extraction as verified by anyone"), which asserts a
-- property across all 315 combinations rather than checking a lookup table.
--
-- Corroboration now earns the editor label only when a human or an authorised
-- feed is behind it. Corroborated machine extractions fall back to
-- 'unverified_estimate'; corroborated visitor reports stay 'visitor_reported'.
-- Strength of agreement is conveyed by the observation count (doc 12), not by
-- promoting the label.

create or replace function app_confidence_label(
  lifecycle claim_lifecycle_state,
  evidence evidence_state,
  authority source_authority
)
returns text
language sql
immutable
as $$
  select case
    when lifecycle in ('rejected', 'withdrawn') then 'not_shown'
    when evidence = 'rejected' then 'not_shown'

    when evidence = 'conflicting' then 'conflicting'

    when evidence = 'stale' or lifecycle = 'stale' then 'needs_recheck'

    when evidence = 'verified' and authority = 'editor_checked' then 'editor_verified'
    when evidence = 'verified' and authority = 'authorized_feed' then 'editor_verified'
    when evidence in ('verified', 'corroborated') and authority = 'venue_attested'
      then 'venue_confirmed'

    -- Changed in this migration: was `when evidence = 'corroborated'`, with no
    -- regard for who asserted it.
    when evidence = 'corroborated'
         and authority in ('editor_checked', 'authorized_feed')
      then 'editor_verified'

    when authority = 'venue_attested' then 'venue_confirmed'
    when authority = 'visitor_reported' then 'visitor_reported'

    when authority = 'ai_extracted' then 'unverified_estimate'
    when evidence = 'source_claimed' then 'unverified_estimate'
    else 'unknown'
  end;
$$;

comment on function app_confidence_label is
  'The single source of the user-facing label (doc 06), derived from the three '
  'state axes. Never stored and never author-set, so it cannot drift from the '
  'evidence. Mirrored in TypeScript at src/modules/evidence/confidence.ts; the '
  'two are compared across all 315 combinations by '
  'scripts/verify-confidence-parity.ts.';
