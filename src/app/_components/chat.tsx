import Link from 'next/link';

import { chatTurn } from '@/modules/intent/actions';
import { toHref, withoutValue } from '@/modules/intent/query';
import type { SearchQuery } from '@/modules/intent/query';
import { copyFor, directionOf } from '@/modules/i18n/copy';

/**
 * The chat input, the chips, and the one clarifying question.
 *
 * A plain form posting to a server action that redirects. No client
 * JavaScript, no session: the turn is parsed server-side and the answer is a
 * URL. That is what makes "cheaper" work with scripting off and makes any
 * state of the conversation a link someone can send to a friend.
 *
 * Chips are the safety mechanism, not decoration. Doc 02 P1 asks for "visible
 * editable chips" because a parser that misreads silently is the failure worth
 * engineering against — every term it took is shown with a way to remove it.
 */

export interface ChipSpec {
  readonly dimension: string;
  readonly value: string;
  readonly label: string;
}

/** Each answer is a link to the search that answering would produce. */
export interface QuestionSpec {
  readonly prompt: string;
  readonly answers: readonly { readonly label: string; readonly href: string }[];
}

export function ChatPanel({
  marketSlug,
  locale,
  query,
  chips,
  said,
  missed,
  question,
}: {
  marketSlug: string;
  locale: string;
  query: SearchQuery;
  chips: readonly ChipSpec[];
  /** What the user typed on the turn that produced this page, if any. */
  said?: string | undefined;
  /** Words the parser could not place, so the gap is admitted. */
  missed?: string | undefined;
  /** At most one, asked only when a hard filter hangs on the answer. */
  question?: QuestionSpec | undefined;
}) {
  const copy = copyFor(locale);
  const direction = directionOf(locale);

  return (
    <section className="rounded-lg border border-neutral-300 bg-white p-4" dir={direction}>
      <form action={chatTurn} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="market" value={marketSlug} />
        {/* The whole query travels with the turn, so the patch has something
            to be a patch of and the server holds no state between requests. */}
        <input type="hidden" name="when" value={query.when} />
        {query.band !== undefined ? <input type="hidden" name="band" value={query.band} /> : null}
        {query.party !== undefined ? (
          <input type="hidden" name="party" value={query.party} />
        ) : null}
        {query.budget !== undefined ? (
          <input type="hidden" name="budget" value={query.budget} />
        ) : null}
        {query.tags.length > 0 ? (
          <input type="hidden" name="tags" value={query.tags.join(',')} />
        ) : null}
        {query.mustHaves.length > 0 ? (
          <input type="hidden" name="must" value={query.mustHaves.join(',')} />
        ) : null}
        {query.outingKinds.length > 0 ? (
          <input type="hidden" name="kinds" value={query.outingKinds.join(',')} />
        ) : null}
        {query.ageBands.length > 0 ? (
          <input type="hidden" name="who" value={query.ageBands.join(',')} />
        ) : null}
        {query.noise !== undefined ? (
          <input type="hidden" name="noise" value={query.noise} />
        ) : null}

        <label className="min-w-0 grow">
          <span className="block text-xs font-semibold uppercase tracking-wide text-neutral-600">
            {copy.describeYourNight}
          </span>
          <input
            type="text"
            name="say"
            maxLength={300}
            autoComplete="off"
            placeholder={copy.describePlaceholder}
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
        >
          {copy.search}
        </button>
      </form>

      {said ? (
        <p className="mt-3 text-sm text-neutral-600">
          <span className="font-medium">{copy.youSaid}:</span> &ldquo;{said}&rdquo;
        </p>
      ) : null}

      {chips.length > 0 ? (
        <>
          <h2 className="mt-4 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            {copy.understood}
          </h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {chips.map((chip) => (
              <li key={`${chip.dimension}-${chip.value}`}>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-300 bg-neutral-50 py-1 ps-3 pe-1.5 text-sm text-neutral-800">
                  {chip.label}
                  {/* A link, not a button: removing a term is a different
                      search, and a different search is a different URL. */}
                  <Link
                    href={toHref(marketSlug, withoutValue(query, chip.dimension, chip.value))}
                    aria-label={`${copy.remove} ${chip.label}`}
                    className="rounded-full px-1.5 text-neutral-500 transition hover:bg-neutral-900 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
                  >
                    ×
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {missed ? (
        <p className="mt-3 text-xs text-neutral-500">
          {/* Said plainly rather than hidden. A parser that quietly drops half
              a sentence teaches people to distrust the whole thing. */}
          {copy.didNotUnderstand}: &ldquo;{missed}&rdquo;
        </p>
      ) : null}

      {question ? (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm text-amber-900">{question.prompt}</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {question.answers.map((answer) => (
              <li key={answer.href}>
                <Link
                  href={answer.href}
                  className="inline-block rounded-full border border-amber-400 bg-white px-3 py-1 text-sm text-amber-900 transition hover:border-amber-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-900"
                >
                  {answer.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
