-- Where to Go | 0004 evidence core
--
-- The write side of the two-sided model: every externally sourced fact is a
-- claim with provenance, not a column someone overwrote. The read side (typed
-- published values on venues and occurrences) comes in 0005 and 0006.
--
-- The decisions made concrete here:
--  - ADR-005 / brief C3: three orthogonal state axes, not one enum. The four
--    specification documents each used a different vocabulary and conflated
--    workflow position, evidence strength and source authority. Keeping them
--    separate is what makes the user-facing label derivable rather than
--    author-set.
--  - ADR-005 / brief C4: venue_attested and independently_verified never
--    collapse. An operator confirming their own Friday band is the strongest
--    evidence we will usually have, and still is not independent verification.
--  - Doc 11: an evidence anchor is mandatory, enforced by NOT NULL rather than
--    by convention. This is what delivers doc 16's "evidence attribution on
--    100% of published factual claims" structurally.
--  - ADR-006 / gap G6: provider payloads whose terms forbid caching live in a
--    physically separate table with a TTL and never join the published read
--    model.

-- ---------------------------------------------------------------------------
-- the three state axes (brief C3)
-- ---------------------------------------------------------------------------

-- Axis 1: where the claim sits in the workflow (doc 11).
create type claim_lifecycle_state as enum (
  'candidate',
  'extracted',
  'validated',
  'review_pending',
  'approved',
  'rejected',
  'published',
  'stale',
  'withdrawn'
);

-- Axis 2: how strong the evidence is (doc 12).
create type evidence_state as enum (
  'unknown',
  'source_claimed',
  'corroborated',
  'verified',
  'conflicting',
  'stale',
  'rejected'
);

-- Axis 3: who asserted it (doc 03). Deliberately distinguishes a venue
-- attesting its own programme from an editor independently checking it.
create type source_authority as enum (
  'venue_attested',
  'editor_checked',
  'visitor_reported',
  'authorized_feed',
  'ai_extracted'
);

create type claim_subject_kind as enum (
  'venue',
  'venue_space',
  'event_series',
  'event_occurrence'
);

-- ---------------------------------------------------------------------------
-- source registry (doc 12)
-- ---------------------------------------------------------------------------

create type source_storage_policy as enum (
  -- Fields may be persisted into canonical records.
  'canonical_ok',
  -- Payload may be held briefly in provider_payloads, never copied across.
  'ephemeral_only',
  -- Only the provider's identifier may be retained.
  'ids_only'
);

create type source_activation_status as enum ('inactive', 'dry_run', 'active');

create table source_providers (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9]+(_[a-z0-9]+)*$'),
  display_name text not null,
  base_domains text[] not null default '{}',

  -- Enforced at write time by app_assert_field_allowed, so a field a provider
  -- forbids cannot reach the canonical store even by mistake (doc 16 #8).
  allowed_fields text[] not null default '{}',
  storage_policy source_storage_policy not null default 'ephemeral_only',
  retention_ttl interval,

  attribution_required boolean not null default false,
  attribution_text text,

  tos_reviewed_at timestamptz,
  legal_reviewer text,
  cost_model text,

  activation_status source_activation_status not null default 'inactive',
  -- Default closed. Live collection is disabled until separately approved
  -- (CLAUDE.md, ADR-006).
  kill_switch boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A provider cannot be active while its terms are unreviewed.
  constraint source_providers_active_requires_review
    check (activation_status <> 'active' or tos_reviewed_at is not null),
  -- Attribution text must exist if attribution is required.
  constraint source_providers_attribution_present
    check (not attribution_required or attribution_text is not null)
);

comment on column source_providers.kill_switch is
  'True blocks all collection from this provider. Default true: a provider is '
  'inert until deliberately enabled.';

