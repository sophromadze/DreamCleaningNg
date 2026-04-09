import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const noAuthGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  
  if (authService.isLoggedIn()) {
    // User is already logged in, redirect to home or profile
    router.navigate(['/']);
    return false;
  }
  
  // User is not logged in, allow access to login page
  return true;
};