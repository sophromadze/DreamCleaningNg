import { PLATFORM_ID, TransferState, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ResolveFn } from '@angular/router';
import { Observable, catchError, forkJoin, map, of, race, timer } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { AccountStatusService } from '../services/account-status.service';
import { BookingCatalogueStore } from '../services/booking-catalogue-store.service';
import { BOOKING_INITIAL_STATE_KEY } from './booking-initial-state';

/** The longest an in-app navigation to /booking waits for its data before drawing anyway. */
export const BOOKING_RESOLVE_CAP_MS = 400;

/**
 * An in-app navigation to /booking keeps the current page on screen until step 1's data is ready
 * - the public catalogue, plans and blocked slots, and for a signed-in visitor their booking
 * context (offers, plan, points, Reorder) - so the page is drawn whole in its first frame and
 * nothing appears or collapses afterwards. Normally everything is already prefetched (idle time,
 * Book link intent, the hero form) and this resolves at once; it never waits more than
 * BOOKING_RESOLVE_CAP_MS. It resolves nothing itself: the page reads the warmed caches.
 *
 * Not on the server (the render has everything in memory) and not for hydration (the page draws
 * the server's state from TransferState).
 */
export const bookingDataResolver: ResolveFn<null> = () => {
  if (!isPlatformBrowser(inject(PLATFORM_ID))) return of(null);
  if (inject(TransferState).hasKey(BOOKING_INITIAL_STATE_KEY)) return of(null);

  const store = inject(BookingCatalogueStore);
  const quietly = <T>(source: Observable<T>) => source.pipe(catchError(() => of(null)));
  const waits: Observable<unknown>[] = [
    quietly(store.load('serviceTypes')),
    quietly(store.load('subscriptions')),
    quietly(store.load('blockedTimeSlots'))
  ];
  if (inject(AuthService).isLoggedIn()) waits.push(quietly(inject(AccountStatusService).loadBookingContext()));

  return race(
    forkJoin(waits).pipe(map(() => null)),
    timer(BOOKING_RESOLVE_CAP_MS).pipe(map(() => null))
  );
};
