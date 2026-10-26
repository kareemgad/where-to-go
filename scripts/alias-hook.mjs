/**
 * Resolve the "@/..." path alias when running TypeScript directly in Node.
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
 */

import { existsSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC_URL = pathToFileURL(`${resolvePath(process.cwd(), 'src')}/`).href;
const EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.mjs'];

export function resolve(specifier, context, next) {
  if (!specifier.startsWith('@/')) {
    return next(specifier, context);
  }

  const base = new URL(specifier.slice(2), SRC_URL);

  // Already carries an extension that exists on disk.
  if (existsSync(fileURLToPath(base))) {
    return next(base.href, context);
  }

  for (const extension of EXTENSIONS) {
    const candidate = new URL(`${base.href}${extension}`);
    if (existsSync(fileURLToPath(candidate))) {
      return next(candidate.href, context);
    }
  }

  // index files, for a directory import.
  for (const extension of EXTENSIONS) {
    const candidate = new URL(`${base.href}/index${extension}`);
    if (existsSync(fileURLToPath(candidate))) {
      return next(candidate.href, context);
    }
  }

  throw new Error(
    `alias-hook: could not resolve "${specifier}" under ${SRC_URL}. ` +
      `Tried ${EXTENSIONS.join(', ')} and index files.`,
  );
}
