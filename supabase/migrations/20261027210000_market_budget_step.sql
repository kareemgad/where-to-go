-- Where to Go | 0027 the step a budget moves in
--
-- "Somewhere cheaper" has to move a ceiling by something, and that something
-- is not the same number in every currency: a step that reads as a round
-- adjustment in one market is meaningless in another whose prices run two
-- orders of magnitude higher.
--
-- Caught by the market guard, which is the whole reason it exists. The first
-- version of this was a ternary on the currency code in shared logic - correct
-- behaviour, wrong place, and exactly the shape that quietly breaks the third
-- market.
--
-- Whole units, not minor units: this is a presentation step for a control the
-- user sees, not an amount of money to compute with.

alter table markets
  add column budget_step integer not null default 50
    check (budget_step > 0);

comment on column markets.budget_step is
  'How much a relative budget change moves the ceiling, in whole units of the '
  'market currency. A readable step for this market, not a constant.';
