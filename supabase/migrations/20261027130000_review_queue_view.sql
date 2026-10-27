-- Where to Go | 0016 the review queue as a view
--
-- A claim's subject is polymorphic across four kinds, so "which venue is this
-- about" and "what should the reviewer see it called" are joins that differ per
-- kind. app_claim_market already resolves the market that way; resolving the
-- label in TypeScript as well would put half of one rule in each language.
--
-- The view is the queue's definition: which claims need a human, with enough
-- context to list them. The detail a reviewer needs to decide is fetched per
-- claim, not carried here, so listing a hundred rows does not read a hundred
-- excerpts.

create or replace function app_claim_subject_label(
  p_subject_kind claim_subject_kind,
  p_subject_id uuid
)
returns text
language sql
stable
as $$
  select case p_subject_kind
    when 'venue' then (
      select v.reference_name from venues v where v.id = p_subject_id
    )
    when 'venue_space' then (
      select v.reference_name || ' — ' || s.reference_name
      from venue_spaces s join venues v on v.id = s.venue_id
      where s.id = p_subject_id
    )
    when 'event_series' then (
      select v.reference_name || ' — ' || e.title
      from event_series e join venues v on v.id = e.venue_id
      where e.id = p_subject_id
    )
    when 'event_occurrence' then (
      select v.reference_name || ' — ' || coalesce(e.title, 'occurrence') || ' on '
             || to_char(o.local_start_date, 'YYYY-MM-DD')
      from event_occurrences o
      join venues v on v.id = o.venue_id
      left join event_series e on e.id = o.series_id
      where o.id = p_subject_id
    )
  end;
$$;

comment on function app_claim_subject_label is
  'Internal reference label for a claim subject, for the review queue. Not a '
  'consumer-facing name: those are localised through place_names (ADR-012).';

-- ---------------------------------------------------------------------------
-- the queue
-- ---------------------------------------------------------------------------

create or replace view claim_review_items as
  select
    c.id                as claim_id,
    c.subject_kind,
    c.subject_id,
    app_claim_subject_label(c.subject_kind, c.subject_id) as subject_label,
    app_claim_market(c.subject_kind, c.subject_id)        as market_id,
    c.attribute_key,
    c.value,
    c.lifecycle_state,
    c.evidence_state,
    c.source_authority,
    c.confidence,
    c.observed_at,
    c.expires_at,
    app_confidence_label(c.lifecycle_state, c.evidence_state, c.source_authority) as confidence_label,
    app_is_high_impact_attribute(c.attribute_key) as high_impact,
    -- A claim marked conflicting is the urgent kind: two credible sources
    -- disagree and the published page is currently saying nothing.
    (c.evidence_state = 'conflicting') as conflicted,
    exists (
      select 1 from verification_decisions d
      where d.claim_id = c.id and d.action in ('approve', 'edit')
    ) as has_approval
  from claims c
  where c.lifecycle_state in ('validated', 'review_pending');

comment on view claim_review_items is
  'Claims awaiting a human decision, with the market and subject resolved. '
  'Validated claims are included because a high-impact attribute cannot '
  'publish without a decision even once it validates (doc 11).';
