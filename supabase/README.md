# Supabase

Project `where-to-go-dev` · ref `lujwjhrqiksrpdgsblad` · region `eu-central-1` · $0/month.
Decision recorded in `decisions/adr-002-auth-and-database.md`.

## Migrations
`migrations/` is the source of truth. The hosted database is the result of applying
them, never the other way round — if the two diverge, the repository wins and the
drift is a bug.

Filenames are `<14-digit version>_<snake_case_name>.sql`. The version is the
identity. An applied migration is history: correct a mistake with a new
migration, never by editing one that has run.

```
npm run db:status    # local vs applied, reports drift either way
npm run db:migrate   # apply pending, one transaction each
npm run db:verify    # exercise the rules against the DB, always rolled back
```

## Why not the Supabase CLI
The CLI needs an interactive `supabase login`, and this machine's install policy
blocks the usual package route. `scripts/migrate.mjs` reads and writes the same
`supabase_migrations.schema_migrations` table the CLI uses, so the two remain
interchangeable - a later `supabase db push` sees exactly the same applied set.

## Local stack
Not set up, and not needed. `supabase start` runs the full stack in Docker;
Docker is absent here, and the hosted dev project is both sufficient and faster.
Revisit only for offline work or destructive schema experiments.

## What is NOT in this repository
- The database password. Reset it in Dashboard -> Project Settings -> Database.
- The `service_role` key. Dashboard -> Project Settings -> API. It bypasses row-level
  security entirely, is server-only, and must never carry a `NEXT_PUBLIC_` prefix.
- Any `.env` file other than `.env.example`.

## Residency
ADR-007 records UAE and Egypt data residency as unassessed. `eu-central-1` was chosen
for consistency with the existing organisation projects and is appropriate for
synthetic fixtures only. This needs a ruling before any real personal data.

## Running without a .env.local
The `db:*` scripts use Node's `--env-file-if-exists`, so they read `.env.local`
when it is present and otherwise fall back to ambient environment variables.
That is what makes them work in a cloud session or in CI, where configuration
arrives as environment variables rather than as a file. The variables needed
are listed in `.env.example`; the three that are secret
(`SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `DIRECT_URL`) must be supplied by
the environment and never committed.
