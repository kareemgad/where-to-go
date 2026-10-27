/**
 * Resolving "when" into days and a clock window.
 *
 * A date, a range, or a phrase like "tonight" or "this weekend" — all three
 * collapse here into the same thing: a list of local dates plus a from/to time.
 * Everything downstream evaluates per day against that window and never needs
 * to know which of the three the user actually gave.
 *
 * Pure and offline. The market's timezone, its weekend days and its band hours
 * all arrive as arguments rather than being read here, so this is unit
 * testable against both markets without a database (ADR-009).
 */

import { DateTime } from 'luxon';

import { InvalidTimeError, assertValidTimezone, localDate, localTime } from '@/lib/time';
import type { Clock, LocalDate, LocalTime } from '@/lib/time';

/**
 * The hard cap on how many days one search may span.
 *
 * Not a performance guess. A window wide enough to contain "some night in the
 * next month" stops being a decision and becomes a directory, which is the
 * thing doc 02's UX principles put second.
 */
export const MAX_WINDOW_DAYS = 14;

export interface TimeBandHours {
  readonly key: string;
  /** HH:MM in the market's own zone. */
  readonly startsLocal: string;
  /** May be earlier than startsLocal: late night runs past midnight. */
  readonly endsLocal: string;
}

export type RelativePhrase =
  | { readonly name: 'tonight' }
  | { readonly name: 'tomorrow' }
  | { readonly name: 'this_weekend' }
  | { readonly name: 'next_days'; readonly days: number };

export type WhenSpec =
  | { readonly kind: 'date'; readonly date: LocalDate }
  | { readonly kind: 'range'; readonly from: LocalDate; readonly to: LocalDate }
  | { readonly kind: 'relative'; readonly phrase: RelativePhrase };

export interface ResolvedWhen {
  /** Local dates to evaluate, ascending, never more than MAX_WINDOW_DAYS. */
  readonly days: readonly LocalDate[];
  readonly fromTime: LocalTime;
  readonly toTime: LocalTime;
  readonly bandKey: string;
  /**
   * The number of days asked for, when that exceeded the cap. Null otherwise.
   * Reported rather than silently applied: a search that quietly answers a
   * narrower question than the one asked is worse than one that says so.
   */
  readonly truncatedFrom: number | null;
}

/** Today in the market's own zone, which is not necessarily today anywhere else. */
export function todayIn(timezone: string, clock: Clock): LocalDate {
  assertValidTimezone(timezone);
  return localDate(
    DateTime.fromJSDate(clock.now()).setZone(timezone).toFormat('yyyy-MM-dd'),
  );
}

function plusDays(date: LocalDate, days: number, timezone: string): LocalDate {
  return localDate(
    DateTime.fromISO(date, { zone: timezone }).plus({ days }).toFormat('yyyy-MM-dd'),
  );
}

/**
 * How many calendar days a range covers, inclusive.
 *
 * Counted in calendar days in the market's zone, not by dividing a millisecond
 * difference: a day is not always 86,400,000 milliseconds long, and on the two
 * DST transitions a year the arithmetic version is off by one.
 */
function dayCount(from: LocalDate, to: LocalDate, timezone: string): number {
  const start = DateTime.fromISO(from, { zone: timezone }).startOf('day');
  const end = DateTime.fromISO(to, { zone: timezone }).startOf('day');
  return Math.floor(end.diff(start, 'days').days) + 1;
}

/**
 * Inclusive run of dates, ascending, stopping at `limit` entries.
 *
 * Built by adding days in the market's zone for the same reason as above. The
 * limit is applied here rather than by slicing afterwards so a range of a
 * thousand days costs a handful of iterations, not a thousand.
 */
function datesBetween(
  from: LocalDate,
  to: LocalDate,
  timezone: string,
  limit = MAX_WINDOW_DAYS,
): LocalDate[] {
  if (to < from) {
    throw new InvalidTimeError(`Range ends (${to}) before it starts (${from}).`);
  }
  const days: LocalDate[] = [];
  let cursor = from;
  while (days.length < limit && cursor <= to) {
    days.push(cursor);
    cursor = plusDays(cursor, 1, timezone);
  }
  return days;
}

/**
 * The market's own weekend, from today forward.
 *
 * Returns the weekend days falling in the next seven days, so "this weekend"
 * asked on a Saturday still includes that Saturday rather than skipping to the
 * next one. Which days those are is market configuration: Saturday and Sunday
 * in one market, Friday and Saturday in another.
 */
function weekendFrom(
  today: LocalDate,
  weekendDays: readonly number[],
  timezone: string,
): LocalDate[] {
  if (weekendDays.length === 0) {
    throw new InvalidTimeError('The market declares no weekend days.');
  }
  const wanted = new Set(weekendDays);
  const days: LocalDate[] = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const date = plusDays(today, offset, timezone);
    if (wanted.has(DateTime.fromISO(date, { zone: timezone }).weekday)) days.push(date);
  }
  return days;
}

