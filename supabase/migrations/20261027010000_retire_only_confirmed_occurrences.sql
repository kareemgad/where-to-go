-- Where to Go | 0009 retire only confirmed occurrences
--
-- app_complete_past_occurrences (0006) tried to move both 'scheduled' and
-- 'confirmed' past occurrences to 'completed', but the state-machine trigger in
-- the same migration forbids scheduled -> completed. The function and the
-- trigger contradicted each other, so the retirement job failed outright the
-- moment any unconfirmed occurrence aged past its end time. Found by
-- scripts/verify-occurrence-rules.mjs.
--
-- Fixed in favour of the trigger, and deliberately so rather than by widening
-- the transition table. Two reasons:
--
--  1. 'completed' asserts the performance happened. For an occurrence that
--     never had date-specific evidence we have no grounds for that claim, and
--     inventing one is the exact failure ADR-010 exists to prevent.
--
--  2. A past occurrence still sitting at 'scheduled' is the early-warning
--     signal the risk register named: the share of nights that reach their date
--     without ever being confirmed is the measure of whether event freshness is
--     working. Flipping those rows to 'completed' would erase the metric.
--
-- Nothing is recommendable past its end time regardless of state, because
-- app_occurrence_is_recommendable filters on ends_at, so leaving them alone
-- costs nothing operationally.

create or replace function app_complete_past_occurrences(as_of timestamptz)
returns integer
language sql
as $$
  with done as (
    update event_occurrences
    set state = 'completed'
    where ends_at <= as_of
      and state = 'confirmed'
    returning 1
  )
  select count(*)::integer from done;
$$;

comment on function app_complete_past_occurrences is
  'Retires confirmed occurrences once their end time has passed (doc 03, doc 02 '
  'AC02). Deliberately leaves past "scheduled" occurrences alone: we never had '
  'evidence they happened, and the count of nights that reached their date '
  'unconfirmed is a freshness metric worth keeping.';

create or replace function app_unconfirmed_past_occurrences(as_of timestamptz)
returns integer
language sql
stable
as $$
  select count(*)::integer
  from event_occurrences
  where ends_at <= as_of
    and state = 'scheduled';
$$;

comment on function app_unconfirmed_past_occurrences is
  'The freshness early-warning signal: nights that reached their date without '
  'ever being confirmed. A rising count means the programme data is not being '
  'verified in time.';
