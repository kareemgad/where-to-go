# 90-Day Delivery and Validation Plan

## Stage 0 | Days 1–10: Align and scaffold
Approve scope and ADRs; define taxonomy; create repository, CI, environments, migrations, synthetic seed data and base design system. Deliver clickable screens and risk register.

## Stage 1 | Days 11–25: Core data and operations
Build venue/event/claim models, admin CRUD, source provenance, role permissions and audit. Seed 10 fictional demo venues; do not represent demo data as real. Build operator change-review flow.

## Stage 2 | Days 26–45: Search vertical slice
Implement hard filters, ranking, explainable results, venue/event details and outbound booking links. Unit and E2E tests. Collect and verify first real venues with permission and sources.

## Stage 3 | Days 46–65: Conversational and quality layer
Add validated natural-language filter parsing with editable chips; source freshness/expiry; flags and corrections; manual moderation. Fallback to standard filters when AI unavailable.

## Stage 4 | Days 66–80: Pilot readiness
Mobile accessibility, analytics, error monitoring, privacy controls, performance, venue onboarding. Pilot with 50–100 curated venues and 100–200 test users as targets, not assumptions.

## Stage 5 | Days 81–90: Evaluate
Audit sample of listings, assess top-three relevance, measure return visits and booking handoffs, interview users/operators, decide iterate/pivot/expand.

## Prioritized engineering epics
E01 repository and environments; E02 schema and migration; E03 identity/RBAC; E04 admin venue editor; E05 events and source review; E06 deterministic search; E07 result explanation; E08 venue detail/booking handoff; E09 AI parser; E10 feedback; E11 analytics; E12 operational readiness.

## Definition of Done for each ticket
Typed implementation; authorization checked; test coverage appropriate to risk; no fabricated live content; loading/empty/error states; accessible mobile UI; migrations and docs; acceptance criteria demonstrated; no secrets in repository.

## Pilot exit gate
Proceed only if evidence demonstrates data maintainability, meaningful recommendation quality and repeat intent. A working app alone is not proof of demand.
