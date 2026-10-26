# Kickoff Decision Brief | Where to Go

**Status:** Proposal awaiting founder decisions. No code written. No live collection enabled.
**Date:** 2026-10-26
**Prepared against:** `prompts/01_PROJECT_KICKOFF.md` (primary) and `08_CLAUDE_KICKOFF_PROMPT.md` (folded in: gap register, repository tree, schema, sprint plan, vertical-slice plan).
**Document priority applied:** `CLAUDE.md` > `09_DECISION_LOG.md` > numbered specs (`10`–`16` as v2 refinements of `01`–`09`) > illustrative examples.

---

## 1. Vision and differentiation

People do not choose a venue; they choose **a night**. The decision inputs are who is coming, which date, what mood, what music, what it will cost and what must be true (accessible, quiet enough to talk, outdoors, family-permitted). Existing tools answer a different question: maps and restaurant platforms index *places* with timeless categories and aggregate ratings; event marketplaces index *ticketed inventory* and miss the unticketed bar trio; social channels carry the real programme but unstructured, unverifiable and rights-restricted; general AI assistants will confidently invent a Friday lineup.

Where to Go indexes the **dated experience occurrence** — venue + confirmed performance + atmosphere + time + price basis + constraints — and treats every field as a sourced, expiring, reviewable claim. Two structural commitments follow, and they are the product:

**Time-indexed truth.** A venue that "has live jazz on weekends" is not evidence that a band plays on Friday 13 November. The system holds a recurrence *rule* and separately holds *materialized occurrences*, which only become recommendable when evidence of that specific date exists. This is the hardest thing competitors do not do, and the thing that makes the answer trustworthy.

**Legible uncertainty.** Every result states which criteria matched, what is unknown, who said so and when it was last checked. Unknown is never silently treated as a pass. "No good options" is a valid, useful answer accompanied by the specific relaxations that would produce one.

The output is a shortlist of three to five, each with a why, a trade-off, a price band with its basis and currency, a freshness stamp and an external reservation handoff — never a claimed booking.

Dubai is the first market because supply is dense and operator relationships are reachable. Cairo exists from day one as a fixture, not a roadmap item: it keeps currency, timezone, locale, script and source configuration in data where they belong. Adding a market must be configuration, never a code fork.

**Defensibility** is not the UI. It is the accumulating corpus of verified, time-indexed, rights-clean atmosphere data plus the operator relationships that keep it fresh. That asset compounds; a search box does not.

---

## 2. Gap and conflict register

The specifications contain real contradictions. Listed blocking-first. Resolutions marked **[default]** I will apply unless you object; those marked **[decision]** map to the questions in §7.

### Blocking conflicts

**C1 — Currency and timezone are hardcoded in the data model.**
`03_EXPERIENCE_DATA_MODEL.md` specifies `price_estimates.currency AED` and "store UTC; **display Asia/Dubai**". `04_ARCHITECTURE.md` defines `POST /api/search` with `budget_max_aed` and no `market_id`. All three contradict `10_GLOBAL_MARKET_ARCHITECTURE.md` (ISO 4217 and IANA timezone per market), `14_API_AND_SCHEMA_CONTRACTS.md` and `CLAUDE.md`'s explicit prohibition.
**[default]** `10`/`14` win. Money is `amount_minor BIGINT + currency CHAR(3) + price_basis`. Display timezone is the venue's, labelled, with the user's as an optional secondary. `budget` is `{amount_minor, currency}`. `market_id` is required on search. Doc `03` is superseded on these two points.

**C2 — One `events` table conflates series and occurrence.**
`03` defines a single `events` row carrying `start_at`, `end_at` *and* `recurrence_rule nullable`. `10` requires distinguishing "a recurring schedule rule from confirmed occurrences", and `14` names `EventSeries` and `EventOccurrence` separately. A single table cannot hold per-date cancellation, postponement, differing evidence per night, or a rule with no confirmed dates — which is exactly the fabrication risk the product exists to avoid.
**[default]** Adopt `14`. `event_series` holds the RRULE and timezone; `event_occurrence` holds one dated instance with its own state and its own evidence. Occurrences are materialized by a job and are not recommendable while unconfirmed.

