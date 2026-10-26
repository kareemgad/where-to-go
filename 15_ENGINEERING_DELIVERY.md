# Implementation Roadmap and Approval Gates

## Phase 0 — decisions and scaffolding
Confirm stack, licensing boundaries, budget, maps provider, hosting, auth and privacy posture. Produce ADRs. Approval gate before production services.

## Phase 1 — global foundation
Next.js/TypeScript app, PostgreSQL/PostGIS migrations, market model, Cairo/Dubai synthetic seeds, typed API, authentication stub or approved auth, test runner, CI, env examples. Acceptance: both markets operate with distinct timezones/currencies and permissions.

## Phase 2 — search vertical slice
Landing, market switcher, filter/chat-to-typed-query adapter (mock fallback), deterministic matcher, explanations, venue details, booking handoff tracking. Acceptance: three synthetic scenarios, hard constraints, zero results, unknowns, RTL and accessibility tests.

## Phase 3 — admin evidence
Claims/evidence store, verification state machine, review UI, audit log, versioned published view. Acceptance: conflicting event claim cannot publish automatically; reviewer rollback works.

## Phase 4 — agent pipeline
Connector interface, fixture connector, queue, extraction schema, reconciliation, dry-run, source registry, kill switch, budgets and telemetry. Acceptance: fully traceable single-venue flow; no live fetches without approval.

## Phase 5 — authorized Dubai pilot
Approve providers, pilot scope and cost caps; 5–10 venues, manual accuracy audit; scale to 50–100 after quality gate. Add authenticated operator update pilot. No unsupported live availability claims.

## Phase 6 — second market
Cairo configuration, Arabic localization, regional rights review, independent source jobs; no forked app code. Only activate real collection after separate approval.

## Definition of done
Code and tests; migrations and rollback notes; docs updated; security/privacy checks; costs noted; demo with synthetic or approved live data; git commit after approval. Report what was implemented, what was not, test results and blockers.
