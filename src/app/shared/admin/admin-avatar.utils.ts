/**
 * The little coloured circle that stands in for a person on the admin tables.
 *
 * Extracted from the Users tab (2026-09) when the Cleaners tab started rendering the same people:
 * an admin moving between the two tabs recognises a row by its colour, so two independently
 * declared palettes would eventually paint one person two ways and quietly break that.
 *
 * Keyed on the USER ID, not the name — a rename must not repaint somebody, and two people who
 * share a first name must not share a bubble.
 */
const AVATAR_PALETTE = [
  '#4f46e5', '#0891b2', '#ea580c', '#9333ea',
  '#db2777', '#16a34a', '#0284c7', '#dc2626'
];

/** Deterministic avatar background colour for an account id. */
export function getAdminAvatarColor(id: number): string {
  return AVATAR_PALETTE[Math.abs(id) % AVATAR_PALETTE.length];
}

/**
 * Initials for the bubble, or '?' when we have neither name — an empty circle reads as a broken
 * image rather than as a person with no name on file.
 */
export function getAdminAvatarInitials(firstName?: string | null, lastName?: string | null): string {
  const f = (firstName || '').trim().charAt(0);
  const l = (lastName || '').trim().charAt(0);
  return (f + l).toUpperCase() || '?';
}
