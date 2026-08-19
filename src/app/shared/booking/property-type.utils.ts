/**
 * Property type (apartment vs house) and the levels service.
 *
 * Mirror of DreamCleaningBackend/Helpers/PropertyDetailsHelper.cs - same constants, same
 * normalization rules, same null semantics. Change both together.
 *
 * TWO INDEPENDENT BEHAVIOURS. Do not couple them again:
 *
 *   A. PROPERTY TYPE is asked on EVERY service type, with no gating of any kind, and is always
 *      required to proceed. On a type that does not price rooms it is purely informational: it
 *      tells admins and cleaners what they are walking into (parking, a walk-up, travel time,
 *      equipment). It is persisted to Order.PropertyType on every order.
 *
 *   B. LEVELS are ASKED for any house, on every service type that shows the property type. What
 *      varies is whether the answer costs anything, and that turns on one thing only: does the
 *      selected service type have a levels catalogue row (findLevelsService)?
 *
 *        - Priced (Residential, Move in/out): the count becomes an OrderService line and is
 *          priced through the self-referencing threshold.
 *        - Informational (Office, Custom, Heavy Conditional, Pre-Arranged...): NO line is created
 *          and the count lives only on Order.LevelsQuantity. No cost, no duration, no summary
 *          row. An hourly type must work this way because stair time is already inside the hours
 *          the customer buys, so a per-level charge would double-charge - but the crew still
 *          needs to know there are three flights to carry equipment up.
 *
 *      This is the existing Order.BedroomsQuantity / BathroomsQuantity pattern, which are already
 *      collected exactly like this for cleaner+hours and custom modes.
 *
 * The market rationale, so nobody "simplifies" it later: a house is not inherently more
 * expensive to clean than an apartment of the same size. What costs more is stairs and moving
 * between levels, which is why the price driver is the LEVEL COUNT and never the property type.
 */

/** Apartment or condo. Never has levels. */
export const PROPERTY_TYPE_APARTMENT = 'Apartment';

/** House or townhouse. Has levels, but they are only PRICED where bedrooms are priced. */
export const PROPERTY_TYPE_HOUSE = 'House';

export type PropertyType = typeof PROPERTY_TYPE_APARTMENT | typeof PROPERTY_TYPE_HOUSE;

/**
 * ServiceKey of the levels service.
 *
 * Levels is a real catalogue row, so it arrives in serviceType.services like bedrooms and
 * bathrooms and would be rendered by every generic service loop. It must not be: the booking
 * page gives it its own gated block inside the House branch, and the home hero does not offer
 * it at all. Every generic loop therefore filters on this key - see excludeLevels.
 */
export const LEVELS_SERVICE_KEY = 'levels';

/**
 * ServiceKey of the bedrooms service. Levels are priced exactly where this exists - see
 * serviceTypePricesLevels for why the rule is stated in terms of bedrooms rather than levels.
 */
export const BEDROOMS_SERVICE_KEY = 'bedrooms';

/** The lowest level count. There is no such thing as a house with zero levels. */
export const MIN_LEVELS = 1;

/** The level counts offered as chips. Values above this are clamped server-side too. */
export const LEVEL_OPTIONS: readonly number[] = [1, 2, 3, 4];

/**
 * Coerces a stored or restored value to one of the two known property types, or null.
 *
 * Null is a first-class result, not a failure. Legacy orders have no property type, and a
 * returning visitor whose session was saved before this feature shipped has none either. Both
 * must be forced to choose rather than silently defaulted, and both must render without an
 * empty field.
 */
export function normalizePropertyType(raw: string | null | undefined): PropertyType | null {
  if (raw == null) return null;

  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === PROPERTY_TYPE_APARTMENT.toLowerCase()) return PROPERTY_TYPE_APARTMENT;
  if (trimmed.toLowerCase() === PROPERTY_TYPE_HOUSE.toLowerCase()) return PROPERTY_TYPE_HOUSE;
  return null;
}

/** True only for a normalized House. Null and Apartment are both false. */
export function isHouse(propertyType: string | null | undefined): boolean {
  return normalizePropertyType(propertyType) === PROPERTY_TYPE_HOUSE;
}

