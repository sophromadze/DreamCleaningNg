/**
 * SINGLE SOURCE OF TRUTH for the list of display-name options offered when an admin uses the
 * custom ("Pre-Arranged") service type. Built from the live DB service types (never hardcoded):
 * every non-custom service type contributes one option (its name minus a trailing "Cleaning"),
 * EXCEPT the Residential service type which contributes two — "Regular" and "Deep" — both being
 * facets of residential. The chosen option is stored bare (no "Cleaning"); customer/cleaner-facing
 * surfaces render it as "<option> Cleaning".
 *
 * Used by the booking page (admin picks a name) and the admin orders page (SuperAdmin re-labels an
 * existing custom order), so the two lists can never drift apart.
 */

export interface CustomNameServiceType {
  name: string;
  isCustom?: boolean;
}

/** Residential is the one service type that splits into Regular + Deep. Matched by name. */
export function isResidentialServiceTypeName(name: string | null | undefined): boolean {
  return (name || '').toLowerCase().includes('residential');
}

/**
 * Turns a raw service-type name into the bare display label shown as an option (and stored on the
 * order). Drops the "Cleaning" word, collapses "Heavy Conditional" -> "Heavy", normalizes
 * "Move In/Out" casing, then Title-Cases. e.g. "Heavy Conditional Cleaning" -> "Heavy",
 * "Move in/out cleaning" -> "Move In/Out", "Office Cleaning" -> "Office".
 */
export function formatServiceTypeLabel(name: string | null | undefined): string {
  let normalized = (name || '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\bcleaning\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  normalized = normalized.replace(/\bheavy condition(al)?\b/g, 'heavy');
  normalized = normalized.replace(/\bin out\b/g, 'in/out');
  normalized = normalized.trim();

  if (!normalized) return '';

  // Title-case each alphabetic run, so "move in/out" -> "Move In/Out".
  return normalized.replace(/[a-z]+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));
}

export function buildCustomServiceTypeNameOptions(serviceTypes: CustomNameServiceType[] | null | undefined): string[] {
  const options: string[] = [];
  for (const st of serviceTypes || []) {
    if (st.isCustom) continue; // never offer the custom service type itself as a name
    if (isResidentialServiceTypeName(st.name)) {
      options.push('Regular', 'Deep');
      continue;
    }
    const label = formatServiceTypeLabel(st.name);
    if (label) options.push(label);
  }
  // De-dupe (case-insensitive) while preserving first-seen order.
  const seen = new Set<string>();
  return options.filter(o => {
    const key = o.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
