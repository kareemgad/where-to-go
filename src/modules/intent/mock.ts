/**
 * The deterministic intent parser.
 *
 * Rules over a folded string, no model, no network, no key. This is the
 * adapter ADR-004 calls the fallback, and it is the only one that exists: the
 * product has to be fully usable with the model switched off, so adding a
 * provider later is a cost decision rather than a rescue.
 *
 * Three properties it keeps that a model would have to be constrained into:
 *
 *  - It never invents a term. Tags come from the alias table or not at all, so
 *    a chip can only ever say something the vocabulary already contains.
 *  - It is reproducible. The same sentence gives the same patch on every run,
 *    which is what makes a search shareable as a URL.
 *  - It says what it ignored. Words that matched nothing come back in
 *    `unparsed`, so the interface can admit the gap rather than papering over
 *    it with a confident reading.
 */

import { DateTime } from 'luxon';

import type { Clock } from '@/lib/time';
import { localDate } from '@/lib/time';
import type { AgeBand, MustHave, NoiseBand } from '@/modules/search/types';
import type { WhenSpec } from '@/modules/search/when';

import { fold, languageOf, meaningful, phrases, words } from './normalise';
import type {
  ClarifyingQuestion,
  IntentParseInput,
  IntentParser,
  IntentResult,
  UnderstoodChip,
} from './port';
import { validatePatch } from './port';

/**
 * Phrase tables.
 *
 * Written out rather than generated, because each entry is a judgement about
 * what someone means and that judgement should be visible and reviewable. A
 * phrase appears once: two entries claiming the same words would make the
 * result depend on iteration order.
 */

const WHEN_PHRASES: readonly { match: readonly string[]; when: WhenSpec }[] = [
  { match: ['tonight', 'this evening', 'الليلة', 'الليله'], when: { kind: 'relative', phrase: { name: 'tonight' } } },
  { match: ['tomorrow', 'غدا', 'بكرة', 'بكره'], when: { kind: 'relative', phrase: { name: 'tomorrow' } } },
  {
    match: ['this weekend', 'the weekend', 'weekend', 'نهاية الاسبوع', 'الويكند'],
    when: { kind: 'relative', phrase: { name: 'this_weekend' } },
  },
];

/** ISO weekday numbers, for "Saturday then". */
const WEEKDAY_WORDS: readonly { match: readonly string[]; weekday: number }[] = [
  { match: ['monday', 'الاثنين', 'الاتنين'], weekday: 1 },
  { match: ['tuesday', 'الثلاثاء'], weekday: 2 },
  { match: ['wednesday', 'الاربعاء'], weekday: 3 },
  { match: ['thursday', 'الخميس'], weekday: 4 },
  { match: ['friday', 'الجمعة', 'الجمعه'], weekday: 5 },
  { match: ['saturday', 'السبت'], weekday: 6 },
  { match: ['sunday', 'الاحد'], weekday: 7 },
];

const BAND_PHRASES: readonly { match: readonly string[]; band: string }[] = [
  { match: ['brunch', 'برانش'], band: 'brunch' },
  { match: ['afternoon', 'بعد الظهر'], band: 'afternoon' },
  { match: ['evening', 'المساء', 'بالمساء'], band: 'evening' },
  { match: ['late night', 'late', 'after midnight', 'متاخر', 'بعد منتصف الليل'], band: 'late_night' },
];

const NOISE_PHRASES: readonly { match: readonly string[]; noise: NoiseBand }[] = [
  { match: ['quiet', 'calm', 'chilled', 'هادي', 'هادئ'], noise: 'quiet' },
  { match: ['moderate', 'متوسط'], noise: 'moderate' },
  { match: ['lively', 'buzzy', 'حيوي'], noise: 'lively' },
  { match: ['loud', 'صاخب'], noise: 'loud' },
];

const AGE_PHRASES: readonly { match: readonly string[]; band: AgeBand }[] = [
  { match: ['kids', 'children', 'with kids', 'اطفال', 'مع الاطفال'], band: 'kids' },
  { match: ['teens', 'teenagers', 'مراهقين'], band: 'teens' },
  { match: ['adults only', 'no kids', 'بالغين فقط'], band: 'adults_only' },
  { match: ['seniors', 'grandparents', 'كبار السن'], band: 'seniors' },
];

