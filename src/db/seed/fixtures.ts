/**
 * Fictional fixture definitions for both markets.
 *
 * Every record here is invented. None of it describes a real business, and
 * every venue carries is_demo_data so the database — not just this file — knows
 * it must never be presented as a real recommendation (doc 07,
 * fixtures/README).
 *
 * Dates are expressed as weekday offsets resolved against a seeded clock, never
 * as literals. Doc 07's five fixtures say "Friday"; the illustrative event in
 * doc 03 was dated 2026-11-05 and was already ten days from expiry when it was
 * written. A fixture with a literal date is a test that silently stops testing
 * anything (brief C11).
 *
 * This file is exempt from the market-literal guard, because naming AED,
 * Africa/Cairo and the rest is the entire point of seed data. Everything
 * outside src/db/seed reads these values from the market record.
 */

import type { EvidenceState, SourceAuthority } from '@/modules/evidence/confidence';

export const WEEKDAY = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 7,
} as const;

export interface MarketFixture {
  slug: string;
  referenceName: string;
  countryIso2: string;
  timezone: string;
  currency: string;
  defaultLocale: string;
  /**
   * ISO weekday numbers this market treats as the weekend, Monday 1 through
   * Sunday 7. Stated per market because "this weekend" is not the same days
   * everywhere, and the resolver reads it rather than assuming.
   */
  weekendDays: number[];
  locales: { locale: string; isDefault: boolean }[];
  /** Rough operating envelope: [minLon, minLat, maxLon, maxLat]. Fictional. */
  envelope: [number, number, number, number];
  priority: number;
  locality: { referenceName: string; names: { locale: string; name: string }[] };
  neighborhoods: {
    key: string;
    referenceName: string;
    names: { locale: string; name: string }[];
    centroid: [number, number];
  }[];
  /**
   * Vocabulary terms that exist only in this market (doc 10: a market extends
   * the taxonomy, it does not fork it). The global set lives in migration
   * 0024; these need a market id, so they are seeded.
   */
  experienceTagExtensions?: {
    key: string;
    facet: 'music' | 'setting' | 'occasion' | 'activity';
    labels: { locale: string; label: string }[];
  }[];
  /**
   * Band hours that differ from the global default here. Empty for both pilot
   * markets, which is itself worth asserting: the mechanism works, and neither
   * market has yet needed it.
   */
  timeBandOverrides?: { key: string; startsLocal: string; endsLocal: string }[];
}

export const COUNTRIES = [
  { iso2: 'AE', iso3: 'ARE', referenceName: 'United Arab Emirates' },
  { iso2: 'EG', iso3: 'EGY', referenceName: 'Egypt' },
] as const;

