-- Where to Go | 0011 versioned publication, rollback and conflict detection
--
-- Phase 3's gate, in two halves:
--   "A conflicting event claim cannot auto-publish"
--   "reviewer rollback restores the prior published version"
--
-- Phase 1 shipped the published projection as typed columns on venues and
-- occurrences with no history, and deferred versioning here deliberately. This
-- adds the history without disturbing the read path: published_attributes is
-- the versioned record of every published value, and the typed columns remain
-- the fast current view that search reads. The publish function writes both, so
-- they cannot drift.
--
-- Why attribute-level versions rather than whole-entity snapshots: rollback in
-- practice is "that price was wrong", not "undo everything about this venue".
-- Versioning at the same granularity as the claim keeps the reviewer's action
-- proportionate to the mistake, and a snapshot would force them to discard
-- good values alongside the bad one.

create table published_attributes (
  id uuid primary key default gen_random_uuid(),

  subject_kind claim_subject_kind not null,
  subject_id uuid not null,
  attribute_key text not null,

  value jsonb not null,
  evidence_state evidence_state not null,
  source_authority source_authority not null,

  -- Which claim produced this version. Provenance is one join from any
  -- published value, which is what doc 16's "evidence attribution on 100% of
  -- published factual claims" means in practice.
  published_from_claim_id uuid not null references claims (id) on delete restrict,

  version integer not null check (version > 0),
  published_at timestamptz not null default now(),
  published_by uuid,

  -- Set when a later version replaces this one.
  superseded_at timestamptz,

  -- Set when a reviewer withdraws this version. Distinct from superseded:
  -- superseded means "something newer arrived", rolled back means "this was
  -- wrong". Collapsing them would lose the reason a value stopped being true.
  rolled_back_at timestamptz,
  rolled_back_by uuid,
  rollback_reason text,

  -- False when the attribute has no typed column yet. The version is still
  -- recorded; it simply does not reach the read model.
  materialized boolean not null default false,

  unique (subject_kind, subject_id, attribute_key, version),

  constraint published_attributes_rollback_has_reason
    check (rolled_back_at is null or rollback_reason is not null)
);

-- At most one live version per attribute. A unique partial index rather than
-- application discipline: two current versions would make "what do we publish"
-- ambiguous, and ambiguity here shows up as contradictory pages.
create unique index published_attributes_current_idx
  on published_attributes (subject_kind, subject_id, attribute_key)
  where superseded_at is null and rolled_back_at is null;

create index published_attributes_subject_idx
  on published_attributes (subject_kind, subject_id, attribute_key, version desc);
create index published_attributes_claim_idx on published_attributes (published_from_claim_id);

comment on table published_attributes is
  'Versioned record of every published value. Append-only in spirit: a version '
  'is superseded or rolled back, never deleted, so the history of what the '
  'platform asserted and when survives (doc 12).';

create view published_attributes_current as
  select *
  from published_attributes
  where superseded_at is null and rolled_back_at is null;

alter table published_attributes enable row level security;

-- ---------------------------------------------------------------------------
-- conflict detection
-- ---------------------------------------------------------------------------

create or replace function app_claim_conflicts(p_claim_id uuid)
returns table (
  conflicting_claim_id uuid,
  their_value jsonb,
  their_authority source_authority,
  their_evidence evidence_state
)
language sql
stable
as $$
  select c.id, c.value, c.source_authority, c.evidence_state
  from claims subject
  join claims c
    on c.subject_kind = subject.subject_kind
   and c.subject_id = subject.subject_id
   and c.attribute_key = subject.attribute_key
   and c.id <> subject.id
  where subject.id = p_claim_id
    -- Only credible competitors. An unknown or rejected claim disagreeing with
    -- a sourced one is not a conflict, it is just absence.
    and c.evidence_state in ('source_claimed', 'corroborated', 'verified')
    and c.lifecycle_state in ('validated', 'review_pending', 'approved', 'published')
    -- A claim this one explicitly replaces is a correction, not a disagreement.
    and c.id is distinct from subject.supersedes_claim_id
    and subject.id is distinct from c.supersedes_claim_id
    and c.value is distinct from subject.value;
$$;

