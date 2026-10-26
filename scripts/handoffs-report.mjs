#!/usr/bin/env node
/**
 * Booking handoff report.
 *
 *   npm run db:handoffs
 *
 * Doc 16 lists detail-to-handoff conversion among the pilot metrics, and doc 01
 * is explicit that handoffs are the *proxy* for the north-star, not the thing
 * itself. So this prints counts and labels them as clicks, because the single
 * easiest way to mislead ourselves about this product is to start reading
 * "handoffs" as "bookings" (gap G8).
 *
 * Shows aggregates and per-row context only. There is no personal data in the
 * table to show: no IP, no user agent, no search query (doc 10, doc 12).
 */

import postgres from 'postgres';

if (!process.env.DIRECT_URL) {
  console.error('DIRECT_URL is not set.');
  process.exit(1);
}

const sql = postgres(process.env.DIRECT_URL, {
  max: 1,
  idle_timeout: 5,
  connect_timeout: 15,
  onnotice: () => {},
});

try {
  const total = await sql`select count(*)::int as n from booking_handoffs`;
  console.log(`\nbooking handoffs recorded: ${total[0]?.n ?? 0}`);
  console.log('(these are outbound clicks. None of them is a booking.)\n');

  const byVenue = await sql`
    select
      m.slug                      as market,
      v.slug                      as venue,
      h.channel,
      h.destination_host,
      count(*)::int               as handoffs,
      count(h.occurrence_id)::int as with_occurrence,
      min(h.result_position)      as best_position,
      max(h.created_at)           as last_at
    from booking_handoffs h
    join venues v on v.id = h.venue_id
    join markets m on m.id = h.market_id
    group by m.slug, v.slug, h.channel, h.destination_host
    order by handoffs desc, v.slug
  `;

  if (byVenue.length === 0) {
    console.log('  none yet. Open a result in the app and use the booking link.');
  } else {
    for (const row of byVenue) {
      console.log(
        `  ${String(row.market).padEnd(7)} ${String(row.venue).padEnd(28)} ` +
          `${String(row.handoffs).padStart(4)}  ${row.channel}  -> ${row.destination_host}`,
      );
      console.log(
        `          with occurrence: ${row.with_occurrence}   best position: ${row.best_position ?? '-'}   last: ${
          row.last_at instanceof Date ? row.last_at.toISOString() : row.last_at
        }`,
      );
    }
  }

  // The privacy claim, checked rather than asserted: there is no column here
  // that could hold a query, an address or a user agent.
  const columns = await sql`
    select column_name
    from information_schema.columns
    where table_name = 'booking_handoffs'
    order by ordinal_position
  `;
  console.log(`\ncolumns: ${columns.map((c) => c.column_name).join(', ')}`);

  const forbidden = ['ip', 'ip_address', 'user_agent', 'query', 'search', 'referrer'];
  const leaks = columns
    .map((c) => String(c.column_name))
    .filter((name) => forbidden.some((f) => name.includes(f)));
  console.log(
    leaks.length === 0
      ? 'no personal-data columns present, as intended (doc 12).'
      : `WARNING: unexpected columns that could hold personal data: ${leaks.join(', ')}`,
  );
} catch (error) {
  console.error(`\nReport failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
