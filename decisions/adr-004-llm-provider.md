# ADR-004 | LLM provider and fallback

- **Question:** What role does an LLM play, and what happens when it is unavailable?
- **Alternatives:** (a) Provider-agnostic `LlmProvider` port, two jobs only — parse natural language into a Zod-validated filter object, and phrase explanations by substituting stored claim values — with a deterministic mock fallback. (b) LLM participating in ranking or eligibility. (c) LLM extraction auto-publishing claims.
- **Decision:** (a). (b) and (c) are prohibited.
- **Rationale:** `CLAUDE.md` reserves publication decisions for deterministic validators. Invalid parser output fails closed per `07`. No model-derived confidence is ever shown to a user, per `03`. The app is fully usable with the LLM switched off.
- **Owner:** Kareem Gad · **Date:** 2026-10-26 · **Status:** Approved
- **Revisit trigger:** Parser accuracy too low to be useful, or spend cap set and a provider chosen.
