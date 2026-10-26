/**
 * Recording a booking handoff.
 *
 * A handoff is a click, never a reservation (doc 02 AC06). Nothing in this
 * module talks to a booking system, and nothing it writes may be read as
 * evidence that a table was held.
 *
 * The destination always comes from the venue row in the database, never from
 * a request parameter. That is not a detail: a redirect target taken from the
 * query string is an open redirect, and this endpoint would be a convenient
 * one to abuse for phishing, since the link would legitimately originate from
 * our own domain.
 */

import type { Sql } from 'postgres';

export type HandoffChannel = 'booking_url' | 'phone' | 'whatsapp' | 'website';

export interface HandoffTarget {
  readonly marketId: string;
  readonly venueId: string;
  readonly destinationUrl: string;
  readonly channel: HandoffChannel;
}

/**
 * Resolve where a venue's handoff should go, reading only from the database and
 * only for a venue that is publicly visible.
 */
export async function resolveHandoffTarget(
  sql: Sql,
  marketSlug: string,
  venueSlug: string,
): Promise<HandoffTarget | null> {
  const rows = await sql<
    { marketId: string; venueId: string; bookingUrl: string | null; website: string | null }[]
  >`
    select m.id as "marketId", v.id as "venueId",
           v.booking_url as "bookingUrl", v.website as "website"
    from venues v
    join markets m on m.id = v.canonical_market_id
    where m.slug = ${marketSlug}
      and m.status = 'live'
      and v.slug = ${venueSlug}
      and v.status = 'active'
  `;

  const row = rows[0];
  if (!row) return null;

  const destination = row.bookingUrl ?? row.website;
  if (!destination) return null;

  // Only ever http(s), and only ever a URL we stored.
  let parsed: URL;
  try {
    parsed = new URL(destination);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;

  return {
    marketId: row.marketId,
    venueId: row.venueId,
    destinationUrl: parsed.toString(),
    channel: row.bookingUrl ? 'booking_url' : 'website',
  };
}

export interface HandoffContext {
  readonly occurrenceId?: string | undefined;
  readonly resultPosition?: number | undefined;
  readonly rankingVersion?: string | undefined;
  readonly userId?: string | undefined;
}

/**
 * Write the handoff row.
 *
 * Stores the destination host only. A booking URL may carry query parameters,
 * and personal data must never end up in one (doc 12). The user's search is not
 * recorded at all: operators get counts, never queries (doc 10).
 */
export async function recordHandoff(
  sql: Sql,
  target: HandoffTarget,
  context: HandoffContext = {},
): Promise<void> {
  const host = new URL(target.destinationUrl).host;

  await sql`
    insert into booking_handoffs (
      market_id, venue_id, occurrence_id, channel, destination_host,
      result_position, ranking_version, user_id
    ) values (
      ${target.marketId}, ${target.venueId}, ${context.occurrenceId ?? null},
      ${target.channel}, ${host},
      ${context.resultPosition ?? null}, ${context.rankingVersion ?? null},
      ${context.userId ?? null}
    )
  `;
}

/** Handoff counts per venue. Aggregates only — never individual rows. */
export async function handoffCounts(
  sql: Sql,
  marketId: string,
): Promise<{ venueSlug: string; handoffs: number }[]> {
  return sql<{ venueSlug: string; handoffs: number }[]>`
    select v.slug as "venueSlug", count(*)::int as handoffs
    from booking_handoffs h
    join venues v on v.id = h.venue_id
    where h.market_id = ${marketId}
    group by v.slug
    order by handoffs desc, v.slug
  `;
}
