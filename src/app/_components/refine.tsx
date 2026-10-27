import type { ReactNode } from 'react';

import { copyFor } from '@/modules/i18n/copy';
import { MUST_HAVES } from '@/modules/search/types';
import type { AgeBand, MustHave, NoiseBand } from '@/modules/search/types';
import type { ExperienceTagEntry, TaxonomyEntry, TimeBand } from '@/modules/taxonomy/queries';

/**
 * The refine panel.
 *
 * A plain GET form inside a <details>, with no client JavaScript. That is not
 * minimalism for its own sake: the chat input and this panel edit the same
 * typed query, the query is the URL, and a form that submits as a URL is the
 * version of that which works with scripting off, survives a reload, and can
 * be shared (doc 02 P1 requires the structured path to stand alone).
 *
 * Grouped the way doc 13 lists intent — when, who, budget, outing type,
 * experiences, noise, must-haves — rather than by which table a field lives in.
 */

const FIELD =
  'mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900';
const LEGEND = 'text-xs font-semibold uppercase tracking-wide text-neutral-600';

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="mt-5">
      <legend className={LEGEND}>{label}</legend>
      <div className="mt-2">{children}</div>
    </fieldset>
  );
}

/**
 * A checkbox whose value joins a comma-separated parameter.
 *
 * Repeated names arrive as repeated query parameters, which the schema reads
 * as one comma-joined string via the browser's own encoding, so no client code
 * is needed to assemble the list.
 */
function CheckboxChip({
  name,
  value,
  label,
  checked,
  note,
}: {
  name: string;
  value: string;
  label: string;
  checked: boolean;
  note?: string | undefined;
}) {
  return (
    <label className="inline-flex items-center gap-2 rounded-full border border-neutral-300 px-3 py-1.5 text-sm transition hover:border-neutral-900 has-[:checked]:border-neutral-900 has-[:checked]:bg-neutral-900 has-[:checked]:text-white">
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={checked}
        className="size-3.5 rounded border-neutral-400"
      />
      <span>{label}</span>
      {note ? <span className="text-xs opacity-70">{note}</span> : null}
    </label>
  );
}

export interface RefineState {
  readonly when: string;
  readonly band: string | undefined;
  readonly party: number | undefined;
  readonly budget: number | undefined;
  readonly tags: readonly string[];
  readonly mustHaves: readonly MustHave[];
  readonly outingKinds: readonly string[];
  readonly ageBands: readonly AgeBand[];
  readonly noise: NoiseBand | undefined;
}

const AGE_BANDS: readonly AgeBand[] = ['kids', 'teens', 'adults_only', 'seniors'];

