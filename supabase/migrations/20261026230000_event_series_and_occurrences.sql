-- Where to Go | 0006 event series and occurrences
--
-- The decision this migration enforces is the one the whole product rests on
-- (ADR-010, brief C2, brief D5):
--
--   A recurrence rule is not evidence that a band plays on a given Friday.
--
-- So a series holds the rule, an occurrence holds one dated instance with its
-- own state and its own evidence, and an occurrence materialised from a rule
-- arrives as 'scheduled' — which is deliberately NOT recommendable. Promotion
-- to 'confirmed' requires date-specific evidence, and the database refuses the
-- transition without it. Doc 03's single events table could not express any of
-- this: not per-date cancellation, not differing evidence per night, not a rule
-- with no confirmed dates.
--
-- Recommending 'scheduled' occurrences would multiply apparent coverage
-- overnight and destroy the only real differentiator. That is why this is a
-- constraint and not a convention.

create type performance_type as enum (
  'live_band',
  'dj',
  'solo_instrumentalist',
  'piano',
  'open_mic',
  'acoustic_set',
  'other'
);

create type occurrence_state as enum (
  -- Materialised from a rule. Has no date-specific evidence. NOT recommendable.
  'scheduled',
  -- Date-specific evidence exists. Recommendable.
  'confirmed',
  'postponed',
  'cancelled',
  'completed'
);

create type series_status as enum ('active', 'ended');

-- ---------------------------------------------------------------------------
-- series: the rule
-- ---------------------------------------------------------------------------

create table event_series (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues (id) on delete cascade,
  space_id uuid references venue_spaces (id) on delete set null,

  title text not null,
  description text,
  genre_tags text[] not null default '{}',
  performance_type performance_type not null,
  artist text,

  -- RFC 5545 RRULE, or null for a one-off that still wants a series row.
  recurrence_rule text,
  -- The zone the rule's wall clock belongs to. A rule without a zone is
  -- meaningless across DST (doc 10).
  timezone text not null,

  status series_status not null default 'active',
  is_demo_data boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint event_series_timezone_is_iana
    check ((timestamp '2000-01-01 00:00:00' at time zone timezone) is not null),
  constraint event_series_timezone_not_offset
    check (timezone !~ '[+]' and timezone !~ ':' and timezone ~ '^[A-Za-z]')
);

create index event_series_venue_idx on event_series (venue_id) where status = 'active';

comment on table event_series is
  'A programme, not a performance. Nothing here is recommendable: only '
  'materialised, confirmed occurrences are (ADR-010).';

-- ---------------------------------------------------------------------------
-- occurrences: the dated instances
-- ---------------------------------------------------------------------------

create table event_occurrences (
  id uuid primary key default gen_random_uuid(),

  -- Denormalised from the series so date-and-place queries need no join, and
  -- so a one-off occurrence needs no series at all.
  venue_id uuid not null references venues (id) on delete cascade,
  series_id uuid references event_series (id) on delete set null,
  space_id uuid references venue_spaces (id) on delete set null,

  title text not null,
  genre_tags text[] not null default '{}',
  performance_type performance_type not null,
  artist text,

  -- The four time representations (src/lib/time.ts, doc 10). All four are
  -- stored because each answers a question the others cannot, and a trigger
  -- below keeps them consistent.
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null,
  local_start_date date not null,
  local_start_time time not null,
  local_end_date date not null,
  local_end_time time not null,
  -- What the evidence literally said: "Fri 8pm", "late Thursday". A reviewer
  -- resolving a conflict needs the source's own wording.
  source_expression text,

  state occurrence_state not null default 'scheduled',

  -- Published evidence for THIS date, carried here so the confidence label is
  -- derivable without touching the claims table.
  evidence_state evidence_state not null default 'unknown',
  source_authority source_authority,
  published_from_claim_id uuid references claims (id) on delete set null,

  -- Doc 12: event listings recheck within 24 hours, tightening near the event.
  expires_at timestamptz,

  is_demo_data boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint event_occurrences_ends_after_start check (ends_at > starts_at),

  constraint event_occurrences_timezone_is_iana
    check ((timestamp '2000-01-01 00:00:00' at time zone timezone) is not null),
  constraint event_occurrences_timezone_not_offset
    check (timezone !~ '[+]' and timezone !~ ':' and timezone ~ '^[A-Za-z]'),

  -- ADR-010, the load-bearing constraint. 'confirmed' asserts that something
  -- happens on this specific date, so it requires evidence for this date.
  constraint event_occurrences_confirmed_requires_evidence
    check (
      state <> 'confirmed'
      or (evidence_state in ('source_claimed', 'corroborated', 'verified')
          and source_authority is not null)
    ),

  -- Doc 11 risk rules: a live-event schedule is high-impact, and an agent's
  -- extraction is a proposal. A machine cannot confirm a date on its own.
  constraint event_occurrences_ai_cannot_confirm
    check (state <> 'confirmed' or source_authority <> 'ai_extracted'),

  -- Brief C4 again, at the published layer.
  constraint event_occurrences_verified_not_self_asserted
    check (evidence_state <> 'verified' or source_authority <> 'visitor_reported'),

  -- The pairing invariant from 0005: no evidence means no authority.
  constraint event_occurrences_evidence_paired
    check ((source_authority is null) = (evidence_state = 'unknown'))
);

