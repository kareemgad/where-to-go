# ADR-001 | Application stack

- **Question:** What stack supports typed contracts, PostGIS geography and a global market model?
- **Alternatives:** (a) Next.js App Router + TypeScript strict + Postgres/PostGIS, typed SQL via Drizzle with raw SQL for spatial predicates. (b) Rails or Django — faster CRUD, weaker typed contracts than `14` demands. (c) Prisma as the query layer — historically poor PostGIS support.
- **Decision:** (a).
- **Rationale:** `14` requires Zod-validated request and agent contracts end to end; `10` requires PostGIS polygons for market boundaries. Drizzle keeps types without hiding spatial SQL.
- **Owner:** Kareem Gad · **Date:** 2026-10-26 · **Status:** Approved
- **Revisit trigger:** Drizzle blocking a needed PostGIS predicate, or search latency unfixable in SQL.