export interface ResolveWhenInput {
  readonly when: WhenSpec;
  /** Band key, or undefined for the market's evening. */
  readonly band?: string | undefined;
  readonly bands: readonly TimeBandHours[];
  readonly timezone: string;
  readonly weekendDays: readonly number[];
  readonly clock: Clock;
}

/** The band a bare request falls back to, by key rather than by hours. */
const DEFAULT_BAND_KEY = 'evening';

export function resolveWhen(input: ResolveWhenInput): ResolvedWhen {
  const { when, bands, timezone, weekendDays, clock } = input;
  assertValidTimezone(timezone);

  const band =
    bands.find((b) => b.key === input.band) ??
    bands.find((b) => b.key === DEFAULT_BAND_KEY) ??
    bands[0];
  if (!band) {
    throw new InvalidTimeError('The market offers no time-of-day bands.');
  }

  const today = todayIn(timezone, clock);

  // Both the days to search and how many were asked for. The second is not
  // the length of the first: the cap is applied while building, so a 30-day
  // range must report 30 rather than the 14 it was cut to.
  const { days, requestedCount } = ((): { days: LocalDate[]; requestedCount: number } => {
    switch (when.kind) {
      case 'date':
        return { days: [when.date], requestedCount: 1 };
      case 'range':
        return {
          days: datesBetween(when.from, when.to, timezone),
          requestedCount: dayCount(when.from, when.to, timezone),
        };
      case 'relative':
        switch (when.phrase.name) {
          case 'tonight':
            return { days: [today], requestedCount: 1 };
          case 'tomorrow':
            return { days: [plusDays(today, 1, timezone)], requestedCount: 1 };
          case 'this_weekend': {
            // At most seven, so never truncated.
            const weekend = weekendFrom(today, weekendDays, timezone);
            return { days: weekend, requestedCount: weekend.length };
          }
          case 'next_days': {
            const { days: asked } = when.phrase;
            if (!Number.isInteger(asked) || asked < 1) {
              throw new InvalidTimeError(`"next N days" needs a positive integer, got ${asked}.`);
            }
            // Inclusive of today, so "next 3 days" is today plus two.
            const last = plusDays(today, asked - 1, timezone);
            return { days: datesBetween(today, last, timezone), requestedCount: asked };
          }
        }
    }
  })();

  return {
    days,
    fromTime: localTime(band.startsLocal),
    toTime: localTime(band.endsLocal),
    bandKey: band.key,
    truncatedFrom: requestedCount > MAX_WINDOW_DAYS ? requestedCount : null,
  };
}

// ---------------------------------------------------------------------------
// the URL form
// ---------------------------------------------------------------------------
// The query is the URL, so a WhenSpec has to survive a round trip through one
// string. Kept beside the resolver rather than in a page, so the chat parser,
// the refine form and the shareable link cannot drift into three dialects.
//
//   tonight | tomorrow | weekend | next7
//   2026-11-13              an exact date
//   2026-11-13..2026-11-16  an inclusive range

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const NEXT_PATTERN = /^next(\d{1,3})$/;

export function parseWhenParam(raw: string | undefined | null): WhenSpec | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();

  if (value === 'tonight') return { kind: 'relative', phrase: { name: 'tonight' } };
  if (value === 'tomorrow') return { kind: 'relative', phrase: { name: 'tomorrow' } };
  if (value === 'weekend') return { kind: 'relative', phrase: { name: 'this_weekend' } };

  const next = NEXT_PATTERN.exec(value);
  if (next?.[1]) {
    const days = Number(next[1]);
    if (days >= 1) return { kind: 'relative', phrase: { name: 'next_days', days } };
    return null;
  }

  const [from, to] = value.split('..');
  if (from && to && DATE_PATTERN.test(from) && DATE_PATTERN.test(to)) {
    // Out-of-order ranges are rejected here rather than silently swapped: the
    // user asked for something impossible and should be told, not corrected.
    if (to < from) return null;
    return { kind: 'range', from: localDate(from), to: localDate(to) };
  }
  if (DATE_PATTERN.test(value)) return { kind: 'date', date: localDate(value) };

  return null;
}

export function formatWhenParam(when: WhenSpec): string {
  switch (when.kind) {
    case 'date':
      return when.date;
    case 'range':
      return `${when.from}..${when.to}`;
    case 'relative':
      switch (when.phrase.name) {
        case 'tonight':
          return 'tonight';
        case 'tomorrow':
          return 'tomorrow';
        case 'this_weekend':
          return 'weekend';
        case 'next_days':
          return `next${when.phrase.days}`;
      }
  }
}
