import Link from 'next/link';
import { notFound } from 'next/navigation';

import { db } from '@/db/client';
import { copyFor } from '@/modules/i18n/copy';
import { loadMarketBySlug, marketDisplayName } from '@/modules/markets/queries';
import {
  loadExperienceTags,
  loadOutingKinds,
  loadTimeBands,
} from '@/modules/taxonomy/queries';
import { RefinePanel } from '@/app/_components/refine';
import { DemoBanner } from '@/app/_components/evidence';

/**
 * Intent form.
 *
 * A plain GET form, server-rendered, no client JavaScript. That is not
 * minimalism for its own sake: doc 02 puts natural-language parsing at P1 with
 * "fallback to standard filters when AI unavailable", so the structured path
 * has to work entirely on its own — and the accessible, keyboard-navigable,
 * shareable-URL version of this screen is a plain form.
 */
export default async function MarketHome({
  params,
}: {
  params: Promise<{ market: string }>;
}) {
  const { market: slug } = await params;
  const sql = db();
  const market = await loadMarketBySlug(sql, slug);
  if (!market) notFound();

  const name = await marketDisplayName(sql, market);
  const copy = copyFor(market.defaultLocale);
  const [bands, vocabulary, kinds] = await Promise.all([
    loadTimeBands(sql, market.id),
    loadExperienceTags(sql, market.id, market.defaultLocale),
    loadOutingKinds(sql, market.id, market.defaultLocale),
  ]);



  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <div className="flex items-baseline justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Where to Go
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-neutral-900">{name}</h1>
          <p className="mt-1 text-neutral-600">{copy.tagline}</p>
        </div>
        <Link href="/" className="text-sm text-neutral-600 underline hover:text-neutral-900">
          {copy.chooseMarket}
        </Link>
      </div>

      <div className="mt-6">
        <DemoBanner locale={market.defaultLocale} />
      </div>

      {/* The same panel the results page shows, so the two cannot drift into
          offering different filters. There are no unconfirmed counts here:
          nothing has been searched yet, and an invented number would be worse
          than none. */}
      <RefinePanel
        marketSlug={market.slug}
        locale={market.defaultLocale}
        currencyCode={market.currency}
        bands={bands}
        vocabulary={vocabulary}
        kinds={kinds}
        unconfirmedByMustHave={{}}
        open
        state={{
          when: 'weekend',
          band: 'evening',
          party: undefined,
          budget: undefined,
          tags: [],
          mustHaves: [],
          outingKinds: [],
          ageBands: [],
          noise: undefined,
        }}
      />
    </main>
  );
}
