/**
 * The controlled vocabularies, read for one market.
 *
 * Every query here takes a market id and resolves the global set plus that
 * market's extensions (doc 10: a market adds terms, it does not fork the
 * core). The market is a parameter rather than a default, so a call site that
 * forgets it does not typecheck.
 */

import type { Sql } from 'postgres';

import type { ExperienceFacet } from '@/modules/search/types';

export interface TaxonomyEntry {
  readonly key: string;
  readonly label: string;
  /** True when this term is an extension belonging to one market. */
  readonly isMarketExtension: boolean;
}

export interface ExperienceTagEntry extends TaxonomyEntry {
  readonly facet: ExperienceFacet;
}

/**
 * Language subtag of a BCP 47 locale.
 *
 * Labels are stored per language ('en', 'ar'), while markets carry full tags
 * ('en-AE', 'ar-EG'). Matching on the whole tag would find nothing and fall
 * back to a key, and a key is a developer-facing identifier that must never
 * reach a user.
 */
function languageOf(locale: string): string {
  const [language] = locale.split('-');
  return (language ?? locale).toLowerCase();
}

export async function loadExperienceTags(
  sql: Sql,
  marketId: string,
  locale: string,
): Promise<ExperienceTagEntry[]> {
  const language = languageOf(locale);
  return sql<ExperienceTagEntry[]>`
    select
      t.key,
      t.facet,
      -- The requested language, then any other, then the key as a last
      -- resort. A tag with no label at all is a seeding fault, and showing
      -- its key makes that visible rather than hiding it behind a blank.
      coalesce(
        (select l.label from experience_tag_labels l
          where l.tag_id = t.id and l.locale = ${language}),
        (select l.label from experience_tag_labels l
          where l.tag_id = t.id order by l.locale limit 1),
        t.key
      )                        as label,
      t.market_id is not null  as "isMarketExtension"
    from experience_tags t
    where t.market_id is null or t.market_id = ${marketId}
    order by t.facet, t.sort_order, t.key
  `;
}

export async function loadOutingKinds(
  sql: Sql,
  marketId: string,
  locale: string,
): Promise<TaxonomyEntry[]> {
  const language = languageOf(locale);
  return sql<TaxonomyEntry[]>`
    select
      k.key,
      coalesce(
        (select l.label from outing_kind_labels l
          where l.kind_id = k.id and l.locale = ${language}),
        (select l.label from outing_kind_labels l
          where l.kind_id = k.id order by l.locale limit 1),
        k.key
      )                        as label,
      k.market_id is not null  as "isMarketExtension"
    from outing_kinds k
    where k.market_id is null or k.market_id = ${marketId}
    order by k.sort_order, k.key
  `;
}

export interface TimeBand {
  readonly key: string;
  /** HH:MM in the market's own zone. */
  readonly startsLocal: string;
  /** May be earlier than startsLocal: late night runs past midnight. */
  readonly endsLocal: string;
}

/**
 * The time-of-day bands this market offers, its own overriding the global
 * default.
 *
 * Hours are market configuration rather than constants because evening is not
 * the same hours everywhere. The market guard would not catch a hardcoded
 * 19:00 — it looks for currencies, zones and locales — but it would still be
 * one culture's evening baked into shared logic (ADR-009).
 */
export async function loadTimeBands(sql: Sql, marketId: string): Promise<TimeBand[]> {
  const rows = await sql<{ key: string; startsLocal: string; endsLocal: string }[]>`
    select key, starts_local::text as "startsLocal", ends_local::text as "endsLocal"
    from app_market_time_bands(${marketId})
    order by sort_order, key
  `;
  return rows.map((row) => ({
    key: row.key,
    startsLocal: row.startsLocal.slice(0, 5),
    endsLocal: row.endsLocal.slice(0, 5),
  }));
}
