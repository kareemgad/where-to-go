# Acceptance Test Scenarios and Fixtures

All names below are fictional test records. Do not render them as real Dubai recommendations.

1. `Jazz Loft Test`: live jazz Friday 20:00–23:00, AED 180–260, medium energy, conversation score 3/5, source venue-confirmed.
2. `Quiet Courtyard Test`: no live music Friday, AED 120–220, conversation score 5/5.
3. `Rock Stage Test`: live rock Friday, AED 220–350, loud, conversation 1/5.
4. `Unknown Price Test`: live Arabic music Friday, unknown spend, event verified.
5. `Expired Gig Test`: past Thursday event only, AED 200–250.

## Required assertions
- Friday live-jazz filter returns Jazz Loft, not Quiet Courtyard or Expired Gig.
- Max AED 300 strict budget does not guarantee Rock Stage or Unknown Price as within budget; can show separately with uncertainty label.
- Quiet conversation soft preference ranks suitable candidates higher but never invents sound measurements.
- Expired Gig cannot be shown as upcoming.
- AI parser output invalid date/price fails validation safely.
- Venue operator A cannot edit venue B; reviewer sees source and audit trail.
- Sponsored result cannot bypass event/date or budget constraints.
- No results leads to transparent suggestions, not fabricated matches.
- User data deletion removes personal preferences and follows subject to lawful retention.
