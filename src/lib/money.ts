/**
 * Money — integer minor units, explicit ISO 4217 currency, explicit price basis.
 *
 * Standing constraints this module exists to enforce (ADR-009, doc 10, doc 14):
 *  - Amounts are integer minor units. Binary floating point never touches money.
 *  - Currency is always carried with the amount. There is no default currency,
 *    and no function here accepts an amount without one.
 *  - The minor-unit exponent is per currency, not a global 2. KWD has three
 *    decimal places; JPY has none. Assuming 2 silently corrupts both.
 *  - Locale is a required argument for formatting. There is no fallback locale,
 *    because a fallback is how "en-US" becomes load-bearing by accident.
 *  - FX conversion is deliberately absent. A converted amount is a presentation
 *    estimate with a rate timestamp (doc 10) and must never be compared against
 *    a budget ceiling; see compareToCeiling, which refuses mismatched currencies.
 */

/** ISO 4217 alphabetic code. Narrow by construction, not by cast. */
export type CurrencyCode = string & { readonly __brand: 'CurrencyCode' };

/**
 * Minor-unit exponents for currencies the platform has markets in or is likely
 * to. Deliberately not exhaustive: an unknown currency throws rather than
 * defaulting, so a new market fails loudly at seed time instead of quietly
 * mispricing by a factor of ten.
 */
const MINOR_UNIT_EXPONENTS = new Map<string, number>([
  ['AED', 2], // United Arab Emirates dirham — Dubai pilot
  ['EGP', 2], // Egyptian pound — Cairo second-market fixture
  ['SAR', 2],
  ['QAR', 2],
  ['KWD', 3], // three decimal places
  ['BHD', 3], // three decimal places
  ['OMR', 3], // three decimal places
  ['JPY', 0], // no decimal places
  ['USD', 2],
  ['EUR', 2],
  ['GBP', 2],
  ['TRY', 2],
]);

export class UnsupportedCurrencyError extends Error {
  constructor(code: string) {
    super(
      `Unsupported currency "${code}". Add its ISO 4217 minor-unit exponent to ` +
        `MINOR_UNIT_EXPONENTS before activating a market that uses it.`,
    );
    this.name = 'UnsupportedCurrencyError';
  }
}

export class InvalidAmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAmountError';
  }
}

const ISO_4217_PATTERN = /^[A-Z]{3}$/;

/** Validate and brand a currency code. Throws on anything unsupported. */
export function currency(code: string): CurrencyCode {
  const upper = code.toUpperCase();
  if (!ISO_4217_PATTERN.test(upper)) {
    throw new UnsupportedCurrencyError(code);
  }
  if (!MINOR_UNIT_EXPONENTS.has(upper)) {
    throw new UnsupportedCurrencyError(upper);
  }
  return upper as CurrencyCode;
}

export function isSupportedCurrency(code: string): boolean {
  return MINOR_UNIT_EXPONENTS.has(code.toUpperCase());
}

export function minorUnitExponent(code: CurrencyCode): number {
  const exponent = MINOR_UNIT_EXPONENTS.get(code);
  if (exponent === undefined) {
    throw new UnsupportedCurrencyError(code);
  }
  return exponent;
}

/**
 * How a price is charged. Comparing a per-person band against a minimum spend
 * is a category error, so the basis travels with the amount and eligibility
 * checks refuse to compare across bases.
 */
export type PriceBasis =
  | 'per_person'
  | 'per_entry'
  | 'minimum_spend'
  | 'per_group';

export interface Money {
  /** Integer minor units. Negative is rejected: there are no negative prices here. */
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
}

/**
 * An observed price band. Venue prices are ranges in practice, and a single
 * number would be an invented precision (doc 02 AC04).
 */
export interface PriceBand {
  readonly lowMinor: number;
  readonly highMinor: number;
  readonly currency: CurrencyCode;
  readonly basis: PriceBasis;
  /** Tax and service inclusion is material to whether a budget is met (doc 10). */
  readonly includesTax: boolean;
  readonly includesServiceCharge: boolean;
}

