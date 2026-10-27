/**
 * Time — four representations of one moment, because one is not enough.
 *
 * An event occurrence stores all of:
 *   startsAt          the UTC instant, for ordering and range queries
 *   localStartDate    the wall-clock date in the venue's zone, for "Friday"
 *   localStartTime    the wall-clock time in the venue's zone, for "8pm"
 *   timezone          the IANA zone the wall clock belongs to
 *   sourceExpression  what the evidence literally said, for audit
 *
 * Why not just the instant (doc 10): "Friday" is a local-calendar question, and
 * deriving it from a UTC instant without the zone gets the wrong answer either
 * side of midnight. Why keep the wall clock separately rather than re-deriving
 * it: a venue that publishes "Fri 20:00" is asserting a wall clock, and if the
 * zone's offset rules change — governments do this, including in this region —
 * the published wall clock is what remains true. Why keep the source
 * expression: "late Thursday" and "Thu 23:30" are different evidence, and the
 * reviewer resolving a conflict needs to see which one a source actually gave.
 *
 * Shows crossing midnight are ordinary here, not an edge case: a Friday 22:00
 * set ending 02:00 is a Friday night, and must match a Friday query.
 */

import { DateTime, Interval } from 'luxon';

/**
 * Injectable clock. Everything that needs "now" takes one of these.
 *
 * Fixtures are generated relative to a seeded clock rather than hardcoded dates
 * (brief C11) — the five fixtures in doc 07 use weekday-relative dates, and the
 * illustrative event in doc 03 was already ten days from expiry when written.
 * Tests freeze time; production passes systemClock.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  // eslint-disable-next-line no-restricted-syntax -- the one permitted construction site
  now: () => new Date(),
};

export function fixedClock(instant: Date | string): Clock {
  const resolved = typeof instant === 'string' ? new Date(instant) : instant;
  if (Number.isNaN(resolved.getTime())) {
    throw new InvalidTimeError(`fixedClock received an unparseable instant: ${String(instant)}`);
  }
  return { now: () => new Date(resolved.getTime()) };
}

export class InvalidTimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTimeError';
  }
}

export class UnknownTimezoneError extends Error {
  constructor(zone: string) {
    super(
      `"${zone}" is not a recognised IANA timezone. Markets and venues carry an ` +
        `IANA zone identifier (doc 10); abbreviations like "GST" are ambiguous and ` +
        `offsets like "+04:00" lose DST rules.`,
    );
    this.name = 'UnknownTimezoneError';
  }
}

export function assertValidTimezone(zone: string): void {
  if (!DateTime.local().setZone(zone).isValid) {
    throw new UnknownTimezoneError(zone);
  }
}

/** YYYY-MM-DD in a specific zone. Not a timestamp — a calendar date. */
export type LocalDate = string & { readonly __brand: 'LocalDate' };
/** HH:mm in 24-hour form, in a specific zone. */
export type LocalTime = string & { readonly __brand: 'LocalTime' };

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function localDate(value: string): LocalDate {
  if (!LOCAL_DATE_PATTERN.test(value)) {
    throw new InvalidTimeError(`"${value}" is not a YYYY-MM-DD local date.`);
  }
  return value as LocalDate;
}

export function localTime(value: string): LocalTime {
  if (!LOCAL_TIME_PATTERN.test(value)) {
    throw new InvalidTimeError(`"${value}" is not an HH:mm 24-hour local time.`);
  }
  return value as LocalTime;
}

/** One dated performance, fully specified in time. */
export interface OccurrenceTime {
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly timezone: string;
  readonly localStartDate: LocalDate;
  readonly localStartTime: LocalTime;
  readonly localEndDate: LocalDate;
  readonly localEndTime: LocalTime;
  /** Verbatim from the evidence, or null when the source gave no expression. */
  readonly sourceExpression: string | null;
}

/**
 * Build an occurrence from the wall clock a source published, which is how
 * sources actually express themselves.
 *
 * Refuses a local time that does not exist (the spring-forward gap) rather than
 * silently shifting it, because a source publishing a nonexistent time is
 * evidence of an error worth a human looking at. Flags an ambiguous time (the
 * autumn fall-back hour) so the caller can record the ambiguity instead of
 * pretending to know which of the two instants was meant.
 */
