import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { filter, take, map } from 'rxjs/operators';

/** Waits for auth to be initialized, then allows route for admin roles or redirects. */
export const adminGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.isInitialized$.pipe(
    filter(initialized => initialized),
    take(1),
    map(() => {
      const currentUser = authService.currentUserValue;
      if (currentUser &&
          (currentUser.role === 'SuperAdmin' ||
           currentUser.role === 'Admin' ||
           currentUser.role === 'Moderator')) {
        return true;
      }
      router.navigate(['/']);
      return false;
    })
  );
};