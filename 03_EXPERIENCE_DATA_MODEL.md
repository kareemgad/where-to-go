# Experience Intelligence Layer | Canonical Data Specification

## Central distinction
A **venue** is a stable place; an **experience occurrence** is what is happening there during a defined window. A **claim** is a sourced assertion about either. An **observation** is a time-stamped report, not necessarily verified truth.

## Entities
- `venues`: id, name, slug, geo point/area, address, timezone, status, website, contact, accessibility, policies, cuisines, created_at, updated_at.
- `venue_spaces`: id, venue_id, name, indoor_outdoor, seating_types, approximate_capacity, lighting_profile, acoustic_profile.
- `events`: id, venue_id, space_id nullable, title, description, genre tags, performance_type (live_band/DJ/piano/open_mic/etc), artist, start_at, end_at, recurrence_rule nullable, status, admission/cover charge.
- `experience_profiles`: venue_id or event_id, energy 1–5, conversation_friendliness 1–5, lighting 1–5, seating_comfort 1–5, noise_band (quiet/moderate/loud/unknown), confidence, valid_from/to.
- `price_estimates`: scope, currency AED, low, high, inclusions, per_person boolean, source_id, observed_at, valid_until.
- `sources`: source_id, origin_type (venue_verified/admin_verified/visitor_report/authorized_feed/AI_extracted), original_url, publisher, observed_at, rights_basis, license_notes.
- `claims`: subject_type/id, field, value_json, source_id, verification_state, reviewed_by, reviewed_at, expires_at, confidence, supersedes_claim_id.
- `users`, `preferences`, `favorites`, `interest_follows`, `venue_memberships`, `booking_handoffs`, `feedback`, `audit_events`.

## Example event (illustrative only, NOT a real listing)
```json
{
  "venue_id": "example-venue-uuid",
  "title": "Live Arabic Jazz",
  "start_at": "2026-11-05T20:00:00+04:00",
  "end_at": "2026-11-05T23:00:00+04:00",
  "genre_tags": ["arabic", "jazz"],
  "performance_type": "live_band",
  "verification_state": "venue_verified",
  "source_id": "example-source-uuid"
}
```

## Time, provenance and uncertainty
All timestamps stored UTC; display Asia/Dubai. A venue's recurring programme is not evidence that a performance occurs on a specific date until an occurrence is materialized and verified. Use confidence per attribute, not a misleading global 'AI confidence'. Do not derive visitor age distribution from appearance or personal profiles. Optional self-reported preferences must not be used to infer protected characteristics.

## Ranking specification v0
1. Apply explicit hard constraints and permission checks.
2. Candidate selection by date, location and supported category.
3. Weighted soft-score (initial tunable defaults): music 30%, atmosphere 25%, budget fit 20%, distance 10%, seating/access preference 10%, freshness 5%. Missing attributes are not scored as positive; record unknowns.
4. Penalize stale/unverified event evidence; do not fabricate events.
5. Return why-match and trade-off fields. Log ranking version for reproducibility.
6. Sponsorship, when introduced, is a separate labeled placement rule after eligibility filtering.

## Data quality lifecycle
Discovered → pending review → verified/published → review due → expired/archived. Capture source, rights, reviewer, change history and expiry. Venue managers can propose corrections. Visitors can flag stale listings. Automatically expire past event occurrences.

## Data sourcing policy
Use venue-submitted content, authorized APIs/feeds, manually verified public facts and permitted linking. Do not assume permission to scrape Instagram/TikTok/Facebook or republish photos. Store third-party media only with appropriate license/permission. Maintain takedown and correction process.
