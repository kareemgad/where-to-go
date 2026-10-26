# ADR-007 | Deployment and data residency

- **Question:** Where does the application run, and where does data live?
- **Alternatives:** (a) Managed Next.js hosting plus managed Postgres, single region, logical multi-tenancy. (b) Per-market deployments or databases.
- **Decision:** (a). Region chosen with the Supabase project; separate development and production environments. (b) is explicitly deferred.
- **Rationale:** `10` instructs avoiding separate city deployments until residency, scale or resilience require them. **Open:** UAE and Egypt residency has not been assessed, and the existing org projects sit in `eu-central-1`. This must be reviewed before any real personal data or public launch, per the `16` gate — it does not block a synthetic-fixture prototype.
- **Owner:** Kareem Gad · **Date:** 2026-10-26 · **Status:** Approved for prototype; residency review outstanding
- **Revisit trigger:** First real user data, public launch, or market activation outside the EU.
