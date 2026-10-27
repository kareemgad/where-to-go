/**
 * The intent parser port.
 *
 * ADR-004 gives a language model exactly two jobs, and this is the first:
 * turn what someone typed into a validated filter object. It never decides
 * eligibility, never ranks, and never publishes a claim. Everything it returns
 * is a proposal that the deterministic engine then acts on, and the user can
 * see and edit every part of it as chips before it does.
 *
 * Only the mock adapter exists. It is deterministic, offline, and good enough
 * to run the product with the model switched off, which is the property
 * ADR-004 actually cares about: adding a provider must be a cost decision, not
 * a rescue.
 *
 * Output is validated here rather than trusted. A parser returning a tag
 * outside the vocabulary, a party of nine hundred or a malformed date fails
 * closed — the turn is reported as not understood and the query is left
 * exactly as it was. Doc 07: invalid parser output must never reach the
 * matcher.
 */

import { z } from 'zod';

import type { AgeBand, MustHave, NoiseBand } from '@/modules/search/types';
import { MUST_HAVES } from '@/modules/search/types';
import type { WhenSpec } from '@/modules/search/when';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const WhenSchema: z.ZodType<WhenSpec> = z.union([
  z.object({ kind: z.literal('date'), date: z.string().regex(ISO_DATE) }),
  z.object({
    kind: z.literal('range'),
    from: z.string().regex(ISO_DATE),
    to: z.string().regex(ISO_DATE),
  }),
  z.object({
    kind: z.literal('relative'),
    phrase: z.union([
      z.object({ name: z.literal('tonight') }),
      z.object({ name: z.literal('tomorrow') }),
      z.object({ name: z.literal('this_weekend') }),
      z.object({ name: z.literal('next_days'), days: z.number().int().min(1).max(60) }),
    ]),
  }),
]) as z.ZodType<WhenSpec>;

const NOISE = ['quiet', 'moderate', 'lively', 'loud'] as const;
const AGE_BANDS = ['kids', 'teens', 'adults_only', 'seniors'] as const;
const BANDS = ['brunch', 'afternoon', 'evening', 'late_night'] as const;

/**
 * A change to the query, not a replacement of it.
 *
 * "Cheaper" and "outdoor instead" are edits to something that already exists,
 * so a turn returns what to change. A parser that returned a whole query would
 * have to re-derive everything the user said three turns ago, and would
 * silently drop whatever it failed to.
 */
export const IntentPatchSchema = z
  .object({
    when: WhenSchema.optional(),
    band: z.enum(BANDS).optional(),
    party: z.number().int().min(1).max(20).optional(),
    /** Whole units of the market currency. */
    budget: z.number().min(0).max(1_000_000).optional(),
    /** Explicitly removes a ceiling, which is different from not mentioning one. */
    clearBudget: z.boolean().optional(),
    /** A relative move, resolved against the current ceiling by the caller. */
    budgetDirection: z.enum(['cheaper', 'pricier']).optional(),

    addTags: z.array(z.string()).max(20).optional(),
    removeTags: z.array(z.string()).max(20).optional(),
    /** Replaces rather than adds: "outdoor instead", not "and outdoor". */
    replaceTags: z.array(z.string()).max(20).optional(),

    addMustHaves: z.array(z.enum(MUST_HAVES as readonly [MustHave, ...MustHave[]])).optional(),
    removeMustHaves: z.array(z.enum(MUST_HAVES as readonly [MustHave, ...MustHave[]])).optional(),

    outingKinds: z.array(z.string()).max(12).optional(),
    ageBands: z.array(z.enum(AGE_BANDS)).max(4).optional(),
    noise: z.enum(NOISE).optional(),
  })
  .strict();

export type IntentPatch = z.infer<typeof IntentPatchSchema>;

/**
 * One thing the parser understood, shown back as an editable chip.
 *
 * Doc 02 P1: "visible editable chips". The user sees what was taken from their
 * sentence and can remove any of it, which is the mechanism that makes a
 * parser safe to be wrong — a silent misreading is the failure mode worth
 * engineering against.
 */
export interface UnderstoodChip {
  readonly dimension:
    | 'when'
    | 'band'
    | 'party'
    | 'budget'
    | 'tag'
    | 'must_have'
    | 'outing_kind'
    | 'age_band'
    | 'noise';
  /** The parameter value this chip corresponds to, for the remove link. */
  readonly value: string;
  /** Already localised; never a raw vocabulary key. */
  readonly label: string;
  /** The words this was taken from, so a wrong reading is traceable. */
  readonly from: string;
}

/**
 * At most one question, asked only when a hard filter hangs on the answer.
 *
 * Not a conversation. A question that does not change which venues are
 * eligible costs the user a turn and buys nothing.
 */
export interface ClarifyingQuestion {
  readonly question: string;
  readonly answers: readonly { readonly label: string; readonly patch: IntentPatch }[];
}

export interface IntentResult {
  readonly patch: IntentPatch;
  readonly understood: readonly UnderstoodChip[];
  readonly question: ClarifyingQuestion | null;
  /** Words that matched nothing, so the UI can say what it ignored. */
  readonly unparsed: readonly string[];
}

export interface AliasEntry {
  readonly alias: string;
  readonly lang: string | null;
  readonly tagKey: string;
}

export interface IntentParseInput {
  readonly utterance: string;
  /** BCP 47, from the market record. */
  readonly locale: string;
  readonly aliases: readonly AliasEntry[];
  /** Vocabulary keys this market offers, for validating what the parser found. */
  readonly tagKeys: readonly string[];
  /** Outing kind keys and their localised labels. */
  readonly kinds: readonly { readonly key: string; readonly label: string }[];
  readonly tagLabels: Readonly<Record<string, string>>;
  /** For resolving relative dates in the market's own zone. */
  readonly timezone: string;
  readonly weekendDays: readonly number[];
}

export interface IntentParser {
  readonly name: string;
  parse(input: IntentParseInput): IntentResult;
}

/**
 * Validate a parser's output, discarding anything outside the vocabulary.
 *
 * A tag key the market does not offer is dropped rather than rejecting the
 * whole turn: the rest of what the user said is still usable, and a chip for
 * a term that does not exist would be a filter they could never satisfy.
 */
export function validatePatch(
  patch: unknown,
  tagKeys: readonly string[],
  kindKeys: readonly string[],
): IntentPatch | null {
  const parsed = IntentPatchSchema.safeParse(patch);
  if (!parsed.success) return null;

  const tags = new Set(tagKeys);
  const kinds = new Set(kindKeys);
  const keepTags = (list: readonly string[] | undefined) =>
    list === undefined ? undefined : list.filter((key) => tags.has(key));

  const cleaned: IntentPatch = {
    ...parsed.data,
    ...(parsed.data.addTags !== undefined ? { addTags: keepTags(parsed.data.addTags) } : {}),
    ...(parsed.data.removeTags !== undefined
      ? { removeTags: keepTags(parsed.data.removeTags) }
      : {}),
    ...(parsed.data.replaceTags !== undefined
      ? { replaceTags: keepTags(parsed.data.replaceTags) }
      : {}),
    ...(parsed.data.outingKinds !== undefined
      ? { outingKinds: parsed.data.outingKinds.filter((key) => kinds.has(key)) }
      : {}),
  };

  return cleaned;
}

export type { AgeBand, MustHave, NoiseBand };
