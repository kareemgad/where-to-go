import { headers } from 'next/headers';
import Link from 'next/link';

import { db } from '@/db/client';
import { listLiveMarkets, marketDisplayName } from '@/modules/markets/queries';
import { copyFor, directionOf, negotiateLanguage } from '@/modules/i18n/copy';

/**
 * Market selector. The entry point is a choice of city, not a default one:
 * guessing a market here would be the first hardcoded market (ADR-009).
 */
export default async function Home() {
  const sql = db();
  const markets = await listLiveMarkets(sql);
  const names = await Promise.all(
    markets.map(async (market) => ({
      market,
      name: await marketDisplayName(sql, market),
    })),
  );

  // This page has no market, so its own language comes from the browser rather
  // than from whichever market happens to sort first.
  const chromeLocale = negotiateLanguage((await headers()).get('accept-language'));
  const copy = copyFor(chromeLocale);

  return (
    <main className="mx-auto max-w-2xl px-6 py-16" lang={chromeLocale} dir={directionOf(chromeLocale)}>
      <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">Where to Go</h1>
      <p className="mt-2 text-lg text-neutral-600">{copy.tagline}</p>

      <h2 className="mt-12 text-sm font-semibold uppercase tracking-wide text-neutral-500">
        {copy.chooseMarket}
      </h2>
      <p className="mt-1 text-sm text-neutral-600">{copy.marketsIntro}</p>

      {names.length === 0 ? (
        <p className="mt-6 rounded-lg border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
          No market is live yet. Run <code className="font-mono">npm run db:seed</code> to load the
          fictional fixture world.
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {names.map(({ market, name }) => (
            <li key={market.id}>
              <Link
                href={'/' + market.slug}
                dir={directionOf(market.defaultLocale)}
                className="flex items-baseline justify-between rounded-lg border border-neutral-300 px-4 py-3 transition hover:border-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
              >
                <span className="text-lg font-medium text-neutral-900">{name}</span>
                <span className="font-mono text-xs text-neutral-500">
                  {market.currency} · {market.timezone}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
