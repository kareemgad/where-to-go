# ADR-002 | Database and auth provider

- **Question:** Where does Postgres run and how is authentication handled?
- **Alternatives:** (a) Supabase — managed Postgres with PostGIS, Auth, Storage and row-level security in one. (b) Vercel + Neon/RDS + Auth.js — more control, no RLS safety net, more wiring, slower start.
- **Decision:** (a) Supabase. New project in org `jzqpfcigoirnuqxjixko`, cost confirmed at $0/month.
- **Rationale:** RLS maps directly onto the market-scoped authorization `10` requires, and it is the fastest path to a working prototype. **RLS is a second line of defence, never a substitute for server-side authorization checks** — every write still verifies membership in application code.
- **Owner:** Kareem Gad · **Date:** 2026-10-26 · **Status:** Approved
- **Revisit trigger:** Data residency requirement incompatible with the chosen region, or auth needs Supabase cannot meet.
