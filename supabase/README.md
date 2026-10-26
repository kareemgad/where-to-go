# Supabase

Project `where-to-go-dev` · ref `lujwjhrqiksrpdgsblad` · region `eu-central-1` · $0/month.
Decision recorded in `decisions/adr-002-auth-and-database.md`.

## Migrations
`migrations/` is the source of truth. The hosted database is the result of applying
them, never the other way round — if the two diverge, the repository wins and the
drift is a bug.

Create one, then push it:

```
npx supabase migration new <snake_case_name>
npx supabase db push
```

## Local stack
Not set up, and not needed. `npx supabase start` runs the full stack in Docker;
Docker is not installed on this machine, and linking to the hosted dev project is
both sufficient and faster. Revisit only if offline work or destructive schema
experiments are needed.

## What is NOT in this repository
- The database password. Reset it in Dashboard -> Project Settings -> Database.
- The `service_role` key. Dashboard -> Project Settings -> API. It bypasses row-level
  security entirely, is server-only, and must never carry a `NEXT_PUBLIC_` prefix.
- Any `.env` file other than `.env.example`.

## Residency
ADR-007 records UAE and Egypt data residency as unassessed. `eu-central-1` was chosen
for consistency with the existing organisation projects and is appropriate for
synthetic fixtures only. This needs a ruling before any real personal data.
