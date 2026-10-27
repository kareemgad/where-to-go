#!/usr/bin/env node
/**
 * Seeds the fictional fixture world for both markets.
 *
 *   npm run db:seed
 *   FIXTURE_CLOCK=2026-10-26T12:00:00Z npm run db:seed
 *
 * Dates are resolved from a seeded clock through lib/time, and prices parsed
 * through lib/money, so the seeder exercises the same tested code the
 * application uses. A fixture whose local times disagreed with its UTC instant
 * would be rejected by the database trigger, which means this script cannot
 * quietly produce the inconsistency it is meant to test against.
 *
 * Safety: refuses to run if the database holds any venue not marked
 * is_demo_data. This wipes and rebuilds the fixture world, and it must never
 * be the thing that deletes real collected data.
 */

import postgres from 'postgres';

import { COUNTRIES, MARKETS, VENUES } from '../src/db/seed/fixtures.ts';
import type { PolicyKey } from '../src/db/seed/fixtures.ts';
import { parseDecimal } from '../src/lib/money.ts';
import { fixedClock, nextWeekdayOnOrAfter, occurrenceFromLocal, systemClock } from '../src/lib/time.ts';

if (!process.env.DIRECT_URL) {
  console.error('DIRECT_URL is not set.');
  process.exit(1);
}

const clock = process.env.FIXTURE_CLOCK ? fixedClock(process.env.FIXTURE_CLOCK) : systemClock;
console.log(`seed clock: ${clock.now().toISOString()}${process.env.FIXTURE_CLOCK ? ' (fixed)' : ' (system)'}`);

const sql = postgres(process.env.DIRECT_URL, {
  max: 1,
  idle_timeout: 10,
  connect_timeout: 15,
  onnotice: () => {},
});

/**
 * Narrow a query result to its single row.
 *
 * tsconfig sets noUncheckedIndexedAccess, so `const [row] = await sql\`...\``
 * is correctly typed Row | undefined. Asserting here keeps the strictness and
 * turns a surprising empty result into a clear error instead of a downstream
 * "cannot read property of undefined".
 */
function pickOne<T>(rows: readonly T[], what: string): T {
  const row = rows[0];
  if (row === undefined) {
    throw new Error(`expected exactly one row from ${what}, got none`);
  }
  return row;
}

const MARKET_PATH = ['sources_configured', 'seeding', 'validating', 'ready', 'live'] as const;

