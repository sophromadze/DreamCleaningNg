import { Injector, inject } from '@angular/core';
import { pendingUntilEvent } from '@angular/core/rxjs-interop';
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
  const injector = inject(Injector);
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
      // pendingUntilEvent: the app counts as busy until the redirect fires, so server rendering and
      // hydration wait for it (zone.js used to give that for free by tracking the timer).
      return timer(200).pipe(
        pendingUntilEvent(injector),
        map(() => {
          router.navigate(['/login'], { queryParams: { returnUrl: state.url } });
          return false;
        })
      );
    })
  );
};