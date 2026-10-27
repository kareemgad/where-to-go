#!/usr/bin/env node
/**
 * Phase 3's gate, exercised against the real database and rolled back.
 *
 *   node --env-file-if-exists=.env.local scripts/verify-publication-rules.mjs
 *
 * The gate has two halves, and they are the first two sections below:
 *   "A conflicting event claim cannot auto-publish"
 *   "reviewer rollback restores the prior published version"
 *
 * Everything else here guards the paths around them, because a publish
 * function that is correct on the happy path and lax on approval is worse than
 * no publish function: it would launder unreviewed claims into the read model
 * with a version number attached, which reads as diligence.
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

const TZ = 'Asia/Dubai';

try {
  await sql.begin(async (tx) => {
    // ---- a fictional world -------------------------------------------------
    const [country] = await tx`
      insert into countries (iso_alpha2, iso_alpha3, reference_name)
      values ('ZY', 'ZYZ', 'Publishland (fictional)') returning id
    `;
    const [market] = await tx`
      insert into markets (slug, country_id, reference_name, timezone, currency, default_locale)
      values ('pubtown', ${country.id}, 'Pubtown (fictional)', ${TZ}, 'AED', 'en')
      returning id
    `;
    for (const s of ['sources_configured', 'seeding', 'validating', 'ready', 'live']) {
      await tx`update markets set status = ${s}::market_status where id = ${market.id}`;
    }
    const [venue] = await tx`
      insert into venues (canonical_market_id, slug, reference_name, timezone, is_demo_data)
      values (${market.id}, 'publish-test', 'Publish Test (fictional)', ${TZ}, true)
      returning id
    `;
    const [provider] = await tx`
      insert into source_providers (key, display_name, storage_policy)
      values ('publication_probe', 'Publication Probe (fictional)', 'canonical_ok')
      returning id
    `;
    const [doc] = await tx`
      insert into source_documents (provider_id, publisher, captured_at)
      values (${provider.id}, 'Fixture', now()) returning id
    `;
    const anchor = async (field, excerpt) => {
      const [row] = await tx`
        insert into evidence_records (document_id, field_pointer, excerpt)
        values (${doc.id}, ${field}, ${excerpt}) returning id
      `;
      return row.id;
    };
    ok('fictional market, venue and evidence source created');

    const makeClaim = async (overrides) => {
      const anchorId = await anchor(overrides.attribute_key, overrides.excerpt ?? 'fixture');
      const [row] = await tx`
        insert into claims ${tx({
          subject_kind: overrides.subject_kind ?? 'venue',
          subject_id: overrides.subject_id ?? venue.id,
          attribute_key: overrides.attribute_key,
          value: overrides.value,
          evidence_id: anchorId,
          lifecycle_state: overrides.lifecycle_state ?? 'validated',
          evidence_state: overrides.evidence_state ?? 'source_claimed',
          source_authority: overrides.source_authority ?? 'venue_attested',
          observed_at: new Date(),
        })} returning id
      `;
      return row.id;
    };

    // =======================================================================
    // GATE 1 — a conflicting claim cannot auto-publish
    // =======================================================================
    console.log('\n  -- gate: conflicting claims --');

    const [occurrence] = await tx`
      insert into event_occurrences (
        venue_id, title, genre_tags, performance_type,
        starts_at, ends_at, timezone,
        local_start_date, local_start_time, local_end_date, local_end_time,
        is_demo_data
      ) values (
        ${venue.id}, 'Disputed Night (fictional)', ${['jazz']}, 'live_band',
        '2026-11-13T16:00:00Z', '2026-11-13T19:00:00Z', ${TZ},
        '2026-11-13', '20:00', '2026-11-13', '23:00', true
      ) returning id, state
    `;
    is('occurrence starts scheduled', occurrence.state, 'scheduled');

    const claimA = await makeClaim({
      subject_kind: 'event_occurrence',
      subject_id: occurrence.id,
      attribute_key: 'event.schedule',
      value: JSON.stringify({ startsAt: '20:00' }),
      excerpt: 'venue page says 8pm',
    });
    const claimB = await makeClaim({
      subject_kind: 'event_occurrence',
      subject_id: occurrence.id,
      attribute_key: 'event.schedule',
      value: JSON.stringify({ startsAt: '21:00' }),
      excerpt: 'listing says 9pm',
    });
    // event.schedule is high-impact, so both carry a human approval; the point
    // of this test is the conflict, not the missing decision.
    for (const id of [claimA, claimB]) {
      await tx`
        insert into verification_decisions (claim_id, action, reason)
        values (${id}, 'approve', 'fixture approval')
      `;
    }

    const [conflictResult] = await tx`select app_publish_claim(${claimA}) as r`;
    is('publishing a disputed schedule returns conflict', conflictResult.r.status, 'conflict');

    const [published] = await tx`
      select count(*)::int as n from published_attributes
      where subject_id = ${occurrence.id} and attribute_key = 'event.schedule'
    `;
    is('nothing was published', published.n, 0);

    const [states] = await tx`
      select
        (select evidence_state from claims where id = ${claimA}) as a,
        (select evidence_state from claims where id = ${claimB}) as b,
        (select lifecycle_state from claims where id = ${claimA}) as a_life,
        (select state from event_occurrences where id = ${occurrence.id}) as occ
    `;
    is('the claim is marked conflicting', states.a, 'conflicting');
    is('and so is the one it disagrees with — neither side wins', states.b, 'conflicting');
    is('both are queued for review', states.a_life, 'review_pending');
    is('the occurrence stays scheduled, so it is not recommendable', states.occ, 'scheduled');

    // =======================================================================
    // GATE 2 — rollback restores the prior published version
    // =======================================================================
    console.log('\n  -- gate: rollback --');

    const first = await makeClaim({
      attribute_key: 'atmosphere.conversation_friendliness',
      value: '4',
    });
    const [p1] = await tx`select app_publish_claim(${first}) as r`;
    is('first publish succeeds', p1.r.status, 'published');
    is('at version 1', p1.r.version, 1);
    is('and reaches the read model', p1.r.materialized, true);

    const [mat1] = await tx`
      select conversation_friendliness as v, conversation_friendliness_state as s
      from venue_experience where venue_id = ${venue.id}
    `;
    is('the typed column holds the published value', mat1.v, 4);
    is('paired with its evidence state', mat1.s, 'source_claimed');

    const second = await makeClaim({
      attribute_key: 'atmosphere.conversation_friendliness',
      value: '2',
      // Declares itself a correction of the first, so it is not a conflict.
    });
    await tx`update claims set supersedes_claim_id = ${first} where id = ${second}`;
    const [p2] = await tx`select app_publish_claim(${second}) as r`;
    is('a correction publishes as version 2', p2.r.version, 2);

    const [mat2] = await tx`
      select conversation_friendliness as v from venue_experience where venue_id = ${venue.id}
    `;
    is('the read model now shows the new value', mat2.v, 2);

    const [current] = await tx`
      select count(*)::int as n from published_attributes_current
      where subject_id = ${venue.id} and attribute_key = 'atmosphere.conversation_friendliness'
    `;
    is('exactly one version is live', current.n, 1);

    const [rb] = await tx`
      select app_rollback_attribute(
        'venue', ${venue.id}, 'atmosphere.conversation_friendliness',
        'published in error during verification'
      ) as r
    `;
    is('rollback reports a restore', rb.r.status, 'restored');
    is('withdrawing version 2', rb.r.rolled_back_version, 2);
    is('and reinstating version 1', rb.r.restored_version, 1);

    const [mat3] = await tx`
      select conversation_friendliness as v from venue_experience where venue_id = ${venue.id}
    `;
    is('the read model is back to the prior value', mat3.v, 4);

    const [afterRollback] = await tx`
      select
        (select lifecycle_state from claims where id = ${second}) as withdrawn,
        (select count(*)::int from published_attributes_current
          where subject_id = ${venue.id}
            and attribute_key = 'atmosphere.conversation_friendliness') as live,
        (select rollback_reason from published_attributes
          where published_from_claim_id = ${second}) as reason
    `;
    is('the bad claim is withdrawn, not left looking published', afterRollback.withdrawn, 'withdrawn');
    is('still exactly one live version', afterRollback.live, 1);
    is('and the reason is recorded', afterRollback.reason, 'published in error during verification');

    // ---- rollback with nothing behind it ----------------------------------
    const only = await makeClaim({ attribute_key: 'atmosphere.energy', value: '5' });
    await tx`select app_publish_claim(${only})`;
    const [rb2] = await tx`
      select app_rollback_attribute('venue', ${venue.id}, 'atmosphere.energy', 'bad source') as r
    `;
    is('rolling back the only version returns to unknown', rb2.r.status, 'rolled_back_to_unknown');

    const [cleared] = await tx`
      select energy as v, energy_state as s from venue_experience where venue_id = ${venue.id}
    `;
    is('the value is cleared', cleared.v, null);
    is('and the state with it, keeping the pairing invariant', cleared.s, 'unknown');

    // ---- a rollback must say why ------------------------------------------
    try {
      await tx.savepoint(async (sp) => {
        await sp`select app_rollback_attribute('venue', ${venue.id}, 'atmosphere.lighting', '  ')`;
      });
      bad('a rollback with no reason is refused');
    } catch {
      ok('a rollback with no reason is refused');
    }

    // =======================================================================
    // the paths around the gate
    // =======================================================================
    console.log('\n  -- approval and eligibility --');

    const highImpact = await makeClaim({
      attribute_key: 'price.per_person',
      value: JSON.stringify({ low: 100, high: 200 }),
    });
    const [hi] = await tx`select app_publish_claim(${highImpact}) as r`;
    is('a high-impact claim with no decision needs review', hi.r.status, 'needs_review');

    await tx`
      insert into verification_decisions (claim_id, action, reason)
      values (${highImpact}, 'approve', 'checked against the venue page')
    `;
    const [hi2] = await tx`select app_publish_claim(${highImpact}) as r`;
    is('and publishes once a human has approved it', hi2.r.status, 'published');
    is('though price has no typed column yet, so it does not reach search', hi2.r.materialized, false);

    const candidate = await makeClaim({
      attribute_key: 'atmosphere.lighting',
      value: '3',
      lifecycle_state: 'candidate',
    });
    const [cand] = await tx`select app_publish_claim(${candidate}) as r`;
    is('an unvalidated claim cannot publish', cand.r.status, 'not_publishable');

    const noEvidence = await makeClaim({
      attribute_key: 'atmosphere.seating_comfort',
      value: '3',
      evidence_state: 'unknown',
    });
    const [none] = await tx`select app_publish_claim(${noEvidence}) as r`;
    is('a claim with no evidence cannot publish', none.r.status, 'not_publishable');

    // ---- schedule publication promotes the occurrence ----------------------
    console.log('\n  -- schedule publication (ADR-010) --');

    const [clean] = await tx`
      insert into event_occurrences (
        venue_id, title, genre_tags, performance_type,
        starts_at, ends_at, timezone,
        local_start_date, local_start_time, local_end_date, local_end_time, is_demo_data
      ) values (
        ${venue.id}, 'Clean Night (fictional)', ${['jazz']}, 'live_band',
        '2026-11-20T16:00:00Z', '2026-11-20T19:00:00Z', ${TZ},
        '2026-11-20', '20:00', '2026-11-20', '23:00', true
      ) returning id
    `;
    const scheduleClaim = await makeClaim({
      subject_kind: 'event_occurrence',
      subject_id: clean.id,
      attribute_key: 'event.schedule',
      value: JSON.stringify({ startsAt: '20:00' }),
    });
    await tx`
      insert into verification_decisions (claim_id, action, reason)
      values (${scheduleClaim}, 'approve', 'confirmed with the venue by phone')
    `;
    const [sched] = await tx`select app_publish_claim(${scheduleClaim}) as r`;
    is('publishing schedule evidence succeeds', sched.r.status, 'published');

    const [promoted] = await tx`
      select state, evidence_state, source_authority from event_occurrences where id = ${clean.id}
    `;
    is('and promotes the occurrence to confirmed', promoted.state, 'confirmed');
    is('carrying its evidence', promoted.evidence_state, 'source_claimed');
    is('and its authority', promoted.source_authority, 'venue_attested');

    const aiClaim = await makeClaim({
      subject_kind: 'event_occurrence',
      subject_id: clean.id,
      attribute_key: 'event.schedule',
      value: JSON.stringify({ startsAt: '20:00', note: 'machine read' }),
      source_authority: 'ai_extracted',
    });
    await tx`update claims set supersedes_claim_id = ${scheduleClaim} where id = ${aiClaim}`;
    await tx`
      insert into verification_decisions (claim_id, action, reason)
      values (${aiClaim}, 'approve', 'fixture')
    `;
    const [aiPublish] = await tx`select app_publish_claim(${aiClaim}) as r`;
    is('a weaker corroborating claim still publishes a version', aiPublish.r.status, 'published');
    is('but does not reach the read model', aiPublish.r.materialized, false);

    const [stillConfirmed] = await tx`
      select state, source_authority from event_occurrences where id = ${clean.id}
    `;
    // Migration 0013: a crawler agreeing with a human does not make the human's
    // check weaker, and must not quietly rewrite the provenance.
    is('the night stays confirmed', stillConfirmed.state, 'confirmed');
    is('and keeps its human provenance', stillConfirmed.source_authority, 'venue_attested');

    const aiVersions = await tx`
      select version, materialized from published_attributes
      where subject_id = ${clean.id} and attribute_key = 'event.schedule'
      order by version
    `;
    is('both schedule versions are on record', aiVersions.length, 2);
    is('the weaker one recorded as unmaterialised', aiVersions[1]?.materialized, false);

    // ---- market scoping ----------------------------------------------------
    console.log('\n  -- market scoping --');
    const [resolved] = await tx`
      select
        app_claim_market('venue', ${venue.id}) as from_venue,
        app_claim_market('event_occurrence', ${clean.id}) as from_occurrence
    `;
    is('a venue claim resolves to its market', resolved.from_venue, market.id);
    is('an occurrence claim resolves through its venue', resolved.from_occurrence, market.id);

    // ---- version history survives -----------------------------------------
    const history = await tx`
      select version, superseded_at is not null as superseded,
             rolled_back_at is not null as rolled_back
      from published_attributes
      where subject_id = ${venue.id} and attribute_key = 'atmosphere.conversation_friendliness'
      order by version
    `;
    is('both versions are still on record', history.length, 2);
    is('version 1 is live again', history[0]?.superseded, false);
    is('version 2 is marked rolled back, not deleted', history[1]?.rolled_back, true);

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
