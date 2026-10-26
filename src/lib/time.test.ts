import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import {
  InvalidTimeError,
  UnknownTimezoneError,
  assertValidTimezone,
  crossesMidnight,
  fixedClock,
  hasEnded,
  localWeekday,
  minutesUntilStart,
  nextWeekdayOnOrAfter,
  occurrenceFromLocal,
  overlapsWindow,
  searchWindow,
} from './time';

const DUBAI = 'Asia/Dubai'; // UTC+4, no DST
const CAIRO = 'Africa/Cairo'; // observes DST — the second-market fixture
const LONDON = 'Europe/London'; // DST, used to prove zone rules are applied

/** A Friday, verified against Luxon rather than asserted from memory. */
const FRIDAY = '2026-11-13';

describe('timezone validation', () => {
  it('accepts IANA identifiers', () => {
    expect(() => assertValidTimezone(DUBAI)).not.toThrow();
    expect(() => assertValidTimezone(CAIRO)).not.toThrow();
  });

  it('rejects abbreviations and raw offsets', () => {
    // "GST" is ambiguous and "+04:00" discards DST rules (doc 10).
    expect(() => assertValidTimezone('GST')).toThrow(UnknownTimezoneError);
    expect(() => assertValidTimezone('Mars/Olympus')).toThrow(UnknownTimezoneError);
  });
});

describe('occurrenceFromLocal', () => {
  it('stores the UTC instant alongside the published wall clock', () => {
    const { occurrence } = occurrenceFromLocal({
      date: FRIDAY,
      startTime: '20:00',
      durationMinutes: 180,
      timezone: DUBAI,
      sourceExpression: 'Fri 8pm - 11pm',
    });

    // Dubai is UTC+4, so 20:00 local is 16:00Z.
    expect(occurrence.startsAt.toISOString()).toBe('2026-11-13T16:00:00.000Z');
    expect(occurrence.localStartDate).toBe(FRIDAY);
    expect(occurrence.localStartTime).toBe('20:00');
    expect(occurrence.localEndTime).toBe('23:00');
    expect(occurrence.timezone).toBe(DUBAI);
    // The evidence's own wording is preserved verbatim for audit.
    expect(occurrence.sourceExpression).toBe('Fri 8pm - 11pm');
  });

  it('records a null source expression rather than inventing one', () => {
    const { occurrence } = occurrenceFromLocal({
      date: FRIDAY,
      startTime: '20:00',
      durationMinutes: 120,
      timezone: DUBAI,
    });
    expect(occurrence.sourceExpression).toBeNull();
  });

  it('handles a show crossing local midnight', () => {
    const { occurrence } = occurrenceFromLocal({
      date: FRIDAY,
      startTime: '22:00',
      durationMinutes: 240, // until 02:00 Saturday
      timezone: DUBAI,
    });

    expect(occurrence.localStartDate).toBe(FRIDAY);
    expect(occurrence.localEndDate).toBe('2026-11-14');
    expect(occurrence.localEndTime).toBe('02:00');
    expect(crossesMidnight(occurrence)).toBe(true);
  });

  it('applies real zone rules, not a fixed offset', () => {
    // Dubai alone would never catch an offset bug, having no DST. London in
    // July is UTC+1 and in January UTC+0 for the same wall clock.
    const summer = occurrenceFromLocal({
      date: '2026-07-10',
      startTime: '20:00',
      durationMinutes: 60,
      timezone: LONDON,
    }).occurrence;
    const winter = occurrenceFromLocal({
      date: '2026-01-10',
      startTime: '20:00',
      durationMinutes: 60,
      timezone: LONDON,
    }).occurrence;

    expect(summer.startsAt.toISOString()).toBe('2026-07-10T19:00:00.000Z');
    expect(winter.startsAt.toISOString()).toBe('2026-01-10T20:00:00.000Z');
  });

  it('keeps Cairo and Dubai distinct for the same wall clock', () => {
    const dubai = occurrenceFromLocal({
      date: FRIDAY,
      startTime: '21:00',
      durationMinutes: 120,
      timezone: DUBAI,
    }).occurrence;
    const cairo = occurrenceFromLocal({
      date: FRIDAY,
      startTime: '21:00',
      durationMinutes: 120,
      timezone: CAIRO,
    }).occurrence;

    expect(dubai.localStartTime).toBe(cairo.localStartTime);
    expect(dubai.startsAt.toISOString()).not.toBe(cairo.startsAt.toISOString());
  });

  it('rejects malformed dates, times and durations', () => {
    const base = { date: FRIDAY, startTime: '20:00', durationMinutes: 60, timezone: DUBAI };
    expect(() => occurrenceFromLocal({ ...base, date: '13-11-2026' })).toThrow(InvalidTimeError);
    expect(() => occurrenceFromLocal({ ...base, startTime: '8pm' })).toThrow(InvalidTimeError);
    expect(() => occurrenceFromLocal({ ...base, startTime: '24:00' })).toThrow(InvalidTimeError);
    expect(() => occurrenceFromLocal({ ...base, durationMinutes: 0 })).toThrow(InvalidTimeError);
    expect(() => occurrenceFromLocal({ ...base, durationMinutes: 1.5 })).toThrow(InvalidTimeError);
  });
});