export function RefinePanel({
  marketSlug,
  locale,
  currencyCode,
  bands,
  vocabulary,
  kinds,
  state,
  unconfirmedByMustHave,
  open,
}: {
  marketSlug: string;
  locale: string;
  currencyCode: string;
  bands: readonly TimeBand[];
  vocabulary: readonly ExperienceTagEntry[];
  kinds: readonly TaxonomyEntry[];
  state: RefineState;
  unconfirmedByMustHave: Readonly<Partial<Record<MustHave, number>>>;
  open: boolean;
}) {
  const copy = copyFor(locale);
  const chosenTags = new Set(state.tags);
  const chosenMust = new Set(state.mustHaves);
  const chosenKinds = new Set(state.outingKinds);
  const chosenWho = new Set<string>(state.ageBands);

  const facets = ['music', 'setting', 'occasion', 'activity'] as const;

  return (
    <details open={open} className="mt-6 rounded-lg border border-neutral-300 bg-white">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-neutral-900">
        {copy.refineTitle}
      </summary>

      <form action={`/${marketSlug}/discover`} method="get" className="border-t border-neutral-200 px-4 pb-5">
        <Group label={copy.whenLabel}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label>
              <span className="sr-only">{copy.whenLabel}</span>
              <select name="when" defaultValue={state.when} className={FIELD}>
                {Object.entries(copy.whenOptions).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
                {/* An exact date or range already in the query stays selectable
                    even though it is not one of the named options. */}
                {copy.whenOptions[state.when] === undefined ? (
                  <option value={state.when}>{state.when}</option>
                ) : null}
              </select>
            </label>
            <label>
              <span className="sr-only">{copy.bandLabel}</span>
              <select name="band" defaultValue={state.band ?? 'evening'} className={FIELD}>
                {bands.map((band) => (
                  <option key={band.key} value={band.key}>
                    {copy.bands[band.key] ?? band.key} ({band.startsLocal}&ndash;{band.endsLocal})
                  </option>
                ))}
              </select>
            </label>
          </div>
        </Group>

        <Group label={copy.whoIsComing}>
          <div className="flex flex-wrap gap-2">
            {AGE_BANDS.map((band) => (
              <CheckboxChip
                key={band}
                name="who"
                value={band}
                label={copy.ageBands[band] ?? band}
                checked={chosenWho.has(band)}
              />
            ))}
          </div>
          <p className="mt-2 text-xs text-neutral-500">{copy.ageBandNote}</p>
        </Group>

        <div className="mt-5 grid grid-cols-2 gap-4">
          <label>
            <span className={LEGEND}>{copy.partySize}</span>
            <input
              type="number"
              name="party"
              min={1}
              max={20}
              defaultValue={state.party ?? ''}
              className={FIELD}
            />
          </label>
          <label>
            <span className={LEGEND}>
              {copy.budgetCeiling} ({currencyCode})
            </span>
            <input
              type="number"
              name="budget"
              min={0}
              step={10}
              defaultValue={state.budget ?? ''}
              className={FIELD}
            />
            <span className="mt-1 block text-xs text-neutral-500">{copy.budgetHint}</span>
          </label>
        </div>

        <Group label={copy.outingType}>
          <div className="flex flex-wrap gap-2">
            {kinds.map((kind) => (
              <CheckboxChip
                key={kind.key}
                name="kinds"
                value={kind.key}
                label={kind.label}
                checked={chosenKinds.has(kind.key)}
              />
            ))}
          </div>
        </Group>

        <Group label={copy.experiences}>
          {facets.map((facet) => {
            const entries = vocabulary.filter((t) => t.facet === facet);
            if (entries.length === 0) return null;
            return (
              <div key={facet} className="mt-3 first:mt-0">
                <p className="text-xs text-neutral-500">{copy.facets[facet] ?? facet}</p>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {entries.map((tag) => (
                    <CheckboxChip
                      key={tag.key}
                      name="tags"
                      value={tag.key}
                      label={tag.label}
                      checked={chosenTags.has(tag.key)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </Group>

        <Group label={copy.noiseLevel}>
          <select name="noise" defaultValue={state.noise ?? ''} className={FIELD}>
            <option value="">{copy.noPreference}</option>
            {(['quiet', 'moderate', 'lively', 'loud'] as const).map((band) => (
              <option key={band} value={band}>
                {copy.noiseBands[band] ?? band}
              </option>
            ))}
          </select>
        </Group>

        <Group label={copy.mustHaves}>
          <div className="flex flex-wrap gap-2">
            {MUST_HAVES.map((key) => {
              const unconfirmed = unconfirmedByMustHave[key];
              return (
                <CheckboxChip
                  key={key}
                  name="must"
                  value={key}
                  label={copy.constraints[key] ?? key}
                  checked={chosenMust.has(key)}
                  // What switching this on would cost: how many candidates we
                  // cannot decide either way. Shown before it is switched on,
                  // so a filter that would move half the catalogue into the
                  // collapsed section says so first (ADR-011).
                  note={
                    unconfirmed !== undefined && unconfirmed > 0
                      ? `${unconfirmed} ${copy.needsConfirmationCount}`
                      : undefined
                  }
                />
              );
            })}
          </div>
        </Group>

        <button
          type="submit"
          className="mt-6 rounded-md bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
        >
          {copy.search}
        </button>
      </form>
    </details>
  );
}
