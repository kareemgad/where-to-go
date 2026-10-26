-- Where to Go | 0005 venues, spaces, and the published projection
--
-- The read side. Consumer search reads only from here; it never touches the
-- claims table. Each published attribute is paired with an evidence_state
-- column, which is what makes "unknown" a first-class queryable value rather
-- than an absent row.
--
-- The invariant worth stating plainly, because the whole product rests on it:
-- a null value and a non-unknown evidence state cannot coexist, and neither can
-- a present value with state 'unknown'. Enforced by check constraints below.
-- Without that pairing, "we have no evidence" and "we checked and it is false"
-- become indistinguishable at the database level, and unknown quietly starts
-- passing hard filters.

create type venue_status as enum ('active', 'temporarily_closed', 'permanently_closed');
create type indoor_outdoor as enum ('indoor', 'outdoor', 'mixed');
create type noise_band as enum ('quiet', 'moderate', 'loud');
create type price_basis as enum ('per_person', 'per_entry', 'minimum_spend', 'per_group');

-- ---------------------------------------------------------------------------
-- venues
-- ---------------------------------------------------------------------------

create table venues (
  id uuid primary key default gen_random_uuid(),

  -- Exactly one canonical market (brief C7). Discoverability elsewhere is
  -- venue_market_visibility.
  canonical_market_id uuid not null references markets (id) on delete restrict,

  -- Market-scoped, not global (brief C6): "the-jazz-loft" may exist in two
  -- markets, and routes are /{market}/venues/{slug}.
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),

  reference_name text not null,
  status venue_status not null default 'active',

  -- A venue's own zone. Usually the market's, but a market may span a zone
  -- boundary, so it is stored per venue (ADR-009).
  timezone text not null,

  locality_id uuid references localities (id) on delete set null,
  neighborhood_id uuid references neighborhoods (id) on delete set null,

  website text,
  -- Outbound handoff only. Never a booking confirmation (doc 02 AC06).
  booking_url text,
  phone text,

  -- Fictional seed data is labelled in the database, not just in the seeding
  -- script, so the UI can mark it and nothing can present it as a real
  -- recommendation (doc 07, fixtures/README).
  is_demo_data boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (canonical_market_id, slug),

  constraint venues_timezone_is_iana
    check ((timestamp '2000-01-01 00:00:00' at time zone timezone) is not null),
  constraint venues_timezone_not_offset
    check (timezone !~ '[+]' and timezone !~ ':' and timezone ~ '^[A-Za-z]')
);

create index venues_market_idx on venues (canonical_market_id) where status = 'active';
create index venues_neighborhood_idx on venues (neighborhood_id);
create index venues_name_trgm_idx on venues using gin (reference_name extensions.gin_trgm_ops);

