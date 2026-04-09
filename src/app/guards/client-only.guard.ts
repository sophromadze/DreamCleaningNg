import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';

export const clientOnlyGuard: CanActivateFn = (route, state) => {
  const platformId = inject(PLATFORM_ID);
  const router = inject(Router);
  
  // Only allow access in browser environment
  if (isPlatformBrowser(platformId)) {
    return true;
  }
  
  // During SSR, redirect to home page
  return router.createUrlTree(['/']);
}; 