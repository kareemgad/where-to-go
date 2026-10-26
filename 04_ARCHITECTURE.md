# Proposed Technical Architecture | Decision Draft

## Recommended default stack (subject to approval)
- Next.js App Router + TypeScript, React, Tailwind CSS, accessible component primitives.
- PostgreSQL with PostGIS for spatial queries; Supabase managed Postgres/Auth/Storage is a practical MVP option.
- ORM/query layer chosen after PostGIS compatibility review (e.g. Drizzle or typed SQL).
- Server-side API routes/actions with strict authorization and input validation using Zod.
- Hosted LLM via provider-agnostic adapter only for parsing natural language into validated filters and explaining grounded results; deterministic filtering/ranking remains in application code.
- Background scheduled jobs for event expiration, freshness review, digest processing and ingestion queues.
- Maps via an approved maps provider; preserve API abstraction and control spend.
- Deployment: managed Next.js hosting and managed database; use separate development/staging/production environments.

## Logical components
Browser UI → server/API → search service → PostgreSQL/PostGIS. Admin UI → moderation service → claims/events. Optional LLM parser → typed filter JSON → deterministic matcher → explanation generator grounded in returned records. Authorized data feeds → staging ingestion → review queue → published records.

## Suggested routes
`/`, `/discover`, `/venues/[slug]`, `/events/[id]`, `/saved`, `/account`, `/operator`, `/operator/venues/[id]`, `/admin/review`, `/admin/audit`.

## API contracts (illustrative)
- `POST /api/search` body `{date, time_window, party_context, budget_max_aed, music_genres, vibe, area, hard_constraints}`; response `{matches:[{venue,event,score,why,tradeoffs,provenance}],unknowns,relaxations}`.
- `GET /api/venues/:id`, `GET /api/events?from=&to=`.
- `POST /api/operator/events` authorized by venue membership.
- `POST /api/feedback` with rate limit and moderation state.
- `POST /api/booking-handoffs` records a click, never a confirmed booking.

## Security, privacy and safety
RBAC with least privilege; row-level security if using Supabase; server-only credentials; secret management; audit logs; rate limiting; anti-spam and moderation; opt-in notifications; deletion/export workflows; retention schedule; privacy impact review for precise location and behavioral profiles. UAE privacy/legal review before public launch. No age inference from photos, no covert tracking. Do not expose private user queries to venue operators.

## Observability
Structured errors, ingestion audit trail, source freshness, search latency, zero-result rate, matching quality, booking-handoff events, moderation queue size and spend dashboards. Avoid sensitive content in logs.

## Quality gates
Unit tests for hard filters and ranking; integration tests for permissions and event time; E2E for discover → detail → booking handoff; accessibility checks; migration rollback plan; seeded synthetic fixtures distinctly labeled as demo.

## Architecture Decision Records (ADRs)
ADR-001 stack; ADR-002 auth; ADR-003 location/maps; ADR-004 LLM provider and fallback; ADR-005 venue verification; ADR-006 ingestion rights; ADR-007 deployment/data residency; ADR-008 notifications. Record alternatives, trade-offs, decision and owner before implementation.
