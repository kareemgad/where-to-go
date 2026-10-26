-- Where to Go | 0002 geographic hierarchy and markets
--
-- Implements doc 10's hierarchy (Country -> AdministrativeRegion -> Locality ->
-- Neighborhood) and the Market as a commercial coverage boundary that may span
-- several localities and may overlap other markets.
--
-- The decisions this migration makes concrete:
--  - ADR-009: currency, timezone and locale live on the market record. Nothing
--    in this schema defaults to a market, a currency or a zone.
--  - Brief C7: a venue resolves to exactly one canonical market. The rule is
--    smallest containing boundary wins, ties broken by explicit priority, and
--    it is a function in the database so application code cannot diverge from it.
--  - Doc 10: every market status transition writes an audit row, enforced by a
--    trigger rather than by convention.
--  - Doc 10: display names are multilingual with BCP 47 tags and a provenance
--    note, because proper names must never be translated without a source.
--
-- PostGIS lives in the `extensions` schema (migration 0001) and is not on the
-- default search_path, so spatial types and functions are qualified throughout.

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------

create or replace function app_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function app_set_updated_at is
  'Maintains updated_at on write. Attached to every mutable table.';

-- ---------------------------------------------------------------------------
-- geographic hierarchy
-- ---------------------------------------------------------------------------

