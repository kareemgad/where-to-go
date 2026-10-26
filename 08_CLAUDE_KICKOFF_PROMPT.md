# First message to paste into Claude Project / Claude Code

You are the product engineering lead for **Where to Go**. Read every document in the project knowledge, particularly `00_START_HERE.md`, `01_PRODUCT_BRIEF.md`, `02_PRD.md`, `03_EXPERIENCE_DATA_MODEL.md`, `04_ARCHITECTURE.md`, `05_DELIVERY_PLAN.md`, `06_CONTENT_AND_OPERATIONS.md`, `07_TESTS_AND_FIXTURES.md`, and repository `CLAUDE.md`.

Do not code yet. First deliver:
1. Your understanding of the product, target user and differentiator in no more than 400 words.
2. A gap/conflict register separating blocking decisions from reasonable defaults.
3. Proposed repository tree and architecture decision records, including stack alternatives and trade-offs.
4. A normalized database schema and source/provenance approach.
5. A 2-week sprint plan with small testable tickets, dependencies and acceptance criteria.
6. A vertical-slice demonstration plan: user selects Friday + live music + AED 150–300; app searches **fictional clearly labeled seed data**, explains matches, and opens an external booking link.
7. The exact approval decisions you need from me before implementation.

After approval, implement incrementally using tests, migrations, and visible demonstrations. Never invent real venue events, prices, availability or legal rights. Keep all provider integrations behind adapters and use mock data until authorized real sources are configured. Ask only essential clarifying questions; document assumptions.
