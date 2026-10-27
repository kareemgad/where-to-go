/**
 * Supabase Auth clients.
 *
 * Authentication only. The app reads and writes data through the pooled
 * Postgres connection in src/db/client.ts, not through supabase-js, so this
 * module exists to answer one question: who is making this request.
 *
 * Deliberately split from authorization. Supabase tells us the request carries
 * a valid session for user X; whether X may do anything is decided in
 * src/modules/auth/session.ts against role_assignments (ADR-002).
 */

import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

interface SupabaseEnv {
  readonly url: string;
  readonly anonKey: string;
}

export function supabaseEnv(): SupabaseEnv {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set. ' +
        'See .env.example.',
    );
  }
  return { url, anonKey };
}

/**
 * Request-scoped client backed by the session cookies.
 *
 * The anon key is used, never the service role key: a mistake here must not be
 * able to bypass row-level security. Session cookies carry the user's own JWT,
 * so this client can only ever see what that user is allowed to see.
 */
export async function serverAuthClient(): Promise<SupabaseClient> {
  const { url, anonKey } = supabaseEnv();
  const store = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) {
            store.set(name, value, options);
          }
        } catch {
          // A Server Component cannot set cookies. That is expected and not an
          // error: the middleware has already refreshed the session for this
          // request, so the tokens here are current either way. Throwing would
          // turn every authenticated page render into a 500.
        }
      },
    },
  });
}
