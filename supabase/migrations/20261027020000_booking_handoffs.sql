-- Where to Go | 0010 booking handoffs
--
-- Records that someone left for a venue's own booking channel. It is a click
-- and nothing more (doc 02 AC06, doc 04): the platform makes no reservation,
-- receives no confirmation, and must never imply otherwise. The table is named
-- for what it is so no later reader mistakes it for a bookings table.
--
-- Privacy shapes the columns as much as analytics does (doc 12, doc 10):
--  - No IP address and no user agent. Neither is needed to count handoffs.
--  - The destination is stored as a host, not a full URL. A booking URL can
--    carry query parameters, and personal data must never sit in one.
--  - The user's search is NOT stored. Operators get counts, never queries
--    (doc 10: "no leaking private user queries to venues").
--  - result_position and ranking_version are kept so ranking changes can be
--    evaluated against outcomes, which needs no personal data at all.

create type handoff_channel as enum ('booking_url', 'phone', 'whatsapp', 'website');

create table booking_handoffs (
  id uuid primary key default gen_random_uuid(),

  market_id uuid not null references markets (id) on delete restrict,
  venue_id uuid not null references venues (id) on delete restrict,
  -- Which dated performance the user was looking at, where there was one.
  occurrence_id uuid references event_occurrences (id) on delete set null,

  channel handoff_channel not null,
  -- Host only. Never the full URL.
  destination_host text,

  -- Where the result sat in the shortlist, and under which ranking. Enough to
  -- tell whether a ranking change helped, with nothing identifying in it.
  result_position smallint check (result_position is null or result_position > 0),
  ranking_version text,

  -- Null for an anonymous visitor, which is the normal case and must stay
  -- workable: a handoff is not a reason to require an account.
  user_id uuid,

  created_at timestamptz not null default now(),

  constraint booking_handoffs_host_has_no_path
    check (destination_host is null or destination_host !~ '[/?#]')
);

create index booking_handoffs_venue_idx on booking_handoffs (venue_id, created_at desc);
create index booking_handoffs_market_idx on booking_handoffs (market_id, created_at desc);

comment on table booking_handoffs is
  'A record that a user left for an external booking channel. Never evidence of '
  'a reservation. The north-star metric is verified satisfactory outings; this '
  'is only the proxy, and a click must never be reported as a booking (doc 01, '
  'gap G8).';

-- ---------------------------------------------------------------------------
-- row level security
-- ---------------------------------------------------------------------------
-- No policies at all. Handoffs are written by the server route using the
-- service connection, never by the browser: a public insert policy would make
-- the table trivially spammable and the counts worthless. Reads are
-- operational and are not exposed to consumers or operators directly.

alter table booking_handoffs enable row level security;
