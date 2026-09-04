import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { filter, take, map } from 'rxjs/operators';
import { CLEANER_PORTAL_PATH, isCleanerRole } from './cleaner-portal.guard';

/** Waits for auth to be initialized, then allows route for SuperAdmin only or redirects. */
export const superAdminGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.isInitialized$.pipe(
    filter(initialized => initialized),
    take(1),
    map(() => {
      const currentUser = authService.currentUserValue;
      if (currentUser && currentUser.role === 'SuperAdmin') {
        return true;
      }
      // Same reasoning as adminGuard: a cleaner's only authenticated view is the portal.
      router.navigate([isCleanerRole(currentUser?.role) ? CLEANER_PORTAL_PATH : '/']);
      return false;
    })
  );
};