**C3 — Three incompatible verification vocabularies, conflating three different axes.**
`03` has `sources.origin_type` (venue_verified / admin_verified / visitor_report / authorized_feed / AI_extracted). `06` has display labels (Venue confirmed / Editor verified / Visitor reported / Unverified estimate). `11` has a 10-state claim lifecycle. `12` has 7 evidence states. These overlap and partly contradict; implementing them as one enum guarantees inconsistency.
**[default]** Separate three orthogonal columns on every claim, plus one derived label:
- `lifecycle_state` — workflow position, from `11`: candidate → extracted → validated → review_pending → approved/rejected → published → stale/withdrawn.
- `evidence_state` — strength of evidence, from `12`: unknown / source_claimed / corroborated / verified / conflicting / stale / rejected.
- `source_authority` — who asserted it, from `03`: venue_attested / editor_checked / visitor_reported / authorized_feed / ai_extracted.
- `confidence_label` — the user-facing string from `06`, **derived deterministically** from the three above by a pure function. Never stored, never author-set, never an AI score.

**C4 — "Verified" means two different things.**
`06` requires "an actual verification event and traceable source". `12` concedes "a source can confirm its own declared programme without independently proving actual delivery". So an operator attesting their own Friday band is not independent verification, yet it is the strongest evidence we will usually have — and `02` makes some hard filters conditional on "verified".
**[default]** `venue_attested` and `independently_verified` are distinct and never collapsed in UI or ranking. For hard filters, define `eligibility_grade` per attribute: `venue_attested` and above satisfies a date/live-music hard constraint; only `independently_verified` may ever be described to the user as verified. Verification method is always recorded.

**C5 — Unknown versus over-ceiling budget are treated as one case.**
`07` says a strict AED 300 ceiling "does not guarantee Rock Stage [220–350] or Unknown Price as within budget; can show separately". But those are different failures: one is *known to possibly exceed*, the other is *no evidence at all*. `13` requires unknown hard-constraint data to either exclude or show as "needs confirmation" under explicit user control.
**[decision — Q5]** Proposed: tri-state eligibility `eligible | needs_confirmation | excluded`, with `needs_confirmation` rendered in a separate labelled section that is **collapsed by default**, never interleaved into the ranked list, and never counted toward the three-to-five shortlist.

**C6 — Globally unique venue slugs break in multi-market.**
`03` gives `venues.slug` and `04` routes `/venues/[slug]`. "The Jazz Loft" can exist in both Dubai and Cairo.
**[default]** `UNIQUE(market_id, slug)`; routes become `/{market}/venues/{slug}`. Affects the route list in `04`.

**C7 — Market overlap has no canonical assignment rule.**
`10` permits overlapping markets and demands explicit canonical assignment; `16` scenario 4 requires no duplicate canonical venue. No rule is specified.
**[default]** A venue has exactly one `canonical_market_id` (smallest-area containing market wins; ties broken by explicit market priority) and zero or more rows in `venue_market_visibility` controlling where it is discoverable. Policy documented, overlap covered by a test.

**C8 — "Availability" is specified as a filter but has no data source.**
`02` P0 includes eligibility filtering on "availability *only if verified*", but no entity in `03`, `14` or the connector contract in `11` ever produces availability, and booking is an external handoff by design.
**[default]** Availability is removed from MVP filters. It is permanently `unknown`, shown as "Check with venue". Revisit only if a booking partner integration is approved.

### Sequencing and scope conflicts

**C9 — Live data collection timing.** `05` Stage 2 (days 26–45) says "collect and verify first real venues"; `15` Phase 5 and `CLAUDE.md` forbid it until separate written approval. **[default]** `15` and `CLAUDE.md` govern. All phases through 4 run exclusively on labelled synthetic fixtures.

**C10 — Arabic at launch.** `01` lists it as an open founder decision, `02` places multi-language at P2, while `10` and `16` make a Cairo Arabic RTL query an acceptance gate. **[decision — Q3]** Proposed split: the *architecture* is locale-ready and RTL-correct from Phase 1 and tested with Arabic fixture data in Phase 2 (cheap, and retrofitting RTL is not); *translated UI copy and Arabic content pipeline* stay P2. This satisfies the `10`/`16` gates without funding translation in the MVP.

**C11 — Fixture set is insufficient and will rot.** `07` names five Dubai/AED fixtures with weekday-relative dates; `fixtures/README.md` additionally requires Arabic names, conflicting schedules, midnight-crossing events, multiple currencies, closed venues and accessibility unknowns; `10`/`16` require Cairo. The illustrative event in `03` is dated 2026-11-05 and expires in ten days. **[default]** Fixtures are **generated relative to a seeded clock**, never literal dates, across ~14 records spanning both markets and every edge case named above. Tests freeze time.

