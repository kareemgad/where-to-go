#!/usr/bin/env node
/**
 * Exercises the venue, occurrence and evidence rules against the real
 * database, then rolls back.
 *
 *   node --env-file-if-exists=.env.local scripts/verify-occurrence-rules.mjs
 *
 * The assertions that matter most are the ones about recommendability. If
 * "scheduled" ever becomes recommendable, or an occurrence can reach
 * "confirmed" without date-specific evidence, the product's only real
 * differentiator is gone and no unit test would notice.
 *
 * All names are obviously fictional. Everything runs in one transaction that
 * is always rolled back.
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

class Rollback extends Error {}

/** Run inside a savepoint and assert the database rejects it. */
async function rejects(tx, label, run) {
  try {
    await tx.savepoint(async (sp) => {
      await run(sp);
    });
    bad(label, 'expected rejection, but it succeeded');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ok(`${label} — rejected: ${message.split('\n')[0].slice(0, 80)}`);
  }
}

const TZ = 'Asia/Dubai';
const FRIDAY = '2026-11-13';

try {
  await sql.begin(async (tx) => {
    // ---- fixture world -----------------------------------------------------
    const [country] = await tx`
      insert into countries (iso_alpha2, iso_alpha3, reference_name)
      values ('ZZ', 'ZZZ', 'Testland (fictional)') returning id
    `;
    const [market] = await tx`
      insert into markets (slug, country_id, reference_name, timezone, currency, default_locale)
      values ('testopolis', ${country.id}, 'Testopolis (fictional)', ${TZ}, 'AED', 'en')
      returning id
    `;
    const [other] = await tx`
      insert into markets (slug, country_id, reference_name, timezone, currency, default_locale)
      values ('othertown', ${country.id}, 'Othertown (fictional)', 'Africa/Cairo', 'EGP', 'ar')
      returning id
    `;
    for (const m of [market.id, other.id]) {
      for (const s of ['sources_configured', 'seeding', 'validating', 'ready', 'live']) {
        await tx`update markets set status = ${s}::market_status where id = ${m}`;
      }
    }
    ok('two live markets created with different zones and currencies');

    const [venue] = await tx`
      insert into venues (canonical_market_id, slug, reference_name, timezone, is_demo_data)
      values (${market.id}, 'jazz-loft-test', 'Jazz Loft Test (fictional)', ${TZ}, true)
      returning id
    `;

    // ---- market-scoped slugs (brief C6) ------------------------------------
    await tx`
      insert into venues (canonical_market_id, slug, reference_name, timezone, is_demo_data)
      values (${other.id}, 'jazz-loft-test', 'Jazz Loft Test (fictional, Othertown)', 'Africa/Cairo', true)
    `;
    ok('the same slug coexists in two markets');

    await rejects(tx, 'a duplicate slug within one market', async (sp) => {
      await sp`
        insert into venues (canonical_market_id, slug, reference_name, timezone)
        values (${market.id}, 'jazz-loft-test', 'Clash', ${TZ})
      `;
    });

    await rejects(tx, 'a fixed-offset venue timezone', async (sp) => {
      await sp`
        insert into venues (canonical_market_id, slug, reference_name, timezone)
        values (${market.id}, 'offset-venue', 'X', '+04:00')
      `;
    });

    // ---- published projection pairing invariant ----------------------------
    await tx`
      insert into venue_experience (
        venue_id, conversation_friendliness, conversation_friendliness_state,
        noise_band, noise_band_state
      )
      values (${venue.id}, 3, 'source_claimed', 'moderate', 'source_claimed')
    `;
    ok('venue experience published with evidence states');

    await rejects(tx, 'an experience value with no evidence', async (sp) => {
      await sp`update venue_experience set energy = 4 where venue_id = ${venue.id}`;
    });
    await rejects(tx, 'an evidence state with no value', async (sp) => {
      await sp`update venue_experience set energy_state = 'verified' where venue_id = ${venue.id}`;
    });

    // ---- price points ------------------------------------------------------
    await rejects(tx, 'a price point with unknown evidence', async (sp) => {
      await sp`
        insert into price_points (
          subject_kind, subject_id, amount_minor_low, amount_minor_high,
          currency, price_basis, includes_tax, includes_service_charge,
          evidence_state, observed_at
        ) values (
          'venue', ${venue.id}, 18000, 26000, 'AED', 'per_person', true, false,
          'unknown', now()
        )
      `;
    });

    await tx`
      insert into price_points (
        subject_kind, subject_id, amount_minor_low, amount_minor_high,
        currency, price_basis, includes_tax, includes_service_charge,
        evidence_state, observed_at
      ) values (
        'venue', ${venue.id}, 18000, 26000, 'AED', 'per_person', true, false,
        'source_claimed', now()
      )
    `;
    ok('price band published in minor units with evidence');

    // ---- the four time representations -------------------------------------
    const makeOccurrence = (overrides = {}) => ({
      venue_id: venue.id,
      title: 'Live Jazz (fictional)',
      genre_tags: ['jazz'],
      performance_type: 'live_band',
      starts_at: `${FRIDAY}T16:00:00Z`, // 20:00 Dubai
      ends_at: `${FRIDAY}T19:00:00Z`, // 23:00 Dubai
      timezone: TZ,
      local_start_date: FRIDAY,
      local_start_time: '20:00',
      local_end_date: FRIDAY,
      local_end_time: '23:00',
      ...overrides,
    });

    const insertOccurrence = (client, o) => client`
      insert into event_occurrences ${client(o)} returning id, state, evidence_state
    `;

    await rejects(tx, 'local times disagreeing with the UTC instant', async (sp) => {
      await insertOccurrence(sp, makeOccurrence({ local_start_time: '21:00' }));
    });

    await rejects(tx, 'an occurrence ending before it starts', async (sp) => {
      await insertOccurrence(
        sp,
        makeOccurrence({ ends_at: `${FRIDAY}T15:00:00Z`, local_end_time: '19:00' }),
      );
    });

    // ---- ADR-010: confirmation requires date-specific evidence -------------
    await rejects(tx, 'confirmed with no evidence at all', async (sp) => {
      await insertOccurrence(sp, makeOccurrence({ state: 'confirmed' }));
    });

    await rejects(tx, 'confirmed on an AI extraction alone', async (sp) => {
      await insertOccurrence(
        sp,
        makeOccurrence({
          state: 'confirmed',
          evidence_state: 'source_claimed',
          source_authority: 'ai_extracted',
        }),
      );
    });

    await rejects(tx, 'a visitor report presented as verified', async (sp) => {
      await insertOccurrence(
        sp,
        makeOccurrence({
          state: 'confirmed',
          evidence_state: 'verified',
          source_authority: 'visitor_reported',
        }),
      );
    });

    // ---- the legal path ----------------------------------------------------
    const [scheduled] = await insertOccurrence(tx, makeOccurrence());
    is('a materialised occurrence defaults to scheduled', scheduled.state, 'scheduled');
    is('and carries no evidence', scheduled.evidence_state, 'unknown');

    await rejects(tx, 'promoting to confirmed without supplying evidence', async (sp) => {
      await sp`update event_occurrences set state = 'confirmed' where id = ${scheduled.id}`;
    });

    await tx`
      update event_occurrences
      set state = 'confirmed', evidence_state = 'source_claimed',
          source_authority = 'venue_attested'
      where id = ${scheduled.id}
    `;
    ok('promotion to confirmed succeeds once the venue attests the date');

    await rejects(tx, 'reviving a cancelled occurrence', async (sp) => {
      await sp`update event_occurrences set state = 'cancelled' where id = ${scheduled.id}`;
      await sp`update event_occurrences set state = 'confirmed' where id = ${scheduled.id}`;
    });

    // ---- recommendability --------------------------------------------------
    const asOf = `${FRIDAY}T12:00:00Z`;
    const [rec] = await tx`
      select
        app_occurrence_is_recommendable('scheduled', 'source_claimed',
          ${`${FRIDAY}T19:00:00Z`}::timestamptz, ${asOf}::timestamptz) as scheduled_future,
        app_occurrence_is_recommendable('confirmed', 'source_claimed',
          ${`${FRIDAY}T19:00:00Z`}::timestamptz, ${asOf}::timestamptz) as confirmed_future,
        app_occurrence_is_recommendable('confirmed', 'source_claimed',
          ${`${FRIDAY}T11:00:00Z`}::timestamptz, ${asOf}::timestamptz) as confirmed_past,
        app_occurrence_is_recommendable('confirmed', 'conflicting',
          ${`${FRIDAY}T19:00:00Z`}::timestamptz, ${asOf}::timestamptz) as conflicting,
        app_occurrence_is_recommendable('confirmed', 'stale',
          ${`${FRIDAY}T19:00:00Z`}::timestamptz, ${asOf}::timestamptz) as stale,
        app_occurrence_is_recommendable('cancelled', 'verified',
          ${`${FRIDAY}T19:00:00Z`}::timestamptz, ${asOf}::timestamptz) as cancelled
    `;
    is('scheduled is NOT recommendable (ADR-010)', rec.scheduled_future, false);
    is('confirmed and upcoming IS recommendable', rec.confirmed_future, true);
    is('confirmed but past is not (AC02)', rec.confirmed_past, false);
    is('conflicting evidence is not recommendable', rec.conflicting, false);
    is('stale evidence is not recommendable', rec.stale, false);
    is('cancelled is not recommendable (doc 16 #6)', rec.cancelled, false);

    // ---- midnight crossing -------------------------------------------------
    const [late] = await insertOccurrence(
      tx,
      makeOccurrence({
        starts_at: `${FRIDAY}T18:00:00Z`, // 22:00 Dubai
        ends_at: `${FRIDAY}T22:00:00Z`, // 02:00 Saturday Dubai
        local_start_time: '22:00',
        local_end_date: '2026-11-14',
        local_end_time: '02:00',
        state: 'confirmed',
        evidence_state: 'source_claimed',
        source_authority: 'venue_attested',
      }),
    );
    const [lateView] = await tx`
      select crosses_midnight, confidence_label
      from publishable_occurrences where id = ${late.id}
    `;
    is('a 22:00-02:00 show is flagged as crossing midnight', lateView.crosses_midnight, true);
    is('venue-attested reads as venue_confirmed, not verified',
      lateView.confidence_label, 'venue_confirmed');

    // ---- the publishable view gates ----------------------------------------
    // A scheduled occurrence on a different night: it exists in the table and
    // must be absent from the view. Asserted by id rather than by counting,
    // because a count only happens to differ when something else is excluded.
    const [unconfirmed] = await insertOccurrence(
      tx,
      makeOccurrence({
        starts_at: '2026-11-20T16:00:00Z',
        ends_at: '2026-11-20T19:00:00Z',
        local_start_date: '2026-11-20',
        local_end_date: '2026-11-20',
      }),
    );
    is('the new occurrence really is scheduled', unconfirmed.state, 'scheduled');

    const [inTable] = await tx`
      select count(*)::int as n from event_occurrences where id = ${unconfirmed.id}
    `;
    const [inView] = await tx`
      select count(*)::int as n from publishable_occurrences where id = ${unconfirmed.id}
    `;
    is('a scheduled occurrence is stored', inTable.n, 1);
    is('but is absent from the publishable view (ADR-010)', inView.n, 0);

    const [confirmedInView] = await tx`
      select count(*)::int as n from publishable_occurrences where id = ${late.id}
    `;
    is('while a confirmed one is present', confirmedInView.n, 1);

    await tx`update markets set status = 'paused' where id = ${market.id}`;
    const [paused] = await tx`
      select count(*)::int as n from publishable_occurrences where venue_id = ${venue.id}
    `;
    is('pausing the market removes its occurrences from the view', paused.n, 0);
    await tx`update markets set status = 'live' where id = ${market.id}`;

    // ---- the confidence label matrix (ADR-005) -----------------------------
    const [labels] = await tx`
      select
        app_confidence_label('published', 'verified', 'editor_checked') as editor,
        app_confidence_label('published', 'verified', 'venue_attested') as venue,
        app_confidence_label('published', 'source_claimed', 'ai_extracted') as ai,
        app_confidence_label('published', 'conflicting', 'editor_checked') as conflicting,
        app_confidence_label('published', 'stale', 'venue_attested') as stale,
        app_confidence_label('published', 'source_claimed', 'visitor_reported') as visitor,
        app_confidence_label('rejected', 'verified', 'editor_checked') as rejected,
        app_confidence_label('published', 'unknown', 'ai_extracted') as unknown_ai
    `;
    is('editor check reads as editor_verified', labels.editor, 'editor_verified');
    is('venue attestation never reads as verified (brief C4)', labels.venue, 'venue_confirmed');
    is('an AI extraction reads as unverified_estimate', labels.ai, 'unverified_estimate');
    is('a conflict is surfaced as conflicting', labels.conflicting, 'conflicting');
    is('expired evidence reads as needs_recheck', labels.stale, 'needs_recheck');
    is('a visitor report reads as visitor_reported', labels.visitor, 'visitor_reported');
    is('a rejected claim is not shown at all', labels.rejected, 'not_shown');
    is('no evidence reads as unverified_estimate', labels.unknown_ai, 'unverified_estimate');

    // ---- claims: evidence anchors and verification -------------------------
    const [provider] = await tx`
      insert into source_providers (key, display_name, storage_policy, allowed_fields)
      values ('verify_probe', 'Verification Probe (fictional)', 'canonical_ok', '{}')
      returning id
    `;
    const [doc] = await tx`
      insert into source_documents (provider_id, publisher, captured_at)
      values (${provider.id}, 'Fixture', now()) returning id
    `;
    const [anchor] = await tx`
      insert into evidence_records (document_id, field_pointer, excerpt)
      values (${doc.id}, 'music.genre', 'Live jazz every Friday') returning id
    `;
    ok('source document and evidence anchor created');

    await rejects(tx, 'an evidence record with neither pointer nor excerpt', async (sp) => {
      await sp`insert into evidence_records (document_id) values (${doc.id})`;
    });

    await rejects(tx, 'a claim with no evidence anchor', async (sp) => {
      await sp`
        insert into claims (subject_kind, subject_id, attribute_key, value,
                            source_authority, observed_at)
        values ('venue', ${venue.id}, 'music.genre', '["jazz"]'::jsonb,
                'venue_attested', now())
      `;
    });

    await rejects(tx, 'a verified claim with no verification method', async (sp) => {
      await sp`
        insert into claims (subject_kind, subject_id, attribute_key, value, evidence_id,
                            evidence_state, source_authority, observed_at)
        values ('venue', ${venue.id}, 'music.genre', '["jazz"]'::jsonb, ${anchor.id},
                'verified', 'editor_checked', now())
      `;
    });

    await rejects(tx, 'an AI extraction claiming to be verified', async (sp) => {
      await sp`
        insert into claims (subject_kind, subject_id, attribute_key, value, evidence_id,
                            evidence_state, source_authority, verification_method,
                            verified_at, observed_at)
        values ('venue', ${venue.id}, 'music.genre', '["jazz"]'::jsonb, ${anchor.id},
                'verified', 'ai_extracted', 'automated', now(), now())
      `;
    });

    // ---- high-impact claims need a human (doc 11) --------------------------
    const [impact] = await tx`
      select
        app_is_high_impact_attribute('event.schedule') as schedule,
        app_is_high_impact_attribute('price.per_person') as price,
        app_is_high_impact_attribute('access.wheelchair') as access,
        app_is_high_impact_attribute('atmosphere.energy') as atmosphere
    `;
    is('an event schedule is high-impact', impact.schedule, true);
    is('a price is high-impact', impact.price, true);
    is('accessibility is high-impact', impact.access, true);
    is('atmosphere is not high-impact', impact.atmosphere, false);

    await rejects(tx, 'publishing a high-impact claim with no review decision', async (sp) => {
      await sp`
        insert into claims (subject_kind, subject_id, attribute_key, value, evidence_id,
                            lifecycle_state, evidence_state, source_authority, observed_at)
        values ('event_occurrence', ${late.id}, 'event.schedule', '"Fri 22:00"'::jsonb,
                ${anchor.id}, 'published', 'source_claimed', 'venue_attested', now())
      `;
    });

    const [lowRisk] = await tx`
      insert into claims (subject_kind, subject_id, attribute_key, value, evidence_id,
                          lifecycle_state, evidence_state, source_authority, observed_at,
                          expires_at)
      values ('venue', ${venue.id}, 'atmosphere.energy', '3'::jsonb, ${anchor.id},
              'published', 'source_claimed', 'venue_attested', now(),
              now() - interval '1 day')
      returning id
    `;
    ok('a low-risk claim publishes on deterministic validation alone');

    // ---- expiry downgrades without a human (gap G5) ------------------------
    const [expired] = await tx`select app_expire_stale_claims(now()) as n`;
    is('expiry downgrades at least the overdue claim', expired.n >= 1, true);
    const [after] = await tx`select evidence_state from claims where id = ${lowRisk.id}`;
    is('the overdue claim is now stale, not deleted', after.evidence_state, 'stale');

    // ---- past occurrences retire automatically -----------------------------
    const [retired] = await tx`
      select app_complete_past_occurrences(${`${FRIDAY}T23:00:00Z`}::timestamptz) as n
    `;
    is('past occurrences are retired automatically', retired.n >= 1, true);

    // ---- RLS: the live-market gate actually applies to anon ----------------
    try {
      await tx.savepoint(async (sp) => {
        await sp`set local role anon`;
        const [anonCount] = await sp`select count(*)::int as n from event_series`;
        is('anon cannot read event_series (programmes are not public)', anonCount.n, 0);
      });
    } catch (error) {
      bad('anon role RLS check', error instanceof Error ? error.message : String(error));
    }

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
