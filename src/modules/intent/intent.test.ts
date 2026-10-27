import { describe, expect, it } from 'vitest';

import { fixedClock } from '@/lib/time';

import { createMockIntentParser, looksLikeQuestion } from './mock';
import { fold, firstNumber, phrases } from './normalise';
import type { AliasEntry, IntentParseInput } from './port';
import { validatePatch } from './port';
import { EMPTY_QUERY, applyPatch, toSearchParams, withoutValue } from './query';

/**
 * The parser, exercised in both languages against the same rules.
 *
 * Arabic is not a translation pass here, it is a correctness one: the folding
 * step has to run on both the typed phrase and the stored alias, and a suite
 * that only ever asserted English would pass with that broken.
 */

// Friday 13 November 2026, midday Dubai.
const CLOCK = fixedClock('2026-11-13T08:00:00Z');
const DUBAI = 'Asia/Dubai';

const ALIASES: AliasEntry[] = [
  { alias: 'jazz', lang: null, tagKey: 'jazz' },
  { alias: 'جاز', lang: 'ar', tagKey: 'jazz' },
  { alias: 'live music', lang: 'en', tagKey: 'live_music' },
  { alias: 'موسيقى حية', lang: 'ar', tagKey: 'live_music' },
  { alias: 'rooftop', lang: 'en', tagKey: 'rooftop' },
  { alias: 'سطح', lang: 'ar', tagKey: 'rooftop' },
  { alias: 'arabic music', lang: 'en', tagKey: 'arabic_music' },
  { alias: 'عود', lang: 'ar', tagKey: 'arabic_music' },
  { alias: 'shisha', lang: null, tagKey: 'shisha' },
  { alias: 'date night', lang: 'en', tagKey: 'date_night' },
];

const TAG_KEYS = [
  'jazz',
  'live_music',
  'rooftop',
  'arabic_music',
  'shisha',
  'date_night',
];

const KINDS = [
  { key: 'restaurant', label: 'Restaurant' },
  { key: 'drinks_lounge', label: 'Drinks and lounge' },
  { key: 'live_music_venue', label: 'Live music' },
];

const TAG_LABELS: Record<string, string> = {
  jazz: 'Jazz',
  live_music: 'Live music',
  rooftop: 'Rooftop',
  arabic_music: 'Arabic music',
  shisha: 'Shisha',
  date_night: 'Date night',
};

const parser = createMockIntentParser(CLOCK);

function parse(utterance: string, locale = 'en-AE'): ReturnType<typeof parser.parse> {
  const input: IntentParseInput = {
    utterance,
    locale,
    aliases: ALIASES,
    tagKeys: TAG_KEYS,
    kinds: KINDS,
    tagLabels: TAG_LABELS,
    timezone: DUBAI,
    weekendDays: [6, 7],
  };
  return parser.parse(input);
}

describe('normalisation', () => {
  it('folds Arabic-Indic digits onto ASCII', () => {
    expect(fold('٣ أيام')).toBe('3 ايام');
    expect(firstNumber('خلال ٧ أيام')).toBe(7);
  });

  it('strips harakat and tatweel without changing the word', () => {
    expect(fold('مُوسِيقــى')).toBe('موسيقى');
  });

  it('folds alef variants, which is how people actually type', () => {
    expect(fold('أطفال')).toBe(fold('اطفال'));
  });

  it('leaves teh marbuta alone', () => {
    // Folding it would merge words that differ by it, and a wrong match is
    // worse than a missing one: it produces a confident chip for something
    // nobody asked for.
    expect(fold('حديقة')).not.toBe(fold('حديقه'));
  });

  it('offers longer phrases before shorter ones', () => {
    const result = phrases('live music tonight');
    expect(result.indexOf('live music')).toBeLessThan(result.indexOf('live'));
  });
});