const MAX_SAFE_MINOR = Number.MAX_SAFE_INTEGER;

function assertValidMinor(amountMinor: number, label: string): void {
  if (!Number.isInteger(amountMinor)) {
    throw new InvalidAmountError(
      `${label} must be an integer number of minor units, received ${amountMinor}. ` +
        `Use parseDecimal() to convert a decimal string; never multiply a float by 100.`,
    );
  }
  if (amountMinor < 0) {
    throw new InvalidAmountError(`${label} must not be negative, received ${amountMinor}.`);
  }
  if (amountMinor > MAX_SAFE_MINOR) {
    throw new InvalidAmountError(`${label} exceeds the safe integer range.`);
  }
}

export function money(amountMinor: number, code: CurrencyCode | string): Money {
  const resolved = typeof code === 'string' ? currency(code) : code;
  assertValidMinor(amountMinor, 'amountMinor');
  return { amountMinor, currency: resolved };
}

export function priceBand(input: {
  lowMinor: number;
  highMinor: number;
  currency: CurrencyCode | string;
  basis: PriceBasis;
  includesTax: boolean;
  includesServiceCharge: boolean;
}): PriceBand {
  const resolved =
    typeof input.currency === 'string' ? currency(input.currency) : input.currency;
  assertValidMinor(input.lowMinor, 'lowMinor');
  assertValidMinor(input.highMinor, 'highMinor');
  if (input.lowMinor > input.highMinor) {
    throw new InvalidAmountError(
      `Price band is inverted: lowMinor ${input.lowMinor} exceeds highMinor ${input.highMinor}.`,
    );
  }
  return {
    lowMinor: input.lowMinor,
    highMinor: input.highMinor,
    currency: resolved,
    basis: input.basis,
    includesTax: input.includesTax,
    includesServiceCharge: input.includesServiceCharge,
  };
}

/**
 * Parse a decimal string into minor units using string arithmetic only.
 *
 * `parseFloat('150.55') * 100` yields 15054.999999999998. This does not.
 * Accepts an optional sign-free decimal with at most the currency's exponent
 * in fraction digits; anything more precise is an error rather than a silent
 * rounding, because rounding someone's price is a data-integrity decision.
 */
export function parseDecimal(input: string, code: CurrencyCode | string): Money {
  const resolved = typeof code === 'string' ? currency(code) : code;
  const exponent = minorUnitExponent(resolved);

  const trimmed = input.trim().replace(/[\s,_]/g, '');
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new InvalidAmountError(
      `"${input}" is not a plain non-negative decimal. Expected digits with an ` +
        `optional single decimal point.`,
    );
  }

  const [wholePart, fractionPart = ''] = trimmed.split('.') as [string, string?];
  const fraction = fractionPart ?? '';

  if (fraction.length > exponent) {
    throw new InvalidAmountError(
      `"${input}" has ${fraction.length} fraction digits but ${resolved} permits ` +
        `${exponent}. Rounding is refused: supply a value at the currency's precision.`,
    );
  }

  const padded = fraction.padEnd(exponent, '0');
  const combined = `${wholePart}${padded}`.replace(/^0+(?=\d)/, '');
  const amountMinor = Number(combined);

  assertValidMinor(amountMinor, 'parsed amount');
  return { amountMinor, currency: resolved };
}

/** Render minor units as a decimal string, without locale formatting. */
export function toDecimalString(value: Money): string {
  const exponent = minorUnitExponent(value.currency);
  if (exponent === 0) return String(value.amountMinor);

  const digits = String(value.amountMinor).padStart(exponent + 1, '0');
  const splitAt = digits.length - exponent;
  return `${digits.slice(0, splitAt)}.${digits.slice(splitAt)}`;
}

/**
 * Locale-aware formatting. `locale` is required — a BCP 47 tag from the market
 * record (doc 10), never a module-level default.
 */
export function format(value: Money, locale: string): string {
  const exponent = minorUnitExponent(value.currency);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: value.currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(value.amountMinor / 10 ** exponent);
}

