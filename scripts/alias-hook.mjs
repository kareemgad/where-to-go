/**
 * Resolve the "@/..." path alias, and extensionless relative imports, when
 * running TypeScript directly in Node.
 *
 * The alias is configured in tsconfig for the editor and the Next.js build, and
 * in vitest.config.mts for tests. Plain Node knows nothing about either, so the
 * seeder and the demo script — which import the same application modules the
 * app uses, deliberately, so they exercise real code rather than a copy — need
 * this hook.
 *
 * The alternative was relative imports with explicit .ts extensions throughout
 * src, which plain Node accepts but bundlers treat inconsistently. One small
 * hook in the two scripts that need it is the narrower change.
 *
 * Relative specifiers need the same treatment, and only became visible when a
 * module first imported a *value* rather than a type from a sibling: a
 * type-only import is erased before Node ever sees it, so `from './types'`
 * resolved fine for as long as nothing concrete came through it.
 */

import { existsSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC_URL = pathToFileURL(`${resolvePath(process.cwd(), 'src')}/`).href;
const EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.mjs'];

/** The first candidate that exists on disk, or null. */
function firstExisting(base) {
  if (existsSync(fileURLToPath(base))) return base;
  for (const extension of EXTENSIONS) {
    const candidate = new URL(`${base.href}${extension}`);
    if (existsSync(fileURLToPath(candidate))) return candidate;
  }
  for (const extension of EXTENSIONS) {
    const candidate = new URL(`${base.href}/index${extension}`);
    if (existsSync(fileURLToPath(candidate))) return candidate;
  }
  return null;
}

export function resolve(specifier, context, next) {
  // Extensionless relative imports inside src, resolved against the importer.
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
    const found = firstExisting(new URL(specifier, context.parentURL));
    if (found) return next(found.href, context);
    return next(specifier, context);
  }

  if (!specifier.startsWith('@/')) {
    return next(specifier, context);
  }

  const base = new URL(specifier.slice(2), SRC_URL);

  const found = firstExisting(base);
  if (found) return next(found.href, context);

  throw new Error(
    `alias-hook: could not resolve "${specifier}" under ${SRC_URL}. ` +
      `Tried ${EXTENSIONS.join(', ')} and index files.`,
  );
}