comment on function app_claim_conflicts is
  'Credible claims disagreeing with this one about the same attribute. Doc 16 '
  'scenario 5: the system never picks a winner - not the newer, not the higher '
  'confidence, and never an average.';

-- ---------------------------------------------------------------------------
-- materialisation into the typed read model
-- ---------------------------------------------------------------------------

create or replace function app_materialize_attribute(
  p_subject_kind claim_subject_kind,
  p_subject_id uuid,
  p_attribute_key text,
  p_value jsonb,
  p_evidence evidence_state,
  p_authority source_authority
)
returns boolean
language plpgsql
as $$
declare
  scalar text := p_value #>> '{}';
begin
  -- Venue atmosphere and access. The pairing invariant from migration 0005
  -- means value and state must always be written together.
  if p_subject_kind = 'venue' then
    insert into venue_experience (venue_id) values (p_subject_id)
      on conflict (venue_id) do nothing;

    case p_attribute_key
      when 'atmosphere.energy' then
        update venue_experience set energy = scalar::smallint, energy_state = p_evidence
        where venue_id = p_subject_id;
      when 'atmosphere.conversation_friendliness' then
        update venue_experience
        set conversation_friendliness = scalar::smallint,
            conversation_friendliness_state = p_evidence
        where venue_id = p_subject_id;
      when 'atmosphere.lighting' then
        update venue_experience set lighting = scalar::smallint, lighting_state = p_evidence
        where venue_id = p_subject_id;
      when 'atmosphere.seating_comfort' then
        update venue_experience
        set seating_comfort = scalar::smallint, seating_comfort_state = p_evidence
        where venue_id = p_subject_id;
      when 'atmosphere.noise_band' then
        update venue_experience
        set noise_band = scalar::noise_band, noise_band_state = p_evidence
        where venue_id = p_subject_id;
      when 'access.outdoor_seating' then
        update venue_experience
        set outdoor_seating = scalar::boolean, outdoor_seating_state = p_evidence
        where venue_id = p_subject_id;
      when 'access.family_friendly' then
        update venue_experience
        set family_friendly = scalar::boolean, family_friendly_state = p_evidence
        where venue_id = p_subject_id;
      when 'access.wheelchair' then
        update venue_experience
        set wheelchair_accessible = scalar::boolean, wheelchair_accessible_state = p_evidence
        where venue_id = p_subject_id;
      else
        return false;
    end case;
    return true;
  end if;

  -- A dated performance. Publishing schedule evidence is what promotes an
  -- occurrence from 'scheduled' to 'confirmed' (ADR-010) - the one legitimate
  -- route, and it runs only after a human decision because event.schedule is
  -- high-impact (doc 11).
  if p_subject_kind = 'event_occurrence' and p_attribute_key = 'event.schedule' then
    update event_occurrences
    set evidence_state = p_evidence,
        source_authority = p_authority,
        state = case
          when state = 'scheduled'
               and p_evidence in ('source_claimed', 'corroborated', 'verified')
               and p_authority <> 'ai_extracted'
            then 'confirmed'
          else state
        end
    where id = p_subject_id;
    return true;
  end if;

  return false;
end;
$$;

comment on function app_materialize_attribute is
  'Writes a published value into the typed read model. Returns false for an '
  'attribute with no column yet: the version is still recorded, it simply does '
  'not reach search.';

-- ---------------------------------------------------------------------------
-- publish
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
begin
  select * into claim from claims where id = p_claim_id for update;
  if not found then
    raise exception 'No such claim %', p_claim_id using errcode = 'no_data_found';
  end if;

  if claim.lifecycle_state not in ('validated', 'approved') then
    -- Returned rather than raised, so a caller batching claims learns why this
    -- one did not publish without losing the rest of the batch.
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

  -- High-impact fields always need a recorded human decision (doc 11). The
  -- trigger on claims enforces this too; checking here gives a usable message
  -- instead of a constraint violation.
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
    update claims set evidence_state = 'conflicting', lifecycle_state = 'review_pending'
    where id = claim.id;

    update claims set evidence_state = 'conflicting', lifecycle_state = 'review_pending'
    where id in (select conflicting_claim_id from app_claim_conflicts(p_claim_id));

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

comment on function app_publish_claim is
  'The only route from an approved claim to a published value. Refuses an '
  'unapproved high-impact claim, refuses to choose between conflicting '
  'sources, supersedes the prior version and writes both the version record '
  'and the typed read model.';

