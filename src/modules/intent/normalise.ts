/**
 * Text normalisation for intent parsing.
 *
 * Both sides of every comparison go through this: the phrase the user typed
 * and the alias stored in the vocabulary. Normalising only one side is the
 * classic way to build a matcher that works in English and silently fails in
 * Arabic, because the stored alias is spelled one way and the typed word
 * another.
 *
 * Deliberately conservative. Every transformation here is one that cannot
 * change which word is meant:
 *
 *  - Arabic-Indic and Eastern Arabic-Indic digits become ASCII, so "٣ أيام"
 *    and "3 days" are the same request.
 *  - Harakat (the optional short-vowel marks) are dropped. They are rarely
 *    typed and never distinguish the words in this vocabulary.
 *  - Tatweel, the kashida used to stretch a word visually, carries no meaning.
 *  - Alef variants fold to bare alef, which is how people actually type.
 *
 * Not done, on purpose: teh marbuta is left alone. Folding it to heh would
 * merge words that differ by it, and a wrong match produces a confident chip
 * for something the user never asked for — worse than no match at all.
 */

/** ٠-٩ and ۰-۹ onto 0-9. */
const ARABIC_INDIC = /[٠-٩۰-۹]/g;

/** Harakat and other combining marks. */
const DIACRITICS = /[ً-ٰٟۖ-ۭ]/g;

/** Tatweel. */
const TATWEEL = /ـ/g;

/** أ إ آ ٱ onto ا. */
const ALEF_VARIANTS = /[آأإٱ]/g;

/** Anything that is not a letter, a digit or a space, across scripts. */
const PUNCTUATION = /[^\p{L}\p{N}\s]/gu;

function foldDigits(value: string): string {
  return value.replace(ARABIC_INDIC, (digit) => {
    const code = digit.codePointAt(0) ?? 0;
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  });
}

/**
 * Fold a string for matching.
 *
 * Returns a single-spaced, lowercase string. Used for aliases and for user
 * input alike, so they meet in the same shape.
 */
export function fold(value: string): string {
  return foldDigits(value)
    .replace(DIACRITICS, '')
    .replace(TATWEEL, '')
    .replace(ALEF_VARIANTS, 'ا')
    .replace(PUNCTUATION, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Folded words, in order. */
export function words(value: string): string[] {
  const folded = fold(value);
  return folded === '' ? [] : folded.split(' ');
}

/**
 * Every contiguous run of up to `maxLength` words, longest first.
 *
 * Longest first matters: "live music" has to be tried before "live", or a
 * two-word term is never found because its first word already matched
 * something else.
 */
export function phrases(value: string, maxLength = 3): string[] {
  const parts = words(value);
  const out: string[] = [];
  for (let size = Math.min(maxLength, parts.length); size >= 1; size -= 1) {
    for (let start = 0; start + size <= parts.length; start += 1) {
      out.push(parts.slice(start, start + size).join(' '));
    }
  }
  return out;
}

/**
 * The first integer in the text, or null.
 *
 * Runs after digit folding, so Arabic-Indic numerals are found too.
 */
export function firstNumber(value: string): number | null {
  const match = /\d+/.exec(fold(value));
  return match ? Number(match[0]) : null;
}

/** The primary language subtag of a BCP 47 locale. */
export function languageOf(locale: string): string {
  const [language] = locale.split('-');
  return (language ?? locale).toLowerCase();
}

/**
 * Words not worth reporting as unparsed.
 *
 * "We could not place: for the" is technically true and useless. The message
 * exists so a user can see which of *their meaningful words* were ignored, and
 * padding it with function words buries that.
 */
const STOPWORDS = new Set([
  // English
  'a', 'an', 'the', 'and', 'or', 'but', 'for', 'of', 'to', 'in', 'on', 'at',
  'with', 'without', 'some', 'something', 'somewhere', 'anywhere', 'place',
  'places', 'me', 'my', 'we', 'us', 'our', 'i', 'is', 'are', 'be', 'please',
  'want', 'looking', 'find', 'go', 'going', 'out', 'night', 'nights', 'then',
  'bit', 'nice', 'good', 'like', 'that', 'this', 'it', 'its', 'about',
  // Arabic
  'في', 'من', 'الى', 'على', 'عن', 'مع', 'او', 'و', 'ال', 'هذا', 'هذه',
  'مكان', 'اماكن', 'شي', 'شيء', 'نريد', 'اريد', 'ابحث', 'عايز', 'عاوز',
  'ليلة', 'ليله', 'يكون', 'كان', 'لو', 'سمحت',
]);

/** Meaningful leftovers only. */
export function meaningful(list: readonly string[]): string[] {
  return list.filter((word) => !STOPWORDS.has(word) && word.length > 1);
}
