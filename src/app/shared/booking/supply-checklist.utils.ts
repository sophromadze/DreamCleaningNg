/**
 * SINGLE SOURCE OF TRUTH (frontend) for deciding what the customer must have ready:
 * whether the Cleaning Supplies extra was taken, and whether the job needs an
 * oven-cleaning liquid on site.
 *
 * Mirrored on the backend in `Helpers/CustomerSupplyChecklist.cs`, which builds the same
 * checklist for the confirmation email and SMS. Any change here must be applied there too —
 * otherwise the customer is told to buy a different set of products depending on which
 * surface they read (booking modal, booking-success, order-details, order-payment, email, SMS).
 */

/** Extra-service shapes the various surfaces carry: booking uses `name`, orders use `extraServiceName`. */
export interface SupplyChecklistExtra {
  name?: string | null;
  extraServiceName?: string | null;
}

export function extraServiceNamesOf(extras: SupplyChecklistExtra[] | null | undefined): string[] {
  return (extras || [])
    .map(e => (e?.extraServiceName ?? e?.name ?? '').toLowerCase())
    .filter(n => !!n);
}

export function hasCleaningSuppliesExtra(extraNames: string[]): boolean {
  return extraNames.some(n => n.includes('cleaning supplies'));
}

/**
 * True when the cleaners need an oven-cleaning liquid: a Deep / Super Deep Cleaning booking,
 * OR the Oven Cleaning extra on its own. The oven extra used to be missed here, so a customer
 * who ordered oven cleaning without deep cleaning was never told to have Oven Cleaner ready.
 */
export function requiresOvenCleaner(extraNames: string[]): boolean {
  return extraNames.some(n => n.includes('deep cleaning')) || extraNames.some(n => n.includes('oven'));
}

/** Convenience wrapper for surfaces that hold the extras list rather than the names. */
export function requiresOvenCleanerForExtras(extras: SupplyChecklistExtra[] | null | undefined): boolean {
  return requiresOvenCleaner(extraServiceNamesOf(extras));
}

/** The Zep line, phrased identically to the email/SMS checklist. */
export function zepLiquidsText(needsOvenCleaner: boolean): string {
  return needsOvenCleaner
    ? 'Green, Floor (or similar), Oven Cleaner (or similar)'
    : 'Green, Floor (or similar)';
}