-- ---------------------------------------------------------------------------
-- rollback
-- ---------------------------------------------------------------------------

create or replace function app_rollback_attribute(
  p_subject_kind claim_subject_kind,
  p_subject_id uuid,
  p_attribute_key text,
  p_reason text,
  p_actor uuid default null
)
returns jsonb
language plpgsql
as $$
declare
  current_row published_attributes;
  previous_row published_attributes;
  did_materialize boolean;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A rollback must record why' using errcode = 'check_violation';
  end if;

  select * into current_row
  from published_attributes
  where subject_kind = p_subject_kind
    and subject_id = p_subject_id
    and attribute_key = p_attribute_key
    and superseded_at is null
    and rolled_back_at is null
  for update;

  if not found then
    return jsonb_build_object('status', 'nothing_published');
  end if;

  update published_attributes
  set rolled_back_at = now(), rolled_back_by = p_actor, rollback_reason = p_reason
  where id = current_row.id;

  -- Withdraw the claim behind it too. Leaving it 'published' while its value is
  -- gone would make the claim queue lie about what is live.
  update claims set lifecycle_state = 'withdrawn'
  where id = current_row.published_from_claim_id;

  select * into previous_row
  from published_attributes
  where subject_kind = p_subject_kind
    and subject_id = p_subject_id
    and attribute_key = p_attribute_key
    and id <> current_row.id
    and rolled_back_at is null
  order by version desc
  limit 1;

  if not found then
    -- Nothing to fall back to. The attribute returns to unknown rather than
    -- keeping a value we have just declared wrong.
    if p_subject_kind = 'venue' then
      perform app_clear_venue_attribute(p_subject_id, p_attribute_key);
    end if;
    return jsonb_build_object(
      'status', 'rolled_back_to_unknown',
      'rolled_back_version', current_row.version
    );
  end if;

  update published_attributes set superseded_at = null where id = previous_row.id;

  did_materialize := app_materialize_attribute(
    previous_row.subject_kind, previous_row.subject_id, previous_row.attribute_key,
    previous_row.value, previous_row.evidence_state, previous_row.source_authority
  );

  return jsonb_build_object(
    'status', 'restored',
    'rolled_back_version', current_row.version,
    'restored_version', previous_row.version,
    'materialized', did_materialize
  );
end;
$$;

comment on function app_rollback_attribute is
  'Withdraws the live version and reinstates the one before it, or returns the '
  'attribute to unknown when there is none. A reason is mandatory: a rollback '
  'with no recorded cause is indistinguishable from data loss.';

-- Returning an attribute to unknown has to respect the pairing invariant:
-- clearing the value and the state together, never one of them.
create or replace function app_clear_venue_attribute(
  p_venue_id uuid,
  p_attribute_key text
)
returns void
language plpgsql
as $$
begin
  case p_attribute_key
    when 'atmosphere.energy' then
      update venue_experience set energy = null, energy_state = 'unknown'
      where venue_id = p_venue_id;
    when 'atmosphere.conversation_friendliness' then
      update venue_experience
      set conversation_friendliness = null, conversation_friendliness_state = 'unknown'
      where venue_id = p_venue_id;
    when 'atmosphere.lighting' then
      update venue_experience set lighting = null, lighting_state = 'unknown'
      where venue_id = p_venue_id;
    when 'atmosphere.seating_comfort' then
      update venue_experience set seating_comfort = null, seating_comfort_state = 'unknown'
      where venue_id = p_venue_id;
    when 'atmosphere.noise_band' then
      update venue_experience set noise_band = null, noise_band_state = 'unknown'
      where venue_id = p_venue_id;
    when 'access.outdoor_seating' then
      update venue_experience set outdoor_seating = null, outdoor_seating_state = 'unknown'
      where venue_id = p_venue_id;
    when 'access.family_friendly' then
      update venue_experience set family_friendly = null, family_friendly_state = 'unknown'
      where venue_id = p_venue_id;
    when 'access.wheelchair' then
      update venue_experience
      set wheelchair_accessible = null, wheelchair_accessible_state = 'unknown'
      where venue_id = p_venue_id;
    else
      null;
  end case;
end;
$$;
