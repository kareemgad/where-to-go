-- Where to Go | 0013 published provenance never moves downward
--
-- app_materialize_attribute overwrote an occurrence's source_authority with
-- whatever the newly published claim carried. So a machine extraction that
-- merely agreed with an already human-confirmed date would have rewritten the
-- provenance to 'ai_extracted' while leaving the night confirmed — and the
-- constraint event_occurrences_ai_cannot_confirm correctly refused the write,
-- which is how this was found (scripts/verify-publication-rules.mjs).
--
-- The constraint was right and the materialiser was wrong. A later source
-- agreeing with a human does not make the human's check weaker. So provenance
-- now only ever moves up: a weaker claim still records its version in
-- published_attributes, because the evidence genuinely arrived and the history
-- should say so, but it does not overwrite stronger provenance in the read
-- model.
--
-- The alternative — letting the downgrade through and un-confirming the night —
-- would have been worse in exactly the case that matters: a confirmed
-- performance silently becoming unrecommendable because a crawler also found it.

create or replace function app_authority_rank(p_authority source_authority)
returns smallint
language sql
immutable
as $$
  select case p_authority
    -- An independent check by a person.
    when 'editor_checked' then 4
    -- A licensed structured feed: accountable, though not independently checked.
    when 'authorized_feed' then 3
    -- The venue's own word. Strong, and not independent (brief C4).
    when 'venue_attested' then 2
    when 'visitor_reported' then 1
    -- A proposal, never a confirmation (doc 11).
    when 'ai_extracted' then 0
  end::smallint;
$$;

comment on function app_authority_rank is
  'Orders source authority so published provenance can be prevented from '
  'moving downward. Not a confidence score and never shown to a user: it '
  'exists only to answer "is this stronger than what we already had".';

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
    -- leave the read model alone.
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

comment on function app_materialize_attribute is
  'Writes a published value into the typed read model. Returns false when the '
  'attribute has no column yet, or when the claim''s provenance is weaker than '
  'what is already published - the version is still recorded either way, it '
  'simply does not reach search.';
