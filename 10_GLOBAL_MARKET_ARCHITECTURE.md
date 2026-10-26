# Global Market Architecture

## Design principles
A single platform supports many countries, regions, cities, neighborhoods, and metropolitan areas. Market is a **commercial/operational coverage boundary**, not necessarily an administrative city. Markets may overlap or include several municipalities. Store a polygon or multipolygon in PostGIS; explicitly manage overlap and canonical assignment.

## Geographic hierarchy
`Country` (ISO 3166-1) → `AdministrativeRegion` (country-specific subdivisions) → `Locality` (city/town) → `Neighborhood`; `Market` references a boundary and may span multiple localities. `VenueLocation` holds a point and postal/address components. Use UUIDs for internal IDs. External identifiers are namespaced by provider and may change.

## Market activation
`draft → sources_configured → seeding → validating → ready → live → paused`. Each transition must have an audit entry and quality gates. A market has supported locales, default locale, IANA timezone, ISO 4217 currency, regulatory profile, licensed connectors, crawl budgets, reviewer assignments, taxonomy extensions, launch thresholds, and publication flags.

## Internationalization
Store multilingual display text with language tags (BCP 47), preserve original script and transliterations, support Arabic RTL, localized sorting/search, Arabic/English synonyms, and optional translations with provenance. Never translate proper names without a source or a clearly labeled generated translation.

## Currency and pricing
Store amount in minor units or exact decimal, ISO currency, price basis (per person, entry, minimum spend), inclusion/exclusion of tax/fees, observed date and source. FX conversion is a presentation-only estimate with rate timestamp, not a replacement for native price. Budgets are evaluated in target-market currency after explicit conversion policy.

## Time and recurrence
Persist event occurrence start/end as UTC instants, local timezone ID, local wall-clock date/time and original source expression. Distinguish a recurring schedule rule from confirmed occurrences. Handle DST, midnight-crossing shows, cancellations, postponed events, and booking cutoffs. Never generate a 'confirmed' occurrence from a general weekly schedule without adequate evidence.

## Authorization
Roles: global_admin, market_manager, reviewer, venue_operator, end_user. Market-scoped authorization and venue-claim verification. Separate admin data and consumer published read model. No leaking private user queries to venues.

## Architecture and scale
Modular monolith for MVP (Next.js/TypeScript + Postgres/PostGIS); queue-backed workers with idempotency keys and dead-letter handling; per-market provider rate limits, quotas and cost dashboards. Geospatial indexes, pagination and selective caching. Avoid separate city deployments until residency, scale or resilience require them.

## Second-market test
Dubai (Asia/Dubai, AED, ar/en) and Cairo (Africa/Cairo, EGP, ar/en). Verify both in the same DB; independent source configs, local event times, Arabic search, FX-aware budgets, permissions and scheduled jobs. Future markets require configuration, not core-code forks.

## Acceptance gates
Create a market via API/admin; search returns only appropriate geo coverage; city switching preserves preferences; independent ingestion; locale-aware formatting; multi-market test suite passes; no hardcoded 'Dubai', 'AED' or timezone in shared business logic.
