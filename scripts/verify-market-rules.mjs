#!/usr/bin/env node
/**
 * Exercises the market rules against the real database, then rolls back.
 *
 *   node --env-file=.env.local scripts/verify-market-rules.mjs
 *
 * These assertions cannot live in the unit suite: they test database
 * constraints, triggers and PostGIS predicates, not TypeScript. Keeping them
 * here means `npm test` stays pure and offline, while the rules that actually
 * guard the data still get checked.
 *
 * Everything runs inside one transaction that is always rolled back, so the
 * database is untouched. All names are obviously fictional.
 */

import postgres from 'postgres';

if (!process.env.DIRECT_URL) {
  console.error('DIRECT_URL is not set.');
  process.exit(1);
}

const sql = postgres(process.env.DIRECT_URL, {
  max: 1,
  idle_timeout: 5,
  connect_timeout: 15,
  onnotice: () => {},
});

let passed = 0;
let failed = 0;

function ok(label) {
  passed += 1;
  console.log(`  PASS  ${label}`);
}

function bad(label, detail) {
  failed += 1;
  console.error(`  FAIL  ${label}`);
  if (detail) console.error(`        ${detail}`);
}

/** Assert that a statement is rejected by the database. */
async function expectRejection(tx, label, run) {
  try {
    await run();
    bad(label, 'expected the database to reject this, but it succeeded');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ok(`${label} — rejected: ${message.split('\n')[0].slice(0, 90)}`);
  }
}

class Rollback extends Error {}

