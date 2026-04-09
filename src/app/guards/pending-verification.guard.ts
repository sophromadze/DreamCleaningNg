import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const pendingVerificationGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  const user = authService.currentUserValue;

  if (!user) {
    router.navigate(['/login']);
    return false;
  }

  if (user.isEmailVerified) {
    // Already verified — no need to be on this page
    router.navigate(['/']);
    return false;
  }

  return true;
};
