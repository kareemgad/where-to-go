# ADR-012 | Locale scope at pilot

- **Question:** Is Arabic shipped at Dubai launch? Resolves conflict C10.
- **Alternatives:** (a) Locale-ready architecture and correct RTL from Phase 1, tested against Arabic fixture data in Phase 2; translated UI copy and the Arabic content pipeline at P2. (b) Fully Arabic UI at launch. (c) English only, localize later.
- **Decision:** (a).
- **Rationale:** `01` leaves this open, `02` places multi-language at P2, while `10` and `16` make a Cairo Arabic RTL query an acceptance gate — (a) is the only option satisfying all four. (b) roughly doubles front-end copy work and adds a translation-provenance pipeline, since `10` forbids translating proper names without a source or a clearly labelled generated translation. (c) is rejected because retrofitting RTL is genuinely expensive, whereas building component architecture RTL-correct from the start is nearly free.
- **Owner:** Kareem Gad · **Date:** 2026-10-26 · **Status:** Approved
- **Revisit trigger:** Cairo activation moving ahead of the Dubai pilot, or operator demand for Arabic self-service.
