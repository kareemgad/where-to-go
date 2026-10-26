#!/usr/bin/env node
/**
 * Connectivity and extension check.
 *
 * Run with Node's own env loading so no dotenv dependency is needed:
 *   node --env-file=.env.local scripts/check-db.mjs
 *
 * Prints host, port and server facts only. Credentials are never echoed — not
 * the password, not the service-role key, not the full connection string —
 * because this output goes into a terminal, a CI log and a transcript.
 */

import postgres from 'postgres';

/** Describe a connection string without revealing any of its secret parts. */
function describe(label, raw) {
  if (!raw) return { label, present: false };
  try {
    const url = new URL(raw);
    return {
      label,
      present: true,
      host: url.hostname,
      port: url.port || '(default)',
      database: url.pathname.replace(/^\//, '') || '(default)',
      // Pooler usernames are of the form postgres.<project-ref>; the ref is not
      // a secret (it is in the public API URL), but the password never prints.
      user: url.username.includes('.') ? url.username : '(set)',
      hasPassword: url.password.length > 0,
    };
  } catch {
    return { label, present: true, parseError: 'not a valid URL — check for an unreplaced [YOUR-PASSWORD] placeholder' };
  }
}

const direct = describe('DIRECT_URL', process.env.DIRECT_URL);
const pooled = describe('DATABASE_URL', process.env.DATABASE_URL);

console.log('--- connection strings ---');
console.log(JSON.stringify({ direct, pooled }, null, 2));

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
console.log('\n--- service role key ---');
console.log(
  JSON.stringify({
    present: serviceKey.length > 0,
    length: serviceKey.length,
    // Enough to tell which key system is in use, nowhere near enough to use it.
    scheme: serviceKey.startsWith('sb_secret_')
      ? 'modern secret key'
      : serviceKey.startsWith('eyJ')
        ? 'legacy service_role JWT'
        : serviceKey.length > 0
          ? 'unrecognised — check you copied the right field'
          : 'missing',
  }),
);

if (!process.env.DIRECT_URL) {
  console.error('\nDIRECT_URL is not set. Migrations need the session pooler (port 5432).');
  process.exit(1);
}

console.log('\n--- connecting via DIRECT_URL ---');

const sql = postgres(process.env.DIRECT_URL, {
  max: 1,
  idle_timeout: 5,
  connect_timeout: 15,
  // The session pooler supports prepared statements; the transaction pooler
  // (6543) does not, which is why migrations use DIRECT_URL.
  prepare: true,
  onnotice: () => {},
});

try {
  const [server] = await sql`select version() as version, current_database() as database`;
  console.log(`  server   : ${String(server.version).split(' ').slice(0, 2).join(' ')}`);
  console.log(`  database : ${server.database}`);

  const extensions = await sql`
    select extname, extversion
    from pg_extension
    where extname in ('postgis', 'pg_trgm', 'unaccent')
    order by extname
  `;
  console.log('  extensions:');
  for (const row of extensions) {
    console.log(`    ${row.extname} ${row.extversion}`);
  }

  const [spatial] = await sql`
    select extensions.st_astext(
      extensions.st_setsrid(extensions.st_makepoint(55.27, 25.20), 4326)
    ) as point
  `;
  console.log(`  postgis round-trip: ${spatial.point}`);

  const [migration] = await sql`
    select count(*)::int as applied
    from supabase_migrations.schema_migrations
  `;
  console.log(`  migrations applied: ${migration.applied}`);

  console.log('\nOK — database reachable, PostGIS working.');
} catch (error) {
  console.error('\nFAILED to connect or query.');
  console.error(`  ${error instanceof Error ? error.message : String(error)}`);
  console.error(
    '\nCommon causes: an unreplaced [YOUR-PASSWORD] placeholder, the transaction\n' +
      'pooler (6543) in DIRECT_URL instead of the session pooler (5432), or a\n' +
      'password that was reset after the string was copied.',
  );
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