export function occurrenceFromLocal(input: {
  date: string;
  startTime: string;
  /** Duration in minutes; a show ending past midnight simply exceeds the day. */
  durationMinutes: number;
  timezone: string;
  sourceExpression?: string | null;
}): { occurrence: OccurrenceTime; ambiguousLocalTime: boolean } {
  assertValidTimezone(input.timezone);
  const date = localDate(input.date);
  const time = localTime(input.startTime);

  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes <= 0) {
    throw new InvalidTimeError(
      `durationMinutes must be a positive integer, received ${input.durationMinutes}.`,
    );
  }

  const parts = time.split(':') as [string, string];
  const start = DateTime.fromObject(
    {
      year: Number(date.slice(0, 4)),
      month: Number(date.slice(5, 7)),
      day: Number(date.slice(8, 10)),
      hour: Number(parts[0]),
      minute: Number(parts[1]),
    },
    { zone: input.timezone },
  );

  if (!start.isValid) {
    throw new InvalidTimeError(
      `${date} ${time} does not exist in ${input.timezone} — this usually means the ` +
        `local clock skipped forward. Reason: ${start.invalidReason ?? 'unknown'}. ` +
        `Route to review rather than adjusting it silently.`,
    );
  }

  // Ambiguity detection: during a fall-back, two UTC instants share one wall
  // clock. Luxon resolves to the earlier; we report that it had to choose.
  const ambiguousLocalTime =
    start.offset !== start.plus({ hours: 1 }).offset &&
    start.minus({ hours: 1 }).toFormat('HH:mm') === start.toFormat('HH:mm');

  const end = start.plus({ minutes: input.durationMinutes });

  return {
    occurrence: {
      startsAt: start.toUTC().toJSDate(),
      endsAt: end.toUTC().toJSDate(),
      timezone: input.timezone,
      localStartDate: localDate(start.toFormat('yyyy-MM-dd')),
      localStartTime: localTime(start.toFormat('HH:mm')),
      localEndDate: localDate(end.toFormat('yyyy-MM-dd')),
      localEndTime: localTime(end.toFormat('HH:mm')),
      sourceExpression: input.sourceExpression ?? null,
    },
    ambiguousLocalTime,
  };
}

/** True when the show runs past local midnight. Ordinary, not exceptional. */
export function crossesMidnight(occurrence: OccurrenceTime): boolean {
  return occurrence.localEndDate !== occurrence.localStartDate;
}

/**
 * A user's search window, expressed in local wall clock because that is how
 * people think: "Friday, 7 to 11".
 */
export interface SearchWindow {
  readonly date: LocalDate;
  readonly fromTime: LocalTime;
  readonly toTime: LocalTime;
  readonly timezone: string;
}

export function searchWindow(input: {
  date: string;
  fromTime: string;
  toTime: string;
  timezone: string;
}): SearchWindow {
  assertValidTimezone(input.timezone);
  const from = localTime(input.fromTime);
  const to = localTime(input.toTime);
  return {
    date: localDate(input.date),
    fromTime: from,
    toTime: to,
    timezone: input.timezone,
  };
}

function windowInterval(window: SearchWindow): Interval {
  const dayStart = DateTime.fromISO(window.date, { zone: window.timezone });
  const fromParts = window.fromTime.split(':') as [string, string];
  const toParts = window.toTime.split(':') as [string, string];

  const start = dayStart.set({
    hour: Number(fromParts[0]),
    minute: Number(fromParts[1]),
  });
  let end = dayStart.set({ hour: Number(toParts[0]), minute: Number(toParts[1]) });

  // A window given as 22:00–02:00 means tonight into tomorrow, not a negative
  // span. Without this, every late-night query silently returns nothing.
  if (end <= start) end = end.plus({ days: 1 });

  return Interval.fromDateTimes(start, end);
}

/**
 * The window's absolute bounds, for pushing the date filter into SQL rather
 * than fetching every occurrence and filtering in memory. Same late-night
 * rollover rule as overlapsWindow, so the two cannot disagree about what
 * "Friday 22:00 to 02:00" means.
 */
export function searchWindowBounds(window: SearchWindow): { startsAt: Date; endsAt: Date } {
  const interval = windowInterval(window);
  const start = interval.start;
  const end = interval.end;
  if (start === null || end === null) {
    throw new InvalidTimeError(
      `Search window ${window.date} ${window.fromTime}-${window.toTime} in ${window.timezone} is not a valid interval.`,
    );
  }
  return { startsAt: start.toUTC().toJSDate(), endsAt: end.toUTC().toJSDate() };
}

/**
 * Does the occurrence overlap the window at all?
 *
 * Overlap, not containment: a set running 20:00–23:00 is a legitimate answer to
 * a 19:00–23:00 query, and so is one running 22:00–02:00. Requiring containment
 * would reject most real programmes.
 */
