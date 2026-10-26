# Acceptance Tests, KPIs, Risks

## Product acceptance scenarios
1. Dubai, friends, live jazz, AED 150–300, specific Friday: results only if evidence supports that date; unknown music schedule is disclosed.
2. Dubai, quiet conversation hard constraint: exclude high-noise verified venues; unknowns flagged.
3. Cairo Arabic query, EGP budget, local event time: correct RTL, timezone, search and currency.
4. Venue crosses market boundary: no duplicate canonical venue; geographic inclusion policy documented.
5. Conflicting official event times: queue for review, no fabricated resolution.
6. Expired event and cancellation: no active event recommendation; audit preserved.
7. Operator edits venue outside assigned market: denied and logged.
8. Provider terms prohibit caching: prohibited fields are not persisted in canonical DB.
9. Source unavailable: graceful degraded results with freshness warning.
10. Sponsored venue fails hard filter: never promoted as suitable.

## Pilot metrics (targets to validate, not promises)
Usable profiles >= 60% of seeded candidates; evidence attribution on 100% of published factual claims; critical event errors < 5% in manually audited sample; reviewer effort tracked; repeat discovery usage; search-to-detail and detail-to-booking-handoff conversions; per-venue monthly cost.

## Key risks
Provider licensing, untrusted social content, duplicate identities, poor event freshness, inflated AI confidence, review burden, cost runaway, privacy, country-specific regulation, supply-side incentives and low consumer retention.

## Gates
No public launch until approved legal/privacy review, source rights audit, accessibility testing, representative human accuracy sample, operational monitoring and incident/rollback plan.
