import { notFound, redirect } from 'next/navigation';

import { db } from '@/db/client';
import { reviewAccess } from '@/modules/auth/session';
import { rollbackAttribute } from '@/modules/review/actions';
import { livePublishedValues } from '@/modules/review/queries';
import {
  AccessDenied,
  AdminHeader,
  JsonValue,
  MarketTabs,
  StatusBanner,
} from '../../_components/chrome';

export const metadata = { title: 'Published · Where to Go' };

export default async function PublishedPage({
  params,
  searchParams,
}: {
  params: Promise<{ market: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { market: slug } = await params;
  const status = (await searchParams).status;

  const sql = db();
  const access = await reviewAccess(sql, slug);
  if (!access.ok) {
    if (access.status === 'unauthenticated') redirect(`/login?next=/admin/${slug}/published`);
    if (access.status === 'no_such_market') notFound();
    return <AccessDenied reason={`You hold no reviewer role for ${slug}.`} />;
  }

  const { user, market } = access;
  const rows = await livePublishedValues(sql, market.id);

  return (
    <>
      <AdminHeader email={user.email} />
      <main className="mx-auto max-w-5xl px-6 py-10" lang="en" dir="ltr">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          {market.referenceName}
        </h1>
        <p className="mt-1 text-sm text-neutral-600">
          What this market currently publishes, newest first. Rollback is per attribute, not per
          venue: &ldquo;that price was wrong&rdquo; should not make you discard the values that were
          right.
        </p>

        <MarketTabs slug={market.slug} active="published" />
        <StatusBanner code={typeof status === 'string' ? status : undefined} />

        {rows.length === 0 ? (
          <p className="mt-8 rounded-lg border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
            Nothing is published in this market yet.
          </p>
        ) : (
          <ul className="mt-8 space-y-4">
            {rows.map((row) => (
              <li
                key={`${row.subjectId}-${row.attributeKey}`}
                className="rounded-lg border border-neutral-300 px-5 py-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-mono text-sm text-neutral-900">{row.attributeKey}</span>
                  <span className="font-mono text-xs text-neutral-500">
                    v{row.version} · {row.publishedAt.toISOString().slice(0, 16).replace('T', ' ')}Z
                  </span>
                </div>
                <p className="mt-1 text-sm text-neutral-700">
                  {row.subjectLabel ?? `${row.subjectKind} ${row.subjectId}`}
                </p>
                <div className="mt-2">
                  <JsonValue value={row.value} />
                </div>

                <form action={rollbackAttribute} className="mt-3 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="marketSlug" value={market.slug} />
                  <input type="hidden" name="subjectKind" value={row.subjectKind} />
                  <input type="hidden" name="subjectId" value={row.subjectId} />
                  <input type="hidden" name="attributeKey" value={row.attributeKey} />
                  <div className="grow">
                    <label
                      htmlFor={`reason-${row.subjectId}-${row.attributeKey}`}
                      className="block text-xs text-neutral-700"
                    >
                      Why this is wrong (required)
                    </label>
                    <input
                      id={`reason-${row.subjectId}-${row.attributeKey}`}
                      name="reason"
                      type="text"
                      required
                      maxLength={2000}
                      className="mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm focus:border-neutral-900 focus:outline-none"
                    />
                  </div>
                  <button
                    type="submit"
                    className="rounded-lg border border-neutral-900 px-3 py-2 text-sm font-medium text-neutral-900 transition hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
                  >
                    Roll back
                  </button>
                </form>
                {row.version === 1 ? (
                  <p className="mt-2 text-xs text-neutral-500">
                    This is the first version, so rolling back returns the attribute to unknown
                    rather than to an earlier value.
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