### Specification gaps (no conflict, but undefined)

**G1 — Unknown-attribute scoring.** `03` says missing attributes "are not scored as positive" but does not say whether the denominator shrinks. Scoring over known weights only quietly rewards sparse data; scoring unknowns as zero penalizes exactly the thinly-seeded venues the pilot starts with. **[default]** Unknowns score zero against the full denominator (conservative), surfaced as a separate "information completeness" indicator rather than hidden in the score. Ranking version logged for reproducibility.

**G2 — Budget counted twice.** Budget is a hard ceiling in `02`/`13` and simultaneously 20% of the soft score in `03`. Both are legitimate (ceiling gates, fit ranks) but the interaction must be explicit or it double-penalizes. **[default]** Ceiling gates eligibility; the soft 20% scores *position within the user's stated range*, not distance from the ceiling.

**G3 — Distance with no GPS.** `02` deliberately avoids precise location, yet `03` weights distance at 10%. **[default]** Distance is measured from the selected neighborhood centroid; absent a neighborhood, the 10% is redistributed and disclosed.

**G4 — Age as a signal.** `01`'s core example says "four friends in their 40s" while `03` and `11` forbid demographic inference. **[default]** Age input maps only to (a) legal admission constraints and (b) self-declared comfort preferences. It can never produce or match an audience-composition claim, and the NL parser's output schema will not contain a field capable of expressing one.

**G5 — Reviewer capacity is assumed but never stated.** `06`'s SLAs (72h pre-event, 90-day static recheck, 2-day flag triage) imply staff. **[default assumption]** One reviewer — you — for the pilot. SLAs are recorded as targets, not commitments; the review queue is designed to be safe when the queue is never emptied (expiry downgrades confidence automatically rather than requiring human action).

**G6 — Provider payload retention has no storage design.** `12` requires that fields a provider forbids caching are not persisted canonically. **[default]** A physically separate `provider_payload` store with per-provider `allowed_fields` enforced **at write time**, a retention TTL job, and a hard rule that it is never joined into the published projection.

**G7 — ADRs referenced but absent.** `04` names ADR-001…008 and `09` has a template; none exist. **[default]** I will not pre-create eight ADR files that read as decided. Draft positions are in §3 below; each becomes `decisions/adr-00NN-*.md` at the moment you approve it.

**G8 — North-star is unmeasurable in 90 days.** "Verified satisfactory outings" needs post-visit confirmation, which `02` places at P1. **[default]** The pilot measures the proxy (qualified booking handoffs) and we state plainly that the north-star is not yet instrumented. No click is ever reported as a booking.

---

## 3. Architecture recommendation and decisions requiring approval

### Recommended shape

A **modular monolith**: one Next.js App Router application in TypeScript strict mode, one PostgreSQL database with PostGIS, queue-backed workers, strict internal module boundaries. No microservices, no GraphQL, no event sourcing, no per-city deployment until residency, scale or resilience actually require it (`10`).

The load-bearing architectural decision is a **two-sided data model**:

- **Evidence side (write).** Keyed claims with full provenance — subject, attribute key, typed value, evidence pointer, source, observed-at, the three state columns from C3, validity window, expiry, supersession chain. Append-only; history is never deleted (`12`).
- **Published projection (read).** Versioned, typed, indexed tables built *only* from approved claims, each nullable column paired with an `*_evidence_state` column. Consumer search reads exclusively from here.

This is what makes the rest of the specification tractable. It satisfies `10`'s "separate admin data and consumer published read model", gives `11` step 9's versioned public projection and rollback for free, makes "unknown" a first-class queryable value rather than an absent row, and keeps search fast without denormalizing provenance into the hot path.

The second load-bearing decision: **the LLM never decides anything.** It has exactly two jobs — parse natural language into a Zod-validated filter object (rejected safely on invalid output, per `07`), and phrase an explanation whose every factual token is substituted from stored claim values. Eligibility and ranking are deterministic application code. The app is fully usable with the LLM switched off (`15` Phase 2: "mock fallback").

Everything external sits behind a port: `MapsProvider`, `GeocodingProvider`, `LlmProvider`, `SourceConnector`, `Clock`. Phase 1 ships stub implementations only, which is what keeps spend at zero until Q2 is answered.

### Decisions I need approved

