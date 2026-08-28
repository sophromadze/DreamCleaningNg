/**
 * The SHORT service-type label the admin tables show — "Regular", "Deep", "Move In/Out",
 * "Office", "Heavy", "Filthy", "Construction", "Arranged".
 *
 * Extracted from the Orders tab (2026-08) when Outgoing Payments needed the identical column.
 * The full names ("Residential Cleaning", "Heavy Conditional Cleaning") are far too long for a
 * dense table, and two admin tables labelling the same order differently is the confusion this
 * exists to prevent — so there is one copy, here.
 *
 * NOTE this is deliberately NOT `formatServiceTypeLabel` in
 * `shared/booking/custom-service-type.util.ts`. That one builds the list of names an admin can
 * PICK for a custom order, and the picked value is stored on the order — collapsing
 * "Post Construction" to "Construction" there would change what gets written to the database and
 * orphan every label already stored. This one only ever renders. The two overlap by coincidence
 * of purpose, not by being the same rule.
 */

/** Residential is the one service type that splits into Regular + Deep. Matched by name. */
export function isResidentialServiceTypeName(serviceTypeName: string | null | undefined): boolean {
  const normalized = (serviceTypeName || '').toLowerCase().trim().replace(/[_\s]+/g, '-');
  return normalized === 'residential-cleaning' || normalized === 'residentialcleaning';
}

/**
 * Raw service-type name → the bare table label. Drops the word "Cleaning", collapses the long
 * category names, keeps "in/out" readable, then Title-Cases.
 *
 *   "Heavy Conditional Cleaning" → "Heavy"
 *   "Post Construction Cleaning" → "Construction"
 *   "Pre-Arranged Cleaning"      → "Arranged"
 *   "Move in/out cleaning"       → "Move In/Out"
 *   "Office Cleaning"            → "Office"
 */
export function formatAdminServiceTypeLabel(serviceTypeName: string | null | undefined): string {
  if (!serviceTypeName) return 'N/A';

  let normalized = serviceTypeName
    .toLowerCase()
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\bcleaning\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Keep "in/out" formatting for move in/out service labels.
  normalized = normalized.replace(/\bin out\b/g, 'in/out');
  normalized = normalized.replace(/\bheavy condition(al)?\b/g, 'heavy');
  normalized = normalized.replace(/\bpre arranged\b/g, 'arranged');
  normalized = normalized.replace(/\bpost construction\b/g, 'construction');

  if (!normalized) return 'N/A';

  return normalized.replace(/\b\w+\b/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));
}

/** What a caller has to know about an order to label it. */
export interface ServiceTypeLabelInput {
  /** The RAW ServiceType.Name — not an already-resolved display name. */
  serviceTypeName?: string | null;
  isCustomServiceType?: boolean;
  /** The per-order label an admin chose for a custom ("Pre-Arranged") order. */
  customServiceDisplayName?: string | null;
  /**
   * Residential only: whether the deep-cleaning extra is on the order. Resolving this needs the
   * order's extras/services, which differ per surface, so the CALLER decides and passes it in.
   */
  isDeepCleaning?: boolean;
}

/**
 * The label itself.
 *
 * Custom ("Pre-Arranged") orders show the admin-chosen label bare — it is already a short name
 * like "Deep" or "Move In/Out". A legacy custom order with no chosen label falls through to the
 * formatter, which renders "Pre-Arranged Cleaning" as "Arranged" until a SuperAdmin assigns a
 * real type. Residential splits into Deep/Regular; everything else is formatted by name.
 */
export function resolveServiceTypeShortLabel(input: ServiceTypeLabelInput): string {
  if (input.isCustomServiceType && input.customServiceDisplayName) {
    return input.customServiceDisplayName;
  }

  if (isResidentialServiceTypeName(input.serviceTypeName)) {
    return input.isDeepCleaning ? 'Deep' : 'Regular';
  }

  return formatAdminServiceTypeLabel(input.serviceTypeName);
}
