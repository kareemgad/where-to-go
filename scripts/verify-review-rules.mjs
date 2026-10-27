#!/usr/bin/env node
/**
 * Phase 3's second gate: who may review, and what a decision actually does.
 *
 *   node --env-file-if-exists=.env.local scripts/verify-review-rules.mjs
 *
 * Two things are being proven here.
 *
 * Authorization, because the failure mode is silent and total: a rule that
 * reads "may review" when it should read "may not" does not crash, it just
 * quietly lets one market's reviewer decide another market's facts. Doc 16
 * scenario 7 makes that an acceptance test.
 *
 * The decision functions, because each one is several writes that must land
 * together, and because two of them were wrong when first written - an
 * approval that claimed to verify facts it had not checked, and a conflict
 * that could be seen but never resolved. Both fixes are pinned below.
 *
 * Everything runs inside one transaction that is rolled back, including the
 * auth.users rows, so the real accounts and the real queue are untouched.
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

/**
 * Assert that a write is refused.
 *
 * Each attempt runs inside its own savepoint. In Postgres a failed statement
 * aborts the whole transaction, so without one the first expected refusal
 * would make every later assertion fail with "current transaction is aborted"
 * — which is how this harness first reported a passing constraint as broken.
 */
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

class Accepted extends Error {}

class Rollback extends Error {}

const TZ = 'Europe/Lisbon';

