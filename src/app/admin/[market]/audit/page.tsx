import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { db } from '@/db/client';
import { reviewAccess } from '@/modules/auth/session';
import { auditTrail } from '@/modules/review/queries';
import {
  AccessDenied,
  AdminHeader,
  MarketTabs,
  StateBadge,
} from '../../_components/chrome';

export const metadata = { title: 'Audit trail · Where to Go' };

const TONES = {
  decision: 'neutral',
  publication: 'good',
  rollback: 'warn',
} as const;

export default async function AuditPage({ params }: { params: Promise<{ market: string }> }) {
  const { market: slug } = await params;

  const sql = db();
  const access = await reviewAccess(sql, slug);
  if (!access.ok) {
    if (access.status === 'unauthenticated') redirect(`/login?next=/admin/${slug}/audit`);
    if (access.status === 'no_such_market') notFound();
    return <AccessDenied reason={`You hold no reviewer role for ${slug}.`} />;
  }

  const { user, market } = access;
  const entries = await auditTrail(sql, market.id);

  return (
    <>
      <AdminHeader email={user.email} />
      <main className="mx-auto max-w-5xl px-6 py-10" lang="en" dir="ltr">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          {market.referenceName}
        </h1>
        <p className="mt-1 text-sm text-neutral-600">
          Every decision, publication and rollback in this market, newest first. Append-only: a
          version is superseded or withdrawn, never deleted.
        </p>

        <MarketTabs slug={market.slug} active="audit" />

        {entries.length === 0 ? (
          <p className="mt-8 rounded-lg border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
            Nothing has been decided or published in this market yet.
          </p>
        ) : (
          <ul className="mt-8 divide-y divide-neutral-200 border-y border-neutral-200">
            {entries.map((entry, index) => (
              <li
                key={`${entry.kind}-${entry.at.toISOString()}-${entry.attributeKey}-${index}`}
                className="py-3"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-xs text-neutral-500">
                    {entry.at.toISOString().slice(0, 16).replace('T', ' ')}Z
                  </span>
                  <StateBadge label={entry.kind} tone={TONES[entry.kind]} />
                  <span className="font-mono text-xs text-neutral-800">{entry.attributeKey}</span>
                  {entry.claimId ? (
                    <Link
                      href={`/admin/${market.slug}/queue/${entry.claimId}`}
                      className="text-xs text-neutral-600 underline"
                    >
                      claim
                    </Link>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-neutral-800">
                  {entry.subjectLabel ?? 'subject no longer resolvable'} — {entry.detail}
                </p>
                <p className="mt-0.5 text-xs text-neutral-500">
                  {/* A null actor is a system action, not an anonymous person:
                      the retirement job and the seed both publish without one. */}
                  {entry.actorEmail ?? (entry.actorId ? entry.actorId : 'system, no reviewer')}
                </p>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
