/**
 * UI copy and text direction.
 *
 * ADR-012 splits localisation in two: the architecture is locale-ready and
 * RTL-correct from the start, while full translation is P2. So this holds the
 * handful of chrome strings the slice needs in both languages, and nothing
 * pretends to be a translation pipeline.
 *
 * What is NOT translated here, deliberately: venue names, event titles and
 * artist names. Doc 10 forbids translating a proper name without a source or a
 * clear "generated translation" label. Those come from place_names and the
 * occurrence row, in whichever locale the data has them.
 *
 * Keyed by language subtag rather than full locale, so a market using ar-EG and
 * one using ar-AE share copy while keeping their own formatting locale.
 */

export type Language = 'en' | 'ar';

export function languageOf(locale: string): Language {
  const subtag = locale.split('-')[0]?.toLowerCase();
  return subtag === 'ar' ? 'ar' : 'en';
}

/**
 * Text direction for a locale. Asks Intl rather than keeping a list of RTL
 * languages, so a market added later is handled without a code change.
 */
/**
 * Intl.Locale's text-info accessor is not in TypeScript's lib yet, and runtimes
 * disagree on whether it is the `getTextInfo()` method or the `textInfo`
 * getter. Typed narrowly here rather than cast to any, so the shape being
 * relied on is written down.
 */
interface LocaleTextInfo {
  readonly direction?: 'ltr' | 'rtl';
}
interface LocaleWithTextInfo {
  readonly textInfo?: LocaleTextInfo;
  getTextInfo?: () => LocaleTextInfo;
}

export function directionOf(locale: string): 'ltr' | 'rtl' {
  try {
    const candidate = new Intl.Locale(locale) as unknown as LocaleWithTextInfo;
    const info = candidate.getTextInfo?.() ?? candidate.textInfo;
    if (info?.direction === 'rtl') return 'rtl';
    if (info?.direction === 'ltr') return 'ltr';
  } catch {
    // An unparseable tag falls through to the language check below.
  }
  return languageOf(locale) === 'ar' ? 'rtl' : 'ltr';
}

interface Dictionary {
  readonly tagline: string;
  readonly chooseMarket: string;
  readonly marketsIntro: string;
  readonly demoBanner: string;
  readonly findNight: string;
  readonly date: string;
  readonly from: string;
  readonly to: string;
  readonly partySize: string;
  readonly budgetCeiling: string;
  readonly perPerson: string;
  readonly musicStyles: string;
  readonly requireLiveMusic: string;
  readonly mustHaves: string;
  readonly accessible: string;
  readonly outdoor: string;
  readonly familyFriendly: string;
  readonly quietEnough: string;
  readonly search: string;
  readonly shortlist: string;
  readonly needsConfirmation: string;
  readonly needsConfirmationNote: string;
  readonly excluded: string;
  readonly noResults: string;
  readonly whatWouldHelp: string;
  readonly raiseBudgetTo: string;
  readonly tryAnotherDate: string;
  readonly dropRequirement: string;
  readonly widenWindow: string;
  readonly whyThisMatches: string;
  readonly unknownsHere: string;
  readonly spend: string;
  readonly spendUnverified: string;
  readonly checkWithVenue: string;
  readonly lastChecked: string;
  readonly sourceSaid: string;
  readonly bookExternally: string;
  readonly externalNote: string;
  readonly noBookingLink: string;
  readonly viewVenue: string;
  readonly back: string;
  readonly atmosphere: string;
  readonly conversation: string;
  readonly energy: string;
  readonly noise: string;
  readonly seating: string;
  readonly observations: string;
  readonly informationComplete: string;
  readonly notVerified: string;
  readonly crossesMidnight: string;
  readonly alsoOn: string;
  readonly whenLabel: string;
  readonly bandLabel: string;
  readonly bands: Readonly<Record<string, string>>;
  readonly whenOptions: Readonly<Record<string, string>>;
  readonly confirmedForThisDate: string;
  readonly noConfirmedPerformance: string;
  readonly availableHere: string;
  readonly noPreference: string;
  readonly upcomingPerformances: string;
  readonly conversationHint: string;
  readonly rankingVersion: string;
  readonly confidence: Record<string, string>;
  readonly noiseBands: Record<string, string>;
  readonly constraints: Record<string, string>;
}

