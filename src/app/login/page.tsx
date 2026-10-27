import { redirect } from 'next/navigation';

import { signIn } from '@/modules/auth/actions';
import { currentUser } from '@/modules/auth/session';

/**
 * Reviewer sign-in.
 *
 * The admin surface is single-language on purpose: it is internal tooling for a
 * named handful of reviewers, and a half-translated review queue is worse than
 * an untranslated one. The consumer-facing pages stay fully localised from
 * market_locales (ADR-012) — this page is not one of them.
 */

const MESSAGES: Record<string, string> = {
  invalid: 'Enter an email address and a password.',
  refused: 'Those credentials were not accepted.',
};

export const metadata = { title: 'Sign in · Where to Go' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const user = await currentUser();
  if (user) redirect('/admin');

  const errorCode = typeof params.error === 'string' ? params.error : undefined;
  const error = errorCode ? MESSAGES[errorCode] : undefined;
  const next = typeof params.next === 'string' ? params.next : undefined;

  return (
    <main className="mx-auto max-w-sm px-6 py-20" lang="en" dir="ltr">
      <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Where to Go</h1>
      <p className="mt-1 text-sm text-neutral-600">Reviewer sign-in</p>

      {error ? (
        <p
          role="alert"
          className="mt-6 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </p>
      ) : null}

      <form action={signIn} className="mt-8 space-y-4">
        {/* Carried through the failure redirect so a deep link survives a typo. */}
        {next ? <input type="hidden" name="next" value={next} /> : null}

        <div>
          <label htmlFor="email" className="block text-sm font-medium text-neutral-800">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-neutral-800">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
          />
        </div>

        <button
          type="submit"
          className="w-full rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
        >
          Sign in
        </button>
      </form>

      <p className="mt-8 text-xs text-neutral-500">
        Accounts are issued by an administrator. There is no self-service sign-up and no password
        reset here.
      </p>
    </main>
  );
}
