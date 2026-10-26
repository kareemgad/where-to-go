# Agentic Venue Intelligence System

## Objective
Discover, structure, verify and refresh information about venues and **dated experiences** in any activated market. Dubai is the first pilot. Agent output is a proposed claim, never an automatic verified fact.

## Pipeline
1. Market scheduler selects authorized connector and geographic scope, subject to budgets.
2. Discovery adapter returns candidate identities + source pointers.
3. Identity resolution compares canonical identifiers, names, address, geospatial proximity and domain; ambiguous duplicates go to review.
4. Fetcher collects permitted material, preserves capture timestamp and rights metadata; respects robots, provider rules, rate limits and access restrictions.
5. Extractor produces typed claims with evidence anchors; missing values remain null. Reject unsupported extraction.
6. Reconciler compares claims with existing values, checks source authority, event date, and conflicts.
7. Validator applies deterministic checks and risk-based policy.
8. Reviewer approves/rejects/requests venue confirmation for high-impact or ambiguous claims.
9. Publisher creates a versioned public projection and an immutable audit trail.
10. Freshness scheduler revisits claims according to expiry, change frequency and event proximity.

## Claim lifecycle
`candidate → extracted → validated → corroborated/verified/uncertain/conflicting → review_pending → approved/rejected → published → stale/withdrawn`. `verified` requires a defined verification method and evidence; venue-declared facts must be labeled as such, not 'independently verified'.

## Core claim attributes
`claim_id`, `subject_id`, `attribute_key`, `typed_value`, `valid_from/to`, `source_id`, `source_url`, `evidence_excerpt_or_field`, `observed_at`, `extracted_at`, `source_license_profile`, `confidence_score`, `verification_method`, `verification_state`, `reviewer_id`, `published_version`, `expires_at`.

## Connectors
Contract: `discover(market, cursor)`, `fetch(sourceRef)`, `normalize(raw)`, `rightsCheck(payload)`, `health()`. Must support dry-run, pagination, cursor checkpoints, retries, circuit breakers, rate limits, source terms and provenance. Provider data subject to restricted storage must stay in separate ephemeral handling, never indiscriminately copied to canonical records.

## Risk rules
High-impact: closure, cancellation, live-event schedule, accessibility, age admission rules, fees/minimum spend, booking links. Unknown should be shown as unknown, not inferred. Never infer age composition or demographic attributes from photographs. Avoid collection of identifiable visitor information without consent and lawful basis.

## Review UI
Queue filters by market, source, age, confidence, conflict and priority; side-by-side existing/new claims; clickable source; approve/reject/edit with reason; audit trail; batch review only for low-risk fields; rollback publication.

## Metrics
Usable venues, verified-field coverage, evidence completeness, event freshness, contradiction rate, accuracy from random audit, cost per usable venue, reviewer minutes per venue, failed connectors, queue backlog, source permission coverage.

## Pilot
Dry-run with 10 fictional records → approved authorized source for 5–10 real venues → manual audit → controlled 50–100 venue pilot. Require written approval for live collection, paid APIs, venue outreach and recurring schedules.