create table countries (
  id uuid primary key default gen_random_uuid(),
  iso_alpha2 char(2) not null unique check (iso_alpha2 ~ '^[A-Z]{2}$'),
  iso_alpha3 char(3) not null unique check (iso_alpha3 ~ '^[A-Z]{3}$'),
  -- Internal identifier for logs and admin screens. NOT for user display:
  -- displayed names come from place_names, tagged by locale.
  reference_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column countries.reference_name is
  'Internal label only. User-facing names come from place_names (doc 10).';

create table admin_regions (
  id uuid primary key default gen_random_uuid(),
  country_id uuid not null references countries (id) on delete restrict,
  -- Subdivision codes are country-specific; ISO 3166-2 where one exists.
  code text,
  reference_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (country_id, code)
);

create table localities (
  id uuid primary key default gen_random_uuid(),
  country_id uuid not null references countries (id) on delete restrict,
  admin_region_id uuid references admin_regions (id) on delete restrict,
  reference_name text not null,
  centroid extensions.geography(Point, 4326),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table neighborhoods (
  id uuid primary key default gen_random_uuid(),
  locality_id uuid not null references localities (id) on delete restrict,
  reference_name text not null,
  -- Distance scoring measures from this centroid when the user picks an area,
  -- because the product deliberately avoids precise GPS (ADR-003, gap G3).
  centroid extensions.geography(Point, 4326),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index localities_country_idx on localities (country_id);
create index localities_centroid_idx on localities using gist (centroid);
create index neighborhoods_locality_idx on neighborhoods (locality_id);
create index neighborhoods_centroid_idx on neighborhoods using gist (centroid);

-- ---------------------------------------------------------------------------
-- multilingual place names
-- ---------------------------------------------------------------------------

create type place_kind as enum ('country', 'admin_region', 'locality', 'neighborhood');

create table place_names (
  id uuid primary key default gen_random_uuid(),
  place_kind place_kind not null,
  place_id uuid not null,
  -- BCP 47. Validated by shape here; the authoritative set per market is in
  -- market_locales.
  locale text not null check (locale ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  name text not null,
  -- ISO 15924 where the script matters for sorting or transliteration display.
  script char(4) check (script is null or script ~ '^[A-Z][a-z]{3}$'),
  is_preferred boolean not null default false,
  -- Doc 10: never translate a proper name without a source, or without
  -- labelling it as generated. Null means the name came with the seed data.
  provenance_note text,
  created_at timestamptz not null default now(),
  unique (place_kind, place_id, locale, name)
);

-- Polymorphic by design: four place kinds share one name table rather than
-- four near-identical ones. The cost is that the reference cannot be a foreign
-- key, so orphans are prevented by deleting through the application rather
-- than by the database. Revisit if orphans appear in practice.
comment on table place_names is
  'Localised display names for geographic entities. place_id is polymorphic '
  'over place_kind and therefore not a foreign key.';

create index place_names_lookup_idx on place_names (place_kind, place_id, locale);
create unique index place_names_one_preferred_idx
  on place_names (place_kind, place_id, locale)
  where is_preferred;

-- ---------------------------------------------------------------------------
-- markets
-- ---------------------------------------------------------------------------

create type market_status as enum (
  'draft',
  'sources_configured',
  'seeding',
  'validating',
  'ready',
  'live',
  'paused'
);

create table markets (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  country_id uuid not null references countries (id) on delete restrict,
  reference_name text not null,

  -- ADR-009. These three are the whole point of the table: they are read at
  -- every call site, and no default exists anywhere in application code.
  timezone text not null,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  default_locale text not null check (default_locale ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),

  status market_status not null default 'draft',

  -- Tie-break for canonical market assignment when boundaries overlap and have
  -- equal area (brief C7). Lower wins.
  priority integer not null default 100,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- IANA zone validation without a trigger: AT TIME ZONE over a text zone is
  -- immutable and raises on an unknown zone, so "GST" or "+04:00" is rejected
  -- at write time rather than discovered at render time (doc 10).
  constraint markets_timezone_is_iana
    check ((timestamp '2000-01-01 00:00:00' at time zone timezone) is not null)
);

comment on column markets.timezone is
  'IANA zone identifier. Abbreviations and fixed offsets are rejected.';
comment on column markets.priority is
  'Lower wins when overlapping boundaries have equal area (brief C7).';

create table market_locales (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references markets (id) on delete cascade,
  locale text not null check (locale ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (market_id, locale)
);

create unique index market_locales_one_default_idx
  on market_locales (market_id)
  where is_default;

create table market_boundaries (
  id uuid primary key default gen_random_uuid(),
  -- One current boundary per market. Boundary history, when it is needed, gets
  -- its own versioning rather than being smuggled in here.
  market_id uuid not null unique references markets (id) on delete cascade,
  geom extensions.geometry(MultiPolygon, 4326) not null,
  -- Where the polygon came from: an official shapefile, a hand-drawn operating
  -- area, or synthetic fixture data.
  source_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint market_boundaries_geom_valid check (extensions.st_isvalid(geom))
);

create index market_boundaries_geom_idx on market_boundaries using gist (geom);

create table market_activations (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references markets (id) on delete cascade,
  from_status market_status,
  to_status market_status not null,
  -- Null until identity lands; the column exists now so the audit trail never
  -- has to be backfilled.
  actor_id uuid,
  reason text,
  created_at timestamptz not null default now()
);

create index market_activations_market_idx
  on market_activations (market_id, created_at desc);

comment on table market_activations is
  'Append-only audit of every market status transition (doc 10). Written by '
  'trigger, so a transition cannot happen without a record.';

-- ---------------------------------------------------------------------------
-- market activation state machine
-- ---------------------------------------------------------------------------

create or replace function app_market_transition_allowed(
  from_status market_status,
  to_status market_status
)
returns boolean
language sql
immutable
as $$
  select case
    when from_status is null then to_status = 'draft'
    when from_status = to_status then true
    when from_status = 'draft' then to_status = 'sources_configured'
    when from_status = 'sources_configured' then to_status in ('seeding', 'draft')
    when from_status = 'seeding' then to_status = 'validating'
    -- Validation may send a market back for more data; that is a normal
    -- outcome, not a failure path.
    when from_status = 'validating' then to_status in ('ready', 'seeding')
    when from_status = 'ready' then to_status = 'live'
    when from_status = 'live' then to_status = 'paused'
    when from_status = 'paused' then to_status in ('live', 'ready')
    else false
  end;
$$;

comment on function app_market_transition_allowed is
  'Legal market status transitions per doc 10. A market cannot reach live '
  'without passing through validation.';

create or replace function app_market_status_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if not app_market_transition_allowed(null, new.status) then
      raise exception
        'A market must be created in status draft, not %', new.status
        using errcode = 'check_violation';
    end if;
    insert into market_activations (market_id, from_status, to_status, reason)
    values (new.id, null, new.status, 'market created');
    return new;
  end if;

  if new.status = old.status then
    return new;
  end if;

  if not app_market_transition_allowed(old.status, new.status) then
    raise exception
      'Illegal market transition % -> % for market %', old.status, new.status, old.slug
      using errcode = 'check_violation';
  end if;

  insert into market_activations (market_id, from_status, to_status)
  values (new.id, old.status, new.status);

  return new;
end;
$$;

create trigger markets_status_guard_insert
  after insert on markets
  for each row execute function app_market_status_guard();

create trigger markets_status_guard_update
  before update of status on markets
  for each row execute function app_market_status_guard();

-- ---------------------------------------------------------------------------
-- canonical market assignment (brief C7)
-- ---------------------------------------------------------------------------

create or replace function app_canonical_market_for_point(point extensions.geometry)
returns uuid
language sql
stable
as $$
  select m.id
  from markets m
  join market_boundaries b on b.market_id = m.id
  where extensions.st_covers(b.geom, point)
  order by
    -- Smallest containing boundary wins: a city market beats a regional one.
    extensions.st_area(b.geom::extensions.geography) asc,
    m.priority asc,
    -- Deterministic final tie-break, so the same venue never flips market.
    m.slug asc
  limit 1;
$$;

comment on function app_canonical_market_for_point is
  'Resolves a point to exactly one canonical market: smallest containing '
  'boundary, then priority, then slug (brief C7, doc 16 scenario 4). Lives in '
  'the database so application code cannot diverge from the rule.';

create or replace function app_markets_containing_point(point extensions.geometry)
returns setof uuid
language sql
stable
as $$
  select m.id
  from markets m
  join market_boundaries b on b.market_id = m.id
  where extensions.st_covers(b.geom, point)
  order by extensions.st_area(b.geom::extensions.geography) asc;
$$;

comment on function app_markets_containing_point is
  'Every market whose boundary contains the point. Discoverability may span '
  'several markets even though canonical assignment picks one.';

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

create trigger countries_updated_at before update on countries
  for each row execute function app_set_updated_at();
create trigger admin_regions_updated_at before update on admin_regions
  for each row execute function app_set_updated_at();
create trigger localities_updated_at before update on localities
  for each row execute function app_set_updated_at();
create trigger neighborhoods_updated_at before update on neighborhoods
  for each row execute function app_set_updated_at();
create trigger markets_updated_at before update on markets
  for each row execute function app_set_updated_at();
create trigger market_boundaries_updated_at before update on market_boundaries
  for each row execute function app_set_updated_at();

-- ---------------------------------------------------------------------------
-- row level security
-- ---------------------------------------------------------------------------
-- RLS is the second line of defence, never the only one: every write still
-- passes a server-side authorization check (ADR-002). Enabled with no write
-- policies, so anonymous and authenticated clients cannot mutate any of this;
-- administrative writes run through the service role, which bypasses RLS.

alter table countries enable row level security;
alter table admin_regions enable row level security;
alter table localities enable row level security;
alter table neighborhoods enable row level security;
alter table place_names enable row level security;
alter table markets enable row level security;
alter table market_locales enable row level security;
alter table market_boundaries enable row level security;
alter table market_activations enable row level security;

-- Geographic reference data is public: it is needed to render a market
-- selector and carries nothing sensitive.
create policy countries_public_read on countries for select using (true);
create policy admin_regions_public_read on admin_regions for select using (true);
create policy localities_public_read on localities for select using (true);
create policy neighborhoods_public_read on neighborhoods for select using (true);
create policy place_names_public_read on place_names for select using (true);

-- A market is only publicly visible once live. A market in seeding holds
-- unverified data and must not reach a consumer (doc 10).
create policy markets_public_read_live on markets
  for select using (status = 'live');

create policy market_locales_public_read on market_locales
  for select using (
    exists (select 1 from markets m where m.id = market_id and m.status = 'live')
  );

create policy market_boundaries_public_read on market_boundaries
  for select using (
    exists (select 1 from markets m where m.id = market_id and m.status = 'live')
  );

-- Activation history is operational, not public. No select policy: only the
-- service role and future admin roles can read it.
