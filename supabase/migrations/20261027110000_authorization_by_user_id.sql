-- Where to Go | 0014 authorization rules callable with an explicit user id
--
-- Migration 0012 expressed authorization as auth.uid() functions, which is
-- what an RLS policy needs. The server routes cannot use them: they reach
-- Postgres over the pooled application connection, where auth.uid() is null,
-- so every one of those checks would read as "denied".
--
-- The fix is not a second copy of the rule in TypeScript. A duplicated
-- authorization rule drifts, and the copy that drifts is the one that grants
-- too much. Instead the rule moves into a function taking the user id, and the
-- auth.uid() variants become one-line delegates. One definition, two callers:
-- RLS passes the session's uid, the server route passes the uid it
-- authenticated.

create or replace function app_user_is_global_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select p_user_id is not null and exists (
    select 1 from role_assignments
    where user_id = p_user_id and role = 'global_admin'
  );
$$;

create or replace function app_user_has_market_role(
  p_user_id uuid,
  p_role app_role,
  p_market_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select app_user_is_global_admin(p_user_id) or (
    p_user_id is not null and p_market_id is not null and exists (
      select 1 from role_assignments
      where user_id = p_user_id and role = p_role and market_id = p_market_id
    )
  );
$$;

create or replace function app_user_can_review_market(p_user_id uuid, p_market_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select app_user_is_global_admin(p_user_id) or (
    p_user_id is not null and p_market_id is not null and exists (
      select 1 from role_assignments
      where user_id = p_user_id
        and role in ('reviewer', 'market_manager')
        and market_id = p_market_id
    )
  );
$$;

create or replace function app_user_reviewable_markets(p_user_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select m.id from markets m where app_user_is_global_admin(p_user_id)
  union
  select ra.market_id
  from role_assignments ra
  where ra.user_id = p_user_id
    and ra.role in ('reviewer', 'market_manager')
    and ra.market_id is not null;
$$;

-- ---------------------------------------------------------------------------
-- the auth.uid() variants, now delegates
-- ---------------------------------------------------------------------------
-- Bodies replaced, signatures unchanged, so every policy from 0012 keeps
-- working and now shares one implementation with the server routes.

create or replace function app_is_global_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select app_user_is_global_admin(auth.uid());
$$;

create or replace function app_has_market_role(p_role app_role, p_market_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select app_user_has_market_role(auth.uid(), p_role, p_market_id);
$$;

create or replace function app_can_review_market(p_market_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select app_user_can_review_market(auth.uid(), p_market_id);
$$;

create or replace function app_reviewable_markets()
returns setof uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select app_user_reviewable_markets(auth.uid());
$$;

comment on function app_user_can_review_market is
  'Whether this user may work the review queue for this market. The rule '
  'lives here; app_can_review_market() is the auth.uid() delegate used by RLS '
  'policies, so a server route and a policy can never disagree.';
