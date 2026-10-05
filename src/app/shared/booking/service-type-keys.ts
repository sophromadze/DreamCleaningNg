/**
 * Recognising a SERVICE TYPE by ServiceType.serviceKey (residential, move-in-out, office, ...) for
 * the booking surfaces. Same rule as extra-service-keys.ts: a keyed type is judged by its key
 * only; a type nobody has keyed falls back to the name rule the call site always used. Marketing
 * pages read keys only (marketing-prices.ts) and never come through here.
 */

export interface KeyedServiceType {
  serviceKey?: string | null;
  name?: string | null;
}

export function serviceTypeIs(
  type: KeyedServiceType | null | undefined,
  key: string,
  legacyNameMatch: (lowerName: string) => boolean
): boolean {
  if (!type) return false;
  const own = (type.serviceKey ?? '').trim();
  if (own) return own === key;
  return legacyNameMatch((type.name ?? '').toLowerCase().trim());
}

/** Residential: key "residential", or (unkeyed) a name with both "residential" and "cleaning". */
export function isResidentialServiceType(type: KeyedServiceType | null | undefined): boolean {
  return serviceTypeIs(type, 'residential', n => n.includes('residential') && n.includes('cleaning'));
}

/** The type a fresh form starts on: the residential one, if there is one. */
export function findResidentialServiceType<T extends KeyedServiceType>(types: T[] | null | undefined): T | undefined {
  return (types ?? []).find(isResidentialServiceType);
}