create table venue_locations (
  venue_id uuid primary key references venues (id) on delete cascade,
  point extensions.geography(Point, 4326) not null,
  address_lines text[] not null default '{}',
  postal_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index venue_locations_point_idx on venue_locations using gist (point);

-- Keeps venues.canonical_market_id honest against the boundary rule. If the
-- point falls in no market at all the venue is allowed through: that is a
-- coverage gap to review, not a data error, and blocking it would make seeding
-- order-dependent.
create or replace function app_venue_assert_canonical_market()
returns trigger
language plpgsql
as $$
declare
  computed uuid;
  declared uuid;
begin
  computed := app_canonical_market_for_point(new.point::extensions.geometry);
  if computed is null then
    return new;
  end if;

  select canonical_market_id into declared from venues where id = new.venue_id;

  if declared <> computed then
    raise exception
      'Venue % declares canonical market % but its point resolves to % (brief C7)',
      new.venue_id, declared, computed
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger venue_locations_canonical_market
  before insert or update of point on venue_locations
  for each row execute function app_venue_assert_canonical_market();

create table venue_spaces (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues (id) on delete cascade,
  reference_name text not null,
  indoor_outdoor indoor_outdoor not null,
  seating_types text[] not null default '{}',
  approximate_capacity integer check (approximate_capacity is null or approximate_capacity > 0),
  lighting_profile text,
  acoustic_profile text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index venue_spaces_venue_idx on venue_spaces (venue_id);

create table venue_external_identifiers (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues (id) on delete cascade,
  provider_id uuid not null references source_providers (id) on delete restrict,
  external_id text not null,
  created_at timestamptz not null default now(),
  -- Namespaced per provider (doc 10). Two providers may use the same string.
  unique (provider_id, external_id)
);

create index venue_external_identifiers_venue_idx on venue_external_identifiers (venue_id);

create table venue_market_visibility (
  venue_id uuid not null references venues (id) on delete cascade,
  market_id uuid not null references markets (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (venue_id, market_id)
);

-- ---------------------------------------------------------------------------
-- published experience attributes
-- ---------------------------------------------------------------------------

create table venue_experience (
  venue_id uuid primary key references venues (id) on delete cascade,

  energy smallint check (energy is null or energy between 1 and 5),
  energy_state evidence_state not null default 'unknown',

  conversation_friendliness smallint
    check (conversation_friendliness is null or conversation_friendliness between 1 and 5),
  conversation_friendliness_state evidence_state not null default 'unknown',

  lighting smallint check (lighting is null or lighting between 1 and 5),
  lighting_state evidence_state not null default 'unknown',

  seating_comfort smallint check (seating_comfort is null or seating_comfort between 1 and 5),
  seating_comfort_state evidence_state not null default 'unknown',

  noise_band noise_band,
  noise_band_state evidence_state not null default 'unknown',

  outdoor_seating boolean,
  outdoor_seating_state evidence_state not null default 'unknown',

  family_friendly boolean,
  family_friendly_state evidence_state not null default 'unknown',

  wheelchair_accessible boolean,
  wheelchair_accessible_state evidence_state not null default 'unknown',

  -- Doc 12: atmosphere observations carry a sample-size indicator rather than
  -- being presented as a measurement.
  observation_count integer not null default 0 check (observation_count >= 0),

  updated_at timestamptz not null default now(),

  -- The pairing invariant. A value exists if and only if there is evidence for
  -- it. This is what stops "unknown" from drifting into "assumed fine".
  constraint venue_experience_energy_paired
    check ((energy is null) = (energy_state = 'unknown')),
  constraint venue_experience_conversation_paired
    check ((conversation_friendliness is null) = (conversation_friendliness_state = 'unknown')),
  constraint venue_experience_lighting_paired
    check ((lighting is null) = (lighting_state = 'unknown')),
  constraint venue_experience_seating_paired
    check ((seating_comfort is null) = (seating_comfort_state = 'unknown')),
  constraint venue_experience_noise_paired
    check ((noise_band is null) = (noise_band_state = 'unknown')),
  constraint venue_experience_outdoor_paired
    check ((outdoor_seating is null) = (outdoor_seating_state = 'unknown')),
  constraint venue_experience_family_paired
    check ((family_friendly is null) = (family_friendly_state = 'unknown')),
  constraint venue_experience_wheelchair_paired
    check ((wheelchair_accessible is null) = (wheelchair_accessible_state = 'unknown'))
);

create trigger venue_experience_updated_at before update on venue_experience
  for each row execute function app_set_updated_at();

-- ---------------------------------------------------------------------------
-- published price points
-- ---------------------------------------------------------------------------

create table price_points (
  id uuid primary key default gen_random_uuid(),

  -- Venue-level typical spend, or a specific occurrence's admission.
  subject_kind claim_subject_kind not null
    check (subject_kind in ('venue', 'event_occurrence')),
  subject_id uuid not null,

  -- Integer minor units, never floating point (doc 14, src/lib/money.ts).
  amount_minor_low bigint not null check (amount_minor_low >= 0),
  amount_minor_high bigint not null check (amount_minor_high >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  price_basis price_basis not null,

  -- Material to whether a budget is actually met (doc 10).
  includes_tax boolean not null,
  includes_service_charge boolean not null,
  inclusions jsonb,

  evidence_state evidence_state not null default 'unknown',
  -- The claim this value was published from, so provenance is one join away.
  published_from_claim_id uuid references claims (id) on delete set null,

  observed_at timestamptz not null,
  -- Doc 12: prices recheck every 30 days.
  valid_until timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint price_points_band_ordered check (amount_minor_high >= amount_minor_low),
  -- A published price must have evidence. An unknown price is the absence of a
  -- row, not a row full of nulls (brief C5).
  constraint price_points_requires_evidence check (evidence_state <> 'unknown')
);

create index price_points_subject_idx on price_points (subject_kind, subject_id);
create index price_points_validity_idx on price_points (valid_until) where valid_until is not null;

create trigger price_points_updated_at before update on price_points
  for each row execute function app_set_updated_at();

comment on constraint price_points_requires_evidence on price_points is
  'An unknown price is a missing row, never a row with null amounts. Brief C5: '
  '"no evidence" and "evidence of a high price" are different states and must '
  'not be representable as the same thing.';

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

create trigger venues_updated_at before update on venues
  for each row execute function app_set_updated_at();
create trigger venue_locations_updated_at before update on venue_locations
  for each row execute function app_set_updated_at();
create trigger venue_spaces_updated_at before update on venue_spaces
  for each row execute function app_set_updated_at();

-- ---------------------------------------------------------------------------
-- row level security
-- ---------------------------------------------------------------------------
-- Published venue data is readable only where its market is live. A venue in a
-- seeding market holds unverified data and must not reach a consumer (doc 10).

alter table venues enable row level security;
alter table venue_locations enable row level security;
alter table venue_spaces enable row level security;
alter table venue_external_identifiers enable row level security;
alter table venue_market_visibility enable row level security;
alter table venue_experience enable row level security;
alter table price_points enable row level security;

create or replace function app_venue_is_publicly_visible(venue uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from venues v
    join markets m on m.id = v.canonical_market_id
    where v.id = venue
      and m.status = 'live'
      and v.status <> 'permanently_closed'
  );
$$;

create policy venues_public_read on venues
  for select using (
    exists (
      select 1 from markets m
      where m.id = canonical_market_id
        and m.status = 'live'
    )
    and status <> 'permanently_closed'
  );

create policy venue_locations_public_read on venue_locations
  for select using (app_venue_is_publicly_visible(venue_id));
create policy venue_spaces_public_read on venue_spaces
  for select using (app_venue_is_publicly_visible(venue_id));
create policy venue_experience_public_read on venue_experience
  for select using (app_venue_is_publicly_visible(venue_id));
create policy venue_market_visibility_public_read on venue_market_visibility
  for select using (app_venue_is_publicly_visible(venue_id));

-- Provider identifiers are operational: they reveal which licensed sources are
-- in use and are not needed by a consumer. No select policy.

create policy price_points_public_read on price_points
  for select using (
    subject_kind <> 'venue' or app_venue_is_publicly_visible(subject_id)
  );
