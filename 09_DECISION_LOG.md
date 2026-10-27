# Decisions and Open Questions

## Approved direction (from product discussion)
- Product: Where to Go — Find your kind of night.
- Global platform, city-by-city rollout; Dubai first, Cairo second-market test.
- Focus: live music and social dining experiences; date-specific atmosphere and explainable matching.
- Agentic data collection with provenance, verification and human review.
- Web-first MVP; no forced paid listing to appear in discovery.

## Proposed, awaiting explicit approval
- Next.js + TypeScript + PostgreSQL/PostGIS stack.
- Hosting, auth, maps and queue providers.
- Specific source connectors and licenses.
- Pilot size, cost limits, staffing and legal/privacy approach.
- Detailed UI identity, target audience, operator pricing and success thresholds.

## ADR template
ID | Question | Alternatives | Decision | Rationale | Owner | Date | Status | Revisit trigger.

## Stop rules
Do not interpret illustrative examples as approved commercial or engineering commitments. Record tradeoffs and ask before proceeding when material.

## 2026-10-26 | Kickoff decision brief submitted
`17_KICKOFF_DECISION_BRIEF.md` delivered against `prompts/01_PROJECT_KICKOFF.md`. No code written; no ADR files created yet (they are created per decision at approval).

**Awaiting founder answers (brief §7):** Q1 stack/hosting and auth provider · Q2 spend ceiling · Q3 Arabic scope at pilot · Q4 rights posture for first connector · Q5 unknown/over-budget display policy.

**Resolved spec conflicts applied as defaults** (brief §2, reversible on objection): C1 currency/timezone are per-market, doc `03` superseded on AED and Asia/Dubai · C2 event series split from occurrence per doc `14` · C3 three orthogonal claim state axes plus a derived confidence label · C4 `venue_attested` never presented as independently verified · C6 market-scoped venue slugs · C7 single canonical market plus visibility rows · C8 availability removed from MVP filters · C9 doc `15`/`CLAUDE.md` govern over doc `05` on live-collection timing · C11 fixtures generated against a seeded clock.

**Open decisions pending approval:** D1–D8 in brief §3. Status for all: Proposed.

## 2026-10-26 | Decisions approved; build authorized
Founder ruling: **currency and timezone are parametrized, never hardcoded**; all other decisions approved as recommended, with the standing instruction to take the fastest path to a working prototype.

**ADRs recorded** in `decisions/`: 001 stack · 002 auth and database (Supabase, $0/month confirmed) · 003 location and maps (stubbed port) · 004 LLM provider (parse and explain only, mock fallback) · 005 verification model (three axes, derived label) · 006 ingestion rights (first-party only, licensed provider designed not enabled) · 007 deployment and residency (**residency review outstanding**) · 008 notifications (none in MVP) · 009 market parametrization · 010 series vs occurrence · 011 eligibility tri-state · 012 locale scope. All status Approved.

**Repository created** at project root, branch `main`, initial commit of the specification pack. No GitHub remote yet.

**Still outstanding, neither blocking the prototype:**
- Spend cap has no figure, so maps, geocoding and LLM remain stubbed behind ports and no key exists.
- Single-reviewer capacity (brief G5) remains an assumption, not a confirmed constraint.
- UAE and Egypt data residency unassessed (ADR-007); required before real personal data or public launch.

**Scope of the one-day prototype:** market/geo model, venues, series and occurrences, price points, a claims table with mandatory evidence anchor, both market fixtures, deterministic eligibility and ranking with explanations, venue detail and booking handoff. Deferred: admin review UI, operator dashboard, real auth, ingestion pipeline, natural-language parser.

## 2026-10-27 | Phase 3: reviewer workflow built, two defects corrected in flight

The admin review surface and Supabase Auth are in. A reviewer signs in, sees only the markets they hold a role for, and approves, rejects, corrects or rolls back published values with a reason on the record. Authorization is market-scoped and expressed once, in SQL: migration 0014 parameterizes the rule by user id and reduces the `auth.uid()` functions from migration 0012 to delegates, so a server route and an RLS policy cannot disagree about who is a reviewer.

**Decision — approving a claim is not verifying the fact.** Approval moves the lifecycle and nothing else. It does not raise `evidence_state` to `verified`, and it does not change `source_authority`. A reviewer approving a visitor report has judged the report credible; they have not been to the venue and checked the step-free entrance, and publishing that as "verified" is an overclaim on exactly the attributes someone relies on. The human judgment is recorded in `verification_decisions`, which is where it belongs under ADR-005's three axes. A reviewer who has independently checked a value uses the edit path, which records the check as evidence under a first-party editorial source. Reversible, but the replacement must say who verified what.

**Known gap this leaves:** a reviewer who independently confirms a value *without changing it* has no way to record that. `verification_action` has no `verify` member. Deferred rather than invented.

**Decision — the admin surface is single-language (English).** Internal tooling for a named handful of reviewers. A half-translated review queue is harder to work than an untranslated one, and the localisation effort belongs on consumer surfaces. Consumer pages remain fully localised from `market_locales` (ADR-012). Revisit when a reviewer who does not read English is onboarded.

