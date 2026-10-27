import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { db } from '@/db/client';
import { reviewAccess } from '@/modules/auth/session';
import { approveClaim, editClaim, rejectClaim } from '@/modules/review/actions';
import { loadReviewDetail } from '@/modules/review/queries';
import {
  AccessDenied,
  AdminHeader,
  Field,
  JsonValue,
  MarketTabs,
  StateBadge,
  StatusBanner,
} from '../../../_components/chrome';

export const metadata = { title: 'Claim · Where to Go' };

function utc(at: Date): string {
  return `${at.toISOString().slice(0, 16).replace('T', ' ')}Z`;
}

export default async function ClaimPage({
  params,
  searchParams,
}: {
  params: Promise<{ market: string; claimId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { market: slug, claimId } = await params;
  const status = (await searchParams).status;

  const sql = db();
  const access = await reviewAccess(sql, slug);
  if (!access.ok) {
    if (access.status === 'unauthenticated') {
      redirect(`/login?next=/admin/${slug}/queue/${claimId}`);
    }
    if (access.status === 'no_such_market') notFound();
    return <AccessDenied reason={`You hold no reviewer role for ${slug}.`} />;
  }

  const { user, market } = access;
  // Scoped to this market, so editing the claim id in the URL cannot reach
  // another market's evidence — it reaches a 404.
  const detail = await loadReviewDetail(sql, market.id, claimId);
  if (!detail) notFound();

  const { item, evidence, conflicts, current, decisions } = detail;
  const proposed = JSON.stringify(item.value, null, 2);

  return (
    <>
      <AdminHeader email={user.email} />
      <main className="mx-auto max-w-5xl px-6 py-10" lang="en" dir="ltr">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          {market.referenceName}
        </h1>
        <MarketTabs slug={market.slug} active="queue" />
        <StatusBanner code={typeof status === 'string' ? status : undefined} />

        <p className="mt-6">
          <Link href={`/admin/${market.slug}/queue`} className="text-sm text-neutral-600 underline">
            Back to the queue
          </Link>
        </p>

        <section className="mt-6 rounded-lg border border-neutral-300 px-5 py-4">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="font-mono text-sm font-semibold text-neutral-900">
              {item.attributeKey}
            </span>
            {item.conflicted ? <StateBadge label="conflict" tone="warn" /> : null}
            {item.highImpact ? <StateBadge label="high impact" tone="warn" /> : null}
            <StateBadge label={item.lifecycleState} tone="neutral" />
            <StateBadge label={item.evidenceState} tone="neutral" />
            <StateBadge label={item.sourceAuthority} tone="neutral" />
          </div>
          <p className="mt-2 text-sm text-neutral-800">
            {item.subjectLabel ?? `${item.subjectKind} ${item.subjectId}`}
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            {item.confidenceLabel} · observed {utc(item.observedAt)}
          </p>
          {item.highImpact ? (
            <p className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              High-impact attribute. It cannot publish without a recorded decision, and it is never
              batch-approved (doc 11).
            </p>
          ) : null}
        </section>

        {/* Existing versus proposed, side by side. A reviewer deciding a
            correction is comparing two values, and showing only the new one
            makes "is this actually different" their job to remember. */}
        <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Current versus proposed
        </h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="text-xs font-semibold text-neutral-700">
              Published now
              {current ? (
                <span className="ml-2 font-mono font-normal text-neutral-500">
                  v{current.version}
                </span>
              ) : null}
            </h3>
            {current ? (
              <>
                <div className="mt-2">
                  <JsonValue value={current.value} />
                </div>
                <p className="mt-2 text-xs text-neutral-500">
                  {current.sourceAuthority} · {current.evidenceState} · published{' '}
                  {utc(current.publishedAt)}
                  {current.materialized ? '' : ' · no typed column yet'}
                </p>
              </>
            ) : (
              <p className="mt-2 rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
                Nothing published for this attribute. The page currently says nothing about it,
                rather than guessing.
              </p>
            )}
          </div>
          <div>
            <h3 className="text-xs font-semibold text-neutral-700">Proposed</h3>
            <div className="mt-2">
              <JsonValue value={item.value} />
            </div>
          </div>
        </div>

        {conflicts.length > 0 ? (
          <section className="mt-10">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-800">
              Credible sources disagree
            </h2>
            <p className="mt-1 text-sm text-neutral-700">
              {conflicts.length === 1 ? 'One other claim' : `${conflicts.length} other claims`} on
              this attribute carry a different value. Approving this one will not publish it while
              that is true — the system does not pick a winner, so resolve the disagreement by
              rejecting or editing.
            </p>
            <ul className="mt-3 space-y-3">
              {conflicts.map((conflict) => (
                <li
                  key={conflict.claimId}
                  className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3"
                >
                  <div className="flex flex-wrap items-baseline gap-2">
                    <StateBadge label={conflict.sourceAuthority} tone="neutral" />
                    <StateBadge label={conflict.evidenceState} tone="neutral" />
                    <Link
                      href={`/admin/${market.slug}/queue/${conflict.claimId}`}
                      className="text-xs underline"
                    >
                      Open that claim
                    </Link>
                  </div>
                  <div className="mt-2">
                    <JsonValue value={conflict.value} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
            What this rests on
          </h2>
          {evidence ? (
            <dl className="mt-3 grid gap-4 rounded-lg border border-neutral-300 px-5 py-4 md:grid-cols-2">
              <Field label="Source">{evidence.providerName}</Field>
              <Field label="Observed">{utc(evidence.capturedAt)}</Field>
              <Field label="Publisher">{evidence.publisher ?? 'not recorded'}</Field>
              <Field label="Rights">{evidence.storagePolicy}</Field>
              <Field label="Field">
                <span className="font-mono text-xs">{evidence.fieldPointer ?? 'not recorded'}</span>
              </Field>
              <Field label="Document">
                {evidence.documentUrl ? (
                  // External and untrusted: the full href is shown so the
                  // reviewer sees where it goes, and the link carries no
                  // referrer and no endorsement.
                  <a
                    href={evidence.documentUrl}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="break-all font-mono text-xs underline"
                  >
                    {evidence.documentUrl}
                  </a>
                ) : (
                  'no link on file'
                )}
              </Field>
              <div className="md:col-span-2">
                <dt className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  What the source said
                </dt>
                <dd className="mt-1">
                  {evidence.excerpt ? (
                    <blockquote className="border-l-2 border-neutral-300 pl-3 text-sm text-neutral-800">
                      {evidence.excerpt}
                    </blockquote>
                  ) : (
                    <span className="text-sm text-neutral-600">
                      No excerpt was captured. Decide on the field pointer and the document, or
                      reject for want of evidence.
                    </span>
                  )}
                </dd>
              </div>
              {evidence.attributionRequired && evidence.attributionText ? (
                <p className="md:col-span-2 text-xs text-neutral-600">
                  Attribution required on publication: {evidence.attributionText}
                </p>
              ) : null}
            </dl>
          ) : (
            <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
              No evidence record. A claim cannot exist without one, so this is a data fault worth
              reporting rather than a claim to decide.
            </p>
          )}
        </section>

        <section className="mt-10 grid gap-6 md:grid-cols-2">
          <form action={approveClaim} className="rounded-lg border border-neutral-300 px-5 py-4">
            <input type="hidden" name="marketSlug" value={market.slug} />
            <input type="hidden" name="claimId" value={item.claimId} />
            <h2 className="text-sm font-semibold text-neutral-900">Approve</h2>
            <p className="mt-1 text-xs text-neutral-600">
              Records your approval, marks the claim human-verified and publishes it. A note is
              optional here; a rejection or an edit requires one.
            </p>
            <label htmlFor="approve-reason" className="mt-3 block text-xs text-neutral-700">
              Note (optional)
            </label>
            <input
              id="approve-reason"
              name="reason"
              type="text"
              maxLength={2000}
              className="mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm focus:border-neutral-900 focus:outline-none"
            />
            <button
              type="submit"
              className="mt-3 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
            >
              Approve and publish
            </button>
          </form>

          <form action={rejectClaim} className="rounded-lg border border-neutral-300 px-5 py-4">
            <input type="hidden" name="marketSlug" value={market.slug} />
            <input type="hidden" name="claimId" value={item.claimId} />
            <h2 className="text-sm font-semibold text-neutral-900">Reject</h2>
            <p className="mt-1 text-xs text-neutral-600">
              The claim is kept with your reason attached, so the same value is not proposed and
              refused over and over.
            </p>
            <label htmlFor="reject-reason" className="mt-3 block text-xs text-neutral-700">
              Reason (required)
            </label>
            <input
              id="reject-reason"
              name="reason"
              type="text"
              required
              maxLength={2000}
              className="mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm focus:border-neutral-900 focus:outline-none"
            />
            <button
              type="submit"
              className="mt-3 rounded-lg border border-neutral-900 px-4 py-2 text-sm font-medium text-neutral-900 transition hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
            >
              Reject
            </button>
          </form>

          <form
            action={editClaim}
            className="rounded-lg border border-neutral-300 px-5 py-4 md:col-span-2"
          >
            <input type="hidden" name="marketSlug" value={market.slug} />
            <input type="hidden" name="claimId" value={item.claimId} />
            <h2 className="text-sm font-semibold text-neutral-900">Correct and publish</h2>
            <p className="mt-1 text-xs text-neutral-600">
              Your correction is published as a new editor-checked claim superseding this one, with
              your reasoning as its evidence. The original is withdrawn, never overwritten, so what
              the source said stays readable beside the correction.
            </p>
            <label htmlFor="edit-value" className="mt-3 block text-xs text-neutral-700">
              Corrected value (JSON)
            </label>
            <textarea
              id="edit-value"
              name="value"
              rows={Math.min(10, proposed.split('\n').length + 1)}
              defaultValue={proposed}
              required
              spellCheck={false}
              className="mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 font-mono text-xs focus:border-neutral-900 focus:outline-none"
            />
            <label htmlFor="edit-reason" className="mt-3 block text-xs text-neutral-700">
              What you checked, and how (required — this becomes the evidence)
            </label>
            <input
              id="edit-reason"
              name="reason"
              type="text"
              required
              maxLength={2000}
              className="mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm focus:border-neutral-900 focus:outline-none"
            />
            <button
              type="submit"
              className="mt-3 rounded-lg border border-neutral-900 px-4 py-2 text-sm font-medium text-neutral-900 transition hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
            >
              Publish correction
            </button>
          </form>
        </section>

        {decisions.length > 0 ? (
          <section className="mt-10">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
              Decisions on this claim
            </h2>
            <ul className="mt-3 space-y-2">
              {decisions.map((decision) => (
                <li key={decision.id} className="text-sm text-neutral-800">
                  <span className="font-mono text-xs text-neutral-500">
                    {utc(decision.createdAt)}
                  </span>{' '}
                  <StateBadge label={decision.action} tone="neutral" />{' '}
                  {decision.reviewerEmail ?? decision.reviewerId ?? 'unattributed'}
                  {decision.reason ? <> — {decision.reason}</> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    </>
  );
}
