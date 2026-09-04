/**
 * Single source of truth for the restricted admin pages a SuperAdmin can grant a regular Admin
 * read-only ("view") access to. The `key` values mirror the backend
 * `Services/AdminViewablePages.cs` — keep both lists in sync.
 *
 * Adding a future page = add an entry here + mirror the const in the backend registry + apply
 * `[RequirePageView(...)]` to that page's GET endpoints + wire its read-only mode.
 */
export interface AdminViewablePage {
  /** Stable key persisted in the grant list and checked by guards/nav. */
  key: string;
  /** Human-readable label shown in the SuperAdmin grant control. */
  label: string;
  /** Router path the grant unlocks (for reference / future use). */
  route: string;
}

export const ADMIN_VIEWABLE_PAGES: AdminViewablePage[] = [
  { key: 'statistics', label: 'Statistics', route: '/admin/company/statistics' },
  { key: 'expenses', label: 'Expenses', route: '/admin/company/expenses' },
  { key: 'finances', label: 'Finances', route: '/admin/company/finances' },
  { key: 'ads', label: 'Ads', route: '/admin/company/ads' },
  { key: 'traffic', label: 'Traffic', route: '/admin/company/traffic' },
  { key: 'keywords', label: 'Keywords', route: '/admin/company/keywords' },
  { key: 'customer-stats', label: 'Customers', route: '/admin/company/customers' },
];

/**
 * True when the user may VIEW the given restricted page: SuperAdmins always can; a regular Admin
 * can when the page key is in their granted `viewablePages` list.
 */
export function canViewAdminPage(
  user: { role?: string; viewablePages?: string[] | null } | null | undefined,
  pageKey: string
): boolean {
  if (!user) return false;
  if (user.role === 'SuperAdmin') return true;
  return Array.isArray(user.viewablePages) && user.viewablePages.includes(pageKey);
}
