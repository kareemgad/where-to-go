/**
 * Alias reads for the parser.
 *
 * The parser folds both sides of every comparison before matching, so it needs
 * the aliases themselves rather than the SQL resolver the repository uses for
 * occurrence genres. The two look redundant and are not: occurrence genre tags
 * arrive already clean from a stored record and match exactly, while a typed
 * phrase carries whatever the keyboard produced and has to be normalised in
 * the same place as the alias it is compared against.
 */

import type { Sql } from 'postgres';

import type { AliasEntry } from './port';

export async function loadAliases(sql: Sql, marketId: string): Promise<AliasEntry[]> {
  return sql<AliasEntry[]>`
    select a.alias, a.lang, t.key as "tagKey"
    from experience_tag_aliases a
    join experience_tags t on t.id = a.tag_id
    where t.market_id is null or t.market_id = ${marketId}
    -- Longest first, so a two-word term is tried before its first word.
    order by length(a.alias) desc, a.alias
  `;
}
