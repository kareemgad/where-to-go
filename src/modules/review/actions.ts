'use server';

/**
 * Review decisions.
 *
 * Each action does the same three things in the same order: resolve who is
 * asking and whether they may review this market, confirm the claim is
 * actually in that market, then call the SQL function that performs the whole
 * decision in one transaction.
 *
 * The second check is not redundant. Authorizing the market in the URL and
 * then acting on a claim id from the form would let a reviewer for one market
 * decide another market's claim by editing a hidden field.
 */

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/db/client';
import { recordDenial, reviewAccess } from '@/modules/auth/session';

const uuid = z.string().uuid();

const decisionForm = z.object({
  marketSlug: z.string().min(1),
  claimId: uuid,
  reason: z.string().trim().max(2000).optional(),
});

/** Short codes only: a status in a URL must carry no claim content. */
type StatusCode =
  | 'published'
  | 'conflict'
  | 'rejected'
  | 'edited'
  | 'needs_review'
  | 'not_publishable'
  | 'invalid'
  | 'not_found'
  | 'forbidden';

function backToClaim(marketSlug: string, claimId: string, status: StatusCode): never {
  redirect(`/admin/${marketSlug}/queue/${claimId}?status=${status}`);
}

function backToQueue(marketSlug: string, status: StatusCode): never {
  redirect(`/admin/${marketSlug}/queue?status=${status}`);
}

/**
 * Map a SQL function's jsonb status onto a redirect code.
 *
 * 'conflict' is deliberately not an error here. The reviewer approved a claim
 * and the system refused to choose between it and another — that is the
 * designed outcome, and it needs reporting as such rather than as a failure.
 */
function statusFrom(result: unknown): StatusCode {
  const status = (result as { status?: unknown } | null)?.status;
  switch (status) {
    case 'published':
      return 'published';
    case 'conflict':
      return 'conflict';
    case 'rejected':
      return 'rejected';
    case 'needs_review':
      return 'needs_review';
    case 'not_publishable':
      return 'not_publishable';
    case 'not_found':
      return 'not_found';
    default:
      return 'invalid';
  }
}

interface AuthorizedClaim {
  readonly marketSlug: string;
  readonly claimId: string;
  readonly reason: string | undefined;
  readonly userId: string;
  readonly marketId: string;
}

/**
 * Authorize a decision, or redirect.
 *
 * Returns only when the caller may decide this claim in this market. Every
 * refusal is recorded (doc 16 scenario 7).
 */
async function authorizeDecision(form: FormData, action: string): Promise<AuthorizedClaim> {
  const parsed = decisionForm.safeParse({
    marketSlug: form.get('marketSlug'),
    claimId: form.get('claimId'),
    reason: form.get('reason') ?? undefined,
  });
  if (!parsed.success) {
    // Nothing trustworthy to redirect back to, so this is the one case that
    // goes to the admin home rather than the claim.
    redirect('/admin?status=invalid');
  }

  const { marketSlug, claimId, reason } = parsed.data;
  const sql = db();
  const access = await reviewAccess(sql, marketSlug);

  if (!access.ok) {
    if (access.status === 'unauthenticated') redirect(`/login?next=/admin/${marketSlug}/queue`);
    redirect('/admin?status=forbidden');
  }

  // The claim must belong to the market we just authorized.
  const rows = await sql<{ marketId: string | null }[]>`
    select app_claim_market(subject_kind, subject_id) as "marketId"
    from claims where id = ${claimId}
  `;
  const claimMarketId = rows[0]?.marketId ?? null;

  if (claimMarketId !== access.market.id) {
    await recordDenial(
      sql,
      access.user.id,
      claimMarketId === null
        ? 'claim does not exist'
        : `claim belongs to another market, attempted via ${marketSlug}`,
      { action, marketId: access.market.id, subjectId: claimId },
    );
    redirect('/admin?status=forbidden');
  }

  return {
    marketSlug,
    claimId,
    reason,
    userId: access.user.id,
    marketId: access.market.id,
  };
}

/** Paths whose cached output a decision can change. */
function revalidateMarket(marketSlug: string): void {
  revalidatePath(`/admin/${marketSlug}/queue`);
  revalidatePath(`/admin/${marketSlug}/audit`);
  // The consumer pages read the typed columns a publication rewrites.
  revalidatePath(`/${marketSlug}/discover`);
}