try {
  // ---- safety gate --------------------------------------------------------
  const real = pickOne(
    await sql`select count(*)::int as n from venues where is_demo_data = false`,
    'demo-data safety check',
  );
  if (real.n > 0) {
    console.error(
      `\nRefusing to seed: ${real.n} venue(s) are not marked is_demo_data.\n` +
        `This script rebuilds the fixture world and would delete collected data.\n`,
    );
    process.exit(1);
  }

  let extensionCount = 0;

  await sql.begin(async (tx) => {
    // ---- reset ------------------------------------------------------------
    // Order matters where polymorphic references mean no cascade exists.
    await tx`delete from price_points`;
    // Handoffs reference venues and are intentionally not cascaded: a click
    // record outliving its venue is a real counting problem, not a tidy-up.
    // Rebuilding the demo world is the one place they are cleared.
    await tx`delete from booking_handoffs`;
    await tx`delete from published_attributes`;
    await tx`delete from authorization_denials`;
    await tx`delete from verification_decisions`;
    await tx`delete from claims`;
    await tx`delete from evidence_records`;
    await tx`delete from source_documents`;
    await tx`delete from provider_payloads`;
    // The editorial provider is infrastructure, not fixture data: it is how a
    // reviewer's own correction gets provenance, and app_edit_claim refuses to
    // run without it. Wiping the demo world must not take it with it.
    await tx`delete from source_providers where key <> 'editorial'`;
    await tx`delete from venues`; // cascades spaces, locations, experience, series, occurrences
    await tx`delete from place_names`;
    await tx`delete from market_activations`;
    await tx`delete from markets`; // cascades boundaries and locales
    await tx`delete from neighborhoods`;
    await tx`delete from localities`;
    await tx`delete from admin_regions`;
    await tx`delete from countries`;

    // ---- provider and one source document ---------------------------------
    const provider = pickOne(await tx`
      insert into source_providers (
        key, display_name, storage_policy, allowed_fields,
        activation_status, kill_switch, cost_model
      ) values (
        'fictional_fixture', 'Fictional Fixture Data', 'canonical_ok', '{}',
        'dry_run', true, 'none'
      ) returning id
    `, 'provider');
    const document = pickOne(await tx`
      insert into source_documents (provider_id, publisher, captured_at, rights_profile)
      values (${provider.id}, 'Where to Go fixtures', ${clock.now()}, 'fixture_only')
      returning id
    `, 'document');

    // Every published value cites an anchor. For fixtures one anchor per
    // attribute key is enough; the point is that the join exists.
    const anchorFor = new Map<string, string>();
    const anchor = async (attributeKey: string, excerpt: string) => {
      const existing = anchorFor.get(attributeKey);
      if (existing) return existing;
      const row = pickOne(await tx`
        insert into evidence_records (document_id, field_pointer, excerpt)
        values (${document.id}, ${attributeKey}, ${excerpt})
        returning id
      `, 'row');
      anchorFor.set(attributeKey, row.id);
      return row.id as string;
    };

    // ---- countries, markets, geography ------------------------------------
    const countryIds = new Map<string, string>();
    for (const country of COUNTRIES) {
      const row = pickOne(await tx`
        insert into countries (iso_alpha2, iso_alpha3, reference_name)
        values (${country.iso2}, ${country.iso3}, ${country.referenceName})
        returning id
      `, 'row');
      countryIds.set(country.iso2, row.id);
    }

    const marketIds = new Map<string, string>();
    const neighborhoodIds = new Map<string, string>();

    for (const market of MARKETS) {
      const countryId = countryIds.get(market.countryIso2);
      if (!countryId) throw new Error(`missing country ${market.countryIso2}`);

      const localityRow = pickOne(await tx`
        insert into localities (country_id, reference_name)
        values (${countryId}, ${market.locality.referenceName})
        returning id
      `, 'localityRow');
      for (const n of market.locality.names) {
        await tx`
          insert into place_names (place_kind, place_id, locale, name, is_preferred, provenance_note)
          values ('locality', ${localityRow.id}, ${n.locale}, ${n.name}, true, 'fixture data')
        `;
      }

      for (const hood of market.neighborhoods) {
        const row = pickOne(await tx`
          insert into neighborhoods (locality_id, reference_name, centroid)
          values (
            ${localityRow.id}, ${hood.referenceName},
            extensions.st_setsrid(extensions.st_makepoint(${hood.centroid[0]}, ${hood.centroid[1]}), 4326)::extensions.geography
          )
          returning id
        `, 'row');
        neighborhoodIds.set(hood.key, row.id);
        for (const n of hood.names) {
          await tx`
            insert into place_names (place_kind, place_id, locale, name, is_preferred, provenance_note)
            values ('neighborhood', ${row.id}, ${n.locale}, ${n.name}, true, 'fixture data')
          `;
        }
      }

      const marketRow = pickOne(await tx`
        insert into markets (
          slug, country_id, reference_name, timezone, currency, default_locale, priority
        ) values (
          ${market.slug}, ${countryId}, ${market.referenceName}, ${market.timezone},
          ${market.currency}, ${market.defaultLocale}, ${market.priority}
        ) returning id
      `, 'marketRow');
      marketIds.set(market.slug, marketRow.id);

      for (const locale of market.locales) {
        await tx`
          insert into market_locales (market_id, locale, is_default)
          values (${marketRow.id}, ${locale.locale}, ${locale.isDefault})
        `;
      }

      const [minLon, minLat, maxLon, maxLat] = market.envelope;
      await tx`
        insert into market_boundaries (market_id, geom, source_note)
        values (
          ${marketRow.id},
          extensions.st_multi(extensions.st_makeenvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326)),
          'fictional operating envelope, not an administrative boundary'
        )
      `;

      // Vocabulary this market adds to the global set (doc 10). Seeded rather
      // than migrated because a market extension needs a market id, and the
      // market only exists now.
      for (const extension of market.experienceTagExtensions ?? []) {
        const tagRow = pickOne(await tx`
          insert into experience_tags (key, facet, market_id, sort_order)
          values (${extension.key}, ${extension.facet}::experience_facet, ${marketRow.id}, 200)
          returning id
        `, 'tagRow');
        for (const label of extension.labels) {
          await tx`
            insert into experience_tag_labels (tag_id, locale, label)
            values (${tagRow.id}, ${label.locale}, ${label.label})
          `;
        }
        extensionCount += 1;
      }

      for (const band of market.timeBandOverrides ?? []) {
        await tx`
          insert into time_of_day_bands (key, market_id, starts_local, ends_local)
          values (${band.key}, ${marketRow.id}, ${band.startsLocal}, ${band.endsLocal})
        `;
      }

      // Through the state machine, so every transition is audited.
      for (const status of MARKET_PATH) {
        await tx`update markets set status = ${status}::market_status where id = ${marketRow.id}`;
      }
    }

    // ---- venues -----------------------------------------------------------
    let occurrenceCount = 0;
    let claimCount = 0;
    let pendingCount = 0;
    let conflictCount = 0;
    let kindCount = 0;
    let tagCount = 0;

    for (const venue of VENUES) {
      const marketId = marketIds.get(venue.marketSlug);
      const marketFixture = MARKETS.find((m) => m.slug === venue.marketSlug);
      if (!marketId || !marketFixture) throw new Error(`missing market ${venue.marketSlug}`);
      const neighborhoodId = neighborhoodIds.get(venue.neighborhoodKey);
      if (!neighborhoodId) throw new Error(`missing neighborhood ${venue.neighborhoodKey}`);

      const localityRow = pickOne(await tx`
        select l.id from localities l
        join neighborhoods n on n.locality_id = l.id
        where n.id = ${neighborhoodId}
      `, 'localityRow');

      const venueRow = pickOne(await tx`
        insert into venues (
          canonical_market_id, slug, reference_name, status, timezone,
          locality_id, neighborhood_id, booking_url, is_demo_data
        ) values (
          ${marketId}, ${venue.slug}, ${venue.referenceName}, ${venue.status},
          ${marketFixture.timezone}, ${localityRow.id}, ${neighborhoodId},
          ${venue.bookingUrl}, true
        ) returning id
      `, 'venueRow');

      for (const n of venue.names) {
        await tx`
          insert into place_names (place_kind, place_id, locale, name, is_preferred, provenance_note)
          values ('venue', ${venueRow.id}, ${n.locale}, ${n.name}, true, 'fixture data')
        `;
      }

      await tx`
        insert into venue_locations (venue_id, point, address_lines)
        values (
          ${venueRow.id},
          extensions.st_setsrid(extensions.st_makepoint(${venue.point[0]}, ${venue.point[1]}), 4326)::extensions.geography,
          ${['Fictional address, demo data only']}
        )
      `;

      await tx`
        insert into venue_market_visibility (venue_id, market_id)
        values (${venueRow.id}, ${marketId})
      `;

      // --- experience, with the pairing invariant respected ---------------
      const e = venue.experience;
      const paired = <T>(value: T | undefined) =>
        value === undefined ? null : value;
      const stateFor = (value: unknown) =>
        value === undefined ? 'unknown' : e.evidenceState;

      await tx`
        insert into venue_experience (
          venue_id,
          energy, energy_state,
          conversation_friendliness, conversation_friendliness_state,
          lighting, lighting_state,
          seating_comfort, seating_comfort_state,
          noise_band, noise_band_state,
          outdoor_seating, outdoor_seating_state,
          indoor_seating, indoor_seating_state,
          family_friendly, family_friendly_state,
          wheelchair_accessible, wheelchair_accessible_state,
          observation_count
        ) values (
          ${venueRow.id},
          ${paired(e.energy)}, ${stateFor(e.energy)}::evidence_state,
          ${paired(e.conversationFriendliness)}, ${stateFor(e.conversationFriendliness)}::evidence_state,
          ${paired(e.lighting)}, ${stateFor(e.lighting)}::evidence_state,
          ${paired(e.seatingComfort)}, ${stateFor(e.seatingComfort)}::evidence_state,
          ${paired(e.noiseBand)}::noise_band, ${stateFor(e.noiseBand)}::evidence_state,
          ${paired(e.outdoorSeating)}, ${stateFor(e.outdoorSeating)}::evidence_state,
          ${paired(e.indoorSeating)}, ${stateFor(e.indoorSeating)}::evidence_state,
          ${paired(e.familyFriendly)}, ${stateFor(e.familyFriendly)}::evidence_state,
          ${paired(e.wheelchairAccessible)}, ${stateFor(e.wheelchairAccessible)}::evidence_state,
          ${e.observationCount}
        )
      `;

      // --- what this place is ---------------------------------------------
      for (const kind of venue.kinds) {
        await tx`
          insert into venue_kinds (venue_id, kind_id, is_primary, evidence_state, source_authority)
          select ${venueRow.id}, k.id, ${kind.isPrimary ?? false},
                 ${kind.evidenceState}::evidence_state,
                 ${kind.sourceAuthority}::source_authority
          from outing_kinds k
          where k.key = ${kind.key}
            and (k.market_id is null or k.market_id = ${marketId})
        `;
        kindCount += 1;
      }

      for (const tag of venue.experienceTags) {
        // Matched by key against the global set plus this market's extensions.
        // A key that resolves to nothing inserts no row, which would be a
        // silent fixture typo, so the count is asserted after the loop.
        const inserted = await tx`
          insert into venue_experience_tags (venue_id, tag_id, evidence_state, source_authority)
          select ${venueRow.id}, t.id,
                 ${tag.evidenceState}::evidence_state,
                 ${tag.sourceAuthority}::source_authority
          from experience_tags t
          where t.key = ${tag.key}
            and (t.market_id is null or t.market_id = ${marketId})
          returning venue_id
        `;
        if (inserted.length === 0) {
          throw new Error(
            `Fixture ${venue.slug} names experience tag "${tag.key}", which is not in the ` +
              `global vocabulary or in ${venue.marketSlug}'s extensions.`,
          );
        }
        tagCount += 1;
      }

      // --- policy facts -----------------------------------------------------
      const pol = venue.policies ?? {};
      const policyValue = (key: PolicyKey) => pol[key]?.value ?? null;
      const policyState = (key: PolicyKey) => pol[key]?.evidenceState ?? 'unknown';
      await tx`
        insert into venue_policies (
          venue_id,
          licensed, licensed_state,
          alcohol_free, alcohol_free_state,
          halal, halal_state,
          takes_reservations, takes_reservations_state,
          open_past_midnight, open_past_midnight_state,
          minimum_age, minimum_age_state
        ) values (
          ${venueRow.id},
          ${policyValue('licensed')}, ${policyState('licensed')}::evidence_state,
          ${policyValue('alcoholFree')}, ${policyState('alcoholFree')}::evidence_state,
          ${policyValue('halal')}, ${policyState('halal')}::evidence_state,
          ${policyValue('takesReservations')}, ${policyState('takesReservations')}::evidence_state,
          ${policyValue('openPastMidnight')}, ${policyState('openPastMidnight')}::evidence_state,
          ${policyValue('minimumAge')}, ${policyState('minimumAge')}::evidence_state
        )
      `;

      const atmosphereAnchor = await anchor(
        'atmosphere.profile',
        'Fictional atmosphere profile for demo purposes',
      );
      // Doc 12: a verified claim names its method and records when. The
      // database refuses it otherwise, so the fixture supplies both rather
      // than pretending.
      const atmosphereVerified = e.evidenceState === 'verified';
      await tx`
        insert into claims (
          subject_kind, subject_id, attribute_key, value, evidence_id,
          lifecycle_state, evidence_state, source_authority, observed_at,
          verification_method, verified_at
        ) values (
          'venue', ${venueRow.id}, 'atmosphere.profile',
          ${JSON.stringify(e)}::jsonb, ${atmosphereAnchor},
          'published', ${e.evidenceState}::evidence_state, 'venue_attested', ${clock.now()},
          ${atmosphereVerified ? 'reviewed first-party observation' : null},
          ${atmosphereVerified ? clock.now() : null}
        )
      `;
      claimCount += 1;

      // --- price ----------------------------------------------------------
      if (venue.price) {
        const low = parseDecimal(venue.price.low, marketFixture.currency);
        const high = parseDecimal(venue.price.high, marketFixture.currency);
        await tx`
          insert into price_points (
            subject_kind, subject_id, amount_minor_low, amount_minor_high,
            currency, price_basis, includes_tax, includes_service_charge,
            evidence_state, observed_at, valid_until
          ) values (
            'venue', ${venueRow.id}, ${low.amountMinor}, ${high.amountMinor},
            ${marketFixture.currency}, ${venue.price.basis},
            ${venue.price.includesTax}, ${venue.price.includesServiceCharge},
            ${venue.price.evidenceState}::evidence_state, ${clock.now()},
            ${new Date(clock.now().getTime() + 30 * 86_400_000)}
          )
        `;
      }

      // --- series ---------------------------------------------------------
      let seriesId: string | null = null;
      if (venue.series) {
        const row = pickOne(await tx`
          insert into event_series (
            venue_id, title, genre_tags, performance_type, recurrence_rule,
            timezone, is_demo_data
          ) values (
            ${venueRow.id}, ${venue.series.title}, ${venue.series.genreTags},
            ${venue.series.performanceType}, ${venue.series.recurrenceRule},
            ${marketFixture.timezone}, true
          ) returning id
        `, 'row');
        seriesId = row.id;
      }

      // --- occurrences ----------------------------------------------------
      for (const o of venue.occurrences) {
        const baseDate = nextWeekdayOnOrAfter(o.weekday, clock, marketFixture.timezone);
        const shifted = new Date(
          new Date(`${baseDate}T00:00:00Z`).getTime() + (o.weekOffset ?? 0) * 7 * 86_400_000,
        )
          .toISOString()
          .slice(0, 10);

        const { occurrence } = occurrenceFromLocal({
          date: shifted,
          startTime: o.startTime,
          durationMinutes: o.durationMinutes,
          timezone: marketFixture.timezone,
          sourceExpression: o.sourceExpression,
        });

        const occurrenceRow = pickOne(await tx`
          insert into event_occurrences (
            venue_id, series_id, title, genre_tags, performance_type, artist,
            starts_at, ends_at, timezone,
            local_start_date, local_start_time, local_end_date, local_end_time,
            source_expression, state, evidence_state, source_authority,
            expires_at, is_demo_data
          ) values (
            ${venueRow.id}, ${seriesId}, ${o.title}, ${o.genreTags},
            ${o.performanceType}, ${o.artist ?? null},
            ${occurrence.startsAt}, ${occurrence.endsAt}, ${occurrence.timezone},
            ${occurrence.localStartDate}, ${occurrence.localStartTime},
            ${occurrence.localEndDate}, ${occurrence.localEndTime},
            ${occurrence.sourceExpression}, ${o.state},
            ${o.evidenceState}::evidence_state,
            ${o.sourceAuthority}::source_authority,
            ${new Date(occurrence.startsAt.getTime() - 86_400_000)}, true
          ) returning id
        `, 'occurrenceRow');
        occurrenceCount += 1;

        if (o.sourceAuthority !== null) {
          const scheduleAnchor = await anchor(
            'event.schedule',
            o.sourceExpression ?? 'Fictional schedule for demo purposes',
          );
          const scheduleVerified = o.evidenceState === 'verified';
          const claimRow = pickOne(await tx`
            insert into claims (
              subject_kind, subject_id, attribute_key, value, evidence_id,
              lifecycle_state, evidence_state, source_authority, observed_at,
              verification_method, verified_at
            ) values (
              'event_occurrence', ${occurrenceRow.id}, 'event.schedule',
              ${JSON.stringify({ startsAt: occurrence.startsAt, source: o.sourceExpression })}::jsonb,
              ${scheduleAnchor}, 'validated',
              ${o.evidenceState}::evidence_state,
              ${o.sourceAuthority}::source_authority, ${clock.now()},
              ${scheduleVerified ? 'current official event publication' : null},
              ${scheduleVerified ? clock.now() : null}
            ) returning id
          `, 'claimRow');
          claimCount += 1;

          // event.schedule is high-impact (doc 11): it cannot reach published
          // without a recorded human decision, so the fixture records one.
          await tx`
            insert into verification_decisions (claim_id, action, reason)
            values (${claimRow.id}, 'approve', 'fixture data, approved for demo')
          `;

          if (o.disputedBy) {
            // A second credible source with a different start time. Both
            // claims go in as validated and the conflict is then *found* by
            // app_publish_claim rather than declared here, so this fixture
            // exercises the real path: both sides marked, both queued, nothing
            // published, and the night left unrecommendable.
            const { occurrence: disputed } = occurrenceFromLocal({
              date: shifted,
              startTime: o.disputedBy.startTime,
              durationMinutes: o.durationMinutes,
              timezone: marketFixture.timezone,
              sourceExpression: o.disputedBy.sourceExpression,
            });
            const rivalAnchor = await anchor('event.schedule', o.disputedBy.sourceExpression);
            const rival = pickOne(await tx`
              insert into claims (
                subject_kind, subject_id, attribute_key, value, evidence_id,
                lifecycle_state, evidence_state, source_authority, observed_at
              ) values (
                'event_occurrence', ${occurrenceRow.id}, 'event.schedule',
                ${JSON.stringify({ startsAt: disputed.startsAt, source: o.disputedBy.sourceExpression })}::jsonb,
                ${rivalAnchor}, 'validated',
                ${o.disputedBy.evidenceState}::evidence_state,
                ${o.disputedBy.sourceAuthority}::source_authority, ${clock.now()}
              ) returning id
            `, 'rival');
            claimCount += 1;
            await tx`
              insert into verification_decisions (claim_id, action, reason)
              values (${rival.id}, 'approve', 'fixture data, approved for demo')
            `;

            const outcome = pickOne(await tx`
              select app_publish_claim(${claimRow.id}) as result
            `, 'outcome');
            if (outcome.result.status !== 'conflict') {
              throw new Error(
                `The disputed fixture did not produce a conflict: ${JSON.stringify(outcome.result)}`,
              );
            }
            conflictCount += 1;
          } else {
            await tx`update claims set lifecycle_state = 'published' where id = ${claimRow.id}`;
          }
        }
      }

      // --- claims left for a reviewer --------------------------------------
      for (const pending of venue.pendingClaims ?? []) {
        const pendingAnchor = await anchor(pending.attributeKey, pending.excerpt);
        await tx`
          insert into claims (
            subject_kind, subject_id, attribute_key, value, evidence_id,
            lifecycle_state, evidence_state, source_authority, observed_at
          ) values (
            'venue', ${venueRow.id}, ${pending.attributeKey},
            ${JSON.stringify(pending.value)}::jsonb, ${pendingAnchor},
            'validated', ${pending.evidenceState}::evidence_state,
            ${pending.sourceAuthority}::source_authority, ${clock.now()}
          )
        `;
        claimCount += 1;
        pendingCount += 1;
      }
    }

    console.log(`\nseeded:`);
    console.log(`  countries      ${COUNTRIES.length}`);
    console.log(`  markets        ${MARKETS.length} (${MARKETS.map((m) => `${m.slug}/${m.currency}`).join(', ')})`);
    console.log(`  venues         ${VENUES.length}`);
    console.log(`  occurrences    ${occurrenceCount}`);
    console.log(`  claims         ${claimCount}`);
    console.log(`  venue kinds    ${kindCount}`);
    console.log(`  venue tags     ${tagCount} (+${extensionCount} market vocabulary extensions)`);
    console.log(`  awaiting review ${pendingCount} pending, ${conflictCount} in conflict`);
  });

  // ---- what a consumer can actually see -----------------------------------
  const visible = await sql`
    select v.slug, m.slug as market, count(p.id)::int as publishable
    from venues v
    join markets m on m.id = v.canonical_market_id
    left join publishable_occurrences p on p.venue_id = v.id
    group by v.slug, m.slug
    order by m.slug, v.slug
  `;
  console.log('\npublishable occurrences per venue (the consumer view):');
  for (const row of visible) {
    console.log(`  ${row.market.padEnd(6)} ${row.slug.padEnd(28)} ${row.publishable}`);
  }

  console.log('\nOK — fixture world seeded. All records are fictional and flagged is_demo_data.');
} catch (error) {
  console.error(`\nSeed failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
