/**
 * The ExtraService.extraServiceKey values code looks for, and the ONE way to ask "is this extra
 * that one?". Mirrors `Helpers/ExtraServiceKeys.cs` on the backend.
 *
 * THE KEY DECIDES WHEN IT IS SET. Only an extra with NO key (a row nobody has keyed yet) falls
 * back to the name rule each call site has always used, and the first such fallback per
 * (key, name) logs one console warning. A keyed extra is never matched by name - which is the
 * point: renaming it in Admin > Services no longer changes what it does.
 *
 * Deep / Super Deep and Same Day are NOT recognised through keys: their own flags
 * (isDeepCleaning, isSuperDeepCleaning, isSameDayService) already are the stable identity.
 *
 * Marketing (the FAQ prices, marketing-prices.ts) reads the key ONLY and never falls back: a
 * missing key drops that price rather than risk naming the wrong one.
 */

export const EXTRA_SERVICE_KEYS = {
  deepCleaning: 'deep-cleaning',
  sameDay: 'same-day',
  extraCleaners: 'extra-cleaners',
  extraMinutes: 'extra-minutes',
  cleaningSupplies: 'cleaning-supplies',
  cleaningEssentials: 'cleaning-essentials',
  vacuumCleaner: 'vacuum-cleaner',
  oven: 'oven'
} as const;

/** The two identity fields every extra-shaped object carries: catalogue rows use `name`, order lines `extraServiceName`. */
export interface KeyedExtra {
  extraServiceKey?: string | null;
  name?: string | null;
  extraServiceName?: string | null;
}

const warned = new Set<string>();

/** The extra's key, trimmed; '' when it has none. */
export function extraServiceKeyOf(extra: KeyedExtra | null | undefined): string {
  return (extra?.extraServiceKey ?? '').trim();
}

/**
 * Key first: a keyed extra is `key` exactly when its key is. An unkeyed one is judged by
 * `legacyNameMatch`, given the trimmed name lowercased (and as typed), and a match there is logged once.
 */
export function extraIs(
  extra: KeyedExtra | null | undefined,
  key: string,
  legacyNameMatch: (lowerName: string, name: string) => boolean
): boolean {
  if (!extra) return false;
  const own = extraServiceKeyOf(extra);
  if (own) return own === key;

  const name = (extra.extraServiceName ?? extra.name ?? '').trim();
  if (!name || !legacyNameMatch(name.toLowerCase(), name)) return false;

  const id = `${key}\u0000${name}`;
  if (!warned.has(id)) {
    warned.add(id);
    console.warn(
      `[extra service keys] Extra service "${name}" has no extraServiceKey; matched it as "${key}" by name. ` +
      'Set its key in Admin > Services > Extra Services.'
    );
  }
  return true;
}

// The legacy name rules (on the lowercased name), exactly as each call site used them before keys.

/** "Extra Cleaners", any case (the pricing calculators use their exact, case-sensitive rule instead). */
export const legacyExtraCleaners = (n: string): boolean => n === 'extra cleaners';
export const legacyExtraMinutes = (n: string): boolean => n.includes('extra minutes');
export const legacyCleaningSupplies = (n: string): boolean => n.includes('cleaning supplies');
export const legacyCleaningEssentials = (n: string): boolean => n.includes('cleaning essentials');
export const legacyVacuum = (n: string): boolean => n.includes('vacuum');
export const legacyOven = (n: string): boolean => n.includes('oven');
/** "deep cleaning" in the name - also matches "Super Deep Cleaning", as it always did. */
export const legacyDeepCleaning = (n: string): boolean => n.includes('deep cleaning');

/** Deep / Super Deep flags, or the fields an order line carries. */
export interface DeepFlags extends KeyedExtra {
  isDeepCleaning?: boolean | null;
  isSuperDeepCleaning?: boolean | null;
}

/**
 * Deep or Super Deep: the flags decide, and an UNKEYED row with both flags off still counts when its
 * name says "deep cleaning" (historical rows predating the flags). Mirrors
 * ExtraServiceKeys.IsDeepOrSuperDeep.
 */
export function isDeepOrSuperDeepExtra(extra: DeepFlags | null | undefined): boolean {
  if (!extra) return false;
  return !!extra.isDeepCleaning || !!extra.isSuperDeepCleaning
    || extraIs(extra, EXTRA_SERVICE_KEYS.deepCleaning, legacyDeepCleaning);
}

/** Super Deep: the flag, or an unkeyed, un-flagged row named "super deep ...". Mirrors ExtraServiceKeys.IsSuperDeep. */
export function isSuperDeepExtra(extra: DeepFlags | null | undefined): boolean {
  if (!extra) return false;
  if (extra.isSuperDeepCleaning) return true;
  if (extraServiceKeyOf(extra) || extra.isDeepCleaning) return false;
  return (extra.extraServiceName ?? extra.name ?? '').toLowerCase().includes('super deep');
}

/** For specs: forget which fallbacks were already logged. */
export function resetExtraServiceKeyWarningsForTests(): void {
  warned.clear();
}
