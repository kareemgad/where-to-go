-- Where to Go | 0023 the stored facts behind the ten must-haves
--
-- Each must-have is a tri-state hard filter (ADR-011), so each needs a stored
-- attribute with evidence. "We have no idea whether this place is licensed" and
-- "we checked and it is not" are different answers, and a schema that cannot
-- tell them apart will eventually present one as the other.
--
-- Two of the ten need no column:
--   live performance confirmed - derived from occurrences, which is the
--     existing live-music constraint.
--   outdoor seating, wheelchair access, kids welcome - already on
--     venue_experience.
--
-- Indoor seating joins venue_experience beside outdoor seating: they are the
-- same kind of fact, and splitting a pair across two tables would be arbitrary.
-- The rest are policy facts rather than atmosphere, and venue_experience is
-- doc 03's experience_profiles. Merging them would make one table mean two
-- things.

alter table venue_experience
  add column indoor_seating boolean,
  add column indoor_seating_state evidence_state not null default 'unknown',
  add constraint venue_experience_indoor_paired
    check ((indoor_seating is null) = (indoor_seating_state = 'unknown'));

create table venue_policies (
  venue_id uuid primary key references venues (id) on delete cascade,

  licensed boolean,
  licensed_state evidence_state not null default 'unknown',

  alcohol_free boolean,
  alcohol_free_state evidence_state not null default 'unknown',

  halal boolean,
  halal_state evidence_state not null default 'unknown',

  takes_reservations boolean,
  takes_reservations_state evidence_state not null default 'unknown',

  open_past_midnight boolean,
  open_past_midnight_state evidence_state not null default 'unknown',

  -- Null means unknown, not "no restriction". Zero is the verified statement
  -- that there is no minimum age, which is a different and useful claim.
  minimum_age smallint check (minimum_age is null or minimum_age between 0 and 99),
  minimum_age_state evidence_state not null default 'unknown',

  updated_at timestamptz not null default now(),

  constraint venue_policies_licensed_paired
    check ((licensed is null) = (licensed_state = 'unknown')),
  constraint venue_policies_alcohol_free_paired
    check ((alcohol_free is null) = (alcohol_free_state = 'unknown')),
  constraint venue_policies_halal_paired
    check ((halal is null) = (halal_state = 'unknown')),
  constraint venue_policies_reservations_paired
    check ((takes_reservations is null) = (takes_reservations_state = 'unknown')),
  constraint venue_policies_past_midnight_paired
    check ((open_past_midnight is null) = (open_past_midnight_state = 'unknown')),
  constraint venue_policies_minimum_age_paired
    check ((minimum_age is null) = (minimum_age_state = 'unknown')),

  -- Licensed and alcohol-free are not independent facts. Two separate
  -- tri-states would let a venue be credibly both, and whichever filter a user
  -- relied on, one of the two answers would be wrong.
  constraint venue_policies_licence_coherent
    check (not (licensed and alcohol_free))
);

comment on table venue_policies is
  'Policy facts a visitor may rely on: licensing, alcohol, halal food, '
  'reservations, late opening and minimum admission age. Tri-state '
  'throughout - a null is an absence of evidence, never a quiet no.';

comment on column venue_policies.minimum_age is
  'Minimum admission age in years. Zero is a verified "no minimum"; null is '
  '"nobody has told us", which is why this is a hard filter that resolves to '
  'needs_confirmation rather than to a pass.';

create trigger venue_policies_updated_at before update on venue_policies
  for each row execute function app_set_updated_at();

alter table venue_policies enable row level security;

-- ---------------------------------------------------------------------------
-- these are facts people act on
-- ---------------------------------------------------------------------------
-- Halal, alcohol-free and licensed join the list that cannot publish without a
-- recorded human decision, for the same reason accessibility and fees are on
-- it: someone plans an evening around the answer. Reservations and late
-- opening are inconveniences when wrong, not the same class of harm, so they
-- stay ordinary.

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
      or attribute_key in (
        'venue.status', 'venue.closure', 'venue.booking_url',
        'policy.licensed', 'policy.alcohol_free', 'policy.halal'
      );
$$;

comment on function app_is_high_impact_attribute is
  'Doc 11 risk rules: closure, cancellation, live-event schedule, '
  'accessibility, age admission, fees, booking links, and the licensing and '
  'dietary facts a visitor plans an evening around. Always a human decision, '
  'never batch-approved.';

-- ---------------------------------------------------------------------------
-- materialisation
-- ---------------------------------------------------------------------------
-- Extends 0013 with the new attributes. The provenance rule from that
-- migration is unchanged and restated below: authority only ever moves up.

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
  existing_authority source_authority;
  existing_state occurrence_state;
begin
  if p_subject_kind = 'venue' then

    -- --- policy facts ----------------------------------------------------
    if p_attribute_key in (
      'policy.licensed', 'policy.alcohol_free', 'policy.halal',
      'policy.takes_reservations', 'policy.open_past_midnight',
      'admission.minimum_age'
    ) then
      insert into venue_policies (venue_id) values (p_subject_id)
        on conflict (venue_id) do nothing;

      case p_attribute_key
        when 'policy.licensed' then
          update venue_policies
          set licensed = scalar::boolean, licensed_state = p_evidence
          where venue_id = p_subject_id;
        when 'policy.alcohol_free' then
          update venue_policies
          set alcohol_free = scalar::boolean, alcohol_free_state = p_evidence
          where venue_id = p_subject_id;
        when 'policy.halal' then
          update venue_policies
          set halal = scalar::boolean, halal_state = p_evidence
          where venue_id = p_subject_id;
        when 'policy.takes_reservations' then
          update venue_policies
          set takes_reservations = scalar::boolean, takes_reservations_state = p_evidence
          where venue_id = p_subject_id;
        when 'policy.open_past_midnight' then
          update venue_policies
          set open_past_midnight = scalar::boolean, open_past_midnight_state = p_evidence
          where venue_id = p_subject_id;
        when 'admission.minimum_age' then
          update venue_policies
          set minimum_age = scalar::smallint, minimum_age_state = p_evidence
          where venue_id = p_subject_id;
        else
          return false;
      end case;
      return true;
    end if;

    -- --- atmosphere and amenities ----------------------------------------
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
      when 'access.indoor_seating' then
        update venue_experience
        set indoor_seating = scalar::boolean, indoor_seating_state = p_evidence
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

  if p_subject_kind = 'event_occurrence' and p_attribute_key = 'event.schedule' then
    select source_authority, state into existing_authority, existing_state
    from event_occurrences where id = p_subject_id;

    -- Weaker provenance than what is already published: record the version,
    -- leave the read model alone (0013).
    if existing_authority is not null
       and app_authority_rank(p_authority) < app_authority_rank(existing_authority)
    then
      return false;
    end if;

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
