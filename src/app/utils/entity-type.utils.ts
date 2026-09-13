/**
 * Infers a commercial client's ENTITY TYPE from the suffix of their legal entity name.
 *
 * `ContractClient.EntityType` is prose, not an enum: the agreement reads "Client, {{ENTITY_TYPE}},
 * organized under the laws of {{FORMATION_STATE}}", so the stored value is "a limited liability
 * company", not "LLC". Admins were typing that sentence fragment by hand for every client whose
 * name already ended in "LLC", and a typo there is printed on a contract.
 *
 * ## Suffix, never substring
 *
 * The match is against the LAST whitespace-separated token only, with dots and commas stripped.
 * A substring search is the obvious shortcut and it is wrong in ways that reach a legal document:
 * "Incognito Cleaning" contains "Inc", "Delp Holdings" contains "LP", and "Corporation Bay Diner"
 * contains "Corporation". None of those is an incorporated entity, and being told so on their own
 * contract is how a client stops trusting the paperwork.
 *
 * ## It never overwrites a manual answer
 *
 * `applyInferredEntityType` refuses the moment the admin has touched the field themselves. The
 * inference is a convenience for the common case; the person filling in the form is the authority,
 * including when they disagree with the suffix (a "Holdings LLC" that is genuinely taxed as a
 * corporation, say).
 */

/** The wording the contract body expects, keyed by the normalized suffix token. */
const ENTITY_TYPE_BY_SUFFIX: ReadonlyMap<string, string> = new Map([
  ['llc', 'a limited liability company'],
  ['pllc', 'a professional limited liability company'],
  ['inc', 'a corporation'],
  ['incorporated', 'a corporation'],
  ['corp', 'a corporation'],
  ['corporation', 'a corporation'],
  ['llp', 'a limited liability partnership'],
  ['lp', 'a limited partnership'],
  ['pc', 'a professional corporation']
]);

/**
 * The entity type implied by a legal entity name, or `null` when the name carries no suffix we
 * recognize. `null` means "no opinion" — it is never a signal to clear an existing value.
 */
export function inferEntityType(legalEntityName: string | null | undefined): string | null {
  const tokens = (legalEntityName ?? '').trim().split(/\s+/).filter(t => t.length > 0);
  if (tokens.length === 0) return null;

  // A one-word name IS its own suffix ("Incorporated" alone is a company called Incorporated, not
  // a corporation), so a suffix needs something in front of it to be a suffix at all.
  if (tokens.length < 2) return null;

  // "L.L.C." → "llc", "Inc." → "inc", "Sons, Inc" → "inc". Dots and commas only: stripping every
  // non-letter would fold "Co-op" into "coop" and invite matches nobody asked for.
  const suffix = tokens[tokens.length - 1].replace(/[.,]/g, '').toLowerCase();

  return ENTITY_TYPE_BY_SUFFIX.get(suffix) ?? null;
}

/**
 * What the entity-type field should become after the legal name changed, or `null` to leave it
 * exactly as it is.
 *
 * @param legalEntityName the name as it now reads
 * @param manuallyEdited  true once the admin has typed in the entity-type field themselves. A
 *                        manual answer is FINAL — this returns null forever after.
 */
export function applyInferredEntityType(
  legalEntityName: string | null | undefined,
  manuallyEdited: boolean
): string | null {
  if (manuallyEdited) return null;
  return inferEntityType(legalEntityName);
}
