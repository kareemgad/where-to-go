-- Where to Go | 0012 roles and market-scoped admin access
--
-- Doc 10's roles, with authorization scoped per market. The reviewer who looks
-- after Dubai has no business reading Cairo's queue, and doc 16 scenario 7
-- makes "operator edits a venue outside their market is denied and logged" an
-- acceptance test rather than an aspiration.
--
-- These policies are the second line of defence, not the only one (ADR-002):
-- every server route still checks authorization in application code. RLS is
-- here so that a mistake in that code is contained rather than catastrophic.

create type app_role as enum (
  'global_admin',
  'market_manager',
  'reviewer',
  'venue_operator',
  'end_user'
);

create table role_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role app_role not null,
  -- Null means "every market", which only a global admin may be.
  market_id uuid references markets (id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid,

  unique (user_id, role, market_id),

  -- Least privilege, enforced rather than documented: a reviewer is a reviewer
  -- *of somewhere*. Granting all markets takes one row per market, which makes
  -- the breadth of access visible instead of implicit.
  constraint role_assignments_scope_matches_role check (
    (role = 'global_admin' and market_id is null)
    or (role <> 'global_admin' and market_id is not null)
  )
);

create index role_assignments_user_idx on role_assignments (user_id);
create index role_assignments_market_idx on role_assignments (market_id);

comment on table role_assignments is
  'Who may do what, and where. A global_admin row has no market; every other '
  'role is scoped to one.';

-- ---------------------------------------------------------------------------
-- authorization helpers
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so a policy can consult role_assignments without the caller
-- needing to read it. search_path is pinned: a SECURITY DEFINER function with a
-- mutable search_path is a privilege-escalation hole.

create or replace function app_is_global_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from role_assignments
    where user_id = auth.uid() and role = 'global_admin'
  );
$$;

create or replace function app_has_market_role(p_role app_role, p_market_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select app_is_global_admin() or exists (
    select 1 from role_assignments
    where user_id = auth.uid()
      and role = p_role
      and market_id = p_market_id
  );
$$;

/** Reviewer, market manager or global admin: who may work the review queue. */
create or replace function app_can_review_market(p_market_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select app_is_global_admin() or exists (
    select 1 from role_assignments
    where user_id = auth.uid()
      and role in ('reviewer', 'market_manager')
      and market_id = p_market_id
  );
$$;

create or replace function app_reviewable_markets()
returns setof uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select m.id from markets m where app_is_global_admin()
  union
  select ra.market_id
  from role_assignments ra
  where ra.user_id = auth.uid()
    and ra.role in ('reviewer', 'market_manager')
    and ra.market_id is not null;
$$;

/**
 * Which market a claim belongs to. Every claim subject resolves to a venue, and
 * every venue has exactly one canonical market (brief C7), so market-scoping a
 * polymorphic claim is well defined.
 */
create or replace function app_claim_market(
  p_subject_kind claim_subject_kind,
  p_subject_id uuid
)
returns uuid
language sql
stable
as $$
  select case p_subject_kind
    when 'venue' then (
      select canonical_market_id from venues where id = p_subject_id
    )
    when 'venue_space' then (
      select v.canonical_market_id from venue_spaces s
      join venues v on v.id = s.venue_id where s.id = p_subject_id
    )
    when 'event_series' then (
      select v.canonical_market_id from event_series e
      join venues v on v.id = e.venue_id where e.id = p_subject_id
    )
    when 'event_occurrence' then (
      select v.canonical_market_id from event_occurrences o
      join venues v on v.id = o.venue_id where o.id = p_subject_id
    )
  end;
$$;

-- ---------------------------------------------------------------------------
-- policies
-- ---------------------------------------------------------------------------

alter table role_assignments enable row level security;

-- Everyone may see their own grants, so the UI can say what you can do. Nobody
-- may grant through the client: assignment runs through the service role.
create policy role_assignments_read_own on role_assignments
  for select using (user_id = auth.uid() or app_is_global_admin());

-- The review queue, scoped to the markets you actually look after.
create policy claims_reviewer_read on claims
  for select using (app_can_review_market(app_claim_market(subject_kind, subject_id)));

create policy verification_decisions_reviewer_read on verification_decisions
  for select using (
    exists (
      select 1 from claims c
      where c.id = claim_id
        and app_can_review_market(app_claim_market(c.subject_kind, c.subject_id))
    )
  );

-- A reviewer records decisions for their own markets, and only as themselves.
create policy verification_decisions_reviewer_write on verification_decisions
  for insert with check (
    reviewer_id = auth.uid()
    and exists (
      select 1 from claims c
      where c.id = claim_id
        and app_can_review_market(app_claim_market(c.subject_kind, c.subject_id))
    )
  );

-- Evidence is not market-scoped, and a reviewer cannot judge a claim without
-- seeing what it rests on. Readable by anyone who reviews anywhere.
create policy source_documents_reviewer_read on source_documents
  for select using (exists (select 1 from app_reviewable_markets()));
create policy evidence_records_reviewer_read on evidence_records
  for select using (exists (select 1 from app_reviewable_markets()));
create policy source_providers_reviewer_read on source_providers
  for select using (exists (select 1 from app_reviewable_markets()));

create policy published_attributes_reviewer_read on published_attributes
  for select using (app_can_review_market(app_claim_market(subject_kind, subject_id)));

-- Handoff counts are operational. A market manager sees their own market's;
-- nobody sees another's, and these are aggregates over rows that hold no
-- personal data to begin with (doc 10, doc 12).
create policy booking_handoffs_manager_read on booking_handoffs
  for select using (app_has_market_role('market_manager', market_id));

-- Market activation history, for the same audience.
create policy market_activations_manager_read on market_activations
  for select using (app_has_market_role('market_manager', market_id));

-- Programmes stay closed to consumers but are visible to reviewers, who need
-- to see the rule behind a proposed occurrence.
create policy event_series_reviewer_read on event_series
  for select using (
    exists (
      select 1 from venues v
      where v.id = venue_id and app_can_review_market(v.canonical_market_id)
    )
  );
