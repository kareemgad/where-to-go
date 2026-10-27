/**
 * Market configuration reads.
 *
 * Every consumer of currency, timezone or locale gets it from here (ADR-009).
 * Only live markets are returned: a market still seeding holds unverified data
 * and must not reach a consumer (doc 10).
 */

import type { Sql } from 'postgres';

export interface MarketRecord {
  readonly id: string;
  readonly slug: string;
  readonly referenceName: string;
  readonly timezone: string;
  readonly currency: string;
  readonly defaultLocale: string;
  /**
   * ISO weekday numbers this market treats as the weekend, Monday 1 through
   * Sunday 7. Read by the when-window resolver, never assumed: Saturday and
   * Sunday in one market, Friday and Saturday in another.
   */
  readonly weekendDays: readonly number[];
  /** Whole units; how far a relative budget change moves the ceiling. */
  readonly budgetStep: number;
}

const SELECT = `
  id,
  slug,
  reference_name  as "referenceName",
  timezone,
  currency,
  default_locale  as "defaultLocale",
  weekend_days    as "weekendDays",
  budget_step     as "budgetStep"
`;

export async function loadMarketBySlug(sql: Sql, slug: string): Promise<MarketRecord | null> {
  const rows = await sql<MarketRecord[]>`
    select ${sql.unsafe(SELECT)}
    from markets
    where slug = ${slug} and status = 'live'
  `;
  return rows[0] ?? null;
}

export async function listLiveMarkets(sql: Sql): Promise<MarketRecord[]> {
  return sql<MarketRecord[]>`
    select ${sql.unsafe(SELECT)}
    from markets
    where status = 'live'
    order by slug
  `;
}

/** Localised market name, falling back to the internal reference label. */
export async function marketDisplayName(
  sql: Sql,
  market: MarketRecord,
): Promise<string> {
  const rows = await sql<{ name: string }[]>`
    select pn.name
    from place_names pn
    join localities l on l.id = pn.place_id
    join markets m on m.country_id = l.country_id and m.id = ${market.id}
    where pn.place_kind = 'locality'
      and pn.locale = ${market.defaultLocale}
      and pn.is_preferred
    limit 1
  `;
  return rows[0]?.name ?? market.referenceName;
}