const MUST_HAVE_PHRASES: readonly { match: readonly string[]; key: MustHave }[] = [
  { match: ['live music', 'live band', 'live performance', 'موسيقى حية', 'عرض حي'], key: 'live_performance' },
  { match: ['outdoor seating', 'outdoors', 'outside', 'جلسات خارجية', 'بالخارج'], key: 'outdoor_seating' },
  { match: ['indoor seating', 'indoors', 'inside', 'جلسات داخلية', 'بالداخل'], key: 'indoor_seating' },
  {
    match: ['wheelchair', 'step free', 'stepfree', 'accessible', 'كرسي متحرك', 'بدون درجات'],
    key: 'wheelchair_accessible',
  },
  { match: ['kids welcome', 'family friendly', 'مناسب للاطفال', 'يرحب بالاطفال'], key: 'kids_welcome' },
  { match: ['licensed', 'serves alcohol', 'مرخص'], key: 'licensed' },
  { match: ['alcohol free', 'no alcohol', 'dry', 'بدون كحول', 'خالي من الكحول'], key: 'alcohol_free' },
  { match: ['halal', 'حلال'], key: 'halal' },
  { match: ['reservation', 'reservations', 'book a table', 'حجز', 'يقبل الحجز'], key: 'takes_reservations' },
  {
    match: ['past midnight', 'open late', 'until late', 'بعد منتصف الليل', 'مفتوح متاخر'],
    key: 'open_past_midnight',
  },
];

/** Words that turn an addition into a replacement. */
const REPLACE_MARKERS = ['instead', 'rather than', 'not', 'بدل', 'بدلا', 'مش', 'ليس'];

const CHEAPER = ['cheaper', 'less expensive', 'lower budget', 'ارخص', 'اقل'];
const PRICIER = ['pricier', 'more expensive', 'higher budget', 'اغلى'];

/** "under 300", "max 300", "up to 300", "اقل من ٣٠٠" */
const BUDGET_MARKERS = ['under', 'max', 'maximum', 'up to', 'below', 'budget', 'اقل من', 'حتى', 'ميزانية'];
/** "for 4", "party of 6", "4 people", "لاربعة", "٤ اشخاص" */
const PARTY_MARKERS = ['people', 'person', 'of us', 'party of', 'for', 'اشخاص', 'افراد', 'نفر'];

const QUESTION_STARTS = ['do', 'does', 'is', 'are', 'can', 'has', 'have', 'what', 'هل', 'ما', 'ايه'];

/**
 * Phrases that name a group without saying whether under-18s are in it.
 *
 * The one case worth a clarifying question: minimum admission age is a hard
 * filter, and "the family" does not say which side of it the party falls on.
 */
const AGE_AMBIGUOUS = ['family', 'the family', 'everyone', 'all of us', 'العائلة', 'كلنا'];

function containsAny(haystack: string, needles: readonly string[]): string | null {
  for (const needle of needles) {
    if (haystack === needle) return needle;
    if (haystack.includes(` ${needle} `)) return needle;
    if (haystack.startsWith(`${needle} `)) return needle;
    if (haystack.endsWith(` ${needle}`)) return needle;
  }
  return null;
}

/** The next occurrence of an ISO weekday, today counting as a match. */
function nextWeekday(weekday: number, timezone: string, clock: Clock) {
  const today = DateTime.fromJSDate(clock.now()).setZone(timezone).startOf('day');
  const delta = (weekday - today.weekday + 7) % 7;
  return localDate(today.plus({ days: delta }).toFormat('yyyy-MM-dd'));
}

