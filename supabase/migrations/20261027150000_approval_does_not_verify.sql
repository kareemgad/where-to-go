-- Where to Go | 0018 approving a claim is not the same as verifying the fact
--
-- Two defects in 0017, both found while writing its verification suite.
--
-- 1. app_approve_claim set evidence_state to 'verified' and recorded the
--    reviewer as the verifier. That conflates two of ADR-005's three axes. A
--    reviewer approving a visitor report has judged the *report* credible; they
--    have not been to the venue and checked the step-free entrance. Publishing
--    that as "verified" is an overclaim, and on an accessibility or price
--    attribute it is the kind of overclaim someone relies on.
--
--    It was also outright broken: claims_ai_cannot_self_verify forbids
--    'verified' on an ai_extracted claim, so approving any machine-extracted
--    claim raised a constraint violation rather than publishing.
--
--    Approval now moves the lifecycle and nothing else. The human judgment
--    lives in verification_decisions, which is where "a person decided this"
--    belongs. A reviewer who has independently checked a value uses the edit
--    path, which records their check as evidence.
--
-- 2. A conflict was a dead end. app_publish_claim marks both sides
--    'conflicting', and nothing ever cleared the mark, so rejecting the wrong
--    claim left the right one permanently unpublishable - evidence_state
--    'conflicting' is not in the publishable set. The reviewer could see the
--    correct value and had no way to publish it.
--
--    Clearing the mark needs the state the claim held before the conflict, so
--    that is now stored rather than guessed. Guessing would mean restoring to
--    the weakest publishable state, which silently downgrades a corroborated
--    claim every time a conflict is resolved, and a downgrade can drop a claim
--    below a hard filter.

alter table claims
  add column conflict_prior_evidence_state evidence_state;

comment on column claims.conflict_prior_evidence_state is
  'The evidence state held before a conflict mark was applied, so resolving '
  'the conflict restores it exactly instead of approximating it. Null when no '
  'conflict is outstanding.';

-- ---------------------------------------------------------------------------
-- marking and clearing conflicts
-- ---------------------------------------------------------------------------

create or replace function app_mark_conflicting(p_claim_id uuid)
returns void
language sql
as $$
  update claims
  set conflict_prior_evidence_state = case
        -- Only on the way in. Marking an already-marked claim must not
        -- overwrite the remembered state with 'conflicting' itself.
        when evidence_state = 'conflicting' then conflict_prior_evidence_state
        else evidence_state
      end,
      evidence_state = 'conflicting',
      lifecycle_state = 'review_pending'
  where id = p_claim_id;
$$;

/**
 * Drop the conflict mark from any claim on this attribute that no longer has a
 * credible competitor.
 *
 * Called after a decision removes one side of a disagreement. Restores the
 * remembered evidence state, which is why it is remembered.
 */
create or replace function app_clear_resolved_conflicts(
  p_subject_kind claim_subject_kind,
  p_subject_id uuid,
  p_attribute_key text
)
returns integer
language plpgsql
as $$
declare
  cleared integer := 0;
  candidate record;
begin
  for candidate in
    select id, conflict_prior_evidence_state
    from claims
    where subject_kind = p_subject_kind
      and subject_id = p_subject_id
      and attribute_key = p_attribute_key
      and evidence_state = 'conflicting'
      and lifecycle_state not in ('rejected', 'withdrawn')
  loop
    if not exists (select 1 from app_claim_conflicts(candidate.id)) then
      update claims
      set evidence_state = coalesce(candidate.conflict_prior_evidence_state, 'source_claimed'),
          conflict_prior_evidence_state = null,
          -- Back to the queue's publishable end, still awaiting a decision.
          lifecycle_state = 'validated'
      where id = candidate.id;
      cleared := cleared + 1;
    end if;
  end loop;
  return cleared;
end;
$$;

comment on function app_clear_resolved_conflicts is
  'Lifts the conflict mark once a claim has no credible competitor left. '
  'Without this a resolved conflict leaves the surviving claim permanently '
  'unpublishable, because conflicting is not a publishable evidence state.';

-- ---------------------------------------------------------------------------
-- app_publish_claim: remember the prior state when marking a conflict
-- ---------------------------------------------------------------------------

create or replace function app_publish_claim(p_claim_id uuid, p_actor uuid default null)
returns jsonb
language plpgsql
as $$
declare
  claim claims;
  conflicts jsonb;
  conflict_count integer;
  next_version integer;
  new_id uuid;
  did_materialize boolean;
  other uuid;
