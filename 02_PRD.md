# Product Requirements Document (PRD) | MVP v0.1

## Personas
P1: planner organizing friends' evening. P2: spontaneous seeker searching tonight. P3: venue manager maintaining events. P4: operations editor verifying content. P5: platform admin.

## User journeys
1. Open landing page, choose date/time, companions, mood/music, spend per person, area and optional constraints.
2. See 3–5 ranked results with explanation, key trade-offs, source/freshness, estimated price band, event time and verification status.
3. Open venue/event detail; save/share; follow music interest; leave via booking link, WhatsApp or phone, clearly identified as external.
4. Return after visit for short structured feedback on noise, music, crowd, spend and listing accuracy.
5. Venue manager claims a venue (admin approval), updates static facts, creates events and submits changes for review.
6. Editor reviews extracted or venue-submitted facts, resolves conflicts and publishes verified records.

## Feature priority
### P0 must-have
- Public landing, responsive search/filter UI; date/time-aware queries; location by selected Dubai area (no precise GPS required).
- Structured venue/event profiles; per-event start/end time and local timezone.
- Deterministic eligibility filtering before ranking: date, budget, access constraints, family policy, availability *only if verified*.
- Ranked shortlist with explanations grounded in stored fields; empty-state alternatives.
- Venue and admin CRUD with role-based authorization and audit history.
- Provenance and verification state on important claims; scheduled expiration/review of stale event data.
- External reservation links; no false booking confirmation.
- Basic telemetry and privacy notice.

### P1 shortly after P0
- Natural-language query interpretation into structured filters, with visible editable chips and clarifying question when needed.
- Accounts, favorites, follows, optional weekly digest with consent and unsubscribe.
- Post-visit feedback, moderation and confidence aggregation.
- Event import from permitted partner feeds with human review.

### P2 later
- Group shortlist/voting; multi-language Arabic/English; personalization; operator analytics; sponsored inventory; transactional integrations.

## Search and matching rules
- Hard constraints are mandatory: venue open/active, event occurring in selected window if live performance requested, age/legal/access constraints, max price when verified; unknown price is labeled unknown and not guaranteed under budget.
- Soft preferences include music style, conversation friendliness, lighting, seating, food, energy and distance.
- Return explanations citing the underlying structured attributes; never fabricate current crowd demographics, live sound levels, schedules, prices or availability.
- For unknown data, show 'Not verified' and offer 'Check with venue'.
- Results may be empty. Provide nearby dates, budget adjustments or preference relaxation; never silently drop hard constraints.

## Sample acceptance criteria
AC01: A query for live music on Friday excludes venues with no confirmed Friday performance; alternatives may appear in a separate clearly labeled section.
AC02: A source with an event date in the past is never displayed as upcoming.
AC03: Each result explains at least two matched criteria and any meaningful mismatch or unknown.
AC04: Estimated spend displays range, currency, source, updated date and disclaimer; no invented exact prices.
AC05: A venue editor cannot modify another venue; unapproved changes cannot silently overwrite verified records.
AC06: External booking action does not claim booking success.
AC07: Opt-in marketing preferences can be changed and deleted.
AC08: Every visible performance has a timezone-aware date/time and source.
AC09: If no matching results, display why and suggest permissible changes.
AC10: Paid placement is labeled and cannot override hard filters.

## UX principles
Decision first, directory second; short interaction; editable filter chips; small explained shortlist; mobile-first; accessible contrast and keyboard controls; Arabic RTL planned in component architecture; clear distinction between confirmed and inferred data.

## Critical screens
Home/intent; results/map optional; venue detail; event detail; favorites; sign-in; venue dashboard; event editor; admin moderation; data provenance/audit.

## Notifications
Not required for first vertical slice. Later: explicit opt-in per interest/date range; digest and unsubscribe; rate limits; time-bounded alerts that expire.
