-- Where to Go | 0003 reject fixed-offset timezones on markets
--
-- Migration 0002 validated the timezone with AT TIME ZONE, which rejects an
-- unrecognised name ("GST") but happily accepts a fixed offset ("+04:00",
-- "UTC+4", "Etc/GMT+5"). PostgreSQL treats those as valid zones; doc 10 does
-- not, because an offset discards DST rules and a market stored that way would
-- silently produce wrong local times for half the year. Caught by
-- scripts/verify-market-rules.mjs.
--
-- Applied as a new migration rather than an edit to 0002: an applied migration
-- is history, and the runner will not re-run it.

alter table markets
  add constraint markets_timezone_not_offset
  check (
    -- No "+" anywhere: kills "+04:00", "UTC+4" and "Etc/GMT+5".
    timezone !~ '[+]'
    -- No ":" anywhere: kills every "HH:MM" form.
    and timezone !~ ':'
    -- Must start with a letter: kills "-05" and "04:00". A "-" later in the
    -- name is fine, so America/Port-au-Prince still validates.
    and timezone ~ '^[A-Za-z]'
  );

comment on constraint markets_timezone_not_offset on markets is
  'Requires an IANA zone identifier rather than a fixed offset (doc 10). '
  'Residual edge case: legacy aliases such as Etc/GMT-5 and EST5EDT remain '
  'accepted because PostgreSQL lists them as real zones; they are not offsets '
  'syntactically and are not worth a trigger to exclude.';
