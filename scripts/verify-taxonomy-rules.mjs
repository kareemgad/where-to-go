#!/usr/bin/env node
/**
 * Slice (a)'s gate: the vocabularies, and the stored facts behind the ten
 * must-haves.
 *
 *   node --env-file-if-exists=.env.local scripts/verify-taxonomy-rules.mjs
 *
 * Two classes of rule are being proven.
 *
 * The pairing invariant, once per new attribute. "We have no evidence" and
 * "we checked and it is false" must stay distinguishable, because every
 * must-have is a tri-state hard filter and the middle state is the whole
 * point. A column that can hold a value with no evidence behind it collapses
 * that distinction silently.
 *
 * Market scoping on the taxonomies. A market extends the vocabulary; it does
 * not get to see another market's extensions. The failure here is quiet - a
 * Cairo-only tag offered in Dubai looks like a working filter that matches
 * nothing.
 *
 * Everything runs inside one transaction that is rolled back.
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
const ok = (label) => {
  passed += 1;
  console.log(`  PASS  ${label}`);
};
const bad = (label, detail) => {
  failed += 1;
  console.error(`  FAIL  ${label}`);
  if (detail) console.error(`        ${detail}`);
};
const is = (label, actual, expected) =>
  actual === expected ? ok(label) : bad(label, `expected ${expected}, got ${actual}`);
const isTrue = (label, actual) => is(label, actual, true);
const isFalse = (label, actual) => is(label, actual, false);

class Accepted extends Error {}
class Rollback extends Error {}

/** Each attempt in its own savepoint: a failed statement aborts the whole
 *  transaction, so without one the first expected refusal poisons the rest. */