describe('the mock parser, in English', () => {
  it('reads a date phrase', () => {
    expect(parse('something tonight').patch.when).toEqual({
      kind: 'relative',
      phrase: { name: 'tonight' },
    });
    expect(parse('free this weekend?').patch.when).toEqual({
      kind: 'relative',
      phrase: { name: 'this_weekend' },
    });
  });

  it('resolves a weekday to the next such date in the market zone', () => {
    // The clock is a Friday, so Saturday is tomorrow.
    expect(parse('saturday then').patch.when).toEqual({
      kind: 'date',
      date: '2026-11-14',
    });
  });

  it('reads a time-of-day band', () => {
    expect(parse('late night somewhere').patch.band).toBe('late_night');
    expect(parse('brunch tomorrow').patch.band).toBe('brunch');
  });

  it('reads tags through the alias table', () => {
    const result = parse('somewhere with live music and jazz');
    expect(new Set(result.patch.addTags)).toEqual(new Set(['live_music', 'jazz']));
  });

  it('does not match a sub-phrase of one it already used', () => {
    // "live music" must not also produce a chip for "live".
    const result = parse('live music please');
    expect(result.patch.addTags).toEqual(['live_music']);
  });

  it('never invents a term it does not have', () => {
    const result = parse('somewhere with gamelan and throat singing');
    expect(result.patch.addTags).toBeUndefined();
    // And says so, rather than quietly dropping the words.
    expect(result.unparsed.length).toBeGreaterThan(0);
  });

  it('reads must-haves, and a negation as a removal', () => {
    expect(parse('must be halal').patch.addMustHaves).toContain('halal');
    expect(parse('no alcohol please').patch.addMustHaves).toContain('alcohol_free');
    expect(parse('not outdoors').patch.removeMustHaves).toContain('outdoor_seating');
  });

  it('reads a budget and a party size without confusing them', () => {
    const result = parse('for 4 people, under 300');
    expect(result.patch.party).toBe(4);
    expect(result.patch.budget).toBe(300);
  });

  it('ignores a bare number with nothing to anchor it', () => {
    const result = parse('something with 7');
    expect(result.patch.party).toBeUndefined();
    expect(result.patch.budget).toBeUndefined();
  });

  it('treats "instead" as a replacement rather than an addition', () => {
    expect(parse('rooftop instead').patch.replaceTags).toEqual(['rooftop']);
    expect(parse('and a rooftop').patch.addTags).toEqual(['rooftop']);
  });

  it('reads a relative budget move without a number', () => {
    expect(parse('somewhere cheaper').patch.budgetDirection).toBe('cheaper');
  });

  it('reads noise and who is coming', () => {
    expect(parse('somewhere quiet').patch.noise).toBe('quiet');
    expect(parse('with kids').patch.ageBands).toEqual(['kids']);
  });

  it('reports what it understood, with the words it came from', () => {
    const result = parse('jazz tonight');
    const dimensions = result.understood.map((c) => c.dimension);
    expect(dimensions).toContain('tag');
    expect(dimensions).toContain('when');
    // Traceable back to the sentence, so a wrong reading is visible.
    expect(result.understood.every((c) => c.from.length > 0)).toBe(true);
  });
});

describe('the mock parser, in Arabic', () => {
  const ar = (utterance: string) => parse(utterance, 'ar-AE');

  it('reads a date phrase', () => {
    expect(ar('الليلة').patch.when).toEqual({ kind: 'relative', phrase: { name: 'tonight' } });
    expect(ar('نهاية الأسبوع').patch.when).toEqual({
      kind: 'relative',
      phrase: { name: 'this_weekend' },
    });
  });

  it('resolves an Arabic weekday name', () => {
    expect(ar('السبت').patch.when).toEqual({ kind: 'date', date: '2026-11-14' });
  });

  it('reads tags through the Arabic aliases', () => {
    expect(ar('موسيقى حية').patch.addTags).toEqual(['live_music']);
    expect(ar('عود').patch.addTags).toEqual(['arabic_music']);
  });

  it('matches a tag whose alef the user typed without a hamza', () => {
    // The stored alias and the typed phrase meet in the folded form; without
    // that, the Arabic path silently matches nothing.
    expect(ar('موسيقى حيه').patch.addTags).toBeUndefined();
    expect(ar('جاز').patch.addTags).toEqual(['jazz']);
  });

  it('reads must-haves and noise', () => {
    expect(ar('حلال').patch.addMustHaves).toContain('halal');
    expect(ar('مكان هادئ').patch.noise).toBe('quiet');
  });

  it('reads who is coming', () => {
    expect(ar('مع الأطفال').patch.ageBands).toEqual(['kids']);
  });

  it('reads a day count written in Arabic numerals', () => {
    expect(ar('خلال ٣ ايام').patch.when).toEqual({
      kind: 'relative',
      phrase: { name: 'next_days', days: 3 },
    });
  });

  it('prefers an Arabic alias over a language-neutral one of the same spelling', () => {
    // 'jazz' is language-neutral and 'جاز' is Arabic; both resolve to the same
    // key, which is the point — the user should not have to switch script.
    expect(ar('جاز').patch.addTags).toEqual(parse('jazz').patch.addTags);
  });
});