try {
  await sql.begin(async (tx) => {
    // ---- two fictional markets --------------------------------------------
    const [country] = await tx`
      insert into countries (iso_alpha2, iso_alpha3, reference_name)
      values ('ZR', 'ZRR', 'Reviewland (fictional)') returning id
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
    const northId = await makeMarket('northtown', 'Northtown (fictional)');
    const southId = await makeMarket('southtown', 'Southtown (fictional)');

    const [venue] = await tx`
      insert into venues (canonical_market_id, slug, reference_name, timezone, is_demo_data)
      values (${northId}, 'review-test', 'Review Test (fictional)', ${TZ}, true)
      returning id
    `;
    const [southVenue] = await tx`
      insert into venues (canonical_market_id, slug, reference_name, timezone, is_demo_data)
      values (${southId}, 'review-test', 'Southern Review Test (fictional)', ${TZ}, true)
      returning id
    `;
    ok('two fictional live markets, one venue in each');

    // ---- fictional accounts ------------------------------------------------
    const makeUser = async (email) => {
      const [row] = await tx`
        insert into auth.users (id, email)
        values (gen_random_uuid(), ${email}) returning id
      `;
      return row.id;
    };
    const adminId = await makeUser('admin@review.invalid');
    const northReviewerId = await makeUser('north@review.invalid');
    const strangerId = await makeUser('stranger@review.invalid');

    await tx`
      insert into role_assignments (user_id, role, market_id)
      values (${adminId}, 'global_admin', null)
    `;
    await tx`
      insert into role_assignments (user_id, role, market_id)
      values (${northReviewerId}, 'reviewer', ${northId})
    `;
    ok('one global admin, one reviewer scoped to Northtown, one user with no role');

    // =======================================================================
    // GATE — a reviewer may not reach another market
    // =======================================================================
    console.log('\n  -- gate: market-scoped authorization --');

    const can = async (userId, marketId) => {
      const [row] = await tx`
        select app_user_can_review_market(${userId}, ${marketId}) as allowed
      `;
      return row.allowed;
    };

    isTrue('the reviewer may review their own market', await can(northReviewerId, northId));
    isFalse(
      'the reviewer may not review the other market',
      await can(northReviewerId, southId),
    );
    isTrue('the global admin may review one market', await can(adminId, northId));
    isTrue('the global admin may review the other', await can(adminId, southId));
    isFalse('a user with no role may review nothing', await can(strangerId, northId));
    isFalse('a null user is refused', await can(null, northId));
    isFalse('a null market is refused', await can(northReviewerId, null));

    const reviewable = async (userId) => {
      const rows = await tx`
        select m.slug from markets m
        where m.id in (select app_user_reviewable_markets(${userId}))
        order by m.slug
      `;
      return rows.map((r) => r.slug).join(',');
    };
    // Other fictional markets from other suites do not exist here, but real
    // seeded markets do, so the admin's list is checked for containment rather
    // than equality.
    const adminMarkets = await reviewable(adminId);
    isTrue(
      'the global admin sees both new markets',
      adminMarkets.includes('northtown') && adminMarkets.includes('southtown'),
    );
    is('the reviewer sees exactly their own', await reviewable(northReviewerId), 'northtown');
    is('the user with no role sees none', await reviewable(strangerId), '');

    // The auth.uid() delegates must fail closed on a connection with no JWT,
    // which is exactly what the pooled application connection is. If these
    // returned true, every RLS policy in migration 0012 would be open.
    const [delegated] = await tx`
      select app_is_global_admin() as admin,
             app_can_review_market(${northId}) as review
    `;
    isFalse('app_is_global_admin() is false with no session', delegated.admin);
    isFalse('app_can_review_market() is false with no session', delegated.review);

    // ---- the scope constraint from 0012 -----------------------------------
    await refuses(
      tx,
      'a market-scoped role cannot be granted without a market',
      (sp) => sp`
        insert into role_assignments (user_id, role, market_id)
        values (${strangerId}, 'reviewer', null)
      `,
      'role_assignments_scope_matches_role',
    );
    await refuses(
      tx,
      'a global admin role cannot be scoped to one market',
      (sp) => sp`
        insert into role_assignments (user_id, role, market_id)
        values (${strangerId}, 'global_admin', ${northId})
      `,
      'role_assignments_scope_matches_role',
    );

    // =======================================================================
    // the denial trail (doc 16 scenario 7)
    // =======================================================================
    console.log('\n  -- the denial trail --');

    await tx`
      insert into authorization_denials (user_id, action, market_id, reason)
      values (${northReviewerId}, 'review.open_market', ${southId}, 'no reviewer role for southtown')
    `;
    await tx`
      insert into authorization_denials (user_id, action, market_id, reason)
      values (null, 'review.open_market', ${northId}, 'not signed in')
    `;
    const denials = await tx`
      select user_id, action, reason from authorization_denials
      where market_id in (${northId}, ${southId}) order by occurred_at
    `;
    is('both the named and the anonymous attempt are recorded', denials.length, 2);
    is('an anonymous attempt keeps a null user rather than being dropped', denials[1]?.user_id, null);
    await refuses(
      tx,
      'an action name must be a dotted machine key, not prose',
      (sp) => sp`
        insert into authorization_denials (user_id, action, reason)
        values (${strangerId}, 'tried to do something bad', 'freeform')
      `,
      'authorization_denials_action_check',
    );

    // =======================================================================
    // claim fixtures
    // =======================================================================
    const [provider] = await tx`
      insert into source_providers (key, display_name, storage_policy)
      values ('review_probe', 'Review Probe (fictional)', 'canonical_ok')
      returning id
    `;
    const [doc] = await tx`
      insert into source_documents (provider_id, publisher, captured_at)
      values (${provider.id}, 'Fixture', now()) returning id
    `;
    /**
     * A claim fixture.
     *
     * The value goes through tx.json deliberately. Passing a pre-stringified
     * object through the driver's object helper stores it as a jsonb *string*
     * rather than a jsonb object, which reads back as text — so assertions on
     * nested fields quietly compare against undefined, and app_edit_claim's
     * "is this value actually different" check compares a string to an object
     * and always says yes. Both of those showed up here before this changed.
     */
    const makeClaim = async (overrides) => {
      const [anchorRow] = await tx`
        insert into evidence_records (document_id, field_pointer, excerpt)
        values (${doc.id}, ${overrides.attribute_key}, ${overrides.excerpt ?? 'fixture'})
        returning id
      `;
      const [row] = await tx`
        insert into claims (
          subject_kind, subject_id, attribute_key, value, evidence_id,
          lifecycle_state, evidence_state, source_authority, observed_at
        ) values (
          ${overrides.subject_kind ?? 'venue'}::claim_subject_kind,
          ${overrides.subject_id ?? venue.id},
          ${overrides.attribute_key},
          ${tx.json(overrides.value)},
          ${anchorRow.id},
          ${overrides.lifecycle_state ?? 'validated'}::claim_lifecycle_state,
          ${overrides.evidence_state ?? 'source_claimed'}::evidence_state,
          ${overrides.source_authority ?? 'venue_attested'}::source_authority,
          ${new Date()}
        ) returning id
      `;
      return row.id;
    };

    // =======================================================================
    // GATE — approving a machine extraction publishes, and does not pretend
    //        a human verified the fact
    // =======================================================================
    console.log('\n  -- gate: approval is a decision, not a verification --');

    const aiClaim = await makeClaim({
      attribute_key: 'atmosphere.conversation_friendliness',
      // A 1-5 scale with a typed smallint column behind it, so this claim also
      // proves the approval reaches the read model and not just the version
      // table.
      value: 4,
      source_authority: 'ai_extracted',
      excerpt: 'extracted from a review: "easy to talk over the music"',
    });

    // The defect this pins: setting evidence_state to 'verified' on approval
    // violated claims_ai_cannot_self_verify, so this call used to raise.
    const [aiResult] = await tx`
      select app_approve_claim(${aiClaim}, ${northReviewerId}, 'checked the source wording') as r
    `;
    is('approving a machine-extracted claim publishes it', aiResult.r.status, 'published');

    const [aiAfter] = await tx`
      select lifecycle_state, evidence_state, source_authority, verifier_id, verified_at
      from claims where id = ${aiClaim}
    `;
    is('the claim is published', aiAfter.lifecycle_state, 'published');
    is(
      'the evidence state is untouched: nobody verified the fact',
      aiAfter.evidence_state,
      'source_claimed',
    );
    is(
      'the authority still names who actually asserted it',
      aiAfter.source_authority,
      'ai_extracted',
    );
    is('no verifier was fabricated on the claim', aiAfter.verifier_id, null);
    is('no verification timestamp was fabricated', aiAfter.verified_at, null);

    const [aiDecision] = await tx`
      select action, reason, reviewer_id from verification_decisions
      where claim_id = ${aiClaim}
    `;
    is('the human decision is recorded where it belongs', aiDecision.action, 'approve');
    is('attributed to the reviewer who made it', aiDecision.reviewer_id, northReviewerId);
    is('with their note', aiDecision.reason, 'checked the source wording');

    const [readModel] = await tx`
      select conversation_friendliness as score, conversation_friendliness_state as state
      from venue_experience where venue_id = ${venue.id}
    `;
    is('the typed read model carries the published value', readModel.score, 4);
    is('and the evidence state beside it', readModel.state, 'source_claimed');

    const [aiPublished] = await tx`
      select source_authority, evidence_state from published_attributes_current
      where subject_id = ${venue.id} and attribute_key = 'atmosphere.conversation_friendliness'
    `;
    is(
      'the published version carries the honest authority',
      aiPublished.source_authority,
      'ai_extracted',
    );
    const [label] = await tx`
      select app_confidence_label('published', ${aiPublished.evidence_state}::evidence_state,
                                  ${aiPublished.source_authority}::source_authority) as label
    `;
    // The point of the fix: an approved extraction reads as an estimate, not
    // as something an editor verified.
    is('and therefore does not read as editor verified', label.label, 'unverified_estimate');

    // ---- approval refuses what it should ----------------------------------
    const [reapprove] = await tx`
      select app_approve_claim(${aiClaim}, ${northReviewerId}, null) as r
    `;
    is('an already-published claim cannot be approved again', reapprove.r.status, 'not_publishable');

    const [missing] = await tx`
      select app_approve_claim(gen_random_uuid(), ${northReviewerId}, null) as r
    `;
    is('approving a claim that does not exist reports not_found', missing.r.status, 'not_found');

    // =======================================================================
    // GATE — a conflict can be resolved
    // =======================================================================
    console.log('\n  -- gate: a conflict can be resolved --');

    const priceA = await makeClaim({
      attribute_key: 'price.per_person',
      value: { amountMinor: 15000, currency: 'EUR' },
      evidence_state: 'corroborated',
      excerpt: 'venue menu says 150',
    });
    const priceB = await makeClaim({
      attribute_key: 'price.per_person',
      value: { amountMinor: 22000, currency: 'EUR' },
      evidence_state: 'source_claimed',
      source_authority: 'authorized_feed',
      excerpt: 'aggregator says 220',
    });

    const [conflicted] = await tx`
      select app_approve_claim(${priceA}, ${northReviewerId}, 'menu is clear') as r
    `;
    is('approving one side of a disagreement does not publish', conflicted.r.status, 'conflict');

    const [nothingPublished] = await tx`
      select count(*)::int as n from published_attributes
      where subject_id = ${venue.id} and attribute_key = 'price.per_person'
    `;
    is('nothing was published', nothingPublished.n, 0);

    const marked = await tx`
      select id, evidence_state, conflict_prior_evidence_state
      from claims where id in (${priceA}, ${priceB}) order by id
    `;
    isTrue(
      'both sides are marked conflicting, neither wins',
      marked.every((row) => row.evidence_state === 'conflicting'),
    );
    const priorA = marked.find((row) => row.id === priceA)?.conflict_prior_evidence_state;
    const priorB = marked.find((row) => row.id === priceB)?.conflict_prior_evidence_state;
    is('the stronger side remembers it was corroborated', priorA, 'corroborated');
    is('the weaker side remembers it was source_claimed', priorB, 'source_claimed');

    // Approving again must not overwrite the remembered state with
    // 'conflicting' itself, which would make the mark unclearable.
    const [reconflict] = await tx`
      select app_approve_claim(${priceA}, ${northReviewerId}, 'still think the menu is right') as r
    `;
    is('approving a conflicted claim is refused outright', reconflict.r.status, 'conflict');
    const [stillRemembered] = await tx`
      select conflict_prior_evidence_state as prior from claims where id = ${priceA}
    `;
    is('and the remembered state survives the second attempt', stillRemembered.prior, 'corroborated');

    // The defect this pins: before 0018 nothing ever cleared the mark, so the
    // surviving claim was permanently unpublishable.
    const [rejectResult] = await tx`
      select app_reject_claim(${priceB}, ${northReviewerId}, 'aggregator price is stale') as r
    `;
    is('rejecting the wrong side succeeds', rejectResult.r.status, 'rejected');
    is('and reports the conflict it resolved', rejectResult.r.conflicts_cleared, 1);

    const [survivor] = await tx`
      select evidence_state, lifecycle_state, conflict_prior_evidence_state as prior
      from claims where id = ${priceA}
    `;
    is('the survivor is restored to exactly its prior state', survivor.evidence_state, 'corroborated');
    is('not approximated to the weakest publishable one', survivor.prior, null);
    is('and is back in the queue, publishable', survivor.lifecycle_state, 'validated');

    const [nowPublished] = await tx`
      select app_approve_claim(${priceA}, ${northReviewerId}, 'menu confirmed') as r
    `;
    is('the correct value can now be published', nowPublished.r.status, 'published');
    const [publishedPrice] = await tx`
      select value, evidence_state from published_attributes_current
      where subject_id = ${venue.id} and attribute_key = 'price.per_person'
    `;
    is('with the value the reviewer chose', publishedPrice.value.amountMinor, 15000);
    is('and its original evidence strength intact', publishedPrice.evidence_state, 'corroborated');

    // ---- rejection requires a reason --------------------------------------
    const blank = await makeClaim({
      attribute_key: 'atmosphere.energy',
      value: 'lively',
    });
    const [noReason] = await tx`
      select app_reject_claim(${blank}, ${northReviewerId}, '   ') as r
    `;
    is('a rejection with a blank reason is refused', noReason.r.status, 'invalid');
    const [untouched] = await tx`select lifecycle_state from claims where id = ${blank}`;
    is('and the claim is left alone', untouched.lifecycle_state, 'validated');

    // =======================================================================
    // a reviewer correction carries its own evidence
    // =======================================================================
    console.log('\n  -- a correction is evidence, not an overwrite --');

    const wrong = await makeClaim({
      attribute_key: 'price.cover_charge',
      value: { amountMinor: 5000, currency: 'EUR' },
      source_authority: 'ai_extracted',
      excerpt: 'extracted "50 cover" from a listing',
    });

    const [editResult] = await tx`
      select app_edit_claim(
        ${wrong}, ${northReviewerId},
        ${tx.json({ amountMinor: 2500, currency: 'EUR' })},
        'rang the venue; cover is 25 on weeknights'
      ) as r
    `;
    is('the correction publishes', editResult.r.status, 'published');

    const [original] = await tx`select lifecycle_state, value from claims where id = ${wrong}`;
    is('the original is withdrawn, not deleted', original.lifecycle_state, 'withdrawn');
    is('and still says what the source said', original.value.amountMinor, 5000);

    const [correction] = await tx`
      select c.id, c.value, c.source_authority, c.evidence_state, c.supersedes_claim_id,
             c.verifier_id, e.excerpt, p.key as provider
      from claims c
      join evidence_records e on e.id = c.evidence_id
      join source_documents d on d.id = e.document_id
      join source_providers p on p.id = d.provider_id
      where c.id = ${editResult.r.new_claim_id}
    `;
    is('the correction supersedes the original', correction.supersedes_claim_id, wrong);
    is('it is attributed to the editor who made it', correction.source_authority, 'editor_checked');
    is('it is verified, because a person actually checked it', correction.evidence_state, 'verified');
    is('the verifier is recorded', correction.verifier_id, northReviewerId);
    is('its evidence is the editorial source', correction.provider, 'editorial');
    is(
      'and the excerpt is the reviewer’s own account of the check',
      correction.excerpt,
      'rang the venue; cover is 25 on weeknights',
    );

    const [publishedCover] = await tx`
      select value, source_authority from published_attributes_current
      where subject_id = ${venue.id} and attribute_key = 'price.cover_charge'
    `;
    is('the corrected value is what publishes', publishedCover.value.amountMinor, 2500);
    is('as editor checked', publishedCover.source_authority, 'editor_checked');

    const editDecisions = await tx`
      select claim_id from verification_decisions
      where claim_id in (${wrong}, ${correction.id}) and action = 'edit'
    `;
    is(
      'the decision is recorded against both the original and the correction',
      editDecisions.length,
      2,
    );

    // ---- an edit must actually change something ---------------------------
    const same = await makeClaim({
      attribute_key: 'atmosphere.noise',
      value: 'moderate',
    });
    const [identical] = await tx`
      select app_edit_claim(${same}, ${northReviewerId}, ${tx.json('moderate')}, 'looks right') as r
    `;
    is('an edit to an identical value is refused', identical.r.status, 'invalid');
    const [noReasonEdit] = await tx`
      select app_edit_claim(${same}, ${northReviewerId}, ${tx.json('quiet')}, '  ') as r
    `;
    is('an edit with no stated reason is refused', noReasonEdit.r.status, 'invalid');
    const [stillThere] = await tx`select lifecycle_state from claims where id = ${same}`;
    is('and neither refusal touched the claim', stillThere.lifecycle_state, 'validated');

    // =======================================================================
    // the queue view
    // =======================================================================
    console.log('\n  -- the queue view --');

    const northQueue = await tx`
      select claim_id, attribute_key, high_impact, conflicted, subject_label
      from claim_review_items where market_id = ${northId}
      order by attribute_key
    `;
    isTrue(
      'the queue only holds claims awaiting a decision',
      northQueue.every((row) => row.claim_id !== aiClaim && row.claim_id !== priceA),
    );
    isTrue(
      'a price attribute is flagged high impact',
      northQueue.every((row) => !row.attribute_key.startsWith('price.') || row.high_impact),
    );
    isTrue(
      'the subject is resolved to a readable label',
      northQueue.every((row) => typeof row.subject_label === 'string' && row.subject_label !== ''),
    );

    // A claim in the other market must not appear in this market's queue. This
    // is the view-level half of scenario 7.
    const southClaim = await makeClaim({
      subject_id: southVenue.id,
      attribute_key: 'atmosphere.energy',
      value: 'loud',
    });
    const leaked = await tx`
      select count(*)::int as n from claim_review_items
      where market_id = ${northId} and claim_id = ${southClaim}
    `;
    is("the other market's claim does not appear in this queue", leaked[0].n, 0);
    const [scoped] = await tx`
      select market_id from claim_review_items where claim_id = ${southClaim}
    `;
    is('it appears in its own market instead', scoped.market_id, southId);

    // ---- subject labels resolve for every kind ----------------------------
    const [space] = await tx`
      insert into venue_spaces (venue_id, reference_name, indoor_outdoor)
      values (${venue.id}, 'Terrace', 'outdoor') returning id
    `;
    const [series] = await tx`
      insert into event_series (venue_id, title, performance_type, timezone, is_demo_data)
      values (${venue.id}, 'Thursday Sessions (fictional)', 'live_band', ${TZ}, true)
      returning id
    `;
    const [occurrence] = await tx`
      insert into event_occurrences (
        venue_id, series_id, title, genre_tags, performance_type,
        starts_at, ends_at, timezone,
        local_start_date, local_start_time, local_end_date, local_end_time, is_demo_data
      ) values (
        ${venue.id}, ${series.id}, 'Thursday Sessions (fictional)', ${['jazz']}, 'live_band',
        '2026-11-12T20:00:00Z', '2026-11-12T23:00:00Z', ${TZ},
        '2026-11-12', '20:00', '2026-11-12', '23:00', true
      ) returning id
    `;
    const [labels] = await tx`
      select
        app_claim_subject_label('venue', ${venue.id}) as venue,
        app_claim_subject_label('venue_space', ${space.id}) as space,
        app_claim_subject_label('event_series', ${series.id}) as series,
        app_claim_subject_label('event_occurrence', ${occurrence.id}) as occurrence
    `;
    isTrue('a venue label names the venue', labels.venue.includes('Review Test'));
    isTrue('a space label names both venue and space', labels.space.includes('Terrace'));
    isTrue('a series label names the programme', labels.series.includes('Thursday Sessions'));
    isTrue(
      'an occurrence label names the date, so two nights are distinguishable',
      labels.occurrence.includes('2026-11-12'),
    );

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