create table source_documents (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references source_providers (id) on delete restrict,
  url text,
  publisher text,
  -- When the material was actually observed, which is not when the row was
  -- written and not when the source published it.
  captured_at timestamptz not null,
  content_hash text,
  rights_profile text,
  -- Set from the provider's retention_ttl; a nightly job prunes past this.
  retention_expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index source_documents_provider_idx on source_documents (provider_id);
create index source_documents_retention_idx on source_documents (retention_expires_at)
  where retention_expires_at is not null;

create table evidence_records (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references source_documents (id) on delete restrict,
  -- Which field or path in the document the value came from.
  field_pointer text,
  -- The literal text supporting the claim. A reviewer resolving a conflict
  -- needs to read what the source actually said.
  excerpt text,
  created_at timestamptz not null default now(),
  constraint evidence_records_has_anchor
    check (field_pointer is not null or excerpt is not null)
);

create index evidence_records_document_idx on evidence_records (document_id);

-- ---------------------------------------------------------------------------
-- claims
-- ---------------------------------------------------------------------------

create table claims (
  id uuid primary key default gen_random_uuid(),

  subject_kind claim_subject_kind not null,
  -- Polymorphic across four subject kinds, so not a foreign key. Referential
  -- integrity is the application's job here; the alternative is four
  -- near-identical claim tables.
  subject_id uuid not null,

  -- Dotted path, e.g. music.genre, price.per_person, access.wheelchair.
  attribute_key text not null check (attribute_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  value jsonb not null,

  -- Mandatory. A claim with no evidence cannot exist (doc 11 step 5).
  evidence_id uuid not null references evidence_records (id) on delete restrict,

  lifecycle_state claim_lifecycle_state not null default 'candidate',
  evidence_state evidence_state not null default 'unknown',
  source_authority source_authority not null,

  -- Per-attribute, never a global "AI confidence" (doc 03).
  confidence numeric(3, 2) check (confidence is null or (confidence >= 0 and confidence <= 1)),

  -- Doc 12: a named method, recorded with the verifier and date.
  verification_method text,
  verifier_id uuid,
  verified_at timestamptz,

  observed_at timestamptz not null,
  valid_from timestamptz,
  valid_to timestamptz,
  -- Doc 12 freshness policy. Expiry downgrades confidence; it never deletes.
  expires_at timestamptz,

  supersedes_claim_id uuid references claims (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint claims_validity_ordered
    check (valid_to is null or valid_from is null or valid_to >= valid_from),

  -- Brief C4: only an actual verification event may carry a verified state,
  -- and it must name its method. "Verified" is never a bare assertion.
  constraint claims_verified_requires_method
    check (evidence_state <> 'verified' or (verification_method is not null and verified_at is not null)),

  -- An AI extraction is a proposal. It can never be its own verification.
  constraint claims_ai_cannot_self_verify
    check (source_authority <> 'ai_extracted' or evidence_state <> 'verified'),

  -- A visitor report is not verification either.
  constraint claims_visitor_cannot_verify
    check (source_authority <> 'visitor_reported' or evidence_state <> 'verified')
);

create index claims_subject_idx on claims (subject_kind, subject_id, attribute_key);
create index claims_lifecycle_idx on claims (lifecycle_state) where lifecycle_state <> 'published';
create index claims_expiry_idx on claims (expires_at) where expires_at is not null;
create index claims_review_queue_idx on claims (lifecycle_state, observed_at)
  where lifecycle_state = 'review_pending';

create trigger claims_updated_at before update on claims
  for each row execute function app_set_updated_at();
create trigger source_providers_updated_at before update on source_providers
  for each row execute function app_set_updated_at();

-- ---------------------------------------------------------------------------
-- review decisions
-- ---------------------------------------------------------------------------

create type verification_action as enum (
  'approve',
  'reject',
  'request_venue_confirmation',
  'edit'
);

create table verification_decisions (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references claims (id) on delete cascade,
  reviewer_id uuid,
  action verification_action not null,
  reason text,
  created_at timestamptz not null default now()
);

create index verification_decisions_claim_idx
  on verification_decisions (claim_id, created_at desc);

comment on table verification_decisions is
  'Append-only review trail. A rejection keeps its reason so the same claim is '
  'not re-proposed and re-rejected indefinitely.';

-- ---------------------------------------------------------------------------
-- restricted provider payloads (gap G6)
-- ---------------------------------------------------------------------------

create table provider_payloads (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references source_providers (id) on delete cascade,
  external_id text not null,
  payload jsonb not null,
  captured_at timestamptz not null,
  retention_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (provider_id, external_id)
);

create index provider_payloads_retention_idx
  on provider_payloads (retention_expires_at);

comment on table provider_payloads is
  'Physically separate from canonical records. Holds provider material whose '
  'terms forbid persistent caching, under a hard TTL. Never joined into the '
  'published read model, and never the source of a published value - a claim '
  'must cite its own evidence_record (ADR-006, doc 12).';

-- ---------------------------------------------------------------------------
-- high-impact attributes (doc 11)
-- ---------------------------------------------------------------------------

create or replace function app_is_high_impact_attribute(attribute_key text)
returns boolean
language sql
immutable
as $$
  select attribute_key like 'event.%'
      or attribute_key like 'price.%'
      or attribute_key like 'access.%'
      or attribute_key like 'admission.%'
      or attribute_key like 'booking.%'
      or attribute_key in ('venue.status', 'venue.closure', 'venue.booking_url');
$$;

comment on function app_is_high_impact_attribute is
  'Doc 11 risk rules: closure, cancellation, live-event schedule, '
  'accessibility, age admission, fees and booking links always require a human '
  'decision and are never batch-approved.';

create or replace function app_claim_review_guard()
returns trigger
language plpgsql
as $$
begin
  -- A high-impact claim cannot be approved or published without a recorded
  -- human decision. Deterministic validation is not enough for these fields.
  if new.lifecycle_state in ('approved', 'published')
     and app_is_high_impact_attribute(new.attribute_key)
     and not exists (
       select 1 from verification_decisions d
       where d.claim_id = new.id and d.action in ('approve', 'edit')
     )
  then
    raise exception
      'Claim % on high-impact attribute "%" cannot reach % without a recorded verification decision',
      new.id, new.attribute_key, new.lifecycle_state
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger claims_review_guard
  after insert or update of lifecycle_state on claims
  for each row execute function app_claim_review_guard();

-- ---------------------------------------------------------------------------
-- rights enforcement at write time (doc 16 scenario 8)
-- ---------------------------------------------------------------------------

create or replace function app_assert_field_allowed(
  provider_key text,
  attribute_key text
)
returns void
language plpgsql
stable
as $$
declare
  provider source_providers;
begin
  select * into provider from source_providers where key = provider_key;
  if not found then
    raise exception 'Unknown source provider "%"', provider_key
      using errcode = 'foreign_key_violation';
  end if;

  if provider.kill_switch then
    raise exception 'Provider "%" has its kill switch engaged', provider_key
      using errcode = 'check_violation';
  end if;

  if provider.storage_policy = 'ids_only' then
    raise exception
      'Provider "%" permits storing identifiers only; "%" cannot be persisted canonically',
      provider_key, attribute_key
      using errcode = 'check_violation';
  end if;

  if array_length(provider.allowed_fields, 1) is not null
     and not (attribute_key = any (provider.allowed_fields))
  then
    raise exception
      'Provider "%" does not permit storing "%". Add it to allowed_fields only with a terms review.',
      provider_key, attribute_key
      using errcode = 'check_violation';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- the derived confidence label (ADR-005)
-- ---------------------------------------------------------------------------

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
    -- Withdrawn, rejected or unpublished claims have no user-facing label:
    -- they must not appear at all.
    when lifecycle in ('rejected', 'withdrawn') then 'not_shown'
    when evidence = 'rejected' then 'not_shown'

    -- A credible disagreement is surfaced as such, never silently resolved
    -- (doc 16 scenario 5).
    when evidence = 'conflicting' then 'conflicting'

    -- Expiry downgrades rather than deleting (doc 12).
    when evidence = 'stale' or lifecycle = 'stale' then 'needs_recheck'

    -- Brief C4: only an independent check earns "verified". An operator
    -- attesting their own programme is labelled as the venue's own word.
    when evidence = 'verified' and authority = 'editor_checked' then 'editor_verified'
    when evidence = 'verified' and authority = 'authorized_feed' then 'editor_verified'
    when evidence in ('verified', 'corroborated') and authority = 'venue_attested'
      then 'venue_confirmed'
    when evidence = 'corroborated' then 'editor_verified'

    when authority = 'venue_attested' then 'venue_confirmed'
    when authority = 'visitor_reported' then 'visitor_reported'

    -- An AI extraction with one attributed source is an estimate, whatever its
    -- confidence score says (doc 03).
    when authority = 'ai_extracted' then 'unverified_estimate'
    when evidence = 'source_claimed' then 'unverified_estimate'
    else 'unknown'
  end;
$$;

comment on function app_confidence_label is
  'The single source of the user-facing label (doc 06), derived from the three '
  'state axes. Never stored and never author-set, so it cannot drift from the '
  'evidence. Mirrored in TypeScript at src/modules/evidence/confidence.ts; the '
  'two are kept in step by a test over the full matrix.';

-- ---------------------------------------------------------------------------
-- freshness expiry (doc 12)
-- ---------------------------------------------------------------------------

create or replace function app_expire_stale_claims(as_of timestamptz)
returns integer
language sql
as $$
  with expired as (
    update claims
    set evidence_state = 'stale'
    where expires_at is not null
      and expires_at <= as_of
      and evidence_state not in ('stale', 'rejected')
      and lifecycle_state not in ('rejected', 'withdrawn')
    returning 1
  )
  select count(*)::integer from expired;
$$;

comment on function app_expire_stale_claims is
  'Downgrades expired claims with no human in the loop, so a review queue '
  'nobody empties degrades safely rather than serving stale facts (gap G5). '
  'Takes an explicit timestamp so it is testable rather than dependent on now().';

-- ---------------------------------------------------------------------------
-- row level security
-- ---------------------------------------------------------------------------
-- None of this is public. Consumers read the published projection, never the
-- evidence store. Enabled with no policies at all: only the service role and
-- future admin roles reach these tables.

alter table source_providers enable row level security;
alter table source_documents enable row level security;
alter table evidence_records enable row level security;
alter table claims enable row level security;
alter table verification_decisions enable row level security;
alter table provider_payloads enable row level security;
