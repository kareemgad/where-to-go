#!/usr/bin/env node
/**
 * Compares the TypeScript confidence label against the SQL one across every
 * combination of the three state axes.
 *
 *   node --env-file-if-exists=.env.local scripts/verify-confidence-parity.ts
 *
 * Two implementations of one rule drift. That is not a hypothetical: the UI
 * calls the TypeScript version and the publishable_occurrences view calls the
 * SQL one, so a divergence shows up as the page claiming something is verified
 * while the database disagrees — exactly the confusion ADR-005 exists to
 * prevent. 9 x 7 x 5 = 315 combinations, checked exhaustively, because a
 * sampled check would miss precisely the odd corner that drifts.
 *
 * Run by `npm run db:verify`. Node runs this .ts file directly by stripping
 * types, so there is no build step.
 */

import postgres from 'postgres';

import {
  CLAIM_LIFECYCLE_STATES,
  EVIDENCE_STATES,
  SOURCE_AUTHORITIES,
  confidenceLabel,
} from '../src/modules/evidence/confidence.ts';

if (!process.env.DIRECT_URL) {
  console.error('DIRECT_URL is not set.');
  process.exit(1);
}

const sql = postgres(process.env.DIRECT_URL, {
  max: 1,
  idle_timeout: 5,
  connect_timeout: 15,
  onnotice: () => {},
});

interface Combination {
  lifecycle: string;
  evidence: string;
  authority: string;
  expected: string;
}

const combinations: Combination[] = [];
for (const lifecycle of CLAIM_LIFECYCLE_STATES) {
  for (const evidence of EVIDENCE_STATES) {
    for (const authority of SOURCE_AUTHORITIES) {
      combinations.push({
        lifecycle,
        evidence,
        authority,
        expected: confidenceLabel(lifecycle, evidence, authority),
      });
    }
  }
}

try {
  // One round trip for all 315: build a VALUES list and let the database label
  // every row with its own function.
  const rows = await sql`
    select
      t.lifecycle,
      t.evidence,
      t.authority,
      app_confidence_label(
        t.lifecycle::claim_lifecycle_state,
        t.evidence::evidence_state,
        t.authority::source_authority
      ) as sql_label
    from (
      values ${sql(
        combinations.map((c) => [c.lifecycle, c.evidence, c.authority] as const),
      )}
    ) as t(lifecycle, evidence, authority)
  `;

  if (rows.length !== combinations.length) {
    throw new Error(`expected ${combinations.length} rows from SQL, got ${rows.length}`);
  }

  const bySignature = new Map<string, string>();
  for (const row of rows) {
    bySignature.set(`${row.lifecycle}|${row.evidence}|${row.authority}`, row.sql_label);
  }

  const mismatches: string[] = [];
  for (const c of combinations) {
    const signature = `${c.lifecycle}|${c.evidence}|${c.authority}`;
    const sqlLabel = bySignature.get(signature);
    if (sqlLabel !== c.expected) {
      mismatches.push(`  ${signature}\n      ts: ${c.expected}\n     sql: ${sqlLabel}`);
    }
  }

  const labelCounts = new Map<string, number>();
  for (const c of combinations) {
    labelCounts.set(c.expected, (labelCounts.get(c.expected) ?? 0) + 1);
  }

  console.log(`confidence label parity — ${combinations.length} combinations checked`);
  console.log(
    `  distribution: ${[...labelCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, n]) => `${label}=${n}`)
      .join(' ')}`,
  );

  if (mismatches.length > 0) {
    console.error(`\n${mismatches.length} MISMATCH(ES) between TypeScript and SQL:\n`);
    console.error(mismatches.join('\n'));
    console.error(
      '\nOne rule, two implementations. Fix both src/modules/evidence/confidence.ts\n' +
        'and app_confidence_label, keeping the clause order identical.\n',
    );
    process.exitCode = 1;
  } else {
    console.log('\nOK — TypeScript and SQL agree on every combination.');
  }
} catch (error) {
  console.error(`\nParity check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
