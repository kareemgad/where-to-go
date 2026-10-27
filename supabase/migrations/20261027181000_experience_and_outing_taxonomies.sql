-- Where to Go | 0022 experience tags, outing kinds and time-of-day bands
--
-- Three controlled vocabularies, each global with per-market extensions, which
-- is doc 10's rule for taxonomies: a market adds terms, it does not fork the
-- core. A row with a null market_id is available everywhere; a row naming a
-- market is available only there.
--
-- These replace free-text genre matching. A genre string typed by a user and
-- compared against a genre string stored on an occurrence matches on spelling,
-- which is not the same thing as matching on meaning, and it gives the parser
-- nothing to map onto. A closed vocabulary gives both sides a shared referent.

-- ---------------------------------------------------------------------------
-- experience tags
-- ---------------------------------------------------------------------------

create type experience_facet as enum (
  'music',
  'setting',
  'occasion',
  'activity'
);

comment on type experience_facet is
  'How a tag is grouped in the refine panel. Matching stays a flat overlap '
  'across all facets; this only decides which heading a chip sits under.';

create table experience_tags (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$'),
  facet experience_facet not null,

  -- Null means every market. A market extension names its market.
  market_id uuid references markets (id) on delete cascade,

  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);

create index experience_tags_market_idx on experience_tags (market_id);

comment on table experience_tags is
  'The controlled experience vocabulary. Keys are stable identifiers and are '
  'never shown to a user; display text lives in experience_tag_labels so it '
  'can be localised (ADR-012).';

create table experience_tag_labels (
  tag_id uuid not null references experience_tags (id) on delete cascade,
  -- BCP 47, matching market_locales.
  locale text not null,
  label text not null,
  primary key (tag_id, locale)
);

comment on table experience_tag_labels is
  'Localised display text for a tag. A tag with no label in the requested '
  'locale falls back to another locale rather than to its key: a key is a '
  'developer-facing identifier and must not surface in the UI.';

-- ---------------------------------------------------------------------------
-- outing kinds
-- ---------------------------------------------------------------------------

create table outing_kinds (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$'),
  market_id uuid references markets (id) on delete cascade,
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);

create index outing_kinds_market_idx on outing_kinds (market_id);

create table outing_kind_labels (
  kind_id uuid not null references outing_kinds (id) on delete cascade,
  locale text not null,
  label text not null,
  primary key (kind_id, locale)
);

comment on table outing_kinds is
  'What sort of outing a venue offers. An activity provider is a venue whose '
  'sessions are occurrences, so this needs no second entity (doc 03).';

-- ---------------------------------------------------------------------------
-- time-of-day bands
-- ---------------------------------------------------------------------------
-- Evening is not the same hours everywhere, so the clock times behind these
-- labels are market configuration rather than constants. The market guard
-- would not catch a hardcoded 19:00 - it looks for currencies, zones and
-- locales - but it would still be one culture's evening baked into shared
-- logic, which is exactly what ADR-009 exists to prevent.

create table time_of_day_bands (
  id uuid primary key default gen_random_uuid(),
  key text not null check (key ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$'),

  -- Null is the global default; a row naming a market overrides it there.
  market_id uuid references markets (id) on delete cascade,

  starts_local time not null,
  ends_local time not null,

  sort_order integer not null default 100,
  created_at timestamptz not null default now(),

  unique (key, market_id)
);

-- A single global row per key. The unique constraint above treats two nulls as
-- distinct, so without this two global defaults could coexist and "which
-- evening" would be ambiguous.
create unique index time_of_day_bands_global_idx
  on time_of_day_bands (key) where market_id is null;

comment on table time_of_day_bands is
  'Clock times for brunch, afternoon, evening and late night. ends_local may '
  'be earlier than starts_local: late night runs past midnight, and the search '
  'window already rolls such a range into the following day.';

/**
 * The bands a market offers, its own overriding the global default.
 *
 * One function rather than a view so the market filter cannot be forgotten at
 * a call site - omitting it would silently hand one market another's hours.
 */
create or replace function app_market_time_bands(p_market_id uuid)
returns table (key text, starts_local time, ends_local time, sort_order integer)
language sql
stable
as $$
  select distinct on (b.key) b.key, b.starts_local, b.ends_local, b.sort_order
  from time_of_day_bands b
  where b.market_id is null or b.market_id = p_market_id
  -- The market's own row wins; nulls sort last here.
  order by b.key, b.market_id nulls last;
$$;

/** Experience tags offered in a market: the global set plus its extensions. */
create or replace function app_market_experience_tags(p_market_id uuid)
returns setof experience_tags
language sql
stable
as $$
  select * from experience_tags
  where market_id is null or market_id = p_market_id
  order by facet, sort_order, key;
$$;

create or replace function app_market_outing_kinds(p_market_id uuid)
returns setof outing_kinds
language sql
stable
as $$
  select * from outing_kinds
  where market_id is null or market_id = p_market_id
  order by sort_order, key;
$$;

-- ---------------------------------------------------------------------------
-- what a venue actually is
-- ---------------------------------------------------------------------------
-- Both join tables carry an evidence state per row. A tag asserted about a
-- venue is a claim like any other, and an unsourced tag is the thing the whole
-- evidence model exists to refuse.

create table venue_experience_tags (
  venue_id uuid not null references venues (id) on delete cascade,
  tag_id uuid not null references experience_tags (id) on delete cascade,
  evidence_state evidence_state not null default 'unknown',
  source_authority source_authority,
  created_at timestamptz not null default now(),
  primary key (venue_id, tag_id),

  -- The pairing invariant in its join-table form: a row asserting a tag with
  -- no evidence is indistinguishable from no row at all, so it is refused.
  constraint venue_experience_tags_evidenced
    check (evidence_state <> 'unknown' and source_authority is not null)
);

create index venue_experience_tags_tag_idx on venue_experience_tags (tag_id);

create table venue_kinds (
  venue_id uuid not null references venues (id) on delete cascade,
  kind_id uuid not null references outing_kinds (id) on delete cascade,

  -- A restaurant that hosts bands is both. One kind is primary, for display
  -- and for tie-breaking; filtering matches any of them.
  is_primary boolean not null default false,

  evidence_state evidence_state not null default 'unknown',
  source_authority source_authority,
  created_at timestamptz not null default now(),
  primary key (venue_id, kind_id),

  constraint venue_kinds_evidenced
    check (evidence_state <> 'unknown' and source_authority is not null)
);

create index venue_kinds_kind_idx on venue_kinds (kind_id);

-- At most one primary per venue. Two would make "what is this place" a
-- question with two answers, which is the ambiguity the flag exists to remove.
create unique index venue_kinds_primary_idx
  on venue_kinds (venue_id) where is_primary;

alter table experience_tags enable row level security;
alter table experience_tag_labels enable row level security;
alter table outing_kinds enable row level security;
alter table outing_kind_labels enable row level security;
alter table time_of_day_bands enable row level security;
alter table venue_experience_tags enable row level security;
alter table venue_kinds enable row level security;
