# ADR-009 | Market parametrization of currency, timezone and locale

- **Question:** Are currency, timezone and locale configuration or constants? Resolves conflict C1.
- **Alternatives:** (a) Market configuration, read from the market record at every call site. (b) Defaults to AED and Asia/Dubai as `03` and `04` specify, overridden per market later.
- **Decision:** (a), **explicitly instructed by the founder on 2026-10-26: parametrized, not hardcoded.**
- **Rationale:** `03` specifies `price_estimates.currency AED` and "display Asia/Dubai"; `04` defines the search API with `budget_max_aed` and no `market_id`. All three contradict `10`, `14` and `CLAUDE.md`. Doc `03` is superseded on both points. Consequences: money is `amount_minor BIGINT` + ISO 4217 + `price_basis`, never binary floating point; occurrences store UTC instant, local wall-clock, IANA zone and the original source expression; `market_id` is required on search; locale is BCP 47 from `market_locales`; FX is a presentation-only estimate with a rate timestamp, never a budget source of truth.
- **Enforcement:** ticket T15 fails the build if `Dubai`, `AED`, `Asia/Dubai` or a locale literal appears in shared business logic.
- **Owner:** Kareem Gad · **Date:** 2026-10-26 · **Status:** Approved
- **Revisit trigger:** None foreseen. This is a standing constraint.
