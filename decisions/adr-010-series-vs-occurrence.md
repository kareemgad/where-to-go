# ADR-010 | Event series versus occurrence, and what is recommendable

- **Question:** How is a recurring programme distinguished from a confirmed performance on a date? Resolves conflict C2.
- **Alternatives:** (a) `event_series` holding the recurrence rule, `event_occurrence` holding one dated instance with its own state and evidence. (b) A single `events` row carrying start, end and recurrence rule, as `03` specifies.
- **Decision:** (a), per `14`. A rule materializes occurrences as `scheduled`, which are **not recommendable**. Promotion to `confirmed` requires date-specific evidence.
- **Rationale:** (b) cannot represent per-date cancellation, postponement, differing evidence per night, or a rule with no confirmed dates — the exact fabrication `CLAUDE.md` prohibits. Recommending `scheduled` occurrences would multiply apparent coverage overnight and destroy the product's only real differentiator. Occurrence state is `scheduled | confirmed | postponed | cancelled | completed`; past occurrences auto-expire.
- **Owner:** Kareem Gad · **Date:** 2026-10-26 · **Status:** Approved
- **Revisit trigger:** Evidence that operators reliably honour published recurring schedules, measured against a sampled audit — not assumed.
