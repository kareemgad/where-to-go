-- Where to Go | 0019 an occurrence label should use the occurrence's own title
--
-- 0016 read the title from the series, so a one-off night with no series row
-- rendered in the queue as "Venue - occurrence on 2026-10-30". Every one-off at
-- a venue then looked alike, which is exactly the case a reviewer resolving a
-- disputed start time is looking at.
--
-- An occurrence carries its own title; the series title is the fallback, not
-- the other way round.

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
      select v.reference_name || ' - ' || s.reference_name
      from venue_spaces s join venues v on v.id = s.venue_id
      where s.id = p_subject_id
    )
    when 'event_series' then (
      select v.reference_name || ' - ' || e.title
      from event_series e join venues v on v.id = e.venue_id
      where e.id = p_subject_id
    )
    when 'event_occurrence' then (
      select v.reference_name || ' - '
             || coalesce(o.title, e.title, 'occurrence')
             || ' on ' || to_char(o.local_start_date, 'YYYY-MM-DD')
      from event_occurrences o
      join venues v on v.id = o.venue_id
      left join event_series e on e.id = o.series_id
      where o.id = p_subject_id
    )
  end;
$$;
