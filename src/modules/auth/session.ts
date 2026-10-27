/**
 * Authorization: who may do what, and where.
 *
 * Authentication happens in supabase.ts and answers "which user is this".
 * Everything here answers "may that user do this", and every answer comes from
 * the SQL rule in migration 0014 rather than a TypeScript reimplementation of
 * it. The same function backs the RLS policies, so a route and a policy cannot
 * disagree about who is a reviewer (ADR-002).
 */

import type { Sql } from 'postgres';

import { loadMarketBySlug, type MarketRecord } from '@/modules/markets/queries';

import { serverAuthClient } from './supabase';

export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string | null;
}

/**
 * The signed-in user, or null.
 *
 * getUser() rather than getSession(): getSession reads the cookie and trusts
 * it, while getUser revalidates the token with Supabase. On a page that decides
 * authorization, trusting an unverified cookie is the whole vulnerability.
 */
export async function currentUser(): Promise<AuthenticatedUser | null> {
  const supabase = await serverAuthClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

export async function canReviewMarket(
  sql: Sql,
  userId: string,
  marketId: string,
): Promise<boolean> {
  const rows = await sql<{ allowed: boolean }[]>`
    select app_user_can_review_market(${userId}::uuid, ${marketId}::uuid) as allowed
  `;
  return rows[0]?.allowed === true;
}

export async function isGlobalAdmin(sql: Sql, userId: string): Promise<boolean> {
  const rows = await sql<{ allowed: boolean }[]>`
    select app_user_is_global_admin(${userId}::uuid) as allowed
  `;
  return rows[0]?.allowed === true;
}

/** Live markets this user may review, in slug order. */
export async function reviewableMarkets(sql: Sql, userId: string): Promise<MarketRecord[]> {
  return sql<MarketRecord[]>`
    select
      m.id,
      m.slug,
      m.reference_name  as "referenceName",
      m.timezone,
      m.currency,
      m.default_locale  as "defaultLocale"
    from markets m
    where m.id in (select app_user_reviewable_markets(${userId}::uuid))
      and m.status = 'live'
    order by m.slug
  `;
}

export interface DenialContext {
  readonly action: string;
  readonly marketId?: string | null;
  readonly subjectKind?: string | null;
  readonly subjectId?: string | null;
}

/**
 * Record a refused action (doc 16 scenario 7).
 *
 * Takes no request body: a denial trail that stores what someone tried to
 * submit becomes a store of unvalidated input, and the useful signal is the
 * attempt, not its payload.
 */
export async function recordDenial(
  sql: Sql,
  userId: string | null,
  reason: string,
  context: DenialContext,
): Promise<void> {
  await sql`
    insert into authorization_denials
      (user_id, action, market_id, subject_kind, subject_id, reason)
    values (
      ${userId},
      ${context.action},
      ${context.marketId ?? null},
      ${context.subjectKind ?? null},
      ${context.subjectId ?? null},
      ${reason}
    )
  `;
}

export type ReviewAccess =
  | { readonly ok: true; readonly user: AuthenticatedUser; readonly market: MarketRecord }
  | { readonly ok: false; readonly status: 'unauthenticated' }
  | { readonly ok: false; readonly status: 'no_such_market' }
  | { readonly ok: false; readonly status: 'forbidden'; readonly user: AuthenticatedUser };

/**
 * Resolve review access to one market, logging a refusal.
 *
 * Returns a status rather than throwing or redirecting, so a page renders an
 * explanation and a server action returns an error — the same decision reached
 * the same way, presented differently.
 */
export async function reviewAccess(sql: Sql, marketSlug: string): Promise<ReviewAccess> {
  const user = await currentUser();
  const market = await loadMarketBySlug(sql, marketSlug);

  if (!user) {
    await recordDenial(sql, null, 'not signed in', {
      action: 'review.open_market',
      marketId: market?.id ?? null,
    });
    return { ok: false, status: 'unauthenticated' };
  }

  if (!market) {
    // Not a denial: a slug that names no live market is a wrong URL, and
    // logging it as an access attempt would bury real probes in typos.
    return { ok: false, status: 'no_such_market' };
  }

  if (!(await canReviewMarket(sql, user.id, market.id))) {
    await recordDenial(sql, user.id, `no reviewer role for ${market.slug}`, {
      action: 'review.open_market',
      marketId: market.id,
    });
    return { ok: false, status: 'forbidden', user };
  }

  return { ok: true, user, market };
}