export const MARKETS: MarketFixture[] = [
  {
    slug: 'dubai',
    referenceName: 'Dubai',
    countryIso2: 'AE',
    timezone: 'Asia/Dubai',
    currency: 'AED',
    defaultLocale: 'en-AE',
    // The UAE moved to a Saturday-Sunday weekend in 2022.
    weekendDays: [6, 7],
    locales: [
      { locale: 'en-AE', isDefault: true },
      { locale: 'ar-AE', isDefault: false },
    ],
    experienceTagExtensions: [
      {
        key: 'desert_setting',
        facet: 'setting',
        labels: [
          { locale: 'en', label: 'Desert setting' },
          { locale: 'ar', label: 'أجواء صحراوية' },
        ],
      },
      {
        key: 'beach_club',
        facet: 'setting',
        labels: [
          { locale: 'en', label: 'Beach club' },
          { locale: 'ar', label: 'نادي شاطئي' },
        ],
      },
    ],
    envelope: [55.05, 24.85, 55.55, 25.45],
    priority: 100,
    locality: {
      referenceName: 'Dubai',
      names: [
        { locale: 'en-AE', name: 'Dubai' },
        { locale: 'ar-AE', name: 'دبي' },
      ],
    },
    neighborhoods: [
      {
        key: 'dxb-marina',
        referenceName: 'Marina District (fictional)',
        names: [
          { locale: 'en-AE', name: 'Marina District' },
          { locale: 'ar-AE', name: 'حي المارينا' },
        ],
        centroid: [55.14, 25.08],
      },
      {
        key: 'dxb-oldtown',
        referenceName: 'Old Town Quarter (fictional)',
        names: [
          { locale: 'en-AE', name: 'Old Town Quarter' },
          { locale: 'ar-AE', name: 'حي المدينة القديمة' },
        ],
        centroid: [55.3, 25.22],
      },
    ],
  },
  {
    slug: 'cairo',
    referenceName: 'Cairo',
    countryIso2: 'EG',
    // Africa/Cairo observes DST, unlike Asia/Dubai. That difference is the
    // point of the second market: a bug that assumes a fixed offset passes
    // every Dubai test and fails here.
    timezone: 'Africa/Cairo',
    currency: 'EGP',
    defaultLocale: 'ar-EG',
    // Egypt's weekend is Friday and Saturday, which is the whole reason this
    // is market configuration and not a constant.
    weekendDays: [5, 6],
    locales: [
      { locale: 'ar-EG', isDefault: true },
      { locale: 'en-EG', isDefault: false },
    ],
    experienceTagExtensions: [
      {
        key: 'nile_view',
        facet: 'setting',
        labels: [
          { locale: 'en', label: 'Nile view' },
          { locale: 'ar', label: 'إطلالة على النيل' },
        ],
      },
      {
        key: 'oriental_tarab',
        facet: 'music',
        labels: [
          { locale: 'en', label: 'Tarab' },
          { locale: 'ar', label: 'طرب' },
        ],
      },
    ],
    envelope: [31.1, 29.9, 31.5, 30.2],
    priority: 100,
    locality: {
      referenceName: 'Cairo',
      names: [
        { locale: 'ar-EG', name: 'القاهرة' },
        { locale: 'en-EG', name: 'Cairo' },
      ],
    },
    neighborhoods: [
      {
        key: 'cai-riverside',
        referenceName: 'Riverside Gardens (fictional)',
        names: [
          { locale: 'ar-EG', name: 'حدائق النيل' },
          { locale: 'en-EG', name: 'Riverside Gardens' },
        ],
        centroid: [31.22, 30.04],
      },
    ],
  },
];

export type OccurrenceFixture = {
  /** Weekday the night falls on, resolved against the seeded clock. */
  weekday: number;
  /** Weeks to add; negative puts the night in the past. */
  weekOffset?: number;
  startTime: string;
  durationMinutes: number;
  title: string;
  genreTags: string[];
  performanceType:
    | 'live_band'
    | 'dj'
    | 'solo_instrumentalist'
    | 'piano'
    | 'open_mic'
    | 'acoustic_set'
    | 'other';
  artist?: string;
  state: 'scheduled' | 'confirmed' | 'postponed' | 'cancelled' | 'completed';
  evidenceState: EvidenceState;
  sourceAuthority: SourceAuthority | null;
  sourceExpression: string | null;
  /**
   * A second credible source giving a different start time.
   *
   * Present so the conflict is *derived* rather than declared. Writing
   * evidenceState: 'conflicting' by hand produces a claim that looks disputed
   * while nothing actually disagrees with it, which is the one shape the
   * review queue can never be exercised against.
   */
  disputedBy?: {
    startTime: string;
    sourceExpression: string;
    sourceAuthority: SourceAuthority;
    evidenceState: EvidenceState;
  };
};

/**
 * A claim deliberately left awaiting a human decision.
 *
 * The rest of the fixture world is already published, which is right for
 * demonstrating search and wrong for demonstrating review: a queue with
 * nothing in it proves nothing. These are the rows a reviewer opens.
 */
export interface PendingClaimFixture {
  attributeKey: string;
  value: unknown;
  sourceAuthority: SourceAuthority;
  evidenceState: EvidenceState;
  /** What the source actually said, kept verbatim as the evidence excerpt. */
  excerpt: string;
  /** Why this one is in the queue, printed by the seeder. */
  purpose: string;
}

