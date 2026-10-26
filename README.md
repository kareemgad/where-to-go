# Where to Go | Claude Project + Claude Code Starter Pack v2

**Mission:** A multi-market experience discovery platform: *Find your kind of night.* Dubai is the pilot, never a hardcoded boundary.

## Quick start
1. Read `00_START_HERE.md`, `01_PRODUCT_BRIEF.md`, `02_PRD.md`, `10_GLOBAL_MARKET_ARCHITECTURE.md`, `11_VENUE_INTELLIGENCE_AGENTS.md`, and `12_DATA_RIGHTS_AND_VERIFICATION.md`.
2. Create a Claude Project named **Where to Go**. Upload the Markdown documents under this package (or a selection of the product documents) as Project knowledge. Paste `prompts/01_PROJECT_KICKOFF.md` into a new conversation. Ask for a decision brief first, not code.
3. Unzip this folder into a local Git repository. Keep `CLAUDE.md` at repository root. Launch Claude Code from that root. Use `prompts/02_CODE_PLANNING.md`, review and approve architecture decisions, then `prompts/03_FOUNDATION.md`.
4. Run subsequent numbered prompts one at a time. Require tests and an implementation report after each.
5. Do not turn on live crawling, paid API usage, outreach, notifications, or public publishing until separately approved.

## Source of truth and document priority
`CLAUDE.md` operational rules > `09_DECISION_LOG.md` approved decisions > numbered specifications > illustrative examples. Resolve contradictions by presenting them for approval; never silently assume.

## What is already decided
- Global platform with city-by-city launch; Dubai first; Cairo as a second-market fixture.
- Evidence-backed recommendations; no invented event dates, prices, or availability.
- Human review for uncertain claims; source and licensing compliance.
- Responsive web MVP; avoid native apps, ticketing, or complex social networking initially.

## What remains open
Deployment provider, auth, maps, approved data vendors, permitted storage rights, market launch order, spend caps, design identity, and exact monetization experiments.

## Deliverables index
- `01`–`09`: original business, PRD, data, architecture, delivery, operations, tests and decisions; refined in v2 where required.
- `10`–`16`: global market design, collection agents, rights, UX, APIs, engineering plan, acceptance criteria.
- `prompts/`: ordered Claude Project and Claude Code prompts.
- `schemas/`: illustrative typed data contracts.
- `fixtures/`: fictional test data; never display as real venues.
