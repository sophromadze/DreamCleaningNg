import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { filter, take, switchMap, map } from 'rxjs/operators';
import { of } from 'rxjs';

/**
 * Blocks access when the logged-in user has no password set (admin-created accounts).
 * Redirects to /set-password so the user is forced to create a password before continuing.
 */
export const passwordSetupGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.isInitialized$.pipe(
    filter(initialized => initialized),
    take(1),
    switchMap(() => {
      const user = authService.currentUserValue;
      if (!user) {
        // Not logged in — let authGuard handle the redirect
        return of(true);
      }
      if (user.hasPassword === false && !authService.isSocialLoginSession) {
        router.navigate(['/set-password']);
        return of(false);
      }
      return of(true);
    })
  );
};
