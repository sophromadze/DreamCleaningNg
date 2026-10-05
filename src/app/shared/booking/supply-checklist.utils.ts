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
 *   "Cleaning Essentials" → paper towels, garbage bags, toilet brush AND A BROOM. The broom was
 *                           added 2026-09; before that the customer was always asked for a broom
 *                           or vacuum, so anything still saying "never included" is stale.
 *   "Vacuum Cleaner"      → the broom-or-vacuum line, and only that line.
 * Because Essentials now covers the broom, that line comes off for EITHER of the last two — we
 * bring a broom, or we bring a vacuum, and the customer was only ever asked for one of the pair.
 *
 * Supplies + Essentials together therefore leave NOTHING, so `buildSupplyChecklistItems` can
 * legitimately return an EMPTY array — every surface has to render that as "nothing to prepare"
 * rather than as an empty bulleted box.
 */

import {
  DeepFlags,
  EXTRA_SERVICE_KEYS,
  extraIs,
  isDeepOrSuperDeepExtra,
  legacyCleaningEssentials,
  legacyCleaningSupplies,
  legacyOven,
  legacyVacuum
} from './extra-service-keys';

/**
 * Extra-service shapes the various surfaces carry: booking uses `name`, orders use
 * `extraServiceName`; both carry `extraServiceKey` (and orders the Deep flags). A plain string is
 * accepted too and treated as an UNKEYED extra of that name - the legacy rules.
 */
export interface SupplyChecklistExtra extends DeepFlags {
  name?: string | null;
  extraServiceName?: string | null;
}

export type SupplyChecklistInput = SupplyChecklistExtra | string | null | undefined;

/**
 * Everything about one order that decides the checklist. Resolved once by
 * `resolveSupplyChecklistFacts` and passed around as a unit — mirrors `SupplyChecklistFacts`
 * on the backend.
 */
export interface SupplyChecklistFacts {
  /** "Cleaning Supplies" bought — WE bring the solutions and the cloths. */
  hasCleaningSupplies: boolean;
  /** "Cleaning Essentials" bought — WE bring paper towels, garbage bags, a toilet brush and a broom. */
  hasCleaningEssentials: boolean;
  /** "Vacuum Cleaner" bought — we bring one, so they are not asked for a broom or vacuum. */
  weBringVacuum: boolean;
  /** Deep / Super Deep Cleaning, or the Oven Cleaning extra on its own. */
  requiresOvenCleaner: boolean;
  /** Custom ("Pre-Arranged") service type — it does not use the supplies workflow. */
  isCustomServiceType: boolean;
}

/**
 * LEGACY name fragments (contains, case-insensitive). The extras are recognised by their
 * extraServiceKey ("cleaning-supplies", "cleaning-essentials", "vacuum-cleaner", "oven" - see
 * extra-service-keys.ts); these fragments only decide for an UNKEYED row. Mirrors the constants
 * on `CustomerSupplyChecklist`.
 */
export const CLEANING_SUPPLIES_MATCH = 'cleaning supplies';
export const CLEANING_ESSENTIALS_MATCH = 'cleaning essentials';
export const VACUUM_MATCH = 'vacuum';

/** What the "Cleaning Essentials" extra covers — the four items WE bring. Shown in the booking
 *  modal. The broom joined the set in 2026-09. */
export const CLEANING_ESSENTIALS_ITEMS = ['Paper towels', 'Garbage bags', 'Toilet brush', 'Broom'];

/** The one line the Vacuum Cleaner extra buys the customer out of. */
export const BROOM_OR_VACUUM_ITEM = 'Broom or vacuum cleaner';

function asExtra(input: SupplyChecklistInput): SupplyChecklistExtra | null {
  if (input == null) return null;
  return typeof input === 'string' ? { name: input } : input;
}

function asExtras(inputs: SupplyChecklistInput[] | null | undefined): SupplyChecklistExtra[] {
  return (inputs || []).map(asExtra).filter((e): e is SupplyChecklistExtra => !!e);
}

/** Single-extra predicates, for surfaces that hold one extra rather than a list. */
export function isCleaningSuppliesExtra(extra: SupplyChecklistInput): boolean {
  return extraIs(asExtra(extra), EXTRA_SERVICE_KEYS.cleaningSupplies, legacyCleaningSupplies);
}

export function isCleaningEssentialsExtra(extra: SupplyChecklistInput): boolean {
  return extraIs(asExtra(extra), EXTRA_SERVICE_KEYS.cleaningEssentials, legacyCleaningEssentials);
}

export function isVacuumExtra(extra: SupplyChecklistInput): boolean {
  return extraIs(asExtra(extra), EXTRA_SERVICE_KEYS.vacuumCleaner, legacyVacuum);
}

