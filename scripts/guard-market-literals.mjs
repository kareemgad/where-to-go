#!/usr/bin/env node
/**
 * T15 — fail the build if a market-specific literal appears in shared logic.
 *
 * ADR-009 makes currency, timezone and locale market configuration rather than
 * constants. That decision is only real if it is enforced, because the failure
 * mode is silent: code that reads correctly today quietly breaks Cairo, and the
 * `10`/`16` acceptance gate catches it only once someone runs the second-market
 * suite. This catches it at commit time instead.
 *
 * Data files are exempt. A market record is *supposed* to say "AED" and
 * "Asia/Dubai" — that is the configuration. The money module's minor-unit table
 * is likewise supposed to name currencies. Everything else is business logic.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const SCAN_ROOTS = ['src'];

/** Paths where market literals are the legitimate payload, not a leak. */
const EXEMPT_FILE_PATTERN = /\.(test|spec)\.[cm]?tsx?$/;

const EXEMPT_PATHS = [
  'src/db/seed',
  'src/lib/money.ts', // ISO 4217 minor-unit exponent table
  'src/lib/time.ts', // IANA zone validation helpers, not market defaults
];

const FORBIDDEN = [
  {
    pattern: /\b(?:Dubai|Cairo)\b/gi,
    why: 'market name — resolve the market from market_id or the route segment',
  },
  {
    pattern: /\b(?:AED|EGP|SAR|QAR|KWD|BHD|OMR)\b/g,
    why: 'currency code — read it from the market record (ADR-009)',
  },
  {
    pattern: /\b(?:Asia\/Dubai|Africa\/Cairo)\b/gi,
    why: 'IANA timezone — read it from the venue or market record',
  },
  {
    pattern: /['"`](?:en|ar)-[A-Z]{2}['"`]/g,
    why: 'locale tag — pass the BCP 47 tag from market_locales, never a literal',
  },
  {
    pattern: /budget_max_aed|budgetMaxAed/gi,
    why: 'currency-suffixed field name — superseded by { amountMinor, currency }',
  },
];

const EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.jsx']);

function toPosix(p) {
  return p.split(sep).join('/');
}

function isExempt(relPath) {
  const posix = toPosix(relPath);
  return EXEMPT_PATHS.some((e) => posix === e || posix.startsWith(`${e}/`));
}

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      yield* walk(full);
    } else if (EXTENSIONS.has(entry.slice(entry.lastIndexOf('.')))) {
      yield full;
    }
  }
}

const violations = [];

for (const scanRoot of SCAN_ROOTS) {
  for (const file of walk(join(ROOT, scanRoot))) {
    const relPath = relative(ROOT, file);
    if (isExempt(relPath) || EXEMPT_FILE_PATTERN.test(relPath)) continue;

    const source = readFileSync(file, 'utf8');
    const lines = source.split(/\r?\n/);

    for (const { pattern, why } of FORBIDDEN) {
      lines.forEach((line, index) => {
        // Skip comments: prose explaining the rule is not a breach of it.
        const stripped = line.trim();
        if (stripped.startsWith('//') || stripped.startsWith('*') || stripped.startsWith('/*')) {
          return;
        }
        pattern.lastIndex = 0;
        const match = pattern.exec(line);
        if (match) {
          violations.push({
            file: toPosix(relPath),
            line: index + 1,
            text: match[0],
            why,
            source: stripped,
          });
        }
      });
    }
  }
}

if (violations.length === 0) {
  console.log('guard:market — no market literals in shared logic.');
  process.exit(0);
}

console.error(
  `\nguard:market — ${violations.length} market literal${violations.length === 1 ? '' : 's'} in shared logic.\n` +
    `ADR-009: currency, timezone and locale are market configuration, not constants.\n`,
);

for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  "${v.text}"`);
  console.error(`      ${v.why}`);
  console.error(`      ${v.source.length > 100 ? `${v.source.slice(0, 100)}…` : v.source}\n`);
}

console.error(
  `If a literal genuinely belongs in a data file, add that path to EXEMPT_PATHS in\n` +
    `scripts/guard-market-literals.mjs with a comment saying why.\n`,
);

process.exit(1);
