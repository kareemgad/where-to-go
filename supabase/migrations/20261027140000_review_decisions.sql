-- Where to Go | 0017 approve, reject and edit as single transactions
--
-- A review decision is several writes that must all land or none: the decision
-- row, the lifecycle move, and for an approval the publication itself. Doing it
-- from the application in three round trips means a crash between them leaves a
-- claim approved with nothing published, or published with no recorded
-- decision — and the recorded decision is the thing the whole workflow exists
-- to produce.
--
-- Putting them here also keeps the order right by construction. The
-- claims_review_guard trigger refuses to let a high-impact claim reach
-- 'approved' before a decision row exists, so decision-then-lifecycle is not a
-- preference, it is the only order that works.

-- ---------------------------------------------------------------------------
-- the editorial source
-- ---------------------------------------------------------------------------
-- A reviewer's correction is a fact about the world like any other, so it needs
-- evidence with provenance (CLAUDE.md). The evidence is the review itself: who
-- checked, when, and what they said. Without this, an edit would be the one
-- published value in the system with no source — exactly the hole the evidence
-- model exists to close.

insert into source_providers (
  key, display_name, storage_policy, activation_status, kill_switch,
  tos_reviewed_at, legal_reviewer, cost_model, attribution_required
) values (
  'editorial',
  'Where to Go editorial',
  'canonical_ok',
  'active',
  false,
  now(),
  'first-party — no third-party terms apply to our own reviewers'' work',
  'internal',
  false
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- reject
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
begin
  if p_reason is null or btrim(p_reason) = '' then
    -- Doc 12: a rejection keeps its reason so the same claim is not
    -- re-proposed and re-rejected indefinitely. A blank reason defeats that.
    return jsonb_build_object('status', 'invalid', 'reason', 'a rejection must give a reason');
  end if;

  select * into claim from claims where id = p_claim_id for update;
  if not found then
    return jsonb_build_object('status', 'not_found', 'reason', 'no such claim');
  end if;

  insert into verification_decisions (claim_id, reviewer_id, action, reason)
  values (p_claim_id, p_reviewer, 'reject', btrim(p_reason));

  update claims
  set lifecycle_state = 'rejected', evidence_state = 'rejected'
  where id = p_claim_id;

  return jsonb_build_object('status', 'rejected');
end;
$$;

comment on function app_reject_claim is
  'Records the rejection and its reason, then moves the claim out of the '
  'queue. The claim is never deleted: the history of what was proposed and '
  'refused is the point.';

-- ---------------------------------------------------------------------------
-- approve
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

  -- Before the lifecycle move, so the review guard sees it.
  insert into verification_decisions (claim_id, reviewer_id, action, reason)
  values (p_claim_id, p_reviewer, 'approve', nullif(btrim(coalesce(p_reason, '')), ''));

  -- A human has now checked this. The evidence state rises to verified only if
  -- it is not already stronger, and the method and verifier are recorded
  -- because claims_verified_requires_method refuses a bare "verified".
  update claims
  set evidence_state = case
        when evidence_state in ('verified', 'corroborated') then evidence_state
        else 'verified'
      end,
      verification_method = 'reviewer_approval',
      verifier_id = p_reviewer,
      verified_at = now(),
      lifecycle_state = 'approved'
  where id = p_claim_id;

  -- Publication is the same function the batch path uses, so an approval
  -- cannot bypass conflict detection or the version history.
  result := app_publish_claim(p_claim_id, p_reviewer);

  return result || jsonb_build_object('decision', 'approve');
end;
$$;

comment on function app_approve_claim is
  'Records the approval, marks the claim human-verified, then publishes '
  'through app_publish_claim. An approved claim that conflicts with another '
  'still does not publish - the approval does not override the disagreement.';

-- ---------------------------------------------------------------------------
-- edit
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
    -- Not an edit. Recording one would put a correction in the trail that
    -- corrected nothing, and the reviewer probably meant to approve.
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

  -- The decision is recorded against the new claim, which is what publishes,
  -- and against the original, which is what the reviewer was looking at.
  insert into verification_decisions (claim_id, reviewer_id, action, reason)
  values (new_claim_id, p_reviewer, 'edit', btrim(p_reason)),
         (p_claim_id, p_reviewer, 'edit', btrim(p_reason));

  update claims set lifecycle_state = 'withdrawn' where id = p_claim_id;

  result := app_publish_claim(new_claim_id, p_reviewer);

  return result || jsonb_build_object(
    'decision', 'edit',
    'new_claim_id', new_claim_id,
    'superseded_claim_id', p_claim_id
  );
end;
$$;

comment on function app_edit_claim is
  'A reviewer correction, recorded as a new editor_checked claim superseding '
  'the original, with the reviewer''s own reasoning as its evidence. The '
  'original is withdrawn, never overwritten, so what the source said survives '
  'next to the correction.';