export function createMockIntentParser(clock: Clock): IntentParser {
  return {
    name: 'mock',

    parse(input: IntentParseInput): IntentResult {
      const text = ` ${fold(input.utterance)} `;
      const bare = fold(input.utterance);
      const language = languageOf(input.locale);
      const understood: UnderstoodChip[] = [];
      const consumed = new Set<string>();
      const draft: Record<string, unknown> = {};

      const note = (
        dimension: UnderstoodChip['dimension'],
        value: string,
        label: string,
        from: string,
      ) => {
        understood.push({ dimension, value, label, from });
        for (const word of words(from)) consumed.add(word);
      };

      const replacing = containsAny(text, REPLACE_MARKERS) !== null;

      // --- when -------------------------------------------------------------
      for (const entry of WHEN_PHRASES) {
        const hit = containsAny(text, entry.match);
        if (hit) {
          draft['when'] = entry.when;
          note('when', hit, hit, hit);
          break;
        }
      }
      if (draft['when'] === undefined) {
        for (const entry of WEEKDAY_WORDS) {
          const hit = containsAny(text, entry.match);
          if (hit) {
            const date = nextWeekday(entry.weekday, input.timezone, clock);
            draft['when'] = { kind: 'date', date };
            note('when', date, `${hit} (${date})`, hit);
            break;
          }
        }
      }
      // "next 3 days", "خلال ٣ ايام"
      const nextDays = /next (\d{1,2}) (?:days|nights)|(\d{1,2}) (?:ايام|يوم)/.exec(bare);
      if (draft['when'] === undefined && nextDays) {
        const days = Number(nextDays[1] ?? nextDays[2]);
        if (Number.isInteger(days) && days >= 1) {
          draft['when'] = { kind: 'relative', phrase: { name: 'next_days', days } };
          note('when', `next${days}`, nextDays[0], nextDays[0]);
        }
      }

      // --- time of day ------------------------------------------------------
      for (const entry of BAND_PHRASES) {
        const hit = containsAny(text, entry.match);
        if (hit) {
          draft['band'] = entry.band;
          note('band', entry.band, hit, hit);
          break;
        }
      }

      // --- budget and party -------------------------------------------------
      // Both are "a number near a marker word". Checked in this order because
      // "for 4" is a party and "under 400" is a budget, and a bare number with
      // no marker is too ambiguous to guess at either.
      const budgetMarker = containsAny(text, BUDGET_MARKERS);
      const partyMarker = containsAny(text, PARTY_MARKERS);
      const numbers = [...bare.matchAll(/\d+/g)].map((m) => Number(m[0]));

      if (budgetMarker && numbers.length > 0) {
        const amount = Math.max(...numbers);
        draft['budget'] = amount;
        note('budget', String(amount), `${budgetMarker} ${amount}`, `${budgetMarker} ${amount}`);
      }
      if (partyMarker && numbers.length > 0) {
        const party = numbers.find((n) => n >= 1 && n <= 20);
        if (party !== undefined && party !== draft['budget']) {
          draft['party'] = party;
          note('party', String(party), `${party}`, `${partyMarker} ${party}`);
        }
      }
      if (containsAny(text, CHEAPER)) {
        draft['budgetDirection'] = 'cheaper';
        note('budget', 'cheaper', 'cheaper', containsAny(text, CHEAPER) ?? 'cheaper');
      } else if (containsAny(text, PRICIER)) {
        draft['budgetDirection'] = 'pricier';
        note('budget', 'pricier', 'pricier', containsAny(text, PRICIER) ?? 'pricier');
      }

      // --- noise ------------------------------------------------------------
      for (const entry of NOISE_PHRASES) {
        const hit = containsAny(text, entry.match);
        if (hit) {
          draft['noise'] = entry.noise;
          note('noise', entry.noise, hit, hit);
          break;
        }
      }

      // --- who is coming ----------------------------------------------------
      const ageBands: AgeBand[] = [];
      for (const entry of AGE_PHRASES) {
        const hit = containsAny(text, entry.match);
        if (hit && !ageBands.includes(entry.band)) {
          ageBands.push(entry.band);
          note('age_band', entry.band, hit, hit);
        }
      }
      if (ageBands.length > 0) draft['ageBands'] = ageBands;

      // --- must-haves -------------------------------------------------------
      const addMustHaves: MustHave[] = [];
      const removeMustHaves: MustHave[] = [];
      for (const entry of MUST_HAVE_PHRASES) {
        const hit = containsAny(text, entry.match);
        if (!hit) continue;
        // "not outdoors" removes rather than adds. Checked against the words
        // immediately before the phrase, not the whole sentence: "outdoor, not
        // too loud" is not a request to drop outdoor seating.
        const index = text.indexOf(hit);
        const preceding = text.slice(Math.max(0, index - 12), index);
        if (/\b(?:not|no|without|بدون|مش)\s*$/.test(preceding)) {
          removeMustHaves.push(entry.key);
        } else {
          addMustHaves.push(entry.key);
        }
        note('must_have', entry.key, hit, hit);
      }
      if (addMustHaves.length > 0) draft['addMustHaves'] = addMustHaves;
      if (removeMustHaves.length > 0) draft['removeMustHaves'] = removeMustHaves;

      // --- outing kinds -----------------------------------------------------
      const kindHits: string[] = [];
      for (const kind of input.kinds) {
        const hit = containsAny(text, [fold(kind.label), fold(kind.key.replace(/_/g, ' '))]);
        if (hit && !kindHits.includes(kind.key)) {
          kindHits.push(kind.key);
          note('outing_kind', kind.key, kind.label, hit);
        }
      }
      if (kindHits.length > 0) draft['outingKinds'] = kindHits;

      // --- experience tags --------------------------------------------------
      // Longest phrase first, and a phrase is only used once: without that,
      // "live music" would also match the single word "live" and produce two
      // chips for one intent.
      const tagHits: string[] = [];
      const aliasIndex = new Map<string, string>();
      for (const entry of input.aliases) {
        if (entry.lang !== null && entry.lang !== language) continue;
        aliasIndex.set(fold(entry.alias), entry.tagKey);
      }
      // Language-neutral aliases fill any gaps.
      for (const entry of input.aliases) {
        const folded = fold(entry.alias);
        if (entry.lang === null && !aliasIndex.has(folded)) aliasIndex.set(folded, entry.tagKey);
      }

      const usedWords = new Set<string>();
      for (const phrase of phrases(input.utterance)) {
        const key = aliasIndex.get(phrase);
        if (key === undefined || tagHits.includes(key)) continue;
        const parts = words(phrase);
        if (parts.some((w) => usedWords.has(w))) continue;
        for (const w of parts) usedWords.add(w);
        tagHits.push(key);
        note('tag', key, input.tagLabels[key] ?? key, phrase);
      }
      if (tagHits.length > 0) {
        if (replacing) draft['replaceTags'] = tagHits;
        else draft['addTags'] = tagHits;
      }

      // --- at most one question ---------------------------------------------
      let question: ClarifyingQuestion | null = null;
      const ambiguous = containsAny(text, AGE_AMBIGUOUS);
      if (ambiguous && ageBands.length === 0) {
        // The only question worth asking here: minimum admission age is a hard
        // filter, and "the family" does not say which side of it this party is
        // on. Everything else the parser is unsure about is a soft signal, and
        // asking about those costs a turn and changes nothing.
        question = {
          question: ambiguous,
          answers: [
            { label: 'kids', patch: { ageBands: ['kids'] } },
            { label: 'teens', patch: { ageBands: ['teens'] } },
            { label: 'adults_only', patch: { ageBands: ['adults_only'] } },
          ],
        };
      }

      const patch = validatePatch(
        draft,
        input.tagKeys,
        input.kinds.map((k) => k.key),
      );

      // Fail closed. An unparseable draft leaves the query untouched rather
      // than applying the half of it that happened to validate (doc 07).
      if (patch === null) {
        return {
          patch: {},
          understood: [],
          question: null,
          unparsed: meaningful(words(input.utterance)),
        };
      }

      return {
        patch,
        understood,
        question,
        unparsed: meaningful(
          words(input.utterance).filter((w) => !consumed.has(w) && !usedWords.has(w)),
        ),
      };
    },
  };
}

/** True when the utterance reads as a question about a venue rather than a filter. */
export function looksLikeQuestion(utterance: string): boolean {
  const parts = words(utterance);
  const first = parts[0];
  return (
    (first !== undefined && QUESTION_STARTS.includes(first)) || utterance.trim().endsWith('?')
  );
}