export interface VenueFixture {
  marketSlug: string;
  slug: string;
  referenceName: string;
  names: { locale: string; name: string }[];
  neighborhoodKey: string;
  point: [number, number];
  status: 'active' | 'temporarily_closed' | 'permanently_closed';
  bookingUrl: string | null;
  /** Why this fixture exists. Printed by the seeder so the set stays legible. */
  purpose: string;
  experience: {
    energy?: number;
    conversationFriendliness?: number;
    lighting?: number;
    seatingComfort?: number;
    noiseBand?: 'quiet' | 'moderate' | 'loud';
    outdoorSeating?: boolean;
    indoorSeating?: boolean;
    familyFriendly?: boolean;
    wheelchairAccessible?: boolean;
    evidenceState: EvidenceState;
    observationCount: number;
  };
  /** Decimal strings, parsed through lib/money so no float ever touches them. */
  price: {
    low: string;
    high: string;
    basis: 'per_person' | 'per_entry' | 'minimum_spend' | 'per_group';
    includesTax: boolean;
    includesServiceCharge: boolean;
    evidenceState: EvidenceState;
  } | null;
  series: {
    title: string;
    recurrenceRule: string | null;
    genreTags: string[];
    performanceType: OccurrenceFixture['performanceType'];
  } | null;
  occurrences: OccurrenceFixture[];
  /** Claims left in the queue for the review workflow to act on. */
  pendingClaims?: PendingClaimFixture[];
  /** What sort of outing this is. At most one entry may be primary. */
  kinds: KindFixture[];
  /** Experience tags asserted about the venue, each with its own evidence. */
  experienceTags: TaggedFixture[];
  /**
   * Policy facts. Anything omitted stays unknown, which is the honest default:
   * a fixture has to opt in to every fact it asserts, exactly as a real venue
   * would have to be sourced for it.
   */
  policies?: PolicyFixture;
}

export interface TaggedFixture {
  key: string;
  evidenceState: EvidenceState;
  sourceAuthority: SourceAuthority;
}

export interface KindFixture extends TaggedFixture {
  isPrimary?: boolean;
}

export type PolicyKey =
  | 'licensed'
  | 'alcoholFree'
  | 'halal'
  | 'takesReservations'
  | 'openPastMidnight'
  | 'minimumAge';

export type PolicyFixture = Partial<
  Record<PolicyKey, { value: boolean | number; evidenceState: EvidenceState }>
>;

/** The venue's own word for it: the commonest provenance in the fixture set. */
const attested = (key: string): TaggedFixture => ({
  key,
  evidenceState: 'source_claimed',
  sourceAuthority: 'venue_attested',
});

/** A fact an editor checked, for the handful of fixtures that need one. */
const checked = (key: string): TaggedFixture => ({
  key,
  evidenceState: 'verified',
  sourceAuthority: 'editor_checked',
});

const says = (
  value: boolean | number,
  evidenceState: EvidenceState = 'source_claimed',
): { value: boolean | number; evidenceState: EvidenceState } => ({ value, evidenceState });

const confirmedByVenue = {
  state: 'confirmed',
  evidenceState: 'source_claimed',
  sourceAuthority: 'venue_attested',
} as const;

