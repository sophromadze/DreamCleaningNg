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
 */
export const companyLandingGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const tabOrder = ['statistics', 'expenses', 'finances', 'ads', 'traffic', 'keywords'];

  return authService.isInitialized$.pipe(
    filter(initialized => initialized),
    take(1),
    map(() => {
      const user = authService.currentUserValue;
      const first = tabOrder.find(key => canViewAdminPage(user, key));
      return router.parseUrl(first ? `/admin/company/${first}` : '/');
    })
  );
};
