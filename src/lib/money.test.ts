import { describe, expect, it } from 'vitest';

import {
  BasisMismatchError,
  CurrencyMismatchError,
  InvalidAmountError,
  UnsupportedCurrencyError,
  compareToCeiling,
  currency,
  format,
  formatBand,
  money,
  parseDecimal,
  positionInRange,
  priceBand,
  toDecimalString,
} from './money';

const AED = currency('AED');
const EGP = currency('EGP');

describe('currency validation', () => {
  it('accepts the pilot and second-market currencies', () => {
    expect(currency('AED')).toBe('AED');
    expect(currency('EGP')).toBe('EGP');
    expect(currency('aed')).toBe('AED');
  });

  it('throws rather than defaulting on an unknown currency', () => {
    // A new market must fail loudly at seed time, not quietly misprice.
    expect(() => currency('XYZ')).toThrow(UnsupportedCurrencyError);
    expect(() => currency('ZZ')).toThrow(UnsupportedCurrencyError);
  });
});

describe('parseDecimal — string arithmetic, never floating point', () => {
  it('parses to exact minor units', () => {
    expect(parseDecimal('150.55', AED).amountMinor).toBe(15055);
    expect(parseDecimal('150.5', AED).amountMinor).toBe(15050);
    expect(parseDecimal('150', AED).amountMinor).toBe(15000);
    expect(parseDecimal('0.05', AED).amountMinor).toBe(5);
  });

  it('is exact where float multiplication is not', () => {
    // This is the entire reason the module exists: 150.55 * 100 is
    // 15054.999999999998 in IEEE 754. Documented as a test so nobody
    // "simplifies" parseDecimal back into a multiplication.
    expect(150.55 * 100).not.toBe(15055);
    expect(parseDecimal('150.55', AED).amountMinor).toBe(15055);
  });

  it('respects per-currency minor-unit exponents', () => {
    expect(parseDecimal('1.234', 'KWD').amountMinor).toBe(1234); // 3 decimals
    expect(parseDecimal('1500', 'JPY').amountMinor).toBe(1500); // 0 decimals
  });

  it('refuses to round away precision the currency does not have', () => {
    // Rounding someone's price is a data-integrity decision, not a convenience.
    expect(() => parseDecimal('150.555', AED)).toThrow(InvalidAmountError);
    expect(() => parseDecimal('1500.5', 'JPY')).toThrow(InvalidAmountError);
  });

  it('rejects non-decimal input', () => {
    expect(() => parseDecimal('abc', AED)).toThrow(InvalidAmountError);
    expect(() => parseDecimal('-10', AED)).toThrow(InvalidAmountError);
    expect(() => parseDecimal('1.2.3', AED)).toThrow(InvalidAmountError);
  });
});

describe('money construction', () => {
  it('rejects a non-integer amount', () => {
    expect(() => money(150.5, AED)).toThrow(InvalidAmountError);
  });

  it('rejects a negative amount', () => {
    expect(() => money(-1, AED)).toThrow(InvalidAmountError);
  });

  it('round-trips through a decimal string', () => {
    expect(toDecimalString(money(15055, AED))).toBe('150.55');
    expect(toDecimalString(money(5, AED))).toBe('0.05');
    expect(toDecimalString(money(1500, 'JPY'))).toBe('1500');
  });
});

