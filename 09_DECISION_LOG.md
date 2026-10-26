# Decisions and Open Questions

## Approved direction (from product discussion)
- Product: Where to Go — Find your kind of night.
- Global platform, city-by-city rollout; Dubai first, Cairo second-market test.
- Focus: live music and social dining experiences; date-specific atmosphere and explainable matching.
- Agentic data collection with provenance, verification and human review.
- Web-first MVP; no forced paid listing to appear in discovery.

## Proposed, awaiting explicit approval
- Next.js + TypeScript + PostgreSQL/PostGIS stack.
- Hosting, auth, maps and queue providers.
- Specific source connectors and licenses.
- Pilot size, cost limits, staffing and legal/privacy approach.
- Detailed UI identity, target audience, operator pricing and success thresholds.

## ADR template
ID | Question | Alternatives | Decision | Rationale | Owner | Date | Status | Revisit trigger.

## Stop rules
Do not interpret illustrative examples as approved commercial or engineering commitments. Record tradeoffs and ask before proceeding when material.

## 2026-10-26 | Kickoff decision brief submitted
`17_KICKOFF_DECISION_BRIEF.md` delivered against `prompts/01_PROJECT_KICKOFF.md`. No code written; no ADR files created yet (they are created per decision at approval).

**Awaiting founder answers (brief §7):** Q1 stack/hosting and auth provider · Q2 spend ceiling · Q3 Arabic scope at pilot · Q4 rights posture for first connector · Q5 unknown/over-budget display policy.

**Resolved spec conflicts applied as defaults** (brief §2, reversible on objection): C1 currency/timezone are per-market, doc `03` superseded on AED and Asia/Dubai · C2 event series split from occurrence per doc `14` · C3 three orthogonal claim state axes plus a derived confidence label · C4 `venue_attested` never presented as independently verified · C6 market-scoped venue slugs · C7 single canonical market plus visibility rows · C8 availability removed from MVP filters · C9 doc `15`/`CLAUDE.md` govern over doc `05` on live-collection timing · C11 fixtures generated against a seeded clock.

**Open decisions pending approval:** D1–D8 in brief §3. Status for all: Proposed.

## 2026-10-26 | Decisions approved; build authorized
Founder ruling: **currency and timezone are parametrized, never hardcoded**; all other decisions approved as recommended, with the standing instruction to take the fastest path to a working prototype.

**ADRs recorded** in `decisions/`: 001 stack · 002 auth and database (Supabase, $0/month confirmed) · 003 location and maps (stubbed port) · 004 LLM provider (parse and explain only, mock fallback) · 005 verification model (three axes, derived label) · 006 ingestion rights (first-party only, licensed provider designed not enabled) · 007 deployment and residency (**residency review outstanding**) · 008 notifications (none in MVP) · 009 market parametrization · 010 series vs occurrence · 011 eligibility tri-state · 012 locale scope. All status Approved.

**Repository created** at project root, branch `main`, initial commit of the specification pack. No GitHub remote yet.

**Still outstanding, neither blocking the prototype:**
- Spend cap has no figure, so maps, geocoding and LLM remain stubbed behind ports and no key exists.
- Single-reviewer capacity (brief G5) remains an assumption, not a confirmed constraint.
- UAE and Egypt data residency unassessed (ADR-007); required before real personal data or public launch.

**Scope of the one-day prototype:** market/geo model, venues, series and occurrences, price points, a claims table with mandatory evidence anchor, both market fixtures, deterministic eligibility and ranking with explanations, venue detail and booking handoff. Deferred: admin review UI, operator dashboard, real auth, ingestion pipeline, natural-language parser.