| # | Decision | Recommendation | Alternatives and trade-off |
|---|---|---|---|
| **D1** | Stack and hosting *(→ ADR-001, ADR-007)* | Next.js App Router + TypeScript strict + Tailwind; PostgreSQL 16 + PostGIS; typed SQL via Drizzle with raw SQL for PostGIS predicates | Rails/Django are faster for CRUD but weaker for the typed contracts `14` demands. Prisma has historically poor PostGIS support. **Blocking for every ticket.** |
| **D2** | Database and auth provider *(→ ADR-002)* | **Supabase** — managed Postgres with PostGIS, Auth, Storage, RLS in one, and I can see a Supabase connector already available in this session | Alternative: Vercel + Neon/RDS + Auth.js — more control, no RLS safety net, more wiring. Supabase's RLS directly serves `10`'s market-scoped authorization. Note: RLS is a second line of defence, not a substitute for server-side authorization checks. |
| **D3** | Spend ceiling and paid services *(→ Q2)* | **Zero paid external calls through Phase 4.** Maps, geocoding and LLM are stubbed behind ports; a named monthly cap and a kill switch precede any real key | Enabling a maps/LLM key in Phase 1 shortens one ticket and creates an uncapped, unreviewed cost and rights surface. |
| **D4** | Rights posture for the first connector *(→ ADR-006, Q4)* | **First-party only**: venue-owned sites, official event pages, authenticated operator submissions. Licensed third-party providers (e.g. Google Places) designed for but not enabled; the `provider_payload` + TTL machinery from G6 built in Phase 4 | Designing for a licensed provider now costs ~1 ticket and avoids a later schema migration. Designing against it and reversing later is expensive. |
| **D5** | Event occurrence materialization *(→ C2)* | A series rule materializes `event_occurrence` rows as **`scheduled`**, which are **not recommendable**. Promotion to `confirmed` requires date-specific evidence | Recommending `scheduled` occurrences would multiply apparent coverage overnight and destroy the product's only real differentiator. This is the decision I would least like reversed. |
| **D6** | Verification model *(→ ADR-005, C3/C4)* | Three orthogonal state columns plus a derived label; `venue_attested` ≠ `independently_verified`, never collapsed | A single enum is simpler and will silently present operator claims as verified facts. |
| **D7** | Unknown-data display policy *(→ Q5, C5)* | Tri-state eligibility; `needs_confirmation` in a separate collapsed section, excluded from the shortlist count | Interleaving them inflates perceived coverage; hard-excluding them wastes genuinely good candidates with thin data — which, early on, is most of them. |
| **D8** | Market and locale scope at pilot *(→ Q3, C10)* | Locale-ready architecture and RTL from Phase 1, Arabic fixtures tested in Phase 2, translated UI copy at P2 | Full Arabic UI at launch roughly doubles front-end copy work and adds a translation-provenance pipeline (`10`: never translate proper names without a source). |

---

## 4. Evidence-based ingestion and verification design

Pipeline per `11`, with the specification gaps closed:

```
market scheduler (budget + kill switch, dry_run default true)
  → discovery adapter        candidate identity + source pointer
  → identity resolution      external IDs → domain → name+geo proximity; ambiguous → review
  → fetcher                  permitted material only; captures content hash, captured_at, rights profile
  → extractor                typed claims + evidence anchor; missing stays NULL; unsupported → reject
  → reconciler               compare to current published value; authority + date + conflict checks
  → validator                deterministic rules; risk-based routing
  → reviewer                 approve / reject / request venue confirmation  (high-impact: mandatory)
  → publisher                new published version + immutable audit entry
  → freshness scheduler      re-check by expiry, change rate, event proximity
```

Five design commitments:

1. **Claims are proposals, never facts.** No path exists from extractor to published without either a deterministic validator pass on a low-risk field or a human decision. High-impact fields per `11` — closure, cancellation, live-event schedule, accessibility, age admission, fees and minimum spend, booking links — always require a human and are never batch-approved.
2. **Evidence anchors are mandatory.** Every claim points at a `source_document` (URL, publisher, capture timestamp, content hash, rights profile) and an `evidence_record` (the excerpt or field the value came from). A claim with no anchor cannot be inserted — enforced by constraint, not convention. This delivers `16`'s "evidence attribution on 100% of published factual claims" structurally rather than by diligence.
3. **Expiry is automatic and downgrades rather than deletes.** Per `12`: hours 7d, event listings 24h (tightening near the event), prices 30d, static amenities 90d, atmosphere 30d with a sample-size indicator. A nightly job moves claims to `stale`, which lowers the derived confidence label and the freshness component of the score, with no human in the loop. Past occurrences auto-expire (AC02). Historical evidence is retained.
4. **Rights are enforced at write time.** The source registry (`12`) carries permitted endpoints, allowed fields, storage policy, retention TTL, attribution requirements, TOS review date, cost model and a kill switch. Fields outside `allowed_fields` are rejected on insert into the canonical store; restricted payloads live only in the separate TTL'd `provider_payload` store (G6). `16` scenario 8 becomes a test, not a policy memo.
5. **Dry-run is the default.** Connectors implement `discover/fetch/normalize/rightsCheck/health`; every job carries an idempotency key and a `dry_run` flag defaulting true. Phase 4's acceptance gate is a fully traceable single-venue flow from a **fixture** connector, with zero network egress.