export function overlapsWindow(occurrence: OccurrenceTime, window: SearchWindow): boolean {
  const occurrenceInterval = Interval.fromDateTimes(
    DateTime.fromJSDate(occurrence.startsAt),
    DateTime.fromJSDate(occurrence.endsAt),
  );
  if (!occurrenceInterval.isValid) return false;
  return occurrenceInterval.overlaps(windowInterval(window));
}

/**
 * Has the occurrence already finished? Doc 02 AC02: a past event is never
 * displayed as upcoming. Evaluated against the injected clock so the assertion
 * is testable rather than dependent on when the suite happens to run.
 */
export function hasEnded(occurrence: OccurrenceTime, clock: Clock): boolean {
  return occurrence.endsAt.getTime() <= clock.now().getTime();
}

/** Minutes until the occurrence starts; negative once it has started. */
export function minutesUntilStart(occurrence: OccurrenceTime, clock: Clock): number {
  return Math.round((occurrence.startsAt.getTime() - clock.now().getTime()) / 60_000);
}

/**
 * Render the occurrence in the venue's own zone, in the market's locale.
 *
 * Both arguments are required. Doc 03's "display Asia/Dubai" is superseded by
 * ADR-009: the zone comes from the venue, the locale from market_locales, and
 * neither has a default here.
 */
export function formatLocal(
  occurrence: OccurrenceTime,
  locale: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  return DateTime.fromJSDate(occurrence.startsAt)
    .setZone(occurrence.timezone)
    .setLocale(locale)
    .toLocaleString(options ?? DateTime.DATETIME_MED);
}

/**
 * The occurrence as one locale-formatted line: date, start and end.
 *
 * Formatting both ends through Intl rather than printing the stored HH:mm for
 * one of them. Mixing the two produces "10:00 PM – 02:00", which looks like a
 * bug to a reader and is one. A show finishing on the following local date says
 * so, because "ends 02:00" without a date is ambiguous on exactly the nights
 * people care about.
 */
export function formatLocalRange(occurrence: OccurrenceTime, locale: string): string {
  const start = DateTime.fromJSDate(occurrence.startsAt)
    .setZone(occurrence.timezone)
    .setLocale(locale);
  const end = DateTime.fromJSDate(occurrence.endsAt)
    .setZone(occurrence.timezone)
    .setLocale(locale);

  const date = start.toLocaleString({ dateStyle: 'medium' });
  const startTime = start.toLocaleString({ timeStyle: 'short' });
  const endTime = end.toLocaleString({ timeStyle: 'short' });

  if (crossesMidnight(occurrence)) {
    return `${date} ${startTime} – ${end.toLocaleString({ dateStyle: 'medium' })} ${endTime}`;
  }
  return `${date} ${startTime} – ${endTime}`;
}

/** The local weekday index (1 = Monday … 7 = Sunday) in the venue's zone. */
export function localWeekday(occurrence: OccurrenceTime): number {
  return DateTime.fromJSDate(occurrence.startsAt).setZone(occurrence.timezone).weekday;
}

/**
 * Resolve a weekday-relative expression like "next Friday" against the clock,
 * in a given zone. Fixture generation uses this so seeded data never rots
 * (brief C11), and it is deliberately not exposed to user input — natural
 * language goes through the validated parser, not through here.
 */
export function nextWeekdayOnOrAfter(
  weekday: number,
  clock: Clock,
  timezone: string,
): LocalDate {
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
    throw new InvalidTimeError(`weekday must be 1 (Monday) through 7 (Sunday), received ${weekday}.`);
  }
  assertValidTimezone(timezone);

  const today = DateTime.fromJSDate(clock.now()).setZone(timezone).startOf('day');
  const delta = (weekday - today.weekday + 7) % 7;
  return localDate(today.plus({ days: delta }).toFormat('yyyy-MM-dd'));
}

/**
 * One local date, written the way the requested locale writes dates.
 *
 * Used for the "also on" list beside a result. The zone is accepted so a date
 * is never reformatted through the server's own zone, which near midnight
 * would name the wrong day.
 */
export function formatLocalDay(date: string, timezone: string, locale: string): string {
  const zone = timezone === '' ? 'utc' : timezone;
  const value = DateTime.fromISO(date, { zone });
  if (!value.isValid) {
    throw new InvalidTimeError(`"${date}" is not a local date in ${timezone}.`);
  }
  return value.setLocale(locale).toLocaleString({
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}