export async function approveClaim(form: FormData): Promise<void> {
  const { marketSlug, claimId, reason, userId } = await authorizeDecision(
    form,
    'review.approve_claim',
  );

  const sql = db();
  const rows = await sql<{ result: unknown }[]>`
    select app_approve_claim(${claimId}, ${userId}, ${reason ?? null}) as result
  `;

  revalidateMarket(marketSlug);
  const status = statusFrom(rows[0]?.result);
  // A conflict keeps the reviewer on the claim: both sides are now queued and
  // they need to see which claim they are being asked to weigh it against.
  if (status === 'published' || status === 'rejected') backToQueue(marketSlug, status);
  backToClaim(marketSlug, claimId, status);
}

export async function rejectClaim(form: FormData): Promise<void> {
  const { marketSlug, claimId, reason, userId } = await authorizeDecision(
    form,
    'review.reject_claim',
  );

  if (!reason) backToClaim(marketSlug, claimId, 'invalid');

  const sql = db();
  const rows = await sql<{ result: unknown }[]>`
    select app_reject_claim(${claimId}, ${userId}, ${reason}) as result
  `;

  revalidateMarket(marketSlug);
  const status = statusFrom(rows[0]?.result);
  if (status === 'rejected') backToQueue(marketSlug, status);
  backToClaim(marketSlug, claimId, status);
}

export async function editClaim(form: FormData): Promise<void> {
  const { marketSlug, claimId, reason, userId } = await authorizeDecision(
    form,
    'review.edit_claim',
  );

  if (!reason) backToClaim(marketSlug, claimId, 'invalid');

  const raw = form.get('value');
  if (typeof raw !== 'string' || raw.trim() === '') {
    backToClaim(marketSlug, claimId, 'invalid');
  }

  let value: unknown;
  try {
    value = JSON.parse(raw as string);
  } catch {
    backToClaim(marketSlug, claimId, 'invalid');
  }

  const sql = db();
  const rows = await sql<{ result: unknown }[]>`
    select app_edit_claim(
      ${claimId}, ${userId}, ${sql.json(value as never)}, ${reason}
    ) as result
  `;

  revalidateMarket(marketSlug);
  const result = rows[0]?.result as { status?: string } | null;
  if (result?.status === 'published') backToQueue(marketSlug, 'edited');
  backToClaim(marketSlug, claimId, statusFrom(result));
}

const rollbackForm = z.object({
  marketSlug: z.string().min(1),
  subjectKind: z.enum(['venue', 'venue_space', 'event_series', 'event_occurrence']),
  subjectId: uuid,
  attributeKey: z.string().min(1).max(200),
  reason: z.string().trim().min(1).max(2000),
});

/**
 * Withdraw the live version of one published attribute.
 *
 * Scoped to an attribute, not an entity. "That price was wrong" is the real
 * request; an entity-wide undo would force the reviewer to discard correct
 * values alongside the one they came to fix.
 */
export async function rollbackAttribute(form: FormData): Promise<void> {
  const parsed = rollbackForm.safeParse({
    marketSlug: form.get('marketSlug'),
    subjectKind: form.get('subjectKind'),
    subjectId: form.get('subjectId'),
    attributeKey: form.get('attributeKey'),
    reason: form.get('reason'),
  });
  if (!parsed.success) redirect('/admin?status=invalid');

  const { marketSlug, subjectKind, subjectId, attributeKey, reason } = parsed.data;
  const sql = db();
  const access = await reviewAccess(sql, marketSlug);
  if (!access.ok) {
    if (access.status === 'unauthenticated') redirect(`/login?next=/admin/${marketSlug}/published`);
    redirect('/admin?status=forbidden');
  }

  const rows = await sql<{ marketId: string | null }[]>`
    select app_claim_market(${subjectKind}::claim_subject_kind, ${subjectId}) as "marketId"
  `;
  if (rows[0]?.marketId !== access.market.id) {
    await recordDenial(sql, access.user.id, 'subject belongs to another market', {
      action: 'review.rollback_attribute',
      marketId: access.market.id,
      subjectKind,
      subjectId,
    });
    redirect('/admin?status=forbidden');
  }

  await sql`
    select app_rollback_attribute(
      ${subjectKind}::claim_subject_kind, ${subjectId}, ${attributeKey},
      ${reason}, ${access.user.id}
    )
  `;

  revalidateMarket(marketSlug);
  revalidatePath(`/admin/${marketSlug}/published`);
  redirect(`/admin/${marketSlug}/published?status=rolled_back`);
}
