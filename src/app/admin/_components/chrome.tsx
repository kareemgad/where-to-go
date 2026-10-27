import Link from 'next/link';
import type { ReactNode } from 'react';

import { signOut } from '@/modules/auth/actions';

/**
 * Shared admin chrome.
 *
 * Single-language by design: this is internal tooling for a named handful of
 * reviewers, and a half-translated review queue is harder to work than an
 * untranslated one. Consumer pages stay fully localised from market_locales
 * (ADR-012); nothing here is one of them.
 */

export function AdminHeader({ email }: { email?: string | null }) {
  return (
    <header className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <Link href="/admin" className="text-sm font-semibold text-neutral-900">
          Where to Go · review
        </Link>
        <div className="flex items-center gap-4 text-xs text-neutral-600">
          {email ? <span className="font-mono">{email}</span> : null}
          <form action={signOut}>
            <button
              type="submit"
              className="rounded border border-neutral-300 px-2 py-1 transition hover:border-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}

export function MarketTabs({ slug, active }: { slug: string; active: 'queue' | 'published' | 'audit' }) {
  const tabs = [
    { key: 'queue' as const, href: `/admin/${slug}/queue`, label: 'Queue' },
    { key: 'published' as const, href: `/admin/${slug}/published`, label: 'Published' },
    { key: 'audit' as const, href: `/admin/${slug}/audit`, label: 'Audit trail' },
  ];
  return (
    <nav className="mt-6 flex gap-1 border-b border-neutral-200" aria-label="Market sections">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === active ? 'page' : undefined}
          className={
            tab.key === active
              ? '-mb-px border-b-2 border-neutral-900 px-3 py-2 text-sm font-medium text-neutral-900'
              : '-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-neutral-600 transition hover:text-neutral-900'
          }
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

/** Explains a refusal without naming what is behind it. */
export function AccessDenied({ reason }: { reason: string }) {
  return (
    <main className="mx-auto max-w-xl px-6 py-20" lang="en">
      <h1 className="text-xl font-semibold text-neutral-900">Not available to you</h1>
      <p className="mt-3 text-sm text-neutral-700">{reason}</p>
      <p className="mt-6 text-xs text-neutral-500">
        The attempt has been recorded. If you should have access, ask an administrator to grant you
        a reviewer role for this market.
      </p>
      <Link
        href="/admin"
        className="mt-6 inline-block rounded-lg border border-neutral-300 px-4 py-2 text-sm transition hover:border-neutral-900"
      >
        Back to your markets
      </Link>
    </main>
  );
}

const STATUS_MESSAGES: Record<string, { tone: 'good' | 'warn' | 'bad'; text: string }> = {
  published: { tone: 'good', text: 'Approved and published. The read model has been updated.' },
  edited: { tone: 'good', text: 'Your correction was published as a new editor-checked claim.' },
  rejected: { tone: 'good', text: 'Rejected, with your reason on the record.' },
  rolled_back: {
    tone: 'good',
    text: 'The live version was withdrawn and the previous one reinstated.',
  },
  conflict: {
    tone: 'warn',
    text:
      'Credible sources disagree, so nothing was published. Both claims are now in the queue — ' +
      'the system will not choose between them.',
  },
  needs_review: {
    tone: 'warn',
    text: 'This attribute is high-impact and still needs a recorded decision before it can publish.',
  },
  not_publishable: {
    tone: 'warn',
    text: 'The claim is not in a publishable state. Its current state is shown below.',
  },
  invalid: { tone: 'bad', text: 'That submission was incomplete. Nothing was changed.' },
  not_found: { tone: 'bad', text: 'That claim no longer exists.' },
  forbidden: { tone: 'bad', text: 'You may not review that market. The attempt was recorded.' },
};

const TONES = {
  good: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  warn: 'border-amber-300 bg-amber-50 text-amber-900',
  bad: 'border-red-300 bg-red-50 text-red-900',
} as const;

export function StatusBanner({ code }: { code?: string | undefined }) {
  if (!code) return null;
  const message = STATUS_MESSAGES[code];
  if (!message) return null;
  return (
    <p role="status" className={`mt-6 rounded-lg border px-4 py-3 text-sm ${TONES[message.tone]}`}>
      {message.text}
    </p>
  );
}

/**
 * A claim value, shown as the JSON it is.
 *
 * Deliberately not prettified into prose. A reviewer deciding whether to
 * publish a value needs to see exactly what will be stored, including the
 * difference between 150 and "150".
 */
export function JsonValue({ value }: { value: unknown }) {
  return (
    <pre className="overflow-x-auto rounded border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono text-xs text-neutral-800">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

const BADGE = 'rounded px-1.5 py-0.5 font-mono text-[11px]';

export function StateBadge({ label, tone }: { label: string; tone: 'neutral' | 'warn' | 'good' }) {
  const classes = {
    neutral: 'bg-neutral-100 text-neutral-700',
    warn: 'bg-amber-100 text-amber-900',
    good: 'bg-emerald-100 text-emerald-900',
  } as const;
  return <span className={`${BADGE} ${classes[tone]}`}>{label}</span>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className="mt-1 text-sm text-neutral-900">{children}</dd>
    </div>
  );
}
