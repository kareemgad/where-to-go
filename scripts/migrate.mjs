#!/usr/bin/env node
/**
 * Migration runner.
 *
 *   node --env-file=.env.local scripts/migrate.mjs          # apply pending
 *   node --env-file=.env.local scripts/migrate.mjs --status  # report only
 *
 * Why this exists rather than the Supabase CLI: the CLI needs an interactive
 * login, and the organisation's install policy blocks the usual package route.
 * This reads the same history table the CLI does
 * (supabase_migrations.schema_migrations), so the two stay interchangeable —
 * a later `supabase db push` sees exactly the same applied set.
 *
 * Rules it enforces:
 *  - Filenames are <version>_<name>.sql and the version IS the identity. The
 *    repository is the source of truth; the database is the result of applying
 *    it (supabase/README.md).
 *  - Each migration runs inside a transaction, so a failure leaves nothing
 *    half-applied.
 *  - A file whose version is already recorded is never re-run, and a recorded
 *    version with no file is reported as drift rather than ignored.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import postgres from 'postgres';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');
const FILENAME_PATTERN = /^(\d{14})_([a-z0-9_]+)\.sql$/;
const statusOnly = process.argv.includes('--status');

if (!process.env.DIRECT_URL) {
  console.error('DIRECT_URL is not set. Migrations need the session pooler (port 5432).');
  process.exit(1);
}

function loadLocalMigrations() {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  return files.map((file) => {
    const match = FILENAME_PATTERN.exec(file);
    if (!match) {
      throw new Error(
        `Migration filename "${file}" must be <14-digit version>_<snake_case_name>.sql`,
      );
    }
    const [, version, name] = match;
    return { version, name, file, sql: readFileSync(join(MIGRATIONS_DIR, file), 'utf8') };
  });
}

const sql = postgres(process.env.DIRECT_URL, {
  max: 1,
  idle_timeout: 5,
  connect_timeout: 15,
  onnotice: () => {},
});

try {
  const local = loadLocalMigrations();

  await sql`create schema if not exists supabase_migrations`;
  await sql`
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key,
      statements text[],
      name text
    )
  `;

  const applied = await sql`select version, name from supabase_migrations.schema_migrations`;
  const appliedVersions = new Set(applied.map((row) => row.version));
  const localVersions = new Set(local.map((m) => m.version));

  const drift = applied.filter((row) => !localVersions.has(row.version));
  if (drift.length > 0) {
    console.error('\nDRIFT — versions recorded in the database with no file in the repository:');
    for (const row of drift) {
      console.error(`  ${row.version}  ${row.name ?? '(unnamed)'}`);
    }
    console.error(
      '\nThe repository is the source of truth. Either restore the missing file or\n' +
        'remove the row deliberately — do not let the two diverge silently.\n',
    );
    process.exitCode = 1;
  }

  const pending = local.filter((m) => !appliedVersions.has(m.version));

  console.log(`\nlocal: ${local.length}   applied: ${applied.length}   pending: ${pending.length}`);
  for (const m of local) {
    console.log(`  ${appliedVersions.has(m.version) ? '[applied]' : '[pending]'} ${m.file}`);
  }

  if (statusOnly) {
    console.log('\n--status: nothing applied.');
  } else if (pending.length === 0) {
    console.log('\nNothing to apply.');
  } else {
    for (const migration of pending) {
      process.stdout.write(`\napplying ${migration.file} ... `);
      await sql.begin(async (tx) => {
        await tx.unsafe(migration.sql);
        await tx`
          insert into supabase_migrations.schema_migrations (version, name, statements)
          values (${migration.version}, ${migration.name}, ${[migration.sql]})
        `;
      });
      process.stdout.write('ok\n');
    }
    console.log(`\nApplied ${pending.length} migration${pending.length === 1 ? '' : 's'}.`);
  }
} catch (error) {
  console.error(`\nMigration failed: ${error instanceof Error ? error.message : String(error)}`);
  console.error('Nothing from the failing migration was committed.');
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