-- The index search actually uses: confirmed occurrences in a date window.
create index event_occurrences_window_idx
  on event_occurrences (venue_id, starts_at, ends_at)
  where state = 'confirmed';
create index event_occurrences_local_date_idx
  on event_occurrences (local_start_date)
  where state = 'confirmed';
create index event_occurrences_genre_idx on event_occurrences using gin (genre_tags);
create index event_occurrences_series_idx on event_occurrences (series_id);
create index event_occurrences_expiry_idx on event_occurrences (expires_at)
  where expires_at is not null;

-- One materialised occurrence per series per local start. Re-running the
-- materialiser must be idempotent rather than duplicating a night.
create unique index event_occurrences_series_slot_idx
  on event_occurrences (series_id, local_start_date, local_start_time)
  where series_id is not null;

create trigger event_series_updated_at before update on event_series
  for each row execute function app_set_updated_at();
create trigger event_occurrences_updated_at before update on event_occurrences
  for each row execute function app_set_updated_at();

-- ---------------------------------------------------------------------------
-- keep the four time representations consistent
-- ---------------------------------------------------------------------------
-- AT TIME ZONE over a timestamptz is STABLE rather than IMMUTABLE, so this
-- cannot be a check constraint. A trigger is the only way to stop the local
-- columns silently drifting from the instants.

create or replace function app_occurrence_assert_local_times()
returns trigger
language plpgsql
as $$
declare
  local_start timestamp;
  local_end timestamp;
begin
  local_start := new.starts_at at time zone new.timezone;
  local_end := new.ends_at at time zone new.timezone;

  if local_start::date <> new.local_start_date
     or local_start::time <> new.local_start_time then
    raise exception
      'local_start_date/time (% %) disagree with starts_at in zone % (% %)',
      new.local_start_date, new.local_start_time, new.timezone,
      local_start::date, local_start::time
      using errcode = 'check_violation';
  end if;

  if local_end::date <> new.local_end_date
     or local_end::time <> new.local_end_time then
    raise exception
      'local_end_date/time (% %) disagree with ends_at in zone % (% %)',
      new.local_end_date, new.local_end_time, new.timezone,
      local_end::date, local_end::time
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger event_occurrences_local_times
  before insert or update of starts_at, ends_at, timezone,
    local_start_date, local_start_time, local_end_date, local_end_time
  on event_occurrences
  for each row execute function app_occurrence_assert_local_times();

-- ---------------------------------------------------------------------------
-- state machine
-- ---------------------------------------------------------------------------

create or replace function app_occurrence_transition_allowed(
  from_state occurrence_state,
  to_state occurrence_state
)
returns boolean
language sql
immutable
as $$
  select case
    when from_state = to_state then true
    -- Evidence arrives for the date, or the night is called off.
    when from_state = 'scheduled' then to_state in ('confirmed', 'cancelled', 'postponed')
    -- A confirmed night can still be cancelled, moved, or finish.
    when from_state = 'confirmed' then to_state in ('cancelled', 'postponed', 'completed')
    -- A postponed night may be re-confirmed at a new time, or abandoned.
    when from_state = 'postponed' then to_state in ('confirmed', 'cancelled', 'scheduled')
    -- Cancelled and completed are terminal. Doc 16 scenario 6: the audit is
    -- preserved and the night never becomes recommendable again.
    else false
  end;
