import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/db/client';
import { recordHandoff, resolveHandoffTarget } from '@/modules/handoffs/record';

/**
 * Booking handoff.
 *
 * Records that someone left for the venue's own channel, then sends them there.
 * It makes no reservation and returns no confirmation (doc 02 AC06) — the
 * response is a redirect and nothing more.
 *
 * The destination is read from the venue row, never from the request. A
 * redirect target taken from a query parameter would be an open redirect, and
 * one originating from our own domain is exactly what a phishing link wants.
 * The context parameters below only annotate the record; none of them can
 * influence where the user is sent.
 */

export const dynamic = 'force-dynamic';

const ContextSchema = z.object({
  occurrence: z.string().uuid().optional(),
  position: z.coerce.number().int().min(1).max(50).optional(),
  ranking: z.string().max(40).optional(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ market: string; venueSlug: string }> },
) {
  const { market, venueSlug } = await params;
  const sql = db();

  const target = await resolveHandoffTarget(sql, market, venueSlug);
  if (!target) {
    // No booking channel on file, or the venue is not publicly visible. Send
    // the user to the venue page rather than nowhere.
    return NextResponse.redirect(new URL(`/${market}/venues/${venueSlug}`, request.url), 302);
  }

  const url = new URL(request.url);
  const context = ContextSchema.safeParse(Object.fromEntries(url.searchParams));

  try {
    await recordHandoff(sql, target, {
      occurrenceId: context.success ? context.data.occurrence : undefined,
      resultPosition: context.success ? context.data.position : undefined,
      rankingVersion: context.success ? context.data.ranking : undefined,
    });
  } catch (error) {
    // Telemetry must never block the user's journey. A failed insert is worth
    // knowing about, not worth stranding someone on an error page for.
    console.error('booking handoff not recorded', error);
  }

  return NextResponse.redirect(target.destinationUrl, 302);
}