/**
 * Format a band as a range. Uses Intl's own range formatting so the separator
 * and digit shaping follow the locale rather than a hardcoded en-dash — which
 * matters immediately for Arabic (doc 10).
 */
export function formatBand(band: PriceBand, locale: string): string {
  const exponent = minorUnitExponent(band.currency);
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: band.currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  });
  const low = band.lowMinor / 10 ** exponent;
  const high = band.highMinor / 10 ** exponent;
  if (band.lowMinor === band.highMinor) return formatter.format(low);
  return formatter.formatRange(low, high);
}

export class CurrencyMismatchError extends Error {
  constructor(left: CurrencyCode, right: CurrencyCode) {
    super(
      `Refusing to compare ${left} against ${right}. FX conversion is a ` +
        `presentation estimate only (doc 10) and must never decide eligibility; ` +
        `evaluate the budget in the market's own currency.`,
    );
    this.name = 'CurrencyMismatchError';
  }
}

export class BasisMismatchError extends Error {
  constructor(left: PriceBasis, right: PriceBasis) {
    super(
      `Refusing to compare a ${left} price against a ${right} budget. The two ` +
        `describe different charges; convert explicitly or treat as unknown.`,
    );
    this.name = 'BasisMismatchError';
  }
}

/**
 * How a known price band sits against a user's ceiling.
 *
 * Note what is NOT here: an "unknown" case. A band that does not exist is the
 * absence of this value, handled one level up, because conflating "no evidence"
 * with "evidence of a high price" is the exact error the brief's C5 identified
 * in doc 07. The two produce different user-facing copy and different
 * eligibility, so they are different types.
 */
export type CeilingComparison =
  /** Entire band at or below the ceiling. Satisfies a hard budget constraint. */
  | { readonly kind: 'within' }
  /** Band straddles the ceiling: possible but not guaranteed (ADR-011). */
  | { readonly kind: 'straddles'; readonly overBy: Money }
  /** Even the low end exceeds the ceiling. Excluded. */
  | { readonly kind: 'above'; readonly overBy: Money };

export function compareToCeiling(band: PriceBand, ceiling: Money, ceilingBasis: PriceBasis): CeilingComparison {
  if (band.currency !== ceiling.currency) {
    throw new CurrencyMismatchError(band.currency, ceiling.currency);
  }
  if (band.basis !== ceilingBasis) {
    throw new BasisMismatchError(band.basis, ceilingBasis);
  }

  if (band.highMinor <= ceiling.amountMinor) {
    return { kind: 'within' };
  }
  if (band.lowMinor > ceiling.amountMinor) {
    return {
      kind: 'above',
      overBy: money(band.lowMinor - ceiling.amountMinor, band.currency),
    };
  }
  return {
    kind: 'straddles',
    overBy: money(band.highMinor - ceiling.amountMinor, band.currency),
  };
}

/**
 * Where a band sits inside a user's stated range, as 0..1, for the soft budget
 * score. Closes gap G2: the ceiling gates eligibility, while this scores
 * position *within* the stated range — so the two are not the same signal
 * counted twice. Returns null when the band lies wholly outside the range,
 * which the caller must treat as unscored rather than as zero merit.
 */
export function positionInRange(
  band: PriceBand,
  rangeLow: Money,
  rangeHigh: Money,
): number | null {
  if (band.currency !== rangeLow.currency) {
    throw new CurrencyMismatchError(band.currency, rangeLow.currency);
  }
  if (band.currency !== rangeHigh.currency) {
    throw new CurrencyMismatchError(band.currency, rangeHigh.currency);
  }
  const span = rangeHigh.amountMinor - rangeLow.amountMinor;
  if (span <= 0) return null;

  const midpoint = (band.lowMinor + band.highMinor) / 2;
  if (midpoint < rangeLow.amountMinor || midpoint > rangeHigh.amountMinor) return null;

  // Nearer the bottom of the stated range scores higher: a user giving a range
  // is stating a tolerance, not a target.
  return 1 - (midpoint - rangeLow.amountMinor) / span;
}