export function isOvenExtra(extra: SupplyChecklistInput): boolean {
  return extraIs(asExtra(extra), EXTRA_SERVICE_KEYS.oven, legacyOven);
}

/** Lowercased names, for display-only callers. Recognition goes through the predicates above. */
export function extraServiceNamesOf(extras: SupplyChecklistExtra[] | null | undefined): string[] {
  return (extras || [])
    .map(e => (e?.extraServiceName ?? e?.name ?? '').toLowerCase())
    .filter(n => !!n);
}

export function hasCleaningSuppliesExtra(extras: SupplyChecklistInput[]): boolean {
  return asExtras(extras).some(isCleaningSuppliesExtra);
}

/**
 * True when the customer bought "Cleaning Essentials". Note this does NOT match
 * "Cleaning Supplies" and vice versa — the two are separate purchases that can be held
 * together, and each removes a different part of the checklist.
 */
export function hasCleaningEssentialsExtra(extras: SupplyChecklistInput[]): boolean {
  return asExtras(extras).some(isCleaningEssentialsExtra);
}

/** True when we bring a vacuum, so the customer is not asked for one. */
export function hasVacuumExtra(extras: SupplyChecklistInput[]): boolean {
  return asExtras(extras).some(isVacuumExtra);
}

/**
 * True when the cleaners need an oven-cleaning liquid: a Deep / Super Deep Cleaning booking
 * (their flags; an unkeyed row by its name), OR the Oven Cleaning extra on its own. The oven extra
 * used to be missed here, so a customer who ordered oven cleaning without deep cleaning was never
 * told to have Oven Cleaner ready.
 */
export function requiresOvenCleaner(extras: SupplyChecklistInput[]): boolean {
  const list = asExtras(extras);
  return list.some(isDeepOrSuperDeepExtra) || list.some(isOvenExtra);
}

/** Alias kept for surfaces that already call it with the extras list. */
export function requiresOvenCleanerForExtras(extras: SupplyChecklistExtra[] | null | undefined): boolean {
  return requiresOvenCleaner(extras || []);
}

/** Reads every checklist-relevant fact off the extras (or bare names) in one pass. */
export function resolveSupplyChecklistFacts(
  extras: SupplyChecklistInput[],
  isCustomServiceType: boolean
): SupplyChecklistFacts {
  const list = asExtras(extras);
  return {
    hasCleaningSupplies: hasCleaningSuppliesExtra(list),
    hasCleaningEssentials: hasCleaningEssentialsExtra(list),
    weBringVacuum: hasVacuumExtra(list),
    requiresOvenCleaner: requiresOvenCleaner(list),
    isCustomServiceType
  };
}

/** Same, named for surfaces holding the extras list. */
export function resolveSupplyChecklistFactsForExtras(
  extras: SupplyChecklistExtra[] | null | undefined,
  isCustomServiceType: boolean
): SupplyChecklistFacts {
  return resolveSupplyChecklistFacts(extras || [], isCustomServiceType);
}

/** The Zep line, phrased identically to the email/SMS checklist. */
export function zepLiquidsText(needsOvenCleaner: boolean): string {
  return needsOvenCleaner
    ? 'Green, Floor (or similar), Oven Cleaner (or similar)'
    : 'Green, Floor (or similar)';
}

/**
 * The checklist itself — what the CUSTOMER has to have on site. The combinations read:
 *   nothing bought        → everything;
 *   Cleaning Supplies     → paper towels, garbage bags, broom/vacuum, toilet brush;
 *   Cleaning Essentials   → only the products we would have brought (it covers the broom as
 *                           well now, so nothing from this group survives);
 *   Supplies + Essentials → NOTHING AT ALL;
 *   Vacuum Cleaner        → drops the broom/vacuum line on its own.
 * A custom ("Pre-Arranged") service type does not use the supplies workflow, so it never gets
 * the products block regardless.
 *
 * Mirrors `CustomerSupplyChecklist.BuildItems` line for line.
 */
export function buildSupplyChecklistItems(facts: SupplyChecklistFacts): string[] {
  const items: string[] = [];

  // Cleaning Essentials covers this whole group, broom included.
  if (!facts.hasCleaningEssentials) {
    items.push('Paper towels');
    items.push('Garbage bags');
    // ...unless we are bringing a vacuum instead, which answers the same need.
    if (!facts.weBringVacuum) {
      items.push(BROOM_OR_VACUUM_ITEM);
    }
    items.push('Toilet brush');
  }

  if (facts.hasCleaningSupplies || facts.isCustomServiceType) {
    return items;
  }

  items.push(`Zep liquids: ${zepLiquidsText(facts.requiresOvenCleaner)}`);
  items.push('Windex liquid (or similar)');
  items.push('Cleaning cloths, Sponge and Mop');

  return items;
}