const EN: Dictionary = {
  tagline: 'Find your kind of night.',
  chooseMarket: 'Choose a city',
  marketsIntro: 'Experience discovery, city by city. Pick where you are.',
  demoBanner:
    'Demonstration data. Every venue, performance and price below is fictional and must not be treated as a real recommendation.',
  findNight: 'Find your night',
  date: 'Date',
  from: 'From',
  to: 'Until',
  partySize: 'People',
  budgetCeiling: 'Budget ceiling',
  perPerson: 'per person',
  musicStyles: 'Music you like',
  requireLiveMusic: 'Live music required',
  mustHaves: 'Must-haves',
  accessible: 'Step-free access',
  outdoor: 'Outdoor seating',
  familyFriendly: 'Family friendly',
  quietEnough: 'Quiet enough to talk',
  search: 'Show me',
  shortlist: 'Shortlist',
  needsConfirmation: 'Needs confirmation',
  needsConfirmationNote:
    'We could not confirm one of your requirements for these. They are not in the shortlist.',
  excluded: 'Ruled out',
  noResults: 'Nothing matches every requirement.',
  whatWouldHelp: 'What would change this',
  raiseBudgetTo: 'Raise your ceiling to',
  tryAnotherDate: 'Try another date',
  dropRequirement: 'Drop this requirement',
  widenWindow: 'Widen the time window',
  whyThisMatches: 'Why this matches',
  unknownsHere: 'Not confirmed',
  spend: 'Typical spend',
  spendUnverified: 'Spend not verified',
  checkWithVenue: 'Check with the venue',
  lastChecked: 'Last checked',
  sourceSaid: 'The source said',
  bookExternally: 'Book on the venue’s site',
  externalNote: 'Opens the venue’s own page. We do not make the booking.',
  noBookingLink: 'No booking link on file',
  viewVenue: 'Venue details',
  back: 'Back to results',
  atmosphere: 'Atmosphere',
  conversation: 'Conversation',
  energy: 'Energy',
  noise: 'Noise',
  seating: 'Seating comfort',
  observations: 'observations',
  informationComplete: 'information complete',
  notVerified: 'Not verified',
  crossesMidnight: 'runs past midnight',
  alsoOn: 'Also on',
  whenLabel: 'When',
  bandLabel: 'Time of day',
  bands: {
    brunch: 'Brunch',
    afternoon: 'Afternoon',
    evening: 'Evening',
    late_night: 'Late night',
  },
  whenOptions: {
    tonight: 'Tonight',
    tomorrow: 'Tomorrow',
    weekend: 'This weekend',
    next3: 'Next 3 days',
    next7: 'Next 7 days',
    next14: 'Next 14 days',
  },
  confirmedForThisDate: 'confirmed for this date',
  noConfirmedPerformance: 'no confirmed performance in this window',
  availableHere: 'confirmed here',
  noPreference: 'No preference',
  upcomingPerformances: 'Confirmed performances',
  conversationHint: '1 = loud, 5 = easy to talk',
  rankingVersion: 'Ranking',
  confidence: {
    venue_confirmed: 'Venue confirmed',
    editor_verified: 'Editor verified',
    visitor_reported: 'Visitor reported',
    unverified_estimate: 'Unverified estimate',
    needs_recheck: 'Needs rechecking',
    conflicting: 'Sources disagree',
    unknown: 'Unknown',
    not_shown: '',
  },
  noiseBands: { quiet: 'Quiet', moderate: 'Moderate', loud: 'Loud' },
  constraints: {
    live_music: 'Live music',
    budget: 'Budget',
    wheelchair_accessible: 'Step-free access',
    outdoor_seating: 'Outdoor seating',
    family_friendly: 'Family friendly',
    quiet_enough_to_talk: 'Quiet enough to talk',
    venue_open: 'Open',
  },
};

