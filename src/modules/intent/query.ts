/**
 * The typed query, and the URL it is.
 *
 * Chat and the refine panel edit the same object, and that object is the
 * query string. Nothing is held in a session: a search is entirely described
 * by its URL, which is what makes it shareable, reloadable, back-buttonable
 * and testable without a browser.
 *
 * A chat turn produces a patch rather than a whole query, so "cheaper" and
 * "Saturday then" mean what they say — a change to what is already there.
 */

import type { AgeBand, MustHave, NoiseBand } from '@/modules/search/types';
import { formatWhenParam } from '@/modules/search/when';
import type { WhenSpec } from '@/modules/search/when';

import type { IntentPatch } from './port';

export interface SearchQuery {
  /** The `when` parameter in its URL form: tonight, weekend, next7, a date… */
  readonly when: string;
  readonly band: string | undefined;
  readonly party: number | undefined;
  /** Whole units of the market currency. */
  readonly budget: number | undefined;
  readonly tags: readonly string[];
  readonly mustHaves: readonly MustHave[];
  readonly outingKinds: readonly string[];
  readonly ageBands: readonly AgeBand[];
  readonly noise: NoiseBand | undefined;
}

export const EMPTY_QUERY: SearchQuery = {
  when: 'tonight',
  band: undefined,
  party: undefined,
  budget: undefined,
  tags: [],
  mustHaves: [],
  outingKinds: [],
  ageBands: [],
  noise: undefined,
};

/** How far a relative "cheaper" moves a ceiling. */
const RELATIVE_STEP = 0.75;
/** Where "cheaper" starts when no ceiling has been set yet. */
const DEFAULT_CEILING_STEPS = 4;

const unique = <T>(list: readonly T[]): T[] => [...new Set(list)];

/**
 * Apply one turn to the query.
 *
 * Additive by default and replacing only when the parser says so, because
 * "and some jazz" and "jazz instead" are different sentences and conflating
 * them makes a conversation impossible to steer.
 */
export function applyPatch(
  query: SearchQuery,
  patch: IntentPatch,
  options: { readonly budgetStep?: number } = {},
): SearchQuery {
  let tags = [...query.tags];
  if (patch.replaceTags !== undefined) tags = [...patch.replaceTags];
  if (patch.addTags !== undefined) tags = unique([...tags, ...patch.addTags]);
  if (patch.removeTags !== undefined) {
    const drop = new Set(patch.removeTags);
    tags = tags.filter((key) => !drop.has(key));
  }

  let mustHaves = [...query.mustHaves];
  if (patch.addMustHaves !== undefined) {
    mustHaves = unique([...mustHaves, ...patch.addMustHaves]);
  }
  if (patch.removeMustHaves !== undefined) {
    const drop = new Set(patch.removeMustHaves);
    mustHaves = mustHaves.filter((key) => !drop.has(key));
  }

  let budget = query.budget;
  if (patch.clearBudget === true) {
    budget = undefined;
  } else if (patch.budget !== undefined) {
    budget = patch.budget;
  } else if (patch.budgetDirection !== undefined) {
    // A relative move needs something to move from. With no ceiling set, the
    // step is a sensible starting point rather than a guess at what the user
    // can afford — and it is visible as a chip they can change.
    const step = options.budgetStep ?? 50;
    const base = budget ?? step * DEFAULT_CEILING_STEPS;
    const moved =
      patch.budgetDirection === 'cheaper' ? base * RELATIVE_STEP : base / RELATIVE_STEP;
    // Rounded to the step so the chip reads as a round number rather than as
    // arithmetic leaking into the interface.
    budget = Math.max(step, Math.round(moved / step) * step);
  }

  return {
    when: patch.when !== undefined ? formatWhenParam(patch.when as WhenSpec) : query.when,
    band: patch.band ?? query.band,
    party: patch.party ?? query.party,
    budget,
    tags,
    mustHaves,
    outingKinds:
      patch.outingKinds !== undefined ? unique(patch.outingKinds) : query.outingKinds,
    ageBands: patch.ageBands !== undefined ? unique(patch.ageBands) : query.ageBands,
    noise: patch.noise ?? query.noise,
  };
}

/**
 * The query as search parameters.
 *
 * Empty values are omitted rather than written as blanks, so a bare search has
 * a short URL and two identical searches have identical links.
 */
export function toSearchParams(query: SearchQuery): URLSearchParams {
  const params = new URLSearchParams();
  params.set('when', query.when);
  if (query.band !== undefined) params.set('band', query.band);
  if (query.party !== undefined) params.set('party', String(query.party));
  if (query.budget !== undefined) params.set('budget', String(query.budget));
  if (query.tags.length > 0) params.set('tags', query.tags.join(','));
  if (query.mustHaves.length > 0) params.set('must', query.mustHaves.join(','));
  if (query.outingKinds.length > 0) params.set('kinds', query.outingKinds.join(','));
  if (query.ageBands.length > 0) params.set('who', query.ageBands.join(','));
  if (query.noise !== undefined) params.set('noise', query.noise);
  return params;
}

export function toHref(marketSlug: string, query: SearchQuery): string {
  return `/${marketSlug}/discover?${toSearchParams(query).toString()}`;
}

/** The same query with one value removed, for a chip's remove link. */
export function withoutValue(
  query: SearchQuery,
  dimension: string,
  value: string,
): SearchQuery {
  switch (dimension) {
    case 'tag':
      return { ...query, tags: query.tags.filter((k) => k !== value) };
    case 'must_have':
      return { ...query, mustHaves: query.mustHaves.filter((k) => k !== value) };
    case 'outing_kind':
      return { ...query, outingKinds: query.outingKinds.filter((k) => k !== value) };
    case 'age_band':
      return { ...query, ageBands: query.ageBands.filter((k) => k !== value) };
    case 'noise':
      return { ...query, noise: undefined };
    case 'budget':
      return { ...query, budget: undefined };
    case 'party':
      return { ...query, party: undefined };
    case 'band':
      return { ...query, band: undefined };
    default:
      return query;
  }
}
