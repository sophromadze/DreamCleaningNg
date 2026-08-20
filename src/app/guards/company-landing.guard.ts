import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { filter, take, map } from 'rxjs/operators';
import { canViewAdminPage } from '../shared/admin-viewable-pages';

/**
 * Landing guard for the bare /admin/company path: redirects to the FIRST Company tab the signed-in
 * user is actually allowed to see (in tab order), so a user granted only Finances lands on Finances
 * rather than bouncing off the Statistics guard. If they can see none, sends them home. Always
 * returns a UrlTree (never activates a component), so the empty child route needs no component.
 *
 * Each entry carries BOTH the grant key and the child path because the two are not always the same
 * word — 'customer-stats' is granted under that name (so the SuperAdmin grant list can't be mistaken
 * for the CRM's own Customers tab) but lives at /admin/company/customers.
 */
const TAB_ORDER: { key: string; path: string }[] = [
  { key: 'statistics', path: 'statistics' },
  { key: 'expenses', path: 'expenses' },
  { key: 'finances', path: 'finances' },
  { key: 'ads', path: 'ads' },
  { key: 'traffic', path: 'traffic' },
  { key: 'keywords', path: 'keywords' },
  { key: 'customer-stats', path: 'customers' }
];

export const companyLandingGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.isInitialized$.pipe(
    filter(initialized => initialized),
    take(1),
    map(() => {
      const user = authService.currentUserValue;
      const first = TAB_ORDER.find(tab => canViewAdminPage(user, tab.key));
      return router.parseUrl(first ? `/admin/company/${first.path}` : '/');
    })
  );
};
