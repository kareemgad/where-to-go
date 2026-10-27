-- Where to Go | 0025 which days a market calls the weekend
--
-- "This weekend" is one of the relative windows the discovery input accepts,
-- and it does not mean the same days everywhere: the UAE weekend is Saturday
-- and Sunday, Egypt's is Friday and Saturday. Resolving it to Sat-Sun in
-- shared logic would be precisely the kind of assumption ADR-009 exists to
-- prevent, and the market guard would not catch it - it looks for currencies,
-- zones and locale tags, not for a weekday number.
--
-- ISO-8601 numbering, Monday 1 through Sunday 7, matching Luxon's `weekday`
-- so the TypeScript side needs no conversion table to get wrong.
--
-- The default exists so this column can be added to a live table; it is a
-- convenience, not a recommendation. Every market should state its own, and
-- the seeder does for both pilot markets.

alter table markets
  add column weekend_days smallint[] not null default '{6,7}',
  add constraint markets_weekend_days_valid check (
    array_length(weekend_days, 1) between 1 and 7
    and weekend_days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
  );

comment on column markets.weekend_days is
  'ISO weekday numbers this market treats as the weekend, Monday 1 through '
  'Sunday 7. Read by the when-window resolver; never assumed.';
