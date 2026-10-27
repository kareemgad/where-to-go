'use server';

/**
 * Sign-in and sign-out.
 *
 * Accounts are created in the Supabase dashboard, never here. This repository
 * holds no sign-up route and no password-reset flow on purpose: both would mean
 * handling credentials and sending mail, and neither is needed to review a
 * queue. The password goes straight from the form to Supabase and is never
 * logged, stored or echoed back.
 */

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { serverAuthClient } from './supabase';

const credentials = z.object({
  email: z.string().trim().min(1, 'Email is required').email('That is not an email address'),
  password: z.string().min(1, 'Password is required'),
});

/** Any absolute origin; only used to resolve a relative path against. */
const SENTINEL_ORIGIN = 'https://where-to-go.invalid';

/**
 * A post-login destination, or the admin home.
 *
 * Resolved against a sentinel origin rather than pattern-matched. A leading
 * slash is not enough: "//evil.example" is a path to a naive check and an open
 * redirect to the browser, and some browsers normalise backslash variants into
 * the same thing. Anything that resolves off this origin is discarded.
 */
function safeDestination(raw: FormDataEntryValue | null): string {
  if (typeof raw !== 'string' || !raw.startsWith('/')) return '/admin';
  try {
    const resolved = new URL(raw, SENTINEL_ORIGIN);
    if (resolved.origin !== SENTINEL_ORIGIN) return '/admin';
    return resolved.pathname + resolved.search;
  } catch {
    return '/admin';
  }
}

/**
 * Failures come back as a redirect rather than returned state, so the form
 * needs no client JavaScript — the same choice the search form makes. The
 * email is not echoed into the query string: it is personal data, and URLs end
 * up in logs, history and referrers.
 */
function rejected(destination: string, code: 'invalid' | 'refused'): never {
  const back = new URL('/login', SENTINEL_ORIGIN);
  back.searchParams.set('error', code);
  if (destination !== '/admin') back.searchParams.set('next', destination);
  redirect(back.pathname + back.search);
}

export async function signIn(form: FormData): Promise<void> {
  const destination = safeDestination(form.get('next'));

  const parsed = credentials.safeParse({
    email: form.get('email'),
    password: form.get('password'),
  });
  if (!parsed.success) rejected(destination, 'invalid');

  const supabase = await serverAuthClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  // Deliberately not "no such user" versus "wrong password". The distinction
  // turns the form into an account-enumeration oracle.
  if (error) rejected(destination, 'refused');

  redirect(destination);
}

export async function signOut(): Promise<never> {
  const supabase = await serverAuthClient();
  await supabase.auth.signOut();
  redirect('/login');
}