Conflict handling (`16` scenario 5): two credible sources disagreeing on an event time sets `evidence_state = conflicting`, blocks publication, and queues both claims side-by-side with clickable sources. The system never picks a winner — including never averaging, never preferring the newer, never preferring the higher-confidence extraction.

---

## 5. Risks

**Legal and rights (highest).** Provider terms restrict caching and redistribution; social sources prohibit scraping outright; republishing venue imagery without permission creates exposure. *Mitigation:* first-party-only start (D4), write-time rights enforcement, per-source registry with kill switch, explicit operator consent records, takedown process, counsel review before any public launch (`16` gate). *Early warning:* any ticket that needs a field the registry disallows.

**Data freshness — the existential product risk.** A wrong Friday lineup destroys trust faster than any feature earns it. Event evidence decays in days, and the pilot's supply is precisely the venues least likely to maintain a web presence. *Mitigation:* D5 (unconfirmed is not recommendable), 24h event TTL, automatic downgrade-on-expiry, visible freshness stamps, visitor flagging. *Early warning:* the share of occurrences reaching their date still `scheduled` rather than `confirmed`.

**Supply thinness.** Dubai's unticketed live-music programme may simply not be documented anywhere citable. If so, coverage depends entirely on operator onboarding — a sales problem, not an engineering one, and the 50–100 venue target may be unreachable at acceptable cost. *Mitigation:* `11`'s cost-per-usable-venue and reviewer-minutes metrics from the first real venue, not at pilot end. *Early warning:* first 10 venues exceeding a per-venue effort budget you set.

**Review burden collapse.** `06`'s SLAs assume capacity that G5 says does not exist. A queue nobody empties silently becomes a backlog of unpublished truth. *Mitigation:* expiry downgrades without human action; low-risk auto-validation; batch review for low-risk fields only; queue depth as a monitored metric with an explicit "stop seeding" trigger.

**Hallucination and inflated confidence.** LLM extraction will produce plausible, wrong event times, and any surfaced "AI confidence %" will be read as truth. *Mitigation:* LLM confined to parsing and templated explanation; explanations substitute stored values only; no model-derived score is ever shown to a user (`03`); invalid parser output fails closed (`07`).

**Privacy and discrimination.** Precise location, private search queries and the age signal in `01` are all live hazards; leaking a user's query to an operator would be a serious breach. *Mitigation:* G4's parser schema that cannot express a demographic claim, no age inference from imagery ever, no precise location without consented need, operators see aggregates only, deletion and export workflows, UAE and Egypt privacy review before activation (`04`, `12`).

**Cost runaway.** Maps, geocoding, LLM and crawl budgets all meter per call and all scale with seeding. *Mitigation:* D3's zero-spend phases, ports with stubs, per-market budgets with hard caps and kill switches, spend dashboard before the first real key.

**Execution and retention.** `05`'s pilot exit gate is correct and worth restating: a working app is not proof of demand. The honest risk is building all six phases and discovering people ask friends instead. *Mitigation:* the vertical slice in §6 is deliberately the earliest point at which matching quality can be judged by a human, on synthetic data, before any collection cost is incurred.

---

## 6. Implementation plan, repository, schema and sprint 1

### Phase sequence and gates

Per `15`, with the gates made testable:

