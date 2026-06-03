import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { filter, take, switchMap } from 'rxjs/operators';
import { of } from 'rxjs';

/**
 * Forces staff users (Admin / SuperAdmin / Moderator) who have not yet set up a 2FA
 * PIN to land on /setup-pin. The flag is written to localStorage by AuthService.login()
 * when the backend response carries `requiresPinSetup: true`. Cleared by TwoFactorService
 * once /set-pin succeeds.
 *
 * Applied alongside authGuard on every protected route. Customers ignore it (the flag
 * is never set for them).
 */
export const pinSetupGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.isInitialized$.pipe(
    filter(initialized => initialized),
    take(1),
    switchMap(() => {
      const user = authService.currentUserValue;
      if (!user) return of(true); // not logged in — authGuard handles it

      // Only staff roles are forced into PIN setup.
      const role = user.role;
      const isStaff = role === 'Admin' || role === 'SuperAdmin' || role === 'Moderator';
      if (!isStaff) return of(true);

      // The flag is set during login when the backend reports requiresPinSetup.
      // Reading from localStorage directly to avoid coupling the guard to TwoFactorService.
      let pending = false;
      try {
        pending = typeof window !== 'undefined' && localStorage.getItem('tf_requires_pin_setup') === '1';
      } catch { /* SSR or storage disabled */ }

      if (pending) {
        router.navigate(['/setup-pin']);
        return of(false);
      }
      return of(true);
    })
  );
};