const AR: Dictionary = {
  tagline: 'اعرف ليلتك المناسبة.',
  chooseMarket: 'اختر مدينة',
  marketsIntro: 'استكشاف التجارب، مدينة بمدينة. اختر مكانك.',
  demoBanner:
    'بيانات توضيحية. كل مكان وعرض وسعر بالأسفل خيالي ولا يصح اعتباره توصية حقيقية.',
  findNight: 'اعرف ليلتك',
  date: 'التاريخ',
  from: 'من',
  to: 'إلى',
  partySize: 'عدد الأشخاص',
  budgetCeiling: 'الحد الأعلى للميزانية',
  perPerson: 'للفرد',
  musicStyles: 'الموسيقى التي تحبها',
  requireLiveMusic: 'موسيقى حية مطلوبة',
  mustHaves: 'شروط أساسية',
  accessible: 'وصول بدون درجات',
  outdoor: 'جلسات خارجية',
  familyFriendly: 'مناسب للعائلات',
  quietEnough: 'هادئ بما يكفي للحديث',
  search: 'اعرض النتائج',
  shortlist: 'القائمة المختارة',
  needsConfirmation: 'يحتاج تأكيدًا',
  needsConfirmationNote:
    'لم نتمكن من تأكيد أحد شروطك لهذه الأماكن، ولذلك هي خارج القائمة المختارة.',
  excluded: 'مستبعدة',
  noResults: 'لا يوجد ما يطابق كل الشروط.',
  whatWouldHelp: 'ما قد يغيّر النتيجة',
  raiseBudgetTo: 'ارفع الحد الأعلى إلى',
  tryAnotherDate: 'جرّب تاريخًا آخر',
  dropRequirement: 'تجاوز هذا الشرط',
  widenWindow: 'وسّع نطاق الوقت',
  whyThisMatches: 'لماذا يناسبك',
  unknownsHere: 'غير مؤكد',
  spend: 'الإنفاق المتوقع',
  spendUnverified: 'الإنفاق غير مؤكد',
  checkWithVenue: 'تحقق مع المكان',
  lastChecked: 'آخر تحقق',
  sourceSaid: 'المصدر يقول',
  bookExternally: 'احجز على موقع المكان',
  externalNote: 'يفتح صفحة المكان نفسه. نحن لا نقوم بالحجز.',
  noBookingLink: 'لا يوجد رابط حجز',
  viewVenue: 'تفاصيل المكان',
  back: 'رجوع إلى النتائج',
  atmosphere: 'الأجواء',
  conversation: 'الحديث',
  energy: 'الحيوية',
  noise: 'الضجيج',
  seating: 'راحة الجلوس',
  observations: 'ملاحظات',
  informationComplete: 'من المعلومات متوفرة',
  notVerified: 'غير مؤكد',
  crossesMidnight: 'يمتد بعد منتصف الليل',
  alsoOn: 'أيضًا في',
  whenLabel: 'متى',
  bandLabel: 'وقت اليوم',
  bands: {
    brunch: 'برانش',
    afternoon: 'بعد الظهر',
    evening: 'المساء',
    late_night: 'وقت متأخر',
  },
  whenOptions: {
    tonight: 'الليلة',
    tomorrow: 'غدًا',
    weekend: 'نهاية الأسبوع',
    next3: 'خلال ٣ أيام',
    next7: 'خلال ٧ أيام',
    next14: 'خلال ١٤ يومًا',
  },
  confirmedForThisDate: 'مؤكد في هذا التاريخ',
  noConfirmedPerformance: 'لا يوجد عرض مؤكد في هذا الوقت',
  availableHere: 'مؤكد هنا',
  noPreference: 'بدون تفضيل',
  upcomingPerformances: 'عروض مؤكدة',
  conversationHint: '١ = صاخب، ٥ = مناسب للحديث',
  rankingVersion: 'الترتيب',
  confidence: {
    venue_confirmed: 'مؤكد من المكان',
    editor_verified: 'موثّق من المحرر',
    visitor_reported: 'من زائر',
    unverified_estimate: 'تقدير غير موثّق',
    needs_recheck: 'يحتاج إعادة تحقق',
    conflicting: 'المصادر متضاربة',
    unknown: 'غير معروف',
    not_shown: '',
  },
  noiseBands: { quiet: 'هادئ', moderate: 'متوسط', loud: 'عالٍ' },
  constraints: {
    live_music: 'موسيقى حية',
    budget: 'الميزانية',
    wheelchair_accessible: 'وصول بدون درجات',
    outdoor_seating: 'جلسات خارجية',
    family_friendly: 'مناسب للعائلات',
    quiet_enough_to_talk: 'هادئ للحديث',
    venue_open: 'مفتوح',
  },
};

/**
 * Pick a UI language from an Accept-Language header.
 *
 * The market selector has no market, so it has no locale to inherit. Taking the
 * first market's locale would make the page's language depend on alphabetical
 * order, which is arbitrary and visibly odd. Asking the browser is the honest
 * answer, with English as the documented fallback rather than an accident.
 */
export function negotiateLanguage(
  acceptLanguage: string | null,
  available: readonly Language[] = ['en', 'ar'],
): Language {
  if (!acceptLanguage) return available[0] ?? 'en';

  const ranked = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag, ...rest] = part.trim().split(';');
      const q = rest.find((r) => r.trim().startsWith('q='));
      const quality = q ? Number.parseFloat(q.trim().slice(2)) : 1;
      return { tag: (tag ?? '').trim().toLowerCase(), quality: Number.isNaN(quality) ? 0 : quality };
    })
    .filter((entry) => entry.tag.length > 0 && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality);

  for (const entry of ranked) {
    if (entry.tag === '*') break;
    const subtag = entry.tag.split('-')[0] as Language;
    if (available.includes(subtag)) return subtag;
  }
  return available[0] ?? 'en';
}

export function copyFor(locale: string): Dictionary {
  return languageOf(locale) === 'ar' ? AR : EN;
}
