import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { db } from '@/db/client';
import { loadMarketBySlug } from '@/modules/markets/queries';
import { directionOf } from '@/modules/i18n/copy';

/**
 * Market shell. Language and direction come from the market record, which is
 * the whole of ADR-012's "locale-ready architecture": an Arabic market renders
 * RTL because its data says so, not because of a branch in the code.
 *
 * Next renders one <html> for the app, so direction is applied to a wrapper
 * here. The attributes are what matter: screen readers and the bidi algorithm
 * both read them.
 */
export default async function MarketLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ market: string }>;
}) {
  const { market: slug } = await params;
  const market = await loadMarketBySlug(db(), slug);
  if (!market) notFound();

  return (
    <div lang={market.defaultLocale} dir={directionOf(market.defaultLocale)}>
      {children}
    </div>
  );
}
