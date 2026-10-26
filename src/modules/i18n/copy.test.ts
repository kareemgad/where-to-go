import { describe, expect, it } from 'vitest';

import { copyFor, directionOf, languageOf, negotiateLanguage } from './copy';

describe('languageOf', () => {
  it('takes the language subtag, ignoring the region', () => {
    expect(languageOf('ar-EG')).toBe('ar');
    expect(languageOf('ar-AE')).toBe('ar');
    expect(languageOf('en-AE')).toBe('en');
  });

  it('falls back to English for anything unsupported', () => {
    expect(languageOf('fr-FR')).toBe('en');
    expect(languageOf('')).toBe('en');
  });
});

describe('directionOf', () => {
  it('returns rtl for Arabic markets and ltr for English ones', () => {
    expect(directionOf('ar-EG')).toBe('rtl');
    expect(directionOf('ar-AE')).toBe('rtl');
    expect(directionOf('en-AE')).toBe('ltr');
  });

  it('handles a right-to-left language the product has no copy for', () => {
    // The direction comes from Intl, not from the copy dictionary, so a market
    // added later renders correctly before anything is translated (ADR-012).
    expect(directionOf('he-IL')).toBe('rtl');
    expect(directionOf('fa-IR')).toBe('rtl');
  });

  it('does not throw on a malformed tag', () => {
    expect(() => directionOf('not a locale')).not.toThrow();
    expect(directionOf('not a locale')).toBe('ltr');
  });
});

describe('negotiateLanguage', () => {
  it('picks the highest-quality supported language', () => {
    expect(negotiateLanguage('ar-EG,ar;q=0.9,en;q=0.8')).toBe('ar');
    expect(negotiateLanguage('en-GB,en;q=0.9')).toBe('en');
  });

  it('respects quality ordering rather than header order', () => {
    expect(negotiateLanguage('en;q=0.3,ar;q=0.9')).toBe('ar');
  });

  it('skips languages it has no copy for', () => {
    expect(negotiateLanguage('fr-FR,de;q=0.9,ar;q=0.5')).toBe('ar');
  });

  it('falls back to English when nothing matches or the header is absent', () => {
    expect(negotiateLanguage(null)).toBe('en');
    expect(negotiateLanguage('')).toBe('en');
    expect(negotiateLanguage('fr-FR,de;q=0.9')).toBe('en');
    expect(negotiateLanguage('*')).toBe('en');
  });

  it('ignores a language the user explicitly refused', () => {
    expect(negotiateLanguage('ar;q=0,en;q=0.5')).toBe('en');
  });
});

describe('copyFor', () => {
  it('returns every key in both languages', () => {
    // A missing key would render as undefined in the UI, which is worse than an
    // untranslated string. Compared structurally rather than by eye.
    const en = copyFor('en-AE') as unknown as Record<string, unknown>;
    const ar = copyFor('ar-EG') as unknown as Record<string, unknown>;
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
  });

  it('has no empty strings except the deliberately blank not_shown label', () => {
    for (const locale of ['en-AE', 'ar-EG']) {
      const dict = copyFor(locale) as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(dict)) {
        if (typeof value === 'string') {
          expect(value.length, `${locale}.${key}`).toBeGreaterThan(0);
        } else if (value && typeof value === 'object') {
          for (const [sub, text] of Object.entries(value as Record<string, string>)) {
            if (sub === 'not_shown') continue;
            expect(text.length, `${locale}.${key}.${sub}`).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('covers every confidence label the deriving function can produce', () => {
    const labels = [
      'venue_confirmed',
      'editor_verified',
      'visitor_reported',
      'unverified_estimate',
      'needs_recheck',
      'conflicting',
      'unknown',
      'not_shown',
    ];
    for (const locale of ['en-AE', 'ar-EG']) {
      for (const label of labels) {
        expect(copyFor(locale).confidence[label], `${locale}.${label}`).toBeDefined();
      }
    }
  });
});
