/**
 * Evidence-facing UI primitives.
 *
 * The product's promise is legible uncertainty, so these are not decoration.
 * A chip that says "Venue confirmed" is making a claim about provenance, and it
 * is rendered from the derived label (ADR-005) rather than from anything a
 * template author chose.
 */

import type { ConfidenceLabel } from '@/modules/evidence/confidence';
import { copyFor } from '@/modules/i18n/copy';

/**
 * Colour carries meaning here, so it is paired with text in every case — the
 * label itself is always readable without relying on the colour.
 */
const TONE: Record<ConfidenceLabel, string> = {
  editor_verified: 'bg-emerald-50 text-emerald-900 ring-emerald-200',
  venue_confirmed: 'bg-sky-50 text-sky-900 ring-sky-200',
  visitor_reported: 'bg-violet-50 text-violet-900 ring-violet-200',
  unverified_estimate: 'bg-amber-50 text-amber-900 ring-amber-200',
  needs_recheck: 'bg-orange-50 text-orange-900 ring-orange-200',
  conflicting: 'bg-rose-50 text-rose-900 ring-rose-200',
  unknown: 'bg-neutral-100 text-neutral-700 ring-neutral-300',
  not_shown: 'hidden',
};

export function ConfidenceChip({
  label,
  locale,
}: {
  label: ConfidenceLabel;
  locale: string;
}) {
  if (label === 'not_shown') return null;
  const copy = copyFor(locale);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE[label]}`}
    >
      {copy.confidence[label] ?? label}
    </span>
  );
}

/** Reasons a candidate matched or did not, rendered from machine-readable grounds. */
export function OutcomeList({
  items,
}: {
  items: { mark: 'pass' | 'fail' | 'unconfirmed'; label: string; detail: string }[];
}) {
  return (
    <ul className="mt-3 space-y-1 text-sm">
      {items.map((item) => (
        <li key={`${item.label}-${item.detail}`} className="flex gap-2">
          <span
            aria-hidden="true"
            className={
              item.mark === 'pass'
                ? 'text-emerald-600'
                : item.mark === 'fail'
                  ? 'text-rose-600'
                  : 'text-amber-600'
            }
          >
            {item.mark === 'pass' ? '✓' : item.mark === 'fail' ? '✕' : '?'}
          </span>
          <span className="text-neutral-700">
            <span className="font-medium text-neutral-900">{item.label}</span>
            {' — '}
            {item.detail}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Information completeness, surfaced separately from the score (gap G1). A
 * thinly documented venue should read as "we know little about this", never as
 * "this is poor".
 */
export function CompletenessMeter({
  fraction,
  locale,
}: {
  fraction: number;
  locale: string;
}) {
  const copy = copyFor(locale);
  const percent = Math.round(fraction * 100);
  return (
    <div className="mt-2 flex items-center gap-2 text-xs text-neutral-600">
      <div
        className="h-1.5 w-20 overflow-hidden rounded-full bg-neutral-200"
        role="img"
        aria-label={`${percent}% ${copy.informationComplete}`}
      >
        <div className="h-full rounded-full bg-neutral-500" style={{ width: `${percent}%` }} />
      </div>
      <span>
        {percent}% {copy.informationComplete}
      </span>
    </div>
  );
}

/** Demo-data notice. Doc 07: fixtures must never read as real recommendations. */
export function DemoBanner({ locale }: { locale: string }) {
  const copy = copyFor(locale);
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      {copy.demoBanner}
    </div>
  );
}
