/**
 * Single source of truth for "may this admin apply an order edit straight away, or does it have to
 * go to a SuperAdmin for approval first?".
 *
 * SuperAdmins always save directly. A regular Admin only does so when a SuperAdmin has granted them
 * `canEditOrdersWithoutApproval` — the same shape as the page-view grants in
 * `admin-viewable-pages.ts`, except this one is a single boolean rather than a list of keys.
 *
 * The grant is deliberately checked TOGETHER with the role: demoting a granted Admin makes the
 * stored flag inert without anyone having to remember to clear it.
 *
 * Mirrors the backend `Helpers/OrderEditApprovalPolicy.cs` — keep both in step.
 */

export interface OrderEditApprovalSubject {
  role?: string | null;
  canEditOrdersWithoutApproval?: boolean | null;
}

/** True when this user's order edits are applied immediately. */
export function canSaveOrderEditsDirectly(user: OrderEditApprovalSubject | null | undefined): boolean {
  if (!user) return false;
  if (user.role === 'SuperAdmin') return true;
  return user.role === 'Admin' && !!user.canEditOrdersWithoutApproval;
}

/** True when this user's order edits must be submitted for SuperAdmin approval. */
export function requiresOrderEditApproval(user: OrderEditApprovalSubject | null | undefined): boolean {
  return !canSaveOrderEditsDirectly(user);
}
