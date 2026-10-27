import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { db } from '@/db/client';
import { reviewAccess } from '@/modules/auth/session';
import { listQueueItems, queueSummary } from '@/modules/review/queries';
import {
  AccessDenied,
  AdminHeader,
  MarketTabs,
  StateBadge,
  StatusBanner,
} from '../../_components/chrome';

export const metadata = { title: 'Queue · Where to Go' };

export default async function QueuePage({
  params,
  searchParams,
}: {
  params: Promise<{ market: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { market: slug } = await params;
  const status = (await searchParams).status;

  const sql = db();
  // Authorization at the page, not only the layout: layouts and pages render
  // independently, so a layout check protects nothing the page then reads.
  const access = await reviewAccess(sql, slug);
  if (!access.ok) {
    if (access.status === 'unauthenticated') redirect(`/login?next=/admin/${slug}/queue`);
    if (access.status === 'no_such_market') notFound();
    return <AccessDenied reason={`You hold no reviewer role for ${slug}.`} />;
  }

  const { user, market } = access;
  const [items, summary] = await Promise.all([
    listQueueItems(sql, market.id),
    queueSummary(sql, market.id),
  ]);

  return (
    <>
      <AdminHeader email={user.email} />
      <main className="mx-auto max-w-5xl px-6 py-10" lang="en" dir="ltr">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          {market.referenceName}
        </h1>
        <p className="mt-1 text-sm text-neutral-600">
          {summary.total === 0
            ? 'Nothing is waiting for a decision.'
            : `${summary.total} claims awaiting a decision. Conflicts first, then high-impact attributes, then oldest observation.`}
        </p>

        <MarketTabs slug={market.slug} active="queue" />
        <StatusBanner code={typeof status === 'string' ? status : undefined} />

        {items.length === 0 ? (
          <p className="mt-8 rounded-lg border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
            The queue is empty. Claims appear here once they validate, or once two credible sources
            disagree.
          </p>
        ) : (
          <ul className="mt-8 divide-y divide-neutral-200 border-y border-neutral-200">
            {items.map((item) => (
              <li key={item.claimId}>
                <Link
                  href={`/admin/${market.slug}/queue/${item.claimId}`}
                  className="block px-1 py-4 transition hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
                >
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono text-sm text-neutral-900">{item.attributeKey}</span>
                    {item.conflicted ? <StateBadge label="conflict" tone="warn" /> : null}
                    {item.highImpact ? <StateBadge label="high impact" tone="warn" /> : null}
                    {item.hasApproval ? <StateBadge label="approved" tone="good" /> : null}
                    <StateBadge label={item.lifecycleState} tone="neutral" />
                    <StateBadge label={item.sourceAuthority} tone="neutral" />
                  </div>
                  <p className="mt-1 text-sm text-neutral-700">
                    {item.subjectLabel ?? `${item.subjectKind} ${item.subjectId}`}
                  </p>
                  <p className="mt-1 truncate font-mono text-xs text-neutral-500">
                    {JSON.stringify(item.value)}
                  </p>
                  <p className="mt-1 text-xs text-neutral-500">
                    {item.confidenceLabel} · observed{' '}
                    <time dateTime={item.observedAt.toISOString()}>
                      {item.observedAt.toISOString().slice(0, 16).replace('T', ' ')}Z
                    </time>
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
