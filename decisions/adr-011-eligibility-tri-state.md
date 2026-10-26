# ADR-011 | Eligibility tri-state and unknown-data display

- **Question:** How are candidates treated when a hard constraint cannot be evaluated? Resolves conflict C5.
- **Alternatives:** (a) Tri-state `eligible | needs_confirmation | excluded`, with the middle state in a separate section collapsed by default and excluded from the shortlist count. (b) Interleave uncertain candidates into the ranked list. (c) Hard-exclude anything unproven.
- **Decision:** (a).
- **Rationale:** `07` groups a known range overlapping the ceiling together with a price nobody has evidence for; these are different failures and are now distinguished. `13` requires unknown hard-constraint data to either exclude or appear as "needs confirmation" under explicit user control. (b) inflates perceived coverage and silently drops hard constraints; (c) discards good candidates with thin data, which early on is most of them. Unknown is never silently a pass. Also closes gap G2: the ceiling gates eligibility, while the 20% soft weight scores position *within* the user's stated range.
- **Owner:** Kareem Gad · **Date:** 2026-10-26 · **Status:** Approved
- **Revisit trigger:** User testing showing the collapsed section is either ignored or misread as rejection.