/** True for the levels catalogue row. */
export function isLevelsService(service: { serviceKey?: string | null } | null | undefined): boolean {
  return service?.serviceKey === LEVELS_SERVICE_KEY;
}

/**
 * Drops the levels row from a list of selected services.
 *
 * Use in every GENERIC service loop, so the stepper grid never renders a Levels control beside
 * Bedrooms and Bathrooms. The booking page renders it deliberately, from its own state, inside
 * the House branch.
 */
export function excludeLevels<T extends { service: { serviceKey?: string | null } }>(
  selected: readonly T[]
): T[] {
  return selected.filter(s => !isLevelsService(s.service));
}

/**
 * THE single exclusion rule for the property-type question.
 *
 * Every surface that renders the selector - booking, user order-edit, admin order editor and the
 * home hero - must go through this one predicate, so an exclusion is added in exactly one place
 * and can never drift between them.
 *
 * Two things exclude a service type:
 *
 *   1. Poll / quote-request types (hasPoll). These submit a quote request and never create an
 *      Order, so there is nothing to persist a property type onto. This is what keeps Filthy out.
 *
 *   2. The admin flag ServiceType.CollectsPropertyType, exposed here as collectsPropertyType.
 *      A stored flag rather than an inferred rule, because Office Cleaning and Heavy Conditional
 *      Cleaning are structurally identical - same cleaner+hours services, no bedrooms, no sq.ft,
 *      neither poll nor custom - and yet one should ask and the other should not. No data-driven
 *      predicate can separate them, and Id/Name matching is ruled out because both diverge
 *      between the local and production databases.
 *
 * ABSENT means TRUE for the flag, mirroring the NOT NULL default true column. A stale cached or
 * prerendered payload therefore degrades to showing the selector, never to hiding it everywhere
 * at once.
 */
export function serviceTypeCollectsPropertyType(
  serviceType: { hasPoll?: boolean; collectsPropertyType?: boolean } | null | undefined
): boolean {
  if (!serviceType) return false;
  if (serviceType.hasPoll === true) return false;
  return serviceType.collectsPropertyType !== false;
}

/**
 * The levels catalogue row for a service type, or null when it has none.
 *
 * THE predicate for "does a level count cost anything here": null means informational. Matched on
 * ServiceKey only - service type IDs and names both diverge between the local and production
 * databases, so neither is a legal thing to test against anywhere in this codebase.
 */
export function findLevelsService<T extends { serviceKey?: string | null; isActive?: boolean }>(
  serviceType: { services?: T[] } | null | undefined
): T | null {
  return (serviceType?.services ?? []).find(
    s => s.serviceKey === LEVELS_SERVICE_KEY && s.isActive !== false
  ) ?? null;
}

/**
 * The level count to SEND for a given property type.
 *
 * An apartment still submits the levels line when the service type has one, at the included
 * count, so it prices to exactly zero. That keeps the submitted selection a faithful image of
 * what the customer chose and matches what the server clamps to anyway
 * (OrderPricingInputBuilder.ClampLevelsToPropertyType), so the client and the server agree on
 * the wire rather than only in the total.
 */
export function levelsToSubmit(
  propertyType: string | null | undefined,
  chosenLevels: number | null
): number {
  if (!isHouse(propertyType)) return MIN_LEVELS;
  return chosenLevels ?? MIN_LEVELS;
}

/**
 * The level count to DISPLAY, or null when nothing should be shown.
 *
 * Null covers three cases that must all render as "no levels row": a legacy order, an
 * apartment, and a custom (Pre-Arranged) order where levels are never priced. A count of 1 is
 * deliberately still shown for a house - "1 level" is information the crew wants, and it is
 * distinguishable from "we do not know", which is what null means.
 */
export function levelsToDisplay(
  propertyType: string | null | undefined,
  levelsQuantity: number | null | undefined
): number | null {
  if (!isHouse(propertyType)) return null;
  return levelsQuantity == null ? null : levelsQuantity;
}
