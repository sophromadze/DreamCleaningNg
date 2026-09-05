/**
 * SINGLE SOURCE OF TRUTH (frontend) for deciding what the customer must have ready.
 *
 * Mirrored on the backend in `Helpers/CustomerSupplyChecklist.cs`, which builds the same
 * checklist for the confirmation email and SMS. Any change here must be applied there too —
 * otherwise the customer is told to buy a different set of products depending on which
 * surface they read (booking modal, booking-success, order-details, order-payment, email, SMS).
 *
 * THREE EXTRAS TAKE ITEMS OFF THE LIST, and each takes off a different thing:
 *   "Cleaning Supplies"   → the products we would otherwise ask them to buy (Zep, Windex,
 *                           cloths, sponge, mop).
 *   "Cleaning Essentials" → paper towels, garbage bags, toilet brush. NEVER the broom or
 *                           vacuum: a cleaner cannot carry one to every job, so the customer
 *                           either owns one or buys the Vacuum Cleaner extra.
 *   "Vacuum Cleaner"      → the broom-or-vacuum line, and only that line.
 * A customer holding all three is asked for nothing, so `buildSupplyChecklistItems` can
 * legitimately return an EMPTY array — every surface has to render that as "nothing to prepare"
 * rather than as an empty bulleted box.
 */

/** Extra-service shapes the various surfaces carry: booking uses `name`, orders use `extraServiceName`. */
export interface SupplyChecklistExtra {
  name?: string | null;
  extraServiceName?: string | null;
}

/**
 * Everything about one order that decides the checklist. Resolved once by
 * `resolveSupplyChecklistFacts` and passed around as a unit — mirrors `SupplyChecklistFacts`
 * on the backend.
 */
export interface SupplyChecklistFacts {
  /** "Cleaning Supplies" bought — WE bring the solutions and the cloths. */
  hasCleaningSupplies: boolean;
  /** "Cleaning Essentials" bought — WE bring paper towels, garbage bags and a toilet brush. */
  hasCleaningEssentials: boolean;
  /** "Vacuum Cleaner" bought — we bring one, so they are not asked for a broom or vacuum. */
  weBringVacuum: boolean;
  /** Deep / Super Deep Cleaning, or the Oven Cleaning extra on its own. */
  requiresOvenCleaner: boolean;
  /** Custom ("Pre-Arranged") service type — it does not use the supplies workflow. */
  isCustomServiceType: boolean;
}

/**
 * Name fragments the extras are matched on — matched on NAME (contains, case-insensitive)
 * rather than on Id, because catalogue Ids differ between dev and production and these rows
 * are admin-created. Mirrors the constants on `CustomerSupplyChecklist`.
 */
export const CLEANING_SUPPLIES_MATCH = 'cleaning supplies';
export const CLEANING_ESSENTIALS_MATCH = 'cleaning essentials';
export const VACUUM_MATCH = 'vacuum';

/** What the "Cleaning Essentials" extra covers, in checklist order. Shown in the booking modal. */
export const CLEANING_ESSENTIALS_ITEMS = ['Paper towels', 'Garbage bags', 'Toilet brush'];

/** The one line the Vacuum Cleaner extra buys the customer out of. */
export const BROOM_OR_VACUUM_ITEM = 'Broom or vacuum cleaner';

/** Single-name predicates, for surfaces that hold one extra rather than a list of names. */
export function isCleaningSuppliesExtra(name: string | null | undefined): boolean {
  return (name || '').toLowerCase().includes(CLEANING_SUPPLIES_MATCH);
}

export function isCleaningEssentialsExtra(name: string | null | undefined): boolean {
  return (name || '').toLowerCase().includes(CLEANING_ESSENTIALS_MATCH);
}

export function extraServiceNamesOf(extras: SupplyChecklistExtra[] | null | undefined): string[] {
  return (extras || [])
    .map(e => (e?.extraServiceName ?? e?.name ?? '').toLowerCase())
    .filter(n => !!n);
}

export function hasCleaningSuppliesExtra(extraNames: string[]): boolean {
  return extraNames.some(n => n.includes(CLEANING_SUPPLIES_MATCH));
}

/**
 * True when the customer bought "Cleaning Essentials". Note this does NOT match
 * "Cleaning Supplies" and vice versa — the two are separate purchases that can be held
 * together, and each removes a different part of the checklist.
 */
export function hasCleaningEssentialsExtra(extraNames: string[]): boolean {
  return extraNames.some(n => n.includes(CLEANING_ESSENTIALS_MATCH));
}

/** True when we bring a vacuum, so the customer is not asked for one. */
export function hasVacuumExtra(extraNames: string[]): boolean {
  return extraNames.some(n => n.includes(VACUUM_MATCH));
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

/** Reads every checklist-relevant fact off the extra-service names in one pass. */
export function resolveSupplyChecklistFacts(
  extraNames: string[],
  isCustomServiceType: boolean
): SupplyChecklistFacts {
  return {
    hasCleaningSupplies: hasCleaningSuppliesExtra(extraNames),
    hasCleaningEssentials: hasCleaningEssentialsExtra(extraNames),
    weBringVacuum: hasVacuumExtra(extraNames),
    requiresOvenCleaner: requiresOvenCleaner(extraNames),
    isCustomServiceType
  };
}

/** Same, for surfaces holding the extras list rather than the names. */
export function resolveSupplyChecklistFactsForExtras(
  extras: SupplyChecklistExtra[] | null | undefined,
  isCustomServiceType: boolean
): SupplyChecklistFacts {
  return resolveSupplyChecklistFacts(extraServiceNamesOf(extras), isCustomServiceType);
}

/** The Zep line, phrased identically to the email/SMS checklist. */
export function zepLiquidsText(needsOvenCleaner: boolean): string {
  return needsOvenCleaner
    ? 'Green, Floor (or similar), Oven Cleaner (or similar)'
    : 'Green, Floor (or similar)';
}

/**
 * The checklist itself — what the CUSTOMER has to have on site. Each extra removes only its own
 * items, so the combinations read:
 *   nothing bought        → everything;
 *   Cleaning Supplies     → paper towels, garbage bags, broom/vacuum, toilet brush;
 *   Cleaning Essentials   → broom/vacuum, plus all the products we would have brought;
 *   Supplies + Essentials → broom or vacuum cleaner, and nothing else.
 * A custom ("Pre-Arranged") service type does not use the supplies workflow, so it never gets
 * the products block regardless.
 *
 * Mirrors `CustomerSupplyChecklist.BuildItems` line for line.
 */
export function buildSupplyChecklistItems(facts: SupplyChecklistFacts): string[] {
  const items: string[] = [];

  if (!facts.hasCleaningEssentials) {
    items.push(CLEANING_ESSENTIALS_ITEMS[0]);
    items.push(CLEANING_ESSENTIALS_ITEMS[1]);
  }

  if (!facts.weBringVacuum) {
    items.push(BROOM_OR_VACUUM_ITEM);
  }

  if (!facts.hasCleaningEssentials) {
    items.push(CLEANING_ESSENTIALS_ITEMS[2]);
  }

  if (facts.hasCleaningSupplies || facts.isCustomServiceType) {
    return items;
  }

  items.push(`Zep liquids: ${zepLiquidsText(facts.requiresOvenCleaner)}`);
  items.push('Windex liquid (or similar)');
  items.push('Cleaning cloths, Sponge and Mop');

  return items;
}
