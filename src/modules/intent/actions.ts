'use server';

/**
 * A chat turn.
 *
 * The whole conversation is one server action and a redirect. The utterance
 * and the current query arrive together as form fields, the parser produces a
 * patch, the patch is applied, and the browser is sent to the resulting URL.
 *
 * No session, no client JavaScript, no state anywhere but the address bar.
 * That is what makes "cheaper" and "Saturday then" work with scripting off,
 * survive a reload, and stay shareable — and it is why the no-JavaScript path
 * is not a fallback here but the only path there is.
 */

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { db } from '@/db/client';
import { systemClock } from '@/lib/time';
import { loadMarketBySlug } from '@/modules/markets/queries';
import { MUST_HAVES } from '@/modules/search/types';
import type { AgeBand, MustHave, NoiseBand } from '@/modules/search/types';
import { loadExperienceTags, loadOutingKinds } from '@/modules/taxonomy/queries';

import { createMockIntentParser } from './mock';
import { loadAliases } from './queries';
import { applyPatch, toHref } from './query';
import type { SearchQuery } from './query';

const NOISE = ['quiet', 'moderate', 'lively', 'loud'] as const;
const AGE_BANDS = ['kids', 'teens', 'adults_only', 'seniors'] as const;

/**
 * The current query, as the form carries it back.
 *
 * Validated rather than trusted even though this page produced it: it has been
 * through the user's browser, and a hidden field is as editable as any other.
 */
const CarriedQuery = z.object({
  when: z.string().min(1).max(40).default('tonight'),
  band: z.string().max(20).optional(),
  party: z.coerce.number().int().min(1).max(20).optional(),
  budget: z.coerce.number().min(0).max(1_000_000).optional(),
  tags: z.string().max(400).optional(),
  must: z.string().max(400).optional(),
  kinds: z.string().max(400).optional(),
  who: z.string().max(100).optional(),
  noise: z.enum(NOISE).optional(),
});

function listFrom<T extends string>(raw: string | undefined, allowed: readonly T[]): T[] {
  if (!raw) return [];
  const permitted = new Set<string>(allowed);
  return [...new Set(raw.split(',').map((p) => p.trim()).filter((p) => permitted.has(p)))] as T[];
}

/** Characters the parser will never need, and a length nobody types by hand. */
const MAX_UTTERANCE = 300;

export async function chatTurn(form: FormData): Promise<void> {
  const marketSlug = String(form.get('market') ?? '');
  const utterance = String(form.get('say') ?? '').slice(0, MAX_UTTERANCE);

  const sql = db();
  const market = await loadMarketBySlug(sql, marketSlug);
  if (!market) redirect('/');

  const carried = CarriedQuery.safeParse(Object.fromEntries(form.entries()));
  const raw = carried.success ? carried.data : CarriedQuery.parse({});

  const [vocabulary, kinds, aliases] = await Promise.all([
    loadExperienceTags(sql, market.id, market.defaultLocale),
    loadOutingKinds(sql, market.id, market.defaultLocale),
    loadAliases(sql, market.id),
  ]);

  const tagKeys = vocabulary.map((t) => t.key);
  const kindKeys = kinds.map((k) => k.key);

  const current: SearchQuery = {
    when: raw.when,
    band: raw.band,
    party: raw.party,
    budget: raw.budget,
    tags: listFrom(raw.tags, tagKeys),
    mustHaves: listFrom<MustHave>(raw.must, MUST_HAVES),
    outingKinds: listFrom(raw.kinds, kindKeys),
    ageBands: listFrom<AgeBand>(raw.who, AGE_BANDS),
    ...(raw.noise !== undefined ? { noise: raw.noise as NoiseBand } : { noise: undefined }),
  };

  // Nothing said: go to the results for the query as it stands rather than
  // treating an empty box as a command.
  if (utterance.trim() === '') redirect(toHref(market.slug, current));

  const parser = createMockIntentParser(systemClock);
  const result = parser.parse({
    utterance,
    locale: market.defaultLocale,
    aliases,
    tagKeys,
    kinds: kinds.map((k) => ({ key: k.key, label: k.label })),
    tagLabels: Object.fromEntries(vocabulary.map((t) => [t.key, t.label])),
    timezone: market.timezone,
    weekendDays: market.weekendDays,
  });

  // The step comes from the market record. The first version of this was a
  // ternary on the currency code, which the market guard caught: correct
  // behaviour, wrong place, and the shape that breaks the third market.
  const next = applyPatch(current, result.patch, { budgetStep: market.budgetStep });

  const params = new URLSearchParams(toHref(market.slug, next).split('?')[1] ?? '');

  // The turn itself travels in the URL so the results page can show what was
  // understood, what it ignored, and any question — without holding a session.
  params.set('said', utterance);
  if (result.question !== null) params.set('ask', result.question.question);
  if (result.unparsed.length > 0) params.set('missed', result.unparsed.join(' '));

  redirect(`/${market.slug}/discover?${params.toString()}`);
}