export const VENUES: VenueFixture[] = [
  // ---- doc 07's five canonical fixtures --------------------------------
  {
    marketSlug: 'dubai',
    slug: 'jazz-loft-test',
    referenceName: 'Jazz Loft Test (fictional)',
    names: [
      { locale: 'en-AE', name: 'Jazz Loft Test' },
      { locale: 'ar-AE', name: 'جاز لوفت' },
    ],
    neighborhoodKey: 'dxb-marina',
    point: [55.141, 25.081],
    status: 'active',
    bookingUrl: 'https://example.invalid/jazz-loft/reserve',
    purpose: 'The expected rank-1 match: live jazz on the queried Friday, inside budget.',
    kinds: [{ ...attested('live_music_venue'), isPrimary: true }, attested('drinks_lounge')],
    experienceTags: [checked('live_music'), checked('jazz'), attested('intimate_cosy'), attested('date_night')],
    policies: {
      licensed: says(true),
      takesReservations: says(true),
      openPastMidnight: says(true),
      minimumAge: says(21, 'verified'),
    },
    experience: {
      energy: 3,
      conversationFriendliness: 3,
      lighting: 2,
      seatingComfort: 4,
      noiseBand: 'moderate',
      outdoorSeating: false,
      familyFriendly: false,
      wheelchairAccessible: true,
      evidenceState: 'source_claimed',
      observationCount: 4,
    },
    price: {
      low: '180',
      high: '260',
      basis: 'per_person',
      includesTax: true,
      includesServiceCharge: false,
      evidenceState: 'source_claimed',
    },
    series: {
      title: 'Friday Jazz Sessions (fictional)',
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=FR',
      genreTags: ['jazz'],
      performanceType: 'live_band',
    },
    occurrences: [
      {
        weekday: WEEKDAY.friday,
        startTime: '20:00',
        durationMinutes: 180,
        title: 'Live Jazz Quartet (fictional)',
        genreTags: ['jazz'],
        performanceType: 'live_band',
        artist: 'The Test Quartet',
        sourceExpression: 'Fri 8pm - 11pm',
        ...confirmedByVenue,
      },
      {
        // A second night, so the pilot market has something on its own
        // weekend. Every Dubai fixture ran on a Friday, which was right when
        // the canonical query was "Friday night" and wrong once the weekend
        // became market configuration: the UAE weekend is Saturday and Sunday,
        // so "this weekend" in Dubai matched nothing at all.
        weekday: WEEKDAY.saturday,
        startTime: '21:00',
        durationMinutes: 150,
        title: 'Saturday Jazz Trio (fictional)',
        genreTags: ['jazz'],
        performanceType: 'live_band',
        artist: 'The Test Trio',
        sourceExpression: 'Sat 9pm - 11:30pm',
        ...confirmedByVenue,
      },
    ],
  },
  {
    marketSlug: 'dubai',
    slug: 'quiet-courtyard-test',
    referenceName: 'Quiet Courtyard Test (fictional)',
    names: [{ locale: 'en-AE', name: 'Quiet Courtyard Test' }],
    neighborhoodKey: 'dxb-oldtown',
    point: [55.301, 25.221],
    status: 'active',
    bookingUrl: 'https://example.invalid/quiet-courtyard/reserve',
    purpose:
      'Must be excluded when live music is required (AC01), despite the best conversation score in the set.',
    kinds: [{ ...attested('restaurant'), isPrimary: true }],
    experienceTags: [attested('garden_courtyard'), attested('intimate_cosy'), attested('date_night'), attested('casual_everyday')],
    policies: {
      alcoholFree: says(true),
      halal: says(true, 'verified'),
      takesReservations: says(true),
      openPastMidnight: says(false),
      minimumAge: says(0, 'verified'),
    },
    experience: {
      energy: 1,
      conversationFriendliness: 5,
      lighting: 3,
      seatingComfort: 4,
      noiseBand: 'quiet',
      outdoorSeating: true,
      familyFriendly: true,
      wheelchairAccessible: true,
      evidenceState: 'corroborated',
      observationCount: 9,
    },
    price: {
      low: '120',
      high: '220',
      basis: 'per_person',
      includesTax: true,
      includesServiceCharge: true,
      evidenceState: 'corroborated',
    },
    series: null,
    occurrences: [],
  },
  {
    marketSlug: 'dubai',
    slug: 'rock-stage-test',
    referenceName: 'Rock Stage Test (fictional)',
    names: [{ locale: 'en-AE', name: 'Rock Stage Test' }],
    neighborhoodKey: 'dxb-marina',
    point: [55.146, 25.084],
    status: 'active',
    bookingUrl: 'https://example.invalid/rock-stage/reserve',
    purpose:
      'Price band straddles a 300 ceiling: needs_confirmation, never silently "within budget" (brief C5).',
    kinds: [{ ...attested('live_music_venue'), isPrimary: true }, attested('drinks_lounge')],
    experienceTags: [checked('live_music'), attested('rock_indie'), attested('dancing'), attested('big_group')],
    policies: {
      licensed: says(true),
      takesReservations: says(false),
      openPastMidnight: says(true),
      minimumAge: says(21, 'verified'),
    },
    experience: {
      energy: 5,
      conversationFriendliness: 1,
      lighting: 2,
      seatingComfort: 2,
      noiseBand: 'loud',
      outdoorSeating: false,
      familyFriendly: false,
      wheelchairAccessible: false,
      evidenceState: 'source_claimed',
      observationCount: 2,
    },
    price: {
      low: '220',
      high: '350',
      basis: 'per_person',
      includesTax: false,
      includesServiceCharge: false,
      evidenceState: 'source_claimed',
    },
    series: null,
    occurrences: [
      {
        weekday: WEEKDAY.friday,
        startTime: '21:00',
        durationMinutes: 180,
        title: 'Rock Night (fictional)',
        genreTags: ['rock'],
        performanceType: 'live_band',
        sourceExpression: 'Fridays 9pm',
        ...confirmedByVenue,
      },
    ],
  },
  {
    marketSlug: 'dubai',
    slug: 'unknown-price-test',
    referenceName: 'Unknown Price Test (fictional)',
    names: [
      { locale: 'en-AE', name: 'Unknown Price Test' },
      { locale: 'ar-AE', name: 'سعر غير معروف' },
    ],
    neighborhoodKey: 'dxb-oldtown',
    point: [55.305, 25.219],
    status: 'active',
    bookingUrl: null,
    purpose:
      'Event verified but no price evidence at all: needs_confirmation for a different reason than Rock Stage.',
    kinds: [{ ...attested('live_music_venue'), isPrimary: true }, attested('restaurant')],
    experienceTags: [checked('live_music'), checked('arabic_music'), attested('shisha'), attested('celebration')],
    policies: {
      alcoholFree: says(true),
      halal: says(true, 'verified'),
      takesReservations: says(true),
      minimumAge: says(0, 'source_claimed'),
    },
    experience: {
      energy: 3,
      conversationFriendliness: 4,
      noiseBand: 'moderate',
      outdoorSeating: true,
      evidenceState: 'source_claimed',
      observationCount: 1,
    },
    // No price row at all. An unknown price is a missing row, never nulls.
    price: null,
    series: null,
    occurrences: [
      {
        weekday: WEEKDAY.friday,
        startTime: '20:30',
        durationMinutes: 150,
        title: 'Arabic Music Evening (fictional)',
        genreTags: ['arabic', 'oud'],
        performanceType: 'live_band',
        sourceExpression: 'Friday evening',
        state: 'confirmed',
        evidenceState: 'verified',
        sourceAuthority: 'editor_checked',
      },
    ],
  },
  {
    marketSlug: 'dubai',
    slug: 'expired-gig-test',
    referenceName: 'Expired Gig Test (fictional)',
    names: [{ locale: 'en-AE', name: 'Expired Gig Test' }],
    neighborhoodKey: 'dxb-marina',
    point: [55.139, 25.078],
    status: 'active',
    bookingUrl: 'https://example.invalid/expired-gig/reserve',
    purpose: 'Only a past occurrence. Must never appear as upcoming (AC02).',
    kinds: [{ ...attested('live_music_venue'), isPrimary: true }],
    experienceTags: [attested('live_music'), attested('casual_everyday')],
    policies: {
      licensed: says(true),
      minimumAge: says(18),
    },
    experience: {
      energy: 4,
      conversationFriendliness: 2,
      noiseBand: 'loud',
      evidenceState: 'source_claimed',
      observationCount: 1,
    },
    price: {
      low: '200',
      high: '250',
      basis: 'per_person',
      includesTax: true,
      includesServiceCharge: false,
      evidenceState: 'source_claimed',
    },
    series: null,
    occurrences: [
      {
        weekday: WEEKDAY.thursday,
        weekOffset: -1,
        startTime: '21:00',
        durationMinutes: 180,
        title: 'Last Week Thursday Session (fictional)',
        genreTags: ['jazz'],
        performanceType: 'live_band',
        sourceExpression: 'Thu 9pm',
        ...confirmedByVenue,
      },
    ],
  },

  // ---- edge cases fixtures/README requires -----------------------------
  {
    marketSlug: 'dubai',
    slug: 'midnight-crossing-test',
    referenceName: 'Midnight Crossing Test (fictional)',
    names: [{ locale: 'en-AE', name: 'Midnight Crossing Test' }],
    neighborhoodKey: 'dxb-marina',
    point: [55.148, 25.086],
    status: 'active',
    bookingUrl: 'https://example.invalid/midnight/reserve',
    purpose: 'A 22:00-02:00 set must match a Friday evening query, not fall between days.',
    kinds: [{ ...attested('drinks_lounge'), isPrimary: true }, attested('live_music_venue')],
    experienceTags: [checked('live_music'), attested('electronic_dj'), attested('dancing'), attested('rooftop')],
    policies: {
      licensed: says(true),
      // The fixture's whole point is the 22:00-02:00 set, so this one fact is
      // editor-checked rather than merely asserted.
      openPastMidnight: says(true, 'verified'),
      takesReservations: says(true),
      minimumAge: says(21, 'verified'),
    },
    experience: {
      energy: 4,
      conversationFriendliness: 2,
      noiseBand: 'loud',
      outdoorSeating: true,
      evidenceState: 'source_claimed',
      observationCount: 3,
    },
    price: {
      low: '150',
      high: '240',
      basis: 'per_person',
      includesTax: true,
      includesServiceCharge: false,
      evidenceState: 'source_claimed',
    },
    series: null,
    occurrences: [
      {
        weekday: WEEKDAY.friday,
        startTime: '22:00',
        durationMinutes: 240,
        title: 'Late Set (fictional)',
        genreTags: ['jazz', 'soul'],
        performanceType: 'live_band',
        sourceExpression: 'Fri 10pm til late',
        ...confirmedByVenue,
      },
    ],
  },
  {
    marketSlug: 'dubai',
    slug: 'cancelled-night-test',
    referenceName: 'Cancelled Night Test (fictional)',
    names: [{ locale: 'en-AE', name: 'Cancelled Night Test' }],
    neighborhoodKey: 'dxb-oldtown',
    point: [55.298, 25.224],
    status: 'active',
    bookingUrl: 'https://example.invalid/cancelled/reserve',
    purpose: 'Cancelled occurrence must be excluded and stay excluded (doc 16 #6).',
    kinds: [{ ...attested('concert_show'), isPrimary: true }],
    experienceTags: [attested('live_music'), attested('comedy')],
    policies: {
      takesReservations: says(true),
      minimumAge: says(16),
    },
    experience: {
      conversationFriendliness: 3,
      noiseBand: 'moderate',
      evidenceState: 'source_claimed',
      observationCount: 1,
    },
    price: {
      low: '160',
      high: '230',
      basis: 'per_person',
      includesTax: true,
      includesServiceCharge: false,
      evidenceState: 'source_claimed',
    },
    series: null,
    occurrences: [
      {
        weekday: WEEKDAY.friday,
        startTime: '20:00',
        durationMinutes: 180,
        title: 'Cancelled Jazz Night (fictional)',
        genreTags: ['jazz'],
        performanceType: 'live_band',
        sourceExpression: 'Fri 8pm',
        state: 'cancelled',
        evidenceState: 'source_claimed',
        sourceAuthority: 'venue_attested',
      },
    ],
  },
  {
    marketSlug: 'dubai',
    slug: 'scheduled-only-test',
    referenceName: 'Scheduled Only Test (fictional)',
    names: [{ locale: 'en-AE', name: 'Scheduled Only Test' }],
    neighborhoodKey: 'dxb-marina',
    point: [55.152, 25.09],
    status: 'active',
    bookingUrl: 'https://example.invalid/scheduled-only/reserve',
    purpose:
      'The single most important exclusion: a weekly rule with no date-specific evidence is NOT recommendable (ADR-010).',
    kinds: [{ ...attested('live_music_venue'), isPrimary: true }],
    experienceTags: [attested('live_music'), attested('acoustic_singer')],
    policies: {
      takesReservations: says(false),
    },
    experience: {
      energy: 3,
      conversationFriendliness: 3,
      noiseBand: 'moderate',
      evidenceState: 'source_claimed',
      observationCount: 1,
    },
    price: {
      low: '170',
      high: '250',
      basis: 'per_person',
      includesTax: true,
      includesServiceCharge: false,
      evidenceState: 'source_claimed',
    },
    series: {
      title: 'Weekly Live Music (fictional)',
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=FR',
      genreTags: ['jazz'],
      performanceType: 'live_band',
    },
    occurrences: [
      {
        weekday: WEEKDAY.friday,
        startTime: '20:00',
        durationMinutes: 180,
        title: 'Weekly Live Music (fictional)',
        genreTags: ['jazz'],
        performanceType: 'live_band',
        sourceExpression: 'live music every weekend',
        // Materialised from the rule. No evidence for this date.
        state: 'scheduled',
        evidenceState: 'unknown',
        sourceAuthority: null,
      },
    ],
  },
  {
    marketSlug: 'dubai',
    slug: 'conflicting-times-test',
    referenceName: 'Conflicting Times Test (fictional)',
    names: [{ locale: 'en-AE', name: 'Conflicting Times Test' }],
    neighborhoodKey: 'dxb-oldtown',
    point: [55.308, 25.216],
    status: 'active',
    bookingUrl: 'https://example.invalid/conflicting/reserve',
    purpose:
      'Two credible sources disagree on the start time. Must not be recommended and must not be silently resolved (doc 16 #5).',
    kinds: [{ ...attested('live_music_venue'), isPrimary: true }, attested('drinks_lounge')],
    experienceTags: [attested('live_music'), attested('jazz'), attested('rooftop')],
    policies: {
      licensed: says(true),
      openPastMidnight: says(true),
    },
    experience: {
      conversationFriendliness: 3,
      noiseBand: 'moderate',
      evidenceState: 'source_claimed',
      observationCount: 1,
    },
    price: {
      low: '190',
      high: '260',
      basis: 'per_person',
      includesTax: true,
      includesServiceCharge: false,
      evidenceState: 'source_claimed',
    },
    series: null,
    occurrences: [
      {
        weekday: WEEKDAY.friday,
        startTime: '19:00',
        durationMinutes: 180,
        title: 'Disputed Start Time (fictional)',
        genreTags: ['jazz'],
        performanceType: 'live_band',
        sourceExpression: 'Fri 7pm (venue page)',
        state: 'scheduled',
        evidenceState: 'source_claimed',
        sourceAuthority: 'venue_attested',
        // The disagreement that makes this fixture what it is. The seeder
        // publishes the first claim and lets app_publish_claim find the
        // conflict, so both sides end up queued and neither is published.
        disputedBy: {
          startTime: '21:00',
          sourceExpression: 'Fri 9pm (aggregator listing)',
          sourceAuthority: 'authorized_feed',
          evidenceState: 'source_claimed',
        },
      },
    ],
  },
  {
    marketSlug: 'dubai',
    slug: 'closed-venue-test',
    referenceName: 'Closed Venue Test (fictional)',
    names: [{ locale: 'en-AE', name: 'Closed Venue Test' }],
    neighborhoodKey: 'dxb-marina',
    point: [55.137, 25.075],
    status: 'permanently_closed',
    bookingUrl: null,
    purpose: 'A closed venue is excluded even with a confirmed occurrence on the books.',
    kinds: [{ ...attested('restaurant'), isPrimary: true }],
    experienceTags: [attested('casual_everyday')],
    policies: {
      halal: says(true),
    },
    experience: {
      conversationFriendliness: 4,
      evidenceState: 'stale',
      observationCount: 1,
    },
    price: null,
    series: null,
    occurrences: [
      {
        weekday: WEEKDAY.friday,
        startTime: '20:00',
        durationMinutes: 180,
        title: 'Jazz Night (fictional, venue since closed)',
        genreTags: ['jazz'],
        performanceType: 'live_band',
        sourceExpression: 'Fri 8pm',
        ...confirmedByVenue,
      },
    ],
  },
  {
    marketSlug: 'dubai',
    slug: 'accessibility-unknown-test',
    referenceName: 'Accessibility Unknown Test (fictional)',
    names: [{ locale: 'en-AE', name: 'Accessibility Unknown Test' }],
    neighborhoodKey: 'dxb-oldtown',
    point: [55.295, 25.227],
    status: 'active',
    bookingUrl: 'https://example.invalid/accessibility-unknown/reserve',
    purpose:
      'Wheelchair access unknown. With accessibility required this must be needs_confirmation, never a silent pass (doc 13).',
    kinds: [{ ...attested('live_music_venue'), isPrimary: true }, attested('restaurant')],
    experienceTags: [checked('live_music'), attested('acoustic_singer'), attested('intimate_cosy'), attested('solo_friendly')],
    policies: {
      alcoholFree: says(true),
      halal: says(true),
      takesReservations: says(true),
      minimumAge: says(0),
    },
    experience: {
      energy: 2,
      conversationFriendliness: 4,
      noiseBand: 'quiet',
      // wheelchairAccessible deliberately absent: unknown, not false.
      evidenceState: 'source_claimed',
      observationCount: 2,
    },
    price: {
      low: '140',
      high: '210',
      basis: 'per_person',
      includesTax: true,
      includesServiceCharge: false,
      evidenceState: 'source_claimed',
    },
    series: null,
    occurrences: [
      {
        weekday: WEEKDAY.friday,
        startTime: '19:30',
        durationMinutes: 150,
        title: 'Acoustic Evening (fictional)',
        genreTags: ['acoustic', 'folk'],
        performanceType: 'acoustic_set',
        sourceExpression: 'Fri 7:30pm',
        ...confirmedByVenue,
      },
    ],
    pendingClaims: [
      {
        attributeKey: 'access.wheelchair',
        value: true,
        sourceAuthority: 'visitor_reported',
        evidenceState: 'source_claimed',
        excerpt: 'visitor note: "got my partner’s chair in through the side door"',
        purpose:
          'Accessibility is high-impact, so this cannot publish without a recorded decision. ' +
          'It is also the case where approving is not the same as verifying: the reviewer is ' +
          'judging a visitor report, not the entrance.',
      },
      {
        attributeKey: 'price.cover_charge',
        value: { amountMinor: 7500, currency: 'AED', basis: 'per_entry' },
        sourceAuthority: 'ai_extracted',
        evidenceState: 'source_claimed',
        excerpt: 'extracted from a listing: "entry 75 on weekends"',
        purpose:
          'A machine extraction of a fee. High-impact and unapproved, so the typed column stays ' +
          'empty and the page says nothing about a cover charge until a human decides.',
      },
    ],
  },

  // ---- Cairo: the second-market architecture test ----------------------
  {
    marketSlug: 'cairo',
    slug: 'nile-oud-house-test',
    referenceName: 'Nile Oud House Test (fictional)',
    names: [
      { locale: 'ar-EG', name: 'بيت العود على النيل' },
      { locale: 'en-EG', name: 'Nile Oud House Test' },
    ],
    neighborhoodKey: 'cai-riverside',
    point: [31.221, 30.041],
    status: 'active',
    bookingUrl: 'https://example.invalid/nile-oud/reserve',
    purpose:
      'Arabic name, EGP prices, Africa/Cairo local times. Proves the slice works with no code change (doc 16 #3).',
    kinds: [{ ...attested('live_music_venue'), isPrimary: true }, attested('restaurant')],
    // nile_view is a Cairo market extension, seeded alongside the market.
    experienceTags: [checked('live_music'), checked('arabic_music'), attested('nile_view'), attested('grand_historic'), attested('celebration')],
    policies: {
      halal: says(true, 'verified'),
      alcoholFree: says(true),
      takesReservations: says(true),
      openPastMidnight: says(true),
      minimumAge: says(0, 'verified'),
    },
    experience: {
      energy: 3,
      conversationFriendliness: 4,
      lighting: 2,
      seatingComfort: 4,
      noiseBand: 'moderate',
      outdoorSeating: true,
      familyFriendly: true,
      wheelchairAccessible: true,
      evidenceState: 'source_claimed',
      observationCount: 5,
    },
    price: {
      // EGP, not a converted AED figure. FX is presentation only (doc 10).
      low: '900',
      high: '1500',
      basis: 'per_person',
      includesTax: true,
      includesServiceCharge: false,
      evidenceState: 'source_claimed',
    },
    series: {
      title: 'ليالي العود (fictional)',
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=FR',
      genreTags: ['arabic', 'oud'],
      performanceType: 'live_band',
    },
    occurrences: [
      {
        weekday: WEEKDAY.friday,
        startTime: '21:00',
        durationMinutes: 180,
        title: 'ليلة عود (fictional)',
        genreTags: ['arabic', 'oud'],
        performanceType: 'live_band',
        artist: 'فرقة الاختبار',
        sourceExpression: 'الجمعة ٩ مساءً',
        ...confirmedByVenue,
      },
    ],
  },
  {
    marketSlug: 'cairo',
    slug: 'garden-tea-room-test',
    referenceName: 'Garden Tea Room Test (fictional)',
    names: [
      { locale: 'ar-EG', name: 'غرفة شاي الحديقة' },
      { locale: 'en-EG', name: 'Garden Tea Room Test' },
    ],
    neighborhoodKey: 'cai-riverside',
    point: [31.225, 30.038],
    status: 'active',
    bookingUrl: null,
    purpose: 'Cairo quiet option with no live music: the Cairo mirror of Quiet Courtyard.',
    kinds: [{ ...attested('restaurant'), isPrimary: true }],
    experienceTags: [attested('garden_courtyard'), attested('intimate_cosy'), attested('solo_friendly'), attested('casual_everyday')],
    policies: {
      alcoholFree: says(true),
      halal: says(true, 'verified'),
      takesReservations: says(false),
      minimumAge: says(0, 'verified'),
    },
    experience: {
      energy: 1,
      conversationFriendliness: 5,
      noiseBand: 'quiet',
      outdoorSeating: true,
      familyFriendly: true,
      wheelchairAccessible: false,
      evidenceState: 'source_claimed',
      observationCount: 2,
    },
    price: {
      low: '400',
      high: '700',
      basis: 'per_person',
      includesTax: true,
      includesServiceCharge: false,
      evidenceState: 'source_claimed',
    },
    series: null,
    occurrences: [],
  },
];
