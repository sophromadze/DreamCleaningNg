import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { filter, take, map } from 'rxjs/operators';
import { canViewAdminPage } from '../shared/admin-viewable-pages';

/**
 * Guards a restricted admin page. Waits for auth init, then allows SuperAdmins (full access) and
 * regular Admins who have been granted view access to `pageKey`; everyone else is redirected home.
 * Server-side authorization (RequirePageView) is the real enforcement — this only controls routing.
 */
export const pageViewGuard = (pageKey: string): CanActivateFn => {
  return () => {
    const authService = inject(AuthService);
    const router = inject(Router);

    return authService.isInitialized$.pipe(
      filter(initialized => initialized),
      take(1),
      map(() => {
        if (canViewAdminPage(authService.currentUserValue, pageKey)) {
          return true;
        }
        router.navigate(['/']);
        return false;
      })
    );
  };
};
