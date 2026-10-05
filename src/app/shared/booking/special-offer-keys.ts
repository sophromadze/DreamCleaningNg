/**
 * Recognising THE first-time customer offer by SpecialOffer.offerKey ("first-time"). Mirrors
 * `Helpers/FirstTimeOfferHelper.cs` on the backend.
 *
 * Neither the name (editable) nor the type is reliable: production's first-time offer is a
 * "Custom" row, and requiresFirstTimeCustomer is an eligibility rule any offer can carry.
 *
 * Two questions, two rules (same split as extra-service-keys.ts):
 *  - BOOKING (applying a discount): `isFirstTimeOffer` / `findFirstTimeOffer`. A keyed offer is
 *    judged by its key only; an UNKEYED one falls back to the rule the call site always used, and
 *    the first such fallback per name logs one console warning.
 *  - MARKETING (advertising the discount - home page, hero, popup, sticky bar, pricing and service
 *    pages): `findAdvertisedFirstTimeOffer`, key ONLY. No keyed offer = no discount line, never a guess.
 */

export const FIRST_TIME_OFFER_KEY = 'first-time';

/** The fields an offer-shaped object may carry (public, per-user and admin offers differ). */
export interface KeyedOffer {
  offerKey?: string | null;
  name?: string | null;
  type?: string | null;
  requiresFirstTimeCustomer?: boolean | null;
}

const warned = new Set<string>();

/** The offer's key, trimmed; '' when it has none. */
export function offerKeyOf(offer: KeyedOffer | null | undefined): string {
  return (offer?.offerKey ?? '').trim();
}

/** The rule before keys existed on the marketing surfaces: flag, FirstTime type, or "first time" / "first-time" in the name. */
export function legacyFirstTimeOffer(offer: KeyedOffer, lowerName: string): boolean {
  return !!offer.requiresFirstTimeCustomer
    || offer.type === 'FirstTime'
    || lowerName.includes('first time')
    || lowerName.includes('first-time');
}

/**
 * Key first: a keyed offer is the first-time offer exactly when its key is "first-time". An unkeyed
 * one is judged by `legacyMatch` (given the offer and its trimmed, lowercased name), and a match
 * there is logged once.
 */
export function isFirstTimeOffer(
  offer: KeyedOffer | null | undefined,
  legacyMatch: (offer: KeyedOffer, lowerName: string) => boolean = legacyFirstTimeOffer
): boolean {
  if (!offer) return false;
  const own = offerKeyOf(offer);
  if (own) return own === FIRST_TIME_OFFER_KEY;

  const name = (offer.name ?? '').trim();
  if (!legacyMatch(offer, name.toLowerCase())) return false;

  if (!warned.has(name)) {
    warned.add(name);
    console.warn(
      `[special offer keys] Special offer "${name}" has no offerKey; treated it as the first-time offer by its old rule. ` +
      `Set its key to "${FIRST_TIME_OFFER_KEY}" in Admin > Special Offers.`
    );
  }
  return true;
}

/** Booking: the keyed first-time offer if there is one, otherwise the first unkeyed legacy match. */
export function findFirstTimeOffer<T extends KeyedOffer>(
  offers: T[] | null | undefined,
  legacyMatch: (offer: KeyedOffer, lowerName: string) => boolean = legacyFirstTimeOffer
): T | undefined {
  const list = offers ?? [];
  return list.find(o => offerKeyOf(o) === FIRST_TIME_OFFER_KEY)
    ?? list.find(o => !offerKeyOf(o) && isFirstTimeOffer(o, legacyMatch));
}

/** Marketing: the offer keyed "first-time", or undefined - never a name/flag guess. */
export function findAdvertisedFirstTimeOffer<T extends KeyedOffer>(offers: T[] | null | undefined): T | undefined {
  return (offers ?? []).find(o => offerKeyOf(o) === FIRST_TIME_OFFER_KEY);
}

/** For specs: forget which fallbacks were already logged. */
export function resetSpecialOfferKeyWarningsForTests(): void {
  warned.clear();
}
