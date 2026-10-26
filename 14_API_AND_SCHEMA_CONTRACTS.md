# Domain and API Contracts (proposed)

## Core entities
Country, Region, Locality, Neighborhood, Market, MarketBoundary, MarketLocale, Venue, VenueLocation, VenueExternalIdentifier, ExperienceAttribute, EventSeries, EventOccurrence, SourceProvider, SourceDocument, EvidenceRecord, Claim, VerificationDecision, IngestionJob, VenueOperator, MarketActivation, UserPreference, SavedList, BookingHandoff.

## REST/API outline
- `GET /api/markets` enabled markets, localized labels, coverage geometry summary.
- `POST /api/search` `{market_id, local_date, time_window, party_context, budget:{amount,currency}, hard_constraints, soft_preferences}`; response `{matches, explanations, evidence, unknowns, relaxations}`.
- `GET /api/venues/{id}` and `GET /api/events?market_id=&from=&to=`.
- `POST /api/admin/markets` + activation transition endpoint (global admin).
- `POST /api/admin/ingestion/dry-run` and `POST /api/admin/ingestion/jobs` (approved operators only).
- `GET /api/admin/claims?status=` and `POST /api/admin/claims/{id}/decision`.
- `POST /api/operator/claims` and `POST /api/booking-handoffs`.

## Validation
Zod schemas for requests and agent outputs. UTC timestamps and explicit IANA timezone. Amounts use integer minor units or exact decimals, never binary floating point for money. Event occurrence state: scheduled, confirmed, postponed, cancelled, completed. Store source URL and provenance for all external facts.

## API behavior
Authentication and authorization on all writes; idempotency keys for ingestion; pagination and rate limiting; predictable errors; no unapproved outbound actions; OpenAPI spec generated/maintained alongside implementation. Use typed SQL for PostGIS where ORM support is incomplete.
