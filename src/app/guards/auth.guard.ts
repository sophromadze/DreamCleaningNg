import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { filter, take, switchMap, map } from 'rxjs/operators';
import { of, timer } from 'rxjs';

/** Same flow as header: wait for auth to be known, then allow route or redirect. Delay redirect so loading shimmer is visible first. */
export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const platformId = inject(PLATFORM_ID);
  const isBrowser = isPlatformBrowser(platformId);

  return authService.isInitialized$.pipe(
    filter(initialized => initialized),
    take(1),
    switchMap(() => {
      if (authService.isLoggedIn()) {
        return of(true);
      }
      if (isBrowser) {
        localStorage.setItem('returnUrl', state.url);
      }
      // Brief delay so app can show route-loading shimmer before navigating to login (same idea as header)
      return timer(200).pipe(
        map(() => {
          router.navigate(['/login'], { queryParams: { returnUrl: state.url } });
          return false;
        })
      );
    })
  );
};