# ADR-005 | Venue verification model

- **Question:** How is the trustworthiness of a claim represented? Resolves conflicts C3 and C4.
- **Alternatives:** (a) Three orthogonal columns plus a derived label. (b) One enum, as `03`, `06`, `11` and `12` each separately imply.
- **Decision:** (a). Every claim carries `lifecycle_state` (workflow position, from `11`), `evidence_state` (strength, from `12`) and `source_authority` (who asserted it, from `03`). The user-facing `confidence_label` from `06` is **derived** by a pure function — never stored, never author-set, never an AI score.
- **Rationale:** The four specifications use four vocabularies that conflate workflow, evidence strength and source authority. Collapsing them into one enum guarantees drift and would silently present operator claims as verified facts. `venue_attested` satisfies a hard constraint; only `independently_verified` may be *described* to a user as verified.
- **Owner:** Kareem Gad · **Date:** 2026-10-26 · **Status:** Approved
- **Revisit trigger:** A real verification method that does not fit the three axes.
