-- Where to Go | 0015 denied-access trail
--
-- Doc 16 scenario 7 makes "an operator editing a venue outside their market is
-- denied and logged" an acceptance test. A denial that leaves no trace cannot
-- be tested, and more to the point cannot be noticed: a reviewer repeatedly
-- probing another market's queue is exactly the signal this table exists to
-- preserve.
--
-- Separate from verification_decisions on purpose. That table is the record of
-- review work performed; this is the record of work refused. Mixing them would
-- make "how many decisions did this reviewer make" a question with two
-- answers.

create table authorization_denials (
  id uuid primary key default gen_random_uuid(),

  -- Null when nobody was signed in. An anonymous probe is still worth keeping.
  user_id uuid references auth.users (id) on delete set null,

  -- What was attempted, as a stable machine-readable pair rather than prose.
  action text not null check (action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  market_id uuid references markets (id) on delete set null,
  subject_kind claim_subject_kind,
  subject_id uuid,

  reason text not null,
  occurred_at timestamptz not null default now()
);

create index authorization_denials_user_idx
  on authorization_denials (user_id, occurred_at desc);
create index authorization_denials_market_idx
  on authorization_denials (market_id, occurred_at desc);

comment on table authorization_denials is
  'Append-only trail of refused actions. Holds no request body and no '
  'credentials - what was attempted, by whom, and why it was refused.';

alter table authorization_denials enable row level security;

-- A global admin may read the trail. Nobody reads their own denials: showing a
-- prober exactly what the system recorded about them helps only the prober.
create policy authorization_denials_admin_read on authorization_denials
  for select using (app_is_global_admin());
