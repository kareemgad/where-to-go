/**
 * Server-side database connection.
 *
 * Uses DATABASE_URL — the transaction pooler on 6543 — because that is what a
 * request-scoped web app wants. Prepared statements are disabled, as the
 * transaction pooler does not support them; migrations use DIRECT_URL instead
 * (see supabase/README.md).
 *
 * This module must never be imported from a client component. It reads a
 * server-only secret, and the connection is pooled per server instance rather
 * than per request.
 */

import postgres from 'postgres';
import type { Sql } from 'postgres';

declare global {
  // Reused across hot reloads in development, so a file change does not leak a
  // new pool on every save.
  // `var` is required for a global declaration; let/const do not augment globalThis.
  var __whereToGoSql: Sql | undefined;
}

function create(): Sql {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env.local and fill in the ' +
        'transaction pooler connection string (port 6543).',
    );
  }

  return postgres(url, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 15,
    // The transaction pooler multiplexes connections and cannot hold prepared
    // statements across them.
    prepare: false,
    onnotice: () => {},
  });
}

export function db(): Sql {
  if (process.env.NODE_ENV === 'production') {
    globalThis.__whereToGoSql ??= create();
    return globalThis.__whereToGoSql;
  }
  globalThis.__whereToGoSql ??= create();
  return globalThis.__whereToGoSql;
}