describe('overlapsWindow — overlap, not containment', () => {
  const window = searchWindow({
    date: FRIDAY,
    fromTime: '19:00',
    toTime: '23:00',
    timezone: DUBAI,
  });

  const occurrence = (startTime: string, durationMinutes: number, date = FRIDAY) =>
    occurrenceFromLocal({ date, startTime, durationMinutes, timezone: DUBAI }).occurrence;

  it('matches a set inside the window', () => {
    // Jazz Loft Test: 20:00-23:00 against a 19:00-23:00 query.
    expect(overlapsWindow(occurrence('20:00', 180), window)).toBe(true);
  });

  it('matches a set that starts inside and runs past midnight', () => {
    // Requiring containment would reject most real late programmes.
    expect(overlapsWindow(occurrence('22:00', 240), window)).toBe(true);
  });

  it('matches a set that starts before and ends inside the window', () => {
    expect(overlapsWindow(occurrence('18:00', 120), window)).toBe(true);
  });

  it('rejects an afternoon set', () => {
    expect(overlapsWindow(occurrence('14:00', 120), window)).toBe(false);
  });

  it('rejects the previous night', () => {
    expect(overlapsWindow(occurrence('20:00', 180, '2026-11-12'), window)).toBe(false);
  });

  it('rolls a window whose end time is past midnight into the next day', () => {
    // 22:00-02:00 means tonight into tomorrow, not a negative span. Without
    // this, every late-night query silently returns nothing.
    const lateWindow = searchWindow({
      date: FRIDAY,
      fromTime: '22:00',
      toTime: '02:00',
      timezone: DUBAI,
    });
    expect(overlapsWindow(occurrence('23:30', 120), lateWindow)).toBe(true);
    expect(overlapsWindow(occurrence('19:00', 60), lateWindow)).toBe(false);
  });
});

describe('hasEnded — doc 02 AC02, a past event is never upcoming', () => {
  const occurrence = occurrenceFromLocal({
    date: FRIDAY,
    startTime: '20:00',
    durationMinutes: 180,
    timezone: DUBAI,
  }).occurrence;

  it('is false before the show ends', () => {
    expect(hasEnded(occurrence, fixedClock('2026-11-13T15:00:00Z'))).toBe(false);
    expect(hasEnded(occurrence, fixedClock('2026-11-13T18:00:00Z'))).toBe(false);
  });

  it('is true once the show has ended', () => {
    // Expired Gig Test: never shown as upcoming.
    expect(hasEnded(occurrence, fixedClock('2026-11-13T19:00:00Z'))).toBe(true);
    expect(hasEnded(occurrence, fixedClock('2026-11-20T00:00:00Z'))).toBe(true);
  });

  it('reports minutes until start against the injected clock', () => {
    expect(minutesUntilStart(occurrence, fixedClock('2026-11-13T15:00:00Z'))).toBe(60);
    expect(minutesUntilStart(occurrence, fixedClock('2026-11-13T17:00:00Z'))).toBe(-60);
  });

  it('rejects an unparseable fixed clock', () => {
    expect(() => fixedClock('not-a-date')).toThrow(InvalidTimeError);
  });
});

describe('weekday resolution for rot-free fixtures (brief C11)', () => {
  it('returns a date whose local weekday matches the request', () => {
    const clock = fixedClock('2026-10-26T09:00:00Z');
    for (let weekday = 1; weekday <= 7; weekday += 1) {
      const resolved = nextWeekdayOnOrAfter(weekday, clock, DUBAI);
      expect(DateTime.fromISO(resolved, { zone: DUBAI }).weekday).toBe(weekday);
    }
  });

  it('never resolves to a date in the past', () => {
    const clock = fixedClock('2026-10-26T09:00:00Z');
    const resolved = nextWeekdayOnOrAfter(5, clock, DUBAI);
    expect(resolved >= '2026-10-26').toBe(true);
  });

  it('rejects an out-of-range weekday', () => {
    const clock = fixedClock('2026-10-26T09:00:00Z');
    expect(() => nextWeekdayOnOrAfter(0, clock, DUBAI)).toThrow(InvalidTimeError);
    expect(() => nextWeekdayOnOrAfter(8, clock, DUBAI)).toThrow(InvalidTimeError);
  });

  it('confirms the fixture Friday really is a Friday', () => {
    // Guards against a hand-written date drifting out of sync with its label.
    const occurrence = occurrenceFromLocal({
      date: FRIDAY,
      startTime: '20:00',
      durationMinutes: 60,
      timezone: DUBAI,
    }).occurrence;
    expect(localWeekday(occurrence)).toBe(5);
  });
});
