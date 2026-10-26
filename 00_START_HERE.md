# Start Here

## Product thesis
People select **experiences**, not just places. Match users with venue + scheduled event + atmosphere + company + time + budget, using evidence-backed information and explainable ranking.

## Scope
Pilot in Dubai with 50–100 curated candidate venues; second market Cairo as a technical test. Global-first entities and locale-aware search. Live music and social dining are the first vertical.

## Development sequence
0. Product/architecture decisions and licensing review.
1. Global data model and synthetic fixtures.
2. End-to-end search and explainable recommendation vertical slice.
3. Admin review and provenance workflows.
4. One authorized source adapter and one venue extraction flow.
5. Market activation and independent jobs.
6. Pilot with verified live records only after approval.

## Working rules
- Ask for a plan before broad edits; one milestone at a time.
- Never confuse a venue's general music offering with a confirmed performance on a specific date.
- Clearly mark unknown, estimated, source-claimed, and independently verified values.
- Every feature must be tested across Dubai and Cairo synthetic fixtures.
- Avoid overengineering: logical multi-tenancy now, regional deployment only when justified.

## First prompts
1. In Claude Project: `prompts/01_PROJECT_KICKOFF.md`.
2. In Claude Code plan mode: `prompts/02_CODE_PLANNING.md`.
3. After approval: `prompts/03_FOUNDATION.md`.