| Phase | Content | Gate to pass |
|---|---|---|
| **0** Decisions | §7 answered; ADRs written for approved items; repo, CI, environments, `.env.example` | ADRs committed; CI green on an empty app; no secrets in repo |
| **1** Global foundation | Geo and market model, migrations, published projection, RBAC, fixture generator, Dubai + Cairo seeds | Both markets operate with distinct timezone, currency, locale and permissions; a grep for `Dubai`/`AED`/`Asia/Dubai`/locale literals in shared logic returns nothing (a CI check, per `10`) |
| **2** Search vertical slice | Market switcher, filters, deterministic eligibility, ranking, explanations, venue and occurrence detail, booking handoff | The §6 demo below, plus zero-result, unknown-handling, RTL and accessibility tests |
| **3** Admin evidence | Claims store, verification state machine, review UI, audit log, versioned publish and rollback | A conflicting event claim cannot auto-publish; reviewer rollback restores the prior published version |
| **4** Agent pipeline | Connector contract, **fixture** connector, queue, extraction schema, reconciliation, dry-run, source registry, kill switch, telemetry | A single venue fully traceable claim-to-publish with zero network egress |
| **5** Dubai pilot | *Requires separate written approval.* Approved provider, cost caps, 5–10 venues, manual audit, then 50–100 | Manual accuracy audit; critical event errors < 5% in sample (`16`) |
| **6** Cairo | Configuration and localization only; independent source jobs | No forked app code; multi-market suite green |

### Proposed repository tree

```
/                             existing 00–17 docs, CLAUDE.md, README.md
  decisions/                  adr-0001-stack.md … (created on approval only)
  src/
    app/
      [market]/               market-scoped public routes (C6)
        page.tsx  discover/  venues/[slug]/  events/[occurrenceId]/
      (account)/              saved/  account/
      (operator)/operator/    venues/[id]/  events/
      (admin)/admin/          review/  audit/  markets/  ingestion/
      api/                    search/  markets/  venues/  events/
                              booking-handoffs/  feedback/
                              operator/  admin/
    modules/                  module boundaries enforced by lint rule
      geo/                    country→region→locality→neighborhood, PostGIS predicates
      markets/                activation state machine, locale/currency/tz config
      venues/  spaces/
      events/                 series, RRULE, occurrence materialization
      experience/             attribute taxonomy
      evidence/               sources, documents, evidence, claims, state machine,
                              derived confidence label (C3)
      publishing/             claim → versioned published projection, rollback
      search/                 eligibility (deterministic) → ranking → explanation
      intent/                 NL → Zod filter adapter + mock fallback
      ingestion/              connector port, fixture connector, queue, registry, budgets
      identity/               auth, RBAC, market-scoped authorization
      operators/  telemetry/
    lib/                      money, time, locale, i18n, result, ids, clock port
    ports/                    maps, geocoding, llm  (stubs only until D3)
    db/                       schema, migrations/, seed/
  fixtures/                   generator + dubai/ + cairo/  (relative dates, C11)
  tests/                      unit/  integration/  e2e/  a11y/  multi-market/
```

### Normalized schema (core, ~30 tables)

**Geography and markets** — `countries` (ISO 3166-1), `admin_regions`, `localities`, `neighborhoods`, `markets`, `market_boundaries` (`geometry(MultiPolygon, 4326)`), `market_locales` (BCP 47, `is_default`), `market_activations` (state transition audit, per `10`).

**Venues** — `venues` (`canonical_market_id`, `UNIQUE(market_id, slug)`), `venue_locations` (`geography(Point, 4326)` + address components), `venue_external_identifiers` (`UNIQUE(provider, external_id)`, namespaced per `10`), `venue_spaces`, `venue_market_visibility` (C7).

**Experience** — `event_series` (RRULE, timezone, status), `event_occurrences` (`starts_at timestamptz`, `ends_at`, `local_date`, `local_start_time`, `timezone`, `source_expression`, `state ∈ {scheduled, confirmed, postponed, cancelled, completed}`, admission), `experience_attributes`, `price_points` (`amount_minor_low`, `amount_minor_high`, `currency`, `price_basis`, `inclusions`, `observed_at`, `valid_until`).

Note on time: four columns, not one. The UTC instant for ordering, the local wall clock for display and for the user's mental model, the IANA zone, and the original source expression for audit — because "Fri 8pm" is what the evidence actually said, and DST plus midnight-crossing shows will otherwise silently corrupt it (`10`).