begin
  select * into claim from claims where id = p_claim_id for update;
  if not found then
    raise exception 'No such claim %', p_claim_id using errcode = 'no_data_found';
  end if;

  if claim.lifecycle_state not in ('validated', 'approved') then
    return jsonb_build_object(
      'status', 'not_publishable',
      'reason', format('claim is %s; expected validated or approved', claim.lifecycle_state)
    );
  end if;

  if claim.evidence_state not in ('source_claimed', 'corroborated', 'verified') then
    return jsonb_build_object(
      'status', 'not_publishable',
      'reason', format('evidence is %s', claim.evidence_state)
    );
  end if;

  if app_is_high_impact_attribute(claim.attribute_key)
     and not exists (
       select 1 from verification_decisions d
       where d.claim_id = claim.id and d.action in ('approve', 'edit')
     )
  then
    return jsonb_build_object(
      'status', 'needs_review',
      'reason', format('%s is high-impact and has no approval decision', claim.attribute_key)
    );
  end if;

  select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb), count(*)
    into conflicts, conflict_count
  from app_claim_conflicts(p_claim_id) c;

  if conflict_count > 0 then
    -- Both sides are marked and queued. The system does not choose between
    -- them, and nothing is published (doc 16 scenario 5). Returning rather
    -- than raising is deliberate: an exception would roll back these marks and
    -- the conflict would be rediscovered on every attempt.
    perform app_mark_conflicting(claim.id);
    for other in select conflicting_claim_id from app_claim_conflicts(p_claim_id) loop
      perform app_mark_conflicting(other);
    end loop;

    return jsonb_build_object(
      'status', 'conflict',
      'reason', 'credible sources disagree; both claims queued for review',
      'conflicts', conflicts
    );
  end if;

  select coalesce(max(version), 0) + 1 into next_version
  from published_attributes
  where subject_kind = claim.subject_kind
    and subject_id = claim.subject_id
    and attribute_key = claim.attribute_key;

  update published_attributes
  set superseded_at = now()
  where subject_kind = claim.subject_kind
    and subject_id = claim.subject_id
    and attribute_key = claim.attribute_key
    and superseded_at is null
    and rolled_back_at is null;

  did_materialize := app_materialize_attribute(
    claim.subject_kind, claim.subject_id, claim.attribute_key,
    claim.value, claim.evidence_state, claim.source_authority
  );

  insert into published_attributes (
    subject_kind, subject_id, attribute_key, value, evidence_state,
    source_authority, published_from_claim_id, version, published_by, materialized
  ) values (
    claim.subject_kind, claim.subject_id, claim.attribute_key, claim.value,
    claim.evidence_state, claim.source_authority, claim.id, next_version,
    p_actor, did_materialize
  ) returning id into new_id;

  update claims set lifecycle_state = 'published' where id = claim.id;

  return jsonb_build_object(
    'status', 'published',
    'version', next_version,
    'published_attribute_id', new_id,
    'materialized', did_materialize
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- app_approve_claim: lifecycle only
-- ---------------------------------------------------------------------------

create or replace function app_approve_claim(
  p_claim_id uuid,
  p_reviewer uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
as $$
declare
  claim claims;
  result jsonb;
begin
  select * into claim from claims where id = p_claim_id for update;
  if not found then
    return jsonb_build_object('status', 'not_found', 'reason', 'no such claim');
  end if;

  if claim.lifecycle_state in ('published', 'rejected', 'withdrawn') then
    return jsonb_build_object(
      'status', 'not_publishable',
      'reason', format('claim is already %s', claim.lifecycle_state)
    );
  end if;

  if claim.evidence_state = 'conflicting' then
    -- Approving one side of a disagreement would be the system picking a
    -- winner by proxy. The reviewer has to say which source was wrong.
    return jsonb_build_object(
      'status', 'conflict',
      'reason', 'this claim conflicts with another; reject or correct the one that is wrong'
    );
  end if;

  -- Before the lifecycle move, so claims_review_guard can see it.
  insert into verification_decisions (claim_id, reviewer_id, action, reason)
  values (p_claim_id, p_reviewer, 'approve', nullif(btrim(coalesce(p_reason, '')), ''));

  -- Lifecycle only. An approval is a decision that this claim may publish; it
  -- is not a second-hand verification of the fact, and it does not change who
  -- asserted it. Both of those are separate axes (ADR-005).
  update claims set lifecycle_state = 'approved' where id = p_claim_id;

  result := app_publish_claim(p_claim_id, p_reviewer);
  return result || jsonb_build_object('decision', 'approve');
end;
$$;

comment on function app_approve_claim is
  'Records the approval and publishes. Deliberately does not touch '
  'evidence_state or source_authority: approving a claim is a workflow '
  'decision, not a verification of the fact and not a change of who asserted '
  'it. A reviewer who checked the value themselves uses app_edit_claim, which '
  'records the check as evidence.';

-- ---------------------------------------------------------------------------
-- app_reject_claim: clear the conflict it resolves
-- ---------------------------------------------------------------------------

create or replace function app_reject_claim(
  p_claim_id uuid,
  p_reviewer uuid,
  p_reason text
)
returns jsonb
language plpgsql
as $$
declare
  claim claims;
  cleared integer;
begin
  if p_reason is null or btrim(p_reason) = '' then
    return jsonb_build_object('status', 'invalid', 'reason', 'a rejection must give a reason');
  end if;

  select * into claim from claims where id = p_claim_id for update;
  if not found then
    return jsonb_build_object('status', 'not_found', 'reason', 'no such claim');
  end if;

  insert into verification_decisions (claim_id, reviewer_id, action, reason)
  values (p_claim_id, p_reviewer, 'reject', btrim(p_reason));

  update claims
  set lifecycle_state = 'rejected',
      evidence_state = 'rejected',
      conflict_prior_evidence_state = null
  where id = p_claim_id;

  -- Rejecting the wrong side of a disagreement is how a conflict is resolved,
  -- so the survivor stops being marked as conflicting here.
  cleared := app_clear_resolved_conflicts(
    claim.subject_kind, claim.subject_id, claim.attribute_key
  );

  return jsonb_build_object('status', 'rejected', 'conflicts_cleared', cleared);
end;
$$;

comment on function app_reject_claim is
  'Records the rejection and its reason, moves the claim out of the queue, '
  'then lifts the conflict mark from any remaining claim that no longer has a '
  'credible competitor.';

-- ---------------------------------------------------------------------------
-- app_edit_claim: clear the conflict the correction resolves
-- ---------------------------------------------------------------------------

create or replace function app_edit_claim(
  p_claim_id uuid,
  p_reviewer uuid,
  p_value jsonb,
  p_reason text
)
returns jsonb
language plpgsql
as $$
declare
  original claims;
  provider_id uuid;
  document_id uuid;
  evidence_id uuid;
  new_claim_id uuid;
  result jsonb;
begin
  if p_reason is null or btrim(p_reason) = '' then
    return jsonb_build_object('status', 'invalid', 'reason', 'an edit must give a reason');
  end if;
  if p_value is null then
    return jsonb_build_object('status', 'invalid', 'reason', 'an edit must give a value');
  end if;

  select * into original from claims where id = p_claim_id for update;
  if not found then
    return jsonb_build_object('status', 'not_found', 'reason', 'no such claim');
  end if;

  if p_value = original.value then
    return jsonb_build_object(
      'status', 'invalid',
      'reason', 'the edited value is identical to the proposed one; approve it instead'
    );
  end if;

  select id into provider_id from source_providers where key = 'editorial';
  if provider_id is null then
    raise exception 'The editorial source provider is missing'
      using errcode = 'no_data_found';
  end if;

  -- The reviewer's check, as a source document. No url: the source is a person
  -- at a time, and inventing a link would be a fabricated citation.
  insert into source_documents (provider_id, publisher, captured_at, rights_profile)
  values (provider_id, 'Where to Go editorial review', now(), 'first_party')
  returning id into document_id;

  insert into evidence_records (document_id, field_pointer, excerpt)
  values (document_id, original.attribute_key, btrim(p_reason))
  returning id into evidence_id;

  -- A new claim superseding the original rather than an update in place. The
  -- evidence store is append-only: what the source said stays readable next to
  -- what the reviewer corrected it to.
  insert into claims (
    subject_kind, subject_id, attribute_key, value, evidence_id,
    lifecycle_state, evidence_state, source_authority,
    verification_method, verifier_id, verified_at,
    observed_at, supersedes_claim_id
  ) values (
    original.subject_kind, original.subject_id, original.attribute_key, p_value, evidence_id,
    'validated', 'verified', 'editor_checked',
    'reviewer_edit', p_reviewer, now(),
    now(), original.id
  )
  returning id into new_claim_id;

  insert into verification_decisions (claim_id, reviewer_id, action, reason)
  values (new_claim_id, p_reviewer, 'edit', btrim(p_reason)),
         (p_claim_id, p_reviewer, 'edit', btrim(p_reason));

  update claims
  set lifecycle_state = 'withdrawn', conflict_prior_evidence_state = null
  where id = p_claim_id;

  -- Withdrawing the original may have settled a disagreement.
  perform app_clear_resolved_conflicts(
    original.subject_kind, original.subject_id, original.attribute_key
  );

  result := app_publish_claim(new_claim_id, p_reviewer);

  return result || jsonb_build_object(
    'decision', 'edit',
    'new_claim_id', new_claim_id,
    'superseded_claim_id', p_claim_id
  );
end;
$$;
