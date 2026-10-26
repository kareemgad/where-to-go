# ADR-006 | Ingestion rights posture

- **Question:** Which sources may be used, and what does the schema assume about future licensed providers?
- **Alternatives:** (a) First-party only now — venue-owned sites, official event pages, authenticated operator submissions — with licensed-provider machinery designed but disabled. (b) First-party only, permanently. (c) Enable a licensed provider now.
- **Decision:** (a).
- **Rationale:** Designing for an eventual licensed provider costs roughly one ticket; retrofitting it would be a migration through the evidence core. Closes gap G6: restricted payloads live in a physically separate `provider_payload` store with per-provider `allowed_fields` enforced **at write time**, a retention TTL job, and a hard rule that it never joins the published projection. No provider is called and no key exists. Social scraping is prohibited outright.
- **Owner:** Kareem Gad · **Date:** 2026-10-26 · **Status:** Approved
- **Revisit trigger:** Written approval for a specific provider, which requires its own ADR covering terms, attribution and retention.