**Evidence** — `source_providers` (registry per `12`: allowed_fields, storage_policy, retention_ttl, attribution, tos_reviewed_at, cost_model, kill_switch, activation_status), `source_documents` (url, publisher, captured_at, content_hash, rights_profile, retention_expires_at), `evidence_records`, `claims` (subject, attribute_key, value JSONB, evidence_id **NOT NULL**, the three state columns from C3, confidence, verification_method, verifier, valid_from/to, expires_at, supersedes_claim_id), `verification_decisions`, `provider_payloads` (physically separate, TTL'd, never joined — G6).

**Published projection** — `published_venue_versions`, `published_occurrence_versions` (typed nullable columns, each paired with `*_evidence_state`, plus `version`, `published_at`, `superseded_at` for rollback).

**Identity and users** — `users`, `role_assignments` (market-scoped: global_admin, market_manager, reviewer, venue_operator, end_user), `venue_memberships` (with claim verification state), `user_preferences`, `consents`, `saved_lists`, `saved_list_items`, `interest_follows`, `feedback` (moderation state), `booking_handoffs`, `audit_events`.

**Operations** — `ingestion_jobs` (idempotency key, market, connector, `dry_run DEFAULT true`, budget, status), `ingestion_dead_letters`, `ranking_versions`, `search_requests` (telemetry, no PII, never exposed to operators).

### Vertical-slice demonstration

The `prompts/01` and `08` demo, specified precisely enough to be an acceptance test. **All data fictional and labelled as demo in the UI.**

*Input:* market Dubai, next Friday, 19:00–23:00, four adults, live music required, budget ceiling AED 300 per person, area selected, no accessibility constraint.

*Fixtures and expected disposition:*

| Fixture | Expected | Why |
|---|---|---|
| Jazz Loft Test — live jazz Fri 20:00–23:00, 180–260, conv 3/5, venue-attested | **Rank 1, eligible** | All hard constraints met with date-specific evidence |
| Quiet Courtyard Test — no live music Fri, 120–220, conv 5/5 | **Excluded** | Fails the live-music hard constraint (AC01) |
| Rock Stage Test — live rock Fri, 220–350, loud, conv 1/5 | **`needs_confirmation`** | Range overlaps the ceiling; not guaranteed under budget (C5) |
| Unknown Price Test — live Arabic music Fri, price unknown, event verified | **`needs_confirmation`** | No price evidence; "Check with venue", never assumed under budget |
| Expired Gig Test — past Thursday occurrence only | **Excluded, never shown as upcoming** | AC02 |
| Midnight Crossing Test — Fri 22:00 → Sat 02:00 | **Eligible** | Window overlap handled across the date boundary |
| Cancelled Occurrence Test — Fri occurrence `cancelled` | **Excluded** | `16` scenario 6 |
| Scheduled-Only Test — weekly rule, no date evidence | **Excluded from the ranked list** | D5 — the demo's most important assertion |

*Output to demonstrate:* three to five ranked cards, each naming at least two matched criteria plus any mismatch or unknown (AC03); price as range + currency + basis + source + updated date + disclaimer (AC04); timezone-aware occurrence time with source (AC08); the derived confidence label from C3; a collapsed `needs_confirmation` section; an external booking handoff that logs a `booking_handoff` row and claims no booking (AC06).

*Then, same build, no code change:* the Cairo mirror — Arabic venue names, EGP ceiling, `Africa/Cairo` local times, RTL layout. And a zero-result run proving AC09: the empty state explains which constraint eliminated everything and offers specific relaxations, never a fabricated match.

### Sprint 1 — two weeks (Phase 0 + Phase 1)

Assumes §7 answered on day 1. Each ticket is independently testable; DoD is `05`'s plus `15`'s.

| # | Ticket | Depends | Acceptance |
|---|---|---|---|
| T01 | Repo, TS strict, lint, module-boundary rule, CI, `.env.example` | §7 Q1–Q2 | CI green; no secrets; `tsc --noEmit` clean |
| T02 | ADRs for approved decisions | §7 | One file per approved decision; `09` updated |
| T03 | DB provisioning + PostGIS + migration runner with rollback notes | T01, Q1 | Migrate up and down cleanly on a scratch DB |
| T04 | `lib/money` — minor units, ISO currency, price basis, no floats | T01 | Property tests; AED and EGP; rejects float input |
| T05 | `lib/time` — UTC instant + local wall clock + IANA zone + source expression; injectable `Clock` | T01 | DST boundary, midnight-crossing and two-timezone tests |
| T06 | Geo migrations: countries → regions → localities → neighborhoods | T03 | Seeded UAE and Egypt; spatial indexes present |
| T07 | Market model, boundaries, locales, activation state machine | T06 | Illegal transition rejected; every transition writes an audit row |
| T08 | Canonical market assignment + visibility (C7) | T07 | Overlapping-boundary venue resolves to exactly one canonical market |
| T09 | Venue, space, location, external-identifier migrations (C6 slugs) | T07 | Same slug in two markets coexists; duplicate `(provider, external_id)` rejected |
| T10 | `event_series` + `event_occurrences` + materialization job (C2, D5) | T09, T05 | Rule yields `scheduled` occurrences; none are recommendable |
| T11 | Evidence core: providers, documents, evidence, claims; three state columns; derived label (C3, C4) | T09 | Claim without evidence anchor rejected by constraint; label function unit-tested across the matrix |
| T12 | Published projection + versioning + rollback | T11 | Approving a claim emits a new version; rollback restores the prior one |
| T13 | RBAC with market-scoped authorization (+ RLS if D2 = Supabase) | T07, T09 | Operator A cannot edit venue B — denied **and** logged (`16` scenario 7) |
| T14 | Fixture generator: ~14 relative-date records, both markets, all C11 edge cases | T10, T11, T04 | Seeds both markets; demo labelling present; time-frozen tests stable |
| T15 | CI guard: no hardcoded `Dubai` / `AED` / `Asia/Dubai` / locale literals in shared logic | T01 | A deliberately planted violation fails the build |
| T16 | Multi-market smoke test + sprint demo | T13, T14, T15 | Both markets queried in one run with correct tz, currency and permissions |

Sprint 1 deliberately ends *before* search. Search is Phase 2 and gets its own sprint, because the vertical slice above is only meaningful once the time, money, evidence and market foundations beneath it are correct.

---

## 7. The five questions

Answer these and I can start T01. Everything else in this brief I will proceed on as a stated default.

**Q1 — Stack and hosting.** Approve D1 and D2: Next.js + TypeScript + PostgreSQL/PostGIS, on **Supabase** (managed Postgres, Auth, Storage, RLS)? A Supabase connector is already available in this session, which makes it the lowest-friction path — but it is a real commitment to their auth model and RLS, so I will not assume it. *If you prefer Vercel + Neon/RDS + Auth.js, say so now: it changes T03 and T13 substantially and is expensive to switch later.*

**Q2 — Spend ceiling.** Confirm **zero paid external calls** through Phase 4, with maps, geocoding and LLM stubbed behind ports — and name the monthly cap that will apply when the first real key is enabled. *Without a number I cannot design budget enforcement or the spend dashboard, and I will keep everything stubbed.*

**Q3 — Arabic scope at pilot.** Approve the C10 split: locale-ready architecture and RTL from Phase 1, Arabic fixtures tested in Phase 2, translated UI copy deferred to P2 — or do you want a fully Arabic UI at Dubai launch? *The second roughly doubles front-end copy work and adds a translation-provenance pipeline.*

**Q4 — Rights posture for the first connector.** Approve D4: first-party sources only (venue sites, official event pages, authenticated operator submissions) through Phase 4, with licensed-provider machinery *designed* but not enabled? Specifically — may I design the schema on the assumption that **Google Places or a comparable licensed provider will eventually be approved** (IDs stored, restricted fields in a separate TTL'd store), or should I assume first-party only permanently? *Designing for it now costs about one ticket; retrofitting it later is a migration across the evidence core.*

**Q5 — Unknown and over-budget results.** Approve D7: tri-state eligibility, with `needs_confirmation` candidates in a separate section that is **collapsed by default** and excluded from the three-to-five shortlist count? *This is the most user-visible judgement call in the brief, and the specs genuinely disagree (`07` vs `13`). Early on, most good candidates will land in this bucket — too strict and the app looks empty; too loose and it looks like every other directory.*

---

## What I am deliberately not building

Recorded so it is a decision rather than an omission: native mobile apps; in-platform payments, ticketing or reservations (external handoff only); full group voting (a shareable read-only shortlist link instead); social graph, feeds or user photo uploads; star ratings and free-text reviews at MVP (structured, moderated post-visit feedback at P1 instead); real-time crowd or noise sensing; personalization or recommender ML (deterministic logged weights instead); our own maps tiles or geocoder; multi-region deployment or per-city databases; push notifications; a chat-only interface (chat is an adapter onto filters, never the only path); microservices, GraphQL or event sourcing; social scraping of any kind; automated venue outreach; FX as a source of budget truth (presentation estimate only); and AI auto-approval of any claim.

---

## Stop

No code will be written and no files beyond this brief and the `09_DECISION_LOG.md` entry will change until you answer §7. All live ingestion remains disabled by default per `CLAUDE.md`.
