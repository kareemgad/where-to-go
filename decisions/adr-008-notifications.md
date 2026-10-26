# ADR-008 | Notifications

- **Question:** Does the MVP send notifications?
- **Alternatives:** (a) None in MVP. (b) Opt-in digest at P1. (c) Push notifications.
- **Decision:** (a) for the prototype and MVP; (b) remains a P1 candidate; (c) is out of scope.
- **Rationale:** `02` states notifications are not required for the first vertical slice. Any later digest needs explicit per-interest opt-in, rate limits, time-bounded alerts that expire, and an unsubscribe path — none of which earns its cost before the matching quality is validated.
- **Owner:** Kareem Gad · **Date:** 2026-10-26 · **Status:** Approved
- **Revisit trigger:** Validated repeat usage plus a consented opt-in mechanism.
