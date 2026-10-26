import Link from 'next/link';
import { notFound } from 'next/navigation';

import { db } from '@/db/client';
import { systemClock, nextWeekdayOnOrAfter } from '@/lib/time';
import { copyFor } from '@/modules/i18n/copy';
import { loadMarketBySlug, marketDisplayName } from '@/modules/markets/queries';
import { DemoBanner } from '@/app/_components/evidence';

/**
 * Intent form.
 *
 * A plain GET form, server-rendered, no client JavaScript. That is not
 * minimalism for its own sake: doc 02 puts natural-language parsing at P1 with
 * "fallback to standard filters when AI unavailable", so the structured path
 * has to work entirely on its own — and the accessible, keyboard-navigable,
 * shareable-URL version of this screen is a plain form.
 */
export default async function MarketHome({
  params,
}: {
  params: Promise<{ market: string }>;
}) {
  const { market: slug } = await params;
  const sql = db();
  const market = await loadMarketBySlug(sql, slug);
  if (!market) notFound();

  const name = await marketDisplayName(sql, market);
  const copy = copyFor(market.defaultLocale);

  // Default to the next Friday in the market's own zone, which is where the
  // product's core example starts. Resolved from the clock, not hardcoded.
  const defaultDate = nextWeekdayOnOrAfter(5, systemClock, market.timezone);

  const field = 'mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900';
  const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-neutral-600';

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <div className="flex items-baseline justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Where to Go
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-neutral-900">{name}</h1>
          <p className="mt-1 text-neutral-600">{copy.tagline}</p>
        </div>
        <Link href="/" className="text-sm text-neutral-600 underline hover:text-neutral-900">
          {copy.chooseMarket}
        </Link>
      </div>

      <div className="mt-6">
        <DemoBanner locale={market.defaultLocale} />
      </div>

      <form action={`/${market.slug}/discover`} method="get" className="mt-8 space-y-6">
        <fieldset>
          <legend className="text-sm font-semibold text-neutral-900">{copy.findNight}</legend>

          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <label className="col-span-2">
              <span className={labelClass}>{copy.date}</span>
              <input type="date" name="date" defaultValue={defaultDate} className={field} required />
            </label>
            <label>
              <span className={labelClass}>{copy.from}</span>
              <input type="time" name="from" defaultValue="19:00" className={field} required />
            </label>
            <label>
              <span className={labelClass}>{copy.to}</span>
              <input type="time" name="to" defaultValue="23:00" className={field} required />
            </label>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4">
            <label>
              <span className={labelClass}>{copy.partySize}</span>
              <input
                type="number"
                name="party"
                min={1}
                max={20}
                defaultValue={4}
                className={field}
              />
            </label>
            <label>
              <span className={labelClass}>
                {copy.budgetCeiling} ({market.currency}, {copy.perPerson})
              </span>
              <input
                type="number"
                name="budget"
                min={0}
                step={10}
                placeholder="300"
                className={field}
              />
            </label>
          </div>

          <label className="mt-4 block">
            <span className={labelClass}>{copy.musicStyles}</span>
            <input
              type="text"
              name="genres"
              placeholder="jazz, arabic, rock"
              className={field}
            />
          </label>

          {/* A soft signal, not a filter (doc 13). "No preference" drops it
              from the score denominator rather than scoring it as zero. */}
          <label className="mt-4 block">
            <span className={labelClass}>{copy.conversation}</span>
            <select name="conv" defaultValue="" className={field}>
              <option value="">{copy.noPreference}</option>
              {[1, 2, 3, 4, 5].map((level) => (
                <option key={level} value={level}>
                  {level}/5
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-neutral-500">{copy.conversationHint}</span>
          </label>
        </fieldset>

        <fieldset>
          <legend className={labelClass}>{copy.mustHaves}</legend>
          <div className="mt-2 space-y-2 text-sm">
            {[
              { name: 'live', label: copy.requireLiveMusic, defaultChecked: true },
              { name: 'accessible', label: copy.accessible, defaultChecked: false },
              { name: 'outdoor', label: copy.outdoor, defaultChecked: false },
              { name: 'family', label: copy.familyFriendly, defaultChecked: false },
              { name: 'quiet', label: copy.quietEnough, defaultChecked: false },
            ].map((item) => (
              <label key={item.name} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name={item.name}
                  value="1"
                  defaultChecked={item.defaultChecked}
                  className="size-4 rounded border-neutral-400 text-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-900"
                />
                <span className="text-neutral-800">{item.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <button
          type="submit"
          className="rounded-md bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
        >
          {copy.search}
        </button>
      </form>
    </main>
  );
}
