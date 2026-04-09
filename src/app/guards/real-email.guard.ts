import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * When the logged-in user has requiresRealEmail (Apple "Hide My Email"),
 * redirect to /verify-email so they must provide and verify a real email.
 */
export const realEmailGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.requiresRealEmail()) {
    return router.createUrlTree(['/verify-email']);
  }
  return true;
};
