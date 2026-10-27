import Link from 'next/link';
import { redirect } from 'next/navigation';

import { db } from '@/db/client';
import { currentUser, isGlobalAdmin, reviewableMarkets } from '@/modules/auth/session';
import { queueSummary } from '@/modules/review/queries';
import { AdminHeader, StatusBanner } from './_components/chrome';

export const metadata = { title: 'Review · Where to Go' };

/**
 * The reviewer's home: the markets they look after, and how much is waiting.
 *
 * Only reviewable markets are listed. A reviewer for one market has no
 * business learning the queue depth of another, and a list of every market
 * with a "you cannot open this" beside most of them is both noisier and more
 * revealing than a list of theirs.
 */
export default async function AdminHome({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await currentUser();
  // The middleware redirects unauthenticated requests already; this is the
  // check that actually decides, because middleware cannot be the only gate.
  if (!user) redirect('/login?next=/admin');

  const params = await searchParams;
  const status = typeof params.status === 'string' ? params.status : undefined;

  const sql = db();
  const [markets, admin] = await Promise.all([
    reviewableMarkets(sql, user.id),
    isGlobalAdmin(sql, user.id),
  ]);

  const summaries = await Promise.all(
    markets.map(async (market) => ({ market, queue: await queueSummary(sql, market.id) })),
  );

  return (
    <>
      <AdminHeader email={user.email} />
      <main className="mx-auto max-w-5xl px-6 py-10" lang="en" dir="ltr">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Review queues</h1>
        <p className="mt-1 text-sm text-neutral-600">
          {admin
            ? 'You are a global administrator, so every live market is listed.'
            : 'The markets you hold a reviewer or manager role for.'}
        </p>

        <StatusBanner code={status} />

        {summaries.length === 0 ? (
          <p className="mt-8 rounded-lg border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
            You hold no reviewer role in any live market. An administrator grants one with{' '}
            <code className="font-mono">npm run grant</code>.
          </p>
        ) : (
          <ul className="mt-8 space-y-3">
            {summaries.map(({ market, queue }) => (
              <li key={market.id}>
                <Link
                  href={`/admin/${market.slug}/queue`}
                  className="block rounded-lg border border-neutral-300 px-4 py-3 transition hover:border-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
                >
                  <div className="flex items-baseline justify-between">
                    <span className="text-lg font-medium text-neutral-900">
                      {market.referenceName}
                    </span>
                    <span className="font-mono text-xs text-neutral-500">
                      {market.currency} · {market.timezone}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-neutral-700">
                    {queue.total === 0
                      ? 'Nothing waiting.'
                      : `${queue.total} awaiting a decision` +
                        (queue.conflicted > 0 ? `, ${queue.conflicted} in conflict` : '') +
                        (queue.highImpact > 0 ? `, ${queue.highImpact} high-impact` : '')}
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