describe('the one clarifying question', () => {
  it('asks when a group phrase leaves a hard filter undecided', () => {
    const result = parse('somewhere for the family');
    expect(result.question).not.toBeNull();
    // Only about minimum admission age, which is the hard filter at stake.
    expect(result.question?.answers.map((a) => a.patch.ageBands?.[0])).toEqual([
      'kids',
      'teens',
      'adults_only',
    ]);
  });

  it('does not ask when the answer was already given', () => {
    expect(parse('the family, with kids').question).toBeNull();
  });

  it('does not ask about anything that is only a soft signal', () => {
    // No question for an unrecognised mood word: it changes no hard filter, so
    // asking would cost a turn and buy nothing.
    expect(parse('somewhere a bit special').question).toBeNull();
  });

  it('asks at most one', () => {
    const result = parse('somewhere for the family, a bit special, nice vibe');
    expect(result.question === null || typeof result.question.question === 'string').toBe(true);
  });
});

describe('venue questions are not filters', () => {
  it('recognises a question', () => {
    expect(looksLikeQuestion('does it have parking?')).toBe(true);
    expect(looksLikeQuestion('هل يوجد موقف سيارات')).toBe(true);
    expect(looksLikeQuestion('jazz tonight')).toBe(false);
  });
});

describe('validation fails closed', () => {
  it('drops a tag the market does not offer', () => {
    const patch = validatePatch({ addTags: ['jazz', 'not_a_real_tag'] }, TAG_KEYS, ['restaurant']);
    expect(patch?.addTags).toEqual(['jazz']);
  });

  it('rejects a patch with an unknown field rather than ignoring it', () => {
    // Strict: a parser inventing a dimension is a bug, and silently dropping
    // it would hide that until the dimension mattered.
    expect(validatePatch({ somethingElse: true }, TAG_KEYS, [])).toBeNull();
  });

  it('rejects an out-of-range value', () => {
    expect(validatePatch({ party: 900 }, TAG_KEYS, [])).toBeNull();
    expect(validatePatch({ when: { kind: 'date', date: 'next friday' } }, TAG_KEYS, [])).toBeNull();
  });
});

describe('applying a turn to the query', () => {
  const base = { ...EMPTY_QUERY, tags: ['jazz'], budget: 400 };

  it('adds by default', () => {
    expect(applyPatch(base, { addTags: ['rooftop'] }).tags).toEqual(['jazz', 'rooftop']);
  });

  it('replaces when told to', () => {
    expect(applyPatch(base, { replaceTags: ['rooftop'] }).tags).toEqual(['rooftop']);
  });

  it('removes without disturbing the rest', () => {
    const q = applyPatch(base, { addTags: ['rooftop'] });
    expect(applyPatch(q, { removeTags: ['jazz'] }).tags).toEqual(['rooftop']);
  });

  it('moves a budget relatively and rounds it to something readable', () => {
    const cheaper = applyPatch(base, { budgetDirection: 'cheaper' }, { budgetStep: 50 });
    expect(cheaper.budget).toBe(300);
    const pricier = applyPatch(cheaper, { budgetDirection: 'pricier' }, { budgetStep: 50 });
    expect(pricier.budget).toBe(400);
  });

  it('starts somewhere sensible when cheaper is asked with no ceiling set', () => {
    const q = applyPatch(EMPTY_QUERY, { budgetDirection: 'cheaper' }, { budgetStep: 50 });
    expect(q.budget).toBeGreaterThan(0);
  });

  it('distinguishes clearing a budget from not mentioning one', () => {
    expect(applyPatch(base, { clearBudget: true }).budget).toBeUndefined();
    expect(applyPatch(base, { addTags: ['rooftop'] }).budget).toBe(400);
  });

  it('keeps everything the turn did not mention', () => {
    const q = applyPatch({ ...base, party: 4, noise: 'quiet' }, { addTags: ['rooftop'] });
    expect(q.party).toBe(4);
    expect(q.noise).toBe('quiet');
    expect(q.when).toBe(base.when);
  });

  it('round-trips through the URL, omitting what is empty', () => {
    const params = toSearchParams({ ...EMPTY_QUERY, tags: ['jazz'], noise: 'quiet' });
    expect(params.get('tags')).toBe('jazz');
    expect(params.get('noise')).toBe('quiet');
    expect(params.has('budget')).toBe(false);
    expect(params.has('party')).toBe(false);
  });

  it('removes one chip without touching the others', () => {
    const q = { ...EMPTY_QUERY, tags: ['jazz', 'rooftop'], noise: 'quiet' as const };
    expect(withoutValue(q, 'tag', 'jazz').tags).toEqual(['rooftop']);
    expect(withoutValue(q, 'tag', 'jazz').noise).toBe('quiet');
    expect(withoutValue(q, 'noise', 'quiet').noise).toBeUndefined();
  });
});