**Decision — denied actions are recorded.** `authorization_denials` holds what was attempted, by whom and why it was refused, with no request body: a trail that stores submitted input becomes a store of unvalidated input. Doc 16 scenario 7 becomes a test rather than an aspiration.

**Defects found and fixed (0018), both by the verification suite rather than by use:**
- Approval set `evidence_state = 'verified'`, which violated `claims_ai_cannot_self_verify` for every machine-extracted claim — so approving one raised instead of publishing.
- A conflict was unresolvable. Both sides were marked `conflicting` and nothing ever cleared the mark, so rejecting the wrong claim left the right one permanently unpublishable. The pre-conflict evidence state is now stored and restored exactly; approximating it to the weakest publishable state would silently downgrade a corroborated claim on every resolution.

**Fixture correction.** `conflicting-times-test` declared `evidenceState: 'conflicting'` by hand, producing a claim that looked disputed while nothing disagreed with it — the one shape the review queue could never be exercised against. It now seeds two competing claims and lets `app_publish_claim` find the conflict. Both database suites were also storing jsonb fixture values as JSON strings rather than objects, so assertions on nested fields compared against `undefined` and passed regardless.

**Gates:** `npm run verify` 101 unit tests green; `npm run db:verify` 193 database rules across five suites green.

**Not verified in a browser:** every signed-in page — queue, claim detail, published values, audit trail. Exercising them requires authenticating as a real account, and credential handling stays outside this work.

**Still outstanding:** spend cap has no figure (maps, geocoding, LLM stubbed) · UAE and Egypt data residency unassessed (ADR-007) · no rate limiting on the booking handoff route · `src/modules/search/repository.ts` has no isolated unit tests · OneDrive sync exclusion for `.next` and `node_modules` not yet applied.

## 2026-10-27 | Chat-plus-refine discovery, and a widened typed query

The intent form is replaced by one screen: a chat input, chips showing what was understood, a collapsible refine panel, then results. Chat and refine edit the same typed query, and that query is the URL. Specified in `18_INTENT_AND_REFINEMENT_SPEC.md`; recorded as ADR-013 (the when-window), ADR-014 (controlled vocabularies) and ADR-015 (the parser port).

Delivered in four slices, each verified and committed: schema and fixtures; the when-window and per-day eligibility; the engine reading the new vocabulary; the parser and the screen.

**Decision — the query is the URL, and the no-JavaScript path is the only path.** The chat input is a form posting to a server action that parses, patches and redirects. No session, no client state. "Cheaper" and "Saturday then" work with scripting off, survive a reload, and are shareable as links. This was cheaper to build than a client-side version, not a concession.

**Decision — a turn is a patch, not a query.** Additive by default, replacing only on an explicit marker, because "and some jazz" and "jazz instead" are different sentences.

**Decision — the mock parser is the only adapter.** No provider, SDK or key, per ADR-004 and the standing spend-cap constraint. It never invents a term outside the vocabulary, is reproducible, and reports what it could not place. Output is validated rather than trusted: a tag outside the vocabulary is dropped, a malformed value fails the turn closed.

**Decision — approving a match strength is not confidence.** Match strength is overlap between requested and stored tags, weighted by evidence. It is shown as the named tags that matched, never as a percentage and never labelled confidence.

**Decision — "quiet enough to talk" is no longer a hard constraint.** It excluded venues on a stored conversation score, so one uncalibrated number could remove a place entirely. Noise is four soft bands instead. Its two tests were deleted rather than coerced into passing.

**Four market assumptions found and moved into configuration.** None would have been caught by the T15 guard, which looks for currencies, zones and locale tags:
- Weekend days — Saturday-Sunday in the UAE, Friday-Saturday in Egypt.
- Time-of-day band hours — evening is not the same hours everywhere.
- The budget step behind "cheaper" — caught by the guard as a currency ternary in shared logic: right behaviour, wrong place.
- Every Dubai fixture ran on a Friday, which was correct while the canonical query was "Friday night" and wrong once the weekend became configuration: "this weekend" in Dubai matched nothing at all.

**Defects found by the suites rather than by use:** approval claiming to verify facts nobody had checked, and breaking outright on machine-extracted claims; a conflict that could be seen but never resolved; fixture factories storing jsonb as strings so assertions on nested fields compared against `undefined` and passed; the alias hook resolving only `@/` specifiers, which broke the moment a module imported a *value* rather than a type from a sibling.

**Gates:** `npm run verify` 189 unit tests; `npm run db:verify` 240 database rules across six suites. Verified in the browser in both markets, including an Arabic utterance resolving to the same typed query an English one would.

**Still outstanding:** spend cap has no figure, so maps, geocoding and the LLM remain stubbed · UAE and Egypt data residency unassessed (ADR-007) · no rate limiting on the booking handoff route · `src/modules/search/repository.ts` has no isolated unit tests · age bands live in the URL, and query strings reach server access logs · venue-question answering is scoped to stored claims and says "we don't know that yet" for everything else.