describe('formatting is locale-driven, not hardcoded', () => {
  it('includes the amount for the market locale', () => {
    expect(format(money(15055, AED), 'en-AE')).toContain('150.55');
  });

  it('produces different output per locale for the same amount', () => {
    // Proves the locale argument is actually applied. If this ever passes
    // trivially, formatting has stopped being locale-aware (doc 10).
    const value = money(15055, AED);
    expect(format(value, 'en-AE')).not.toBe(format(value, 'ar-AE'));
  });

  it('formats a band as a range and collapses a zero-width band', () => {
    const band = priceBand({
      lowMinor: 18000,
      highMinor: 26000,
      currency: AED,
      basis: 'per_person',
      includesTax: true,
      includesServiceCharge: false,
    });
    const rendered = formatBand(band, 'en-AE');
    expect(rendered).toContain('180');
    expect(rendered).toContain('260');

    const flat = priceBand({
      lowMinor: 20000,
      highMinor: 20000,
      currency: AED,
      basis: 'per_person',
      includesTax: true,
      includesServiceCharge: false,
    });
    expect(formatBand(flat, 'en-AE')).toBe(format(money(20000, AED), 'en-AE'));
  });
});

describe('priceBand invariants', () => {
  it('rejects an inverted band', () => {
    expect(() =>
      priceBand({
        lowMinor: 30000,
        highMinor: 20000,
        currency: AED,
        basis: 'per_person',
        includesTax: true,
        includesServiceCharge: false,
      }),
    ).toThrow(InvalidAmountError);
  });
});

describe('compareToCeiling — the C5 distinction', () => {
  const ceiling = money(30000, AED); // AED 300 per person

  const band = (lowMinor: number, highMinor: number) =>
    priceBand({
      lowMinor,
      highMinor,
      currency: AED,
      basis: 'per_person',
      includesTax: true,
      includesServiceCharge: false,
    });

  it('reports a band wholly under the ceiling as within', () => {
    // Jazz Loft Test: AED 180-260 against a 300 ceiling.
    expect(compareToCeiling(band(18000, 26000), ceiling, 'per_person')).toEqual({
      kind: 'within',
    });
  });

  it('reports a band straddling the ceiling as straddles, not within', () => {
    // Rock Stage Test: AED 220-350. Possible under budget, not guaranteed.
    // Doc 07 lumps this together with an unknown price; they are different
    // failures and must not collapse into one state.
    const result = compareToCeiling(band(22000, 35000), ceiling, 'per_person');
    expect(result.kind).toBe('straddles');
    if (result.kind === 'straddles') {
      expect(result.overBy.amountMinor).toBe(5000);
    }
  });

  it('reports a band entirely over the ceiling as above', () => {
    const result = compareToCeiling(band(35000, 40000), ceiling, 'per_person');
    expect(result.kind).toBe('above');
    if (result.kind === 'above') {
      expect(result.overBy.amountMinor).toBe(5000);
    }
  });

  it('refuses to compare across currencies', () => {
    // FX is a presentation estimate and must never decide eligibility (doc 10).
    const egpBand = priceBand({
      lowMinor: 18000,
      highMinor: 26000,
      currency: EGP,
      basis: 'per_person',
      includesTax: true,
      includesServiceCharge: false,
    });
    expect(() => compareToCeiling(egpBand, ceiling, 'per_person')).toThrow(
      CurrencyMismatchError,
    );
  });

  it('refuses to compare across price bases', () => {
    expect(() => compareToCeiling(band(18000, 26000), ceiling, 'minimum_spend')).toThrow(
      BasisMismatchError,
    );
  });
});

describe('positionInRange — the soft budget signal (gap G2)', () => {
  const inRange = (lowMinor: number, highMinor: number) =>
    positionInRange(
      priceBand({
        lowMinor,
        highMinor,
        currency: AED,
        basis: 'per_person',
        includesTax: true,
        includesServiceCharge: false,
      }),
      money(15000, AED),
      money(30000, AED),
    );

  it('scores the lower part of a stated range higher', () => {
    const cheap = inRange(15000, 17000);
    const dear = inRange(28000, 30000);
    expect(cheap).not.toBeNull();
    expect(dear).not.toBeNull();
    expect(cheap as number).toBeGreaterThan(dear as number);
  });

  it('returns null rather than zero when the band falls outside the range', () => {
    // Null means unscored; zero would mean "scored, and bad" — a different claim.
    expect(inRange(50000, 60000)).toBeNull();
  });
});