async function refuses(tx, label, run, expected) {
  try {
    await tx.savepoint(async (sp) => {
      await run(sp);
      throw new Accepted();
    });
    bad(label, 'the write was accepted');
  } catch (error) {
    if (error instanceof Accepted) {
      bad(label, 'the write was accepted');
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (!expected || message.includes(expected)) ok(label);
    else bad(label, `refused for the wrong reason: ${message}`);
  }
}

const TZ = 'Europe/Lisbon';

try {
  await sql.begin(async (tx) => {
    const [country] = await tx`
      insert into countries (iso_alpha2, iso_alpha3, reference_name)
      values ('ZT', 'ZTT', 'Taxonomyland (fictional)') returning id
    `;
    const makeMarket = async (slug, name) => {
      const [row] = await tx`
        insert into markets (slug, country_id, reference_name, timezone, currency, default_locale)
        values (${slug}, ${country.id}, ${name}, ${TZ}, 'EUR', 'en')
        returning id
      `;
      for (const s of ['sources_configured', 'seeding', 'validating', 'ready', 'live']) {
        await tx`update markets set status = ${s}::market_status where id = ${row.id}`;
      }
      return row.id;
    };
    const eastId = await makeMarket('eastport', 'Eastport (fictional)');
    const westId = await makeMarket('westport', 'Westport (fictional)');

    const [venue] = await tx`
      insert into venues (canonical_market_id, slug, reference_name, timezone, is_demo_data)
      values (${eastId}, 'taxonomy-test', 'Taxonomy Test (fictional)', ${TZ}, true)
      returning id
    `;
    ok('two fictional markets and a venue created');

    // =======================================================================
    // the pairing invariant on every new attribute
    // =======================================================================
    console.log('\n  -- pairing: a value exists only with evidence for it --');

    await tx`insert into venue_policies (venue_id) values (${venue.id})`;

    const policyColumns = [
      ['licensed', true],
      ['alcohol_free', true],
      ['halal', true],
      ['takes_reservations', true],
      ['open_past_midnight', true],
      ['minimum_age', 21],
    ];

    for (const [column, value] of policyColumns) {
      await refuses(
        tx,
        `${column} cannot hold a value with no evidence`,
        (sp) => sp`
          update venue_policies
          set ${sp(column)} = ${value}
          where venue_id = ${venue.id}
        `,
        'paired',
      );
      await refuses(
        tx,
        `${column} cannot claim evidence with no value`,
        (sp) => sp`
          update venue_policies
          set ${sp(`${column}_state`)} = 'verified'
          where venue_id = ${venue.id}
        `,
        'paired',
      );
    }

    await tx`
      insert into venue_experience (venue_id) values (${venue.id})
      on conflict (venue_id) do nothing
    `;
    await refuses(
      tx,
      'indoor_seating cannot hold a value with no evidence',
      (sp) => sp`update venue_experience set indoor_seating = true where venue_id = ${venue.id}`,
      'venue_experience_indoor_paired',
    );

    // ---- zero is a claim, null is an absence ------------------------------
    await tx`
      update venue_policies
      set minimum_age = 0, minimum_age_state = 'verified'
      where venue_id = ${venue.id}
    `;
    const [age] = await tx`
      select minimum_age, minimum_age_state from venue_policies where venue_id = ${venue.id}
    `;
    is('a verified "no minimum age" stores zero, not null', age.minimum_age, 0);
    is('with its evidence beside it', age.minimum_age_state, 'verified');

    // =======================================================================
    // licensed and alcohol-free are not independent
    // =======================================================================
    console.log('\n  -- licensing coherence --');

    await tx`
      update venue_policies
      set licensed = true, licensed_state = 'source_claimed'
      where venue_id = ${venue.id}
    `;
    await refuses(
      tx,
      'a venue cannot be both licensed and alcohol-free',
      (sp) => sp`
        update venue_policies
        set alcohol_free = true, alcohol_free_state = 'source_claimed'
        where venue_id = ${venue.id}
      `,
      'venue_policies_licence_coherent',
    );
    await tx`
      update venue_policies
      set alcohol_free = false, alcohol_free_state = 'source_claimed'
      where venue_id = ${venue.id}
    `;
    ok('licensed and not alcohol-free is accepted');

    // =======================================================================
    // tags and kinds carry their own evidence
    // =======================================================================
    console.log('\n  -- a tag is a claim like any other --');

    const [jazz] = await tx`select id from experience_tags where key = 'jazz'`;
    const [restaurant] = await tx`select id from outing_kinds where key = 'restaurant'`;
    const [liveVenue] = await tx`select id from outing_kinds where key = 'live_music_venue'`;

    await refuses(
      tx,
      'a tag cannot be asserted with no evidence state',
      (sp) => sp`
        insert into venue_experience_tags (venue_id, tag_id, evidence_state, source_authority)
        values (${venue.id}, ${jazz.id}, 'unknown', 'venue_attested')
      `,
      'venue_experience_tags_evidenced',
    );
    await refuses(
      tx,
      'a tag cannot be asserted with no source',
      (sp) => sp`
        insert into venue_experience_tags (venue_id, tag_id, evidence_state, source_authority)
        values (${venue.id}, ${jazz.id}, 'source_claimed', null)
      `,
      'venue_experience_tags_evidenced',
    );
    await tx`
      insert into venue_experience_tags (venue_id, tag_id, evidence_state, source_authority)
      values (${venue.id}, ${jazz.id}, 'source_claimed', 'venue_attested')
    `;
    ok('a sourced tag is accepted');

    // ---- many kinds, at most one primary ----------------------------------
    await tx`
      insert into venue_kinds (venue_id, kind_id, is_primary, evidence_state, source_authority)
      values (${venue.id}, ${restaurant.id}, true, 'source_claimed', 'venue_attested')
    `;
    await tx`
      insert into venue_kinds (venue_id, kind_id, is_primary, evidence_state, source_authority)
      values (${venue.id}, ${liveVenue.id}, false, 'source_claimed', 'venue_attested')
    `;
    ok('a restaurant that hosts bands can be both');

    await refuses(
      tx,
      'but it cannot have two primary kinds',
      (sp) => sp`
        update venue_kinds set is_primary = true
        where venue_id = ${venue.id} and kind_id = ${liveVenue.id}
      `,
      'venue_kinds_primary_idx',
    );

    // =======================================================================
    // market scoping
    // =======================================================================
    console.log('\n  -- a market extends the vocabulary, it does not share it --');

    const [eastTag] = await tx`
      insert into experience_tags (key, facet, market_id, sort_order)
      values ('eastport_harbour', 'setting', ${eastId}, 300) returning id
    `;
    await tx`
      insert into experience_tag_labels (tag_id, locale, label)
      values (${eastTag.id}, 'en', 'Harbour side')
    `;

    const eastTags = await tx`select key from app_market_experience_tags(${eastId})`;
    const westTags = await tx`select key from app_market_experience_tags(${westId})`;
    const eastKeys = eastTags.map((r) => r.key);
    const westKeys = westTags.map((r) => r.key);

    isTrue('the extending market sees its own term', eastKeys.includes('eastport_harbour'));
    isFalse('the other market does not', westKeys.includes('eastport_harbour'));
    isTrue('both still see the global set', eastKeys.includes('jazz') && westKeys.includes('jazz'));
    is(
      'and the global set is identical for both',
      eastKeys.filter((k) => k !== 'eastport_harbour').join(','),
      westKeys.join(','),
    );

    const globalCount = await tx`
      select count(*)::int as n from experience_tags where market_id is null
    `;
    is('the approved v1 vocabulary is 22 terms', globalCount[0].n, 22);
    const kindCount = await tx`
      select count(*)::int as n from outing_kinds where market_id is null
    `;
    is('with 12 outing kinds', kindCount[0].n, 12);

    const unlabelled = await tx`
      select t.key from experience_tags t
      where t.market_id is null
        and not exists (
          select 1 from experience_tag_labels l where l.tag_id = t.id and l.locale = 'ar'
        )
    `;
    is('every global tag has an Arabic label', unlabelled.length, 0);

    // =======================================================================
    // time-of-day bands
    // =======================================================================
    console.log('\n  -- evening is not the same hours everywhere --');

    const globalBands = await tx`select key from app_market_time_bands(${westId}) order by key`;
    is(
      'four bands by default',
      globalBands.map((b) => b.key).join(','),
      'afternoon,brunch,evening,late_night',
    );

    const [defaultEvening] = await tx`
      select starts_local::text as s from app_market_time_bands(${westId}) where key = 'evening'
    `;
    await tx`
      insert into time_of_day_bands (key, market_id, starts_local, ends_local)
      values ('evening', ${eastId}, '21:00', '02:00')
    `;
    const [override] = await tx`
      select starts_local::text as s, ends_local::text as e
      from app_market_time_bands(${eastId}) where key = 'evening'
    `;
    const [untouched] = await tx`
      select starts_local::text as s from app_market_time_bands(${westId}) where key = 'evening'
    `;
    is("a market's own hours win", override.s.slice(0, 5), '21:00');
    is('including one that runs past midnight', override.e.slice(0, 5), '02:00');
    is('and the other market is unaffected', untouched.s, defaultEvening.s);

    const [bandCount] = await tx`
      select count(*)::int as n from app_market_time_bands(${eastId})
    `;
    is('an override replaces the default rather than adding to it', bandCount.n, 4);

    await refuses(
      tx,
      'there cannot be two global defaults for one band',
      (sp) => sp`
        insert into time_of_day_bands (key, market_id, starts_local, ends_local)
        values ('evening', null, '18:00', '22:00')
      `,
      'time_of_day_bands_global_idx',
    );

    // =======================================================================
    // the new attributes reach the read model
    // =======================================================================
    console.log('\n  -- publishing a policy fact --');

    const [provider] = await tx`
      insert into source_providers (key, display_name, storage_policy)
      values ('taxonomy_probe', 'Taxonomy Probe (fictional)', 'canonical_ok')
      returning id
    `;
    const [doc] = await tx`
      insert into source_documents (provider_id, publisher, captured_at)
      values (${provider.id}, 'Fixture', now()) returning id
    `;
    const makeClaim = async (attributeKey, value) => {
      const [anchor] = await tx`
        insert into evidence_records (document_id, field_pointer, excerpt)
        values (${doc.id}, ${attributeKey}, 'fixture') returning id
      `;
      const [row] = await tx`
        insert into claims (
          subject_kind, subject_id, attribute_key, value, evidence_id,
          lifecycle_state, evidence_state, source_authority, observed_at
        ) values (
          'venue', ${venue.id}, ${attributeKey}, ${tx.json(value)}, ${anchor.id},
          'validated', 'source_claimed', 'venue_attested', now()
        ) returning id
      `;
      return row.id;
    };

    // Halal is high-impact: someone plans an evening around the answer.
    const halalClaim = await makeClaim('policy.halal', true);
    const [blocked] = await tx`select app_publish_claim(${halalClaim}) as r`;
    is('halal cannot publish without a human decision', blocked.r.status, 'needs_review');

    const [reviewer] = await tx`
      insert into auth.users (id, email) values (gen_random_uuid(), 'tax@review.invalid')
      returning id
    `;
    const [approved] = await tx`
      select app_approve_claim(${halalClaim}, ${reviewer.id}, 'kitchen certificate seen') as r
    `;
    is('and publishes once one is recorded', approved.r.status, 'published');

    const [policies] = await tx`
      select halal, halal_state from venue_policies where venue_id = ${venue.id}
    `;
    is('the typed column carries the value', policies.halal, true);
    is('with the evidence state beside it', policies.halal_state, 'source_claimed');

    // Reservations are an inconvenience when wrong, not the same class of harm.
    const reservationClaim = await makeClaim('policy.takes_reservations', true);
    const [direct] = await tx`select app_publish_claim(${reservationClaim}) as r`;
    is('taking reservations is not high-impact', direct.r.status, 'published');
    isTrue('and still reaches the read model', direct.r.materialized);

    const ageClaim = await makeClaim('admission.minimum_age', 18);
    await tx`
      insert into verification_decisions (claim_id, reviewer_id, action, reason)
      values (${ageClaim}, ${reviewer.id}, 'approve', 'door policy confirmed')
    `;
    const [agePublished] = await tx`select app_publish_claim(${ageClaim}, ${reviewer.id}) as r`;
    is('a minimum age publishes as a number', agePublished.r.status, 'published');
    const [storedAge] = await tx`
      select minimum_age from venue_policies where venue_id = ${venue.id}
    `;
    is('and lands in the typed column', storedAge.minimum_age, 18);

    // =======================================================================
    // the fourth noise band
    // =======================================================================
    console.log('\n  -- four noise bands --');

    const bands = await tx`
      select unnest(enum_range(null::noise_band))::text as band
    `;
    is(
      'the enum offers what the UI offers',
      bands.map((b) => b.band).join(','),
      'quiet,moderate,lively,loud',
    );

    const noiseClaim = await makeClaim('atmosphere.noise_band', 'lively');
    const [noisePublished] = await tx`select app_publish_claim(${noiseClaim}) as r`;
    is('a lively venue publishes', noisePublished.r.status, 'published');
    const [storedNoise] = await tx`
      select noise_band from venue_experience where venue_id = ${venue.id}
    `;
    is('as lively, not collapsed into loud', storedNoise.noise_band, 'lively');

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