$$;

create or replace function app_occurrence_state_guard()
returns trigger
language plpgsql
as $$
begin
  if not app_occurrence_transition_allowed(old.state, new.state) then
    raise exception
      'Illegal occurrence transition % -> % for occurrence %',
      old.state, new.state, old.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger event_occurrences_state_guard
  before update of state on event_occurrences
  for each row execute function app_occurrence_state_guard();

-- ---------------------------------------------------------------------------
-- recommendability
-- ---------------------------------------------------------------------------

create or replace function app_occurrence_is_recommendable(
  state occurrence_state,
  evidence evidence_state,
  ends_at timestamptz,
  as_of timestamptz
)
returns boolean
language sql
immutable
as $$
  select state = 'confirmed'
    and evidence in ('source_claimed', 'corroborated', 'verified')
    -- Doc 02 AC02: a past event is never shown as upcoming.
    and ends_at > as_of;
$$;

comment on function app_occurrence_is_recommendable is
  'The single definition of recommendable. "scheduled" is excluded by design '
  '(ADR-010): a recurrence rule is not evidence for a date. Conflicting and '
  'stale evidence are excluded too, so a disagreement is never silently '
  'resolved in the venue''s favour. Takes an explicit as_of so it is testable.';

-- Everything a consumer may see, before the date window is applied. Joins in
-- the market and venue gates so no caller can forget them.
create view publishable_occurrences as
  select
    o.id,
    o.venue_id,
    o.series_id,
    o.space_id,
    o.title,
    o.genre_tags,
    o.performance_type,
    o.artist,
    o.starts_at,
    o.ends_at,
    o.timezone,
    o.local_start_date,
    o.local_start_time,
    o.local_end_date,
    o.local_end_time,
    o.source_expression,
    o.state,
    o.evidence_state,
    o.source_authority,
    o.expires_at,
    o.is_demo_data,
    app_confidence_label('published'::claim_lifecycle_state, o.evidence_state, o.source_authority)
      as confidence_label,
    -- True when the show runs past local midnight: ordinary, not exceptional.
    (o.local_end_date <> o.local_start_date) as crosses_midnight,
    v.canonical_market_id,
    m.timezone as market_timezone,
    m.currency as market_currency
  from event_occurrences o
  join venues v on v.id = o.venue_id
  join markets m on m.id = v.canonical_market_id
  where o.state = 'confirmed'
    and o.evidence_state in ('source_claimed', 'corroborated', 'verified')
    and v.status = 'active'
    and m.status = 'live';

comment on view publishable_occurrences is
  'Consumer-facing occurrences. Applies the confirmed-plus-evidence rule, the '
  'venue status gate and the live-market gate in one place, so a query cannot '
  'accidentally omit one. Callers still apply their own date window.';

-- ---------------------------------------------------------------------------
-- freshness
-- ---------------------------------------------------------------------------

create or replace function app_complete_past_occurrences(as_of timestamptz)
returns integer
language sql
as $$
  with done as (
    update event_occurrences
    set state = 'completed'
    where ends_at <= as_of
      and state in ('scheduled', 'confirmed')
    returning 1
  )
  select count(*)::integer from done;
$$;

comment on function app_complete_past_occurrences is
  'Automatically retires past occurrences (doc 03, doc 02 AC02). Runs without '
  'a human, so an unattended queue degrades safely.';

-- ---------------------------------------------------------------------------
-- row level security
-- ---------------------------------------------------------------------------

alter table event_series enable row level security;
alter table event_occurrences enable row level security;

-- A series is a programme, not a performance. Exposing it publicly invites
-- exactly the inference the product exists to prevent, so there is no public
-- read policy for it.

create policy event_occurrences_public_read on event_occurrences
  for select using (
    state = 'confirmed'
    and evidence_state in ('source_claimed', 'corroborated', 'verified')
    and app_venue_is_publicly_visible(venue_id)
  );