try {
  await sql.begin(async (tx) => {
    // Savepoints let a rejected statement not poison the rest of the batch.
    const country = await tx`
      insert into countries (iso_alpha2, iso_alpha3, reference_name)
      values ('ZZ', 'ZZZ', 'Testland (fictional)')
      returning id
    `;
    const countryId = country[0].id;
    ok('country inserted');

    // --- timezone validation (doc 10) -------------------------------------
    await tx.savepoint(async (sp) => {
      await expectRejection(sp, 'abbreviation "GST" as timezone', async () => {
        await sp`
          insert into markets (slug, country_id, reference_name, timezone, currency, default_locale)
          values ('tz-abbrev', ${countryId}, 'X', 'GST', 'AED', 'en')
        `;
      });
    }).catch(() => {});

    await tx.savepoint(async (sp) => {
      await expectRejection(sp, 'fixed offset "+04:00" as timezone', async () => {
        await sp`
          insert into markets (slug, country_id, reference_name, timezone, currency, default_locale)
          values ('tz-offset', ${countryId}, 'X', '+04:00', 'AED', 'en')
        `;
      });
    }).catch(() => {});

    await tx.savepoint(async (sp) => {
      await expectRejection(sp, 'lowercase currency "aed"', async () => {
        await sp`
          insert into markets (slug, country_id, reference_name, timezone, currency, default_locale)
          values ('cur-lower', ${countryId}, 'X', 'Asia/Dubai', 'aed', 'en')
        `;
      });
    }).catch(() => {});

    // --- creation and audit ------------------------------------------------
    const created = await tx`
      insert into markets (slug, country_id, reference_name, timezone, currency, default_locale)
      values ('testopolis', ${countryId}, 'Testopolis (fictional)', 'Asia/Dubai', 'AED', 'en')
      returning id, status
    `;
    const marketId = created[0].id;
    if (created[0].status === 'draft') ok('market created in status draft');
    else bad('market created in status draft', `got ${created[0].status}`);

    const afterCreate = await tx`
      select from_status, to_status from market_activations where market_id = ${marketId}
    `;
    if (afterCreate.length === 1 && afterCreate[0].to_status === 'draft') {
      ok('creation wrote one audit row');
    } else {
      bad('creation wrote one audit row', `got ${afterCreate.length} rows`);
    }

    // --- illegal transition ------------------------------------------------
    await tx.savepoint(async (sp) => {
      await expectRejection(sp, 'draft -> live skipping validation', async () => {
        await sp`update markets set status = 'live' where id = ${marketId}`;
      });
    }).catch(() => {});

    // --- legal path --------------------------------------------------------
    for (const next of ['sources_configured', 'seeding', 'validating', 'ready', 'live']) {
      await tx`update markets set status = ${next}::market_status where id = ${marketId}`;
    }
    const final = await tx`select status from markets where id = ${marketId}`;
    if (final[0].status === 'live') ok('full legal path reaches live');
    else bad('full legal path reaches live', `got ${final[0].status}`);

    const audit = await tx`
      select count(*)::int as n from market_activations where market_id = ${marketId}
    `;
    // 1 creation + 5 transitions
    if (audit[0].n === 6) ok('every transition wrote an audit row (6 total)');
    else bad('every transition wrote an audit row (6 total)', `got ${audit[0].n}`);

    // --- one default locale per market -------------------------------------
    await tx`
      insert into market_locales (market_id, locale, is_default)
      values (${marketId}, 'en', true), (${marketId}, 'ar', false)
    `;
    ok('market locales inserted');

    await tx.savepoint(async (sp) => {
      await expectRejection(sp, 'a second default locale for one market', async () => {
        await sp`
          insert into market_locales (market_id, locale, is_default)
          values (${marketId}, 'fr', true)
        `;
      });
    }).catch(() => {});

    // --- canonical market with overlapping boundaries (brief C7) -----------
    // A large regional market and a small city market both contain the point.
    const region = await tx`
      insert into markets (slug, country_id, reference_name, timezone, currency, default_locale, priority)
      values ('greater-testopolis', ${countryId}, 'Greater Testopolis (fictional)',
              'Asia/Dubai', 'AED', 'en', 100)
      returning id
    `;
    const regionId = region[0].id;

    await tx`
      insert into market_boundaries (market_id, geom, source_note)
      values (
        ${regionId},
        extensions.st_multi(extensions.st_makeenvelope(0, 0, 10, 10, 4326)),
        'fictional test envelope'
      )
    `;
    await tx`
      insert into market_boundaries (market_id, geom, source_note)
      values (
        ${marketId},
        extensions.st_multi(extensions.st_makeenvelope(4, 4, 6, 6, 4326)),
        'fictional test envelope'
      )
    `;

    const point = tx`extensions.st_setsrid(extensions.st_makepoint(5, 5), 4326)`;

    const canonical = await tx`
      select app_canonical_market_for_point(${point}) as market_id
    `;
    if (canonical[0].market_id === marketId) {
      ok('smallest containing boundary wins canonical assignment');
    } else {
      bad('smallest containing boundary wins canonical assignment', 'got the regional market');
    }

    const containing = await tx`
      select array_agg(id) as ids from app_markets_containing_point(${point}) as t(id)
    `;
    if ((containing[0].ids ?? []).length === 2) {
      ok('both overlapping markets are reported as containing the point');
    } else {
      bad('both overlapping markets contain the point', `got ${(containing[0].ids ?? []).length}`);
    }

    // --- equal area, priority decides --------------------------------------
    const rival = await tx`
      insert into markets (slug, country_id, reference_name, timezone, currency, default_locale, priority)
      values ('testopolis-rival', ${countryId}, 'Testopolis Rival (fictional)',
              'Asia/Dubai', 'AED', 'en', 10)
      returning id
    `;
    const rivalId = rival[0].id;
    await tx`
      insert into market_boundaries (market_id, geom, source_note)
      values (
        ${rivalId},
        extensions.st_multi(extensions.st_makeenvelope(4, 4, 6, 6, 4326)),
        'fictional test envelope, identical area'
      )
    `;

    const tie = await tx`select app_canonical_market_for_point(${point}) as market_id`;
    if (tie[0].market_id === rivalId) {
      ok('equal area is broken by explicit priority (lower wins)');
    } else {
      bad('equal area is broken by explicit priority', 'priority was not applied');
    }

    // --- a point outside every boundary ------------------------------------
    const outside = await tx`
      select app_canonical_market_for_point(
        extensions.st_setsrid(extensions.st_makepoint(50, 50), 4326)
      ) as market_id
    `;
    if (outside[0].market_id === null) {
      ok('a point outside every boundary resolves to no market, not a default');
    } else {
      bad('a point outside every boundary resolves to no market', 'got a market');
    }

    // --- invalid geometry ---------------------------------------------------
    await tx.savepoint(async (sp) => {
      await expectRejection(sp, 'a non-MultiPolygon boundary', async () => {
        await sp`
          insert into market_boundaries (market_id, geom)
          values (${regionId}, extensions.st_setsrid(extensions.st_makepoint(1, 1), 4326))
        `;
      });
    }).catch(() => {});

    throw new Rollback();
  });
} catch (error) {
  if (!(error instanceof Rollback)) {
    console.error(`\nUnexpected failure: ${error instanceof Error ? error.message : String(error)}`);
    failed += 1;
  }
} finally {
  await sql.end({ timeout: 5 });
}

console.log(`\n${passed} passed, ${failed} failed. Transaction rolled back — database untouched.`);
process.exit(failed === 0 ? 0 : 1);
