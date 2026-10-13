import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID, TransferState } from '@angular/core';
import { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { Observable, NEVER, of } from 'rxjs';

import { BOOKING_RESOLVE_CAP_MS, bookingDataResolver } from './booking-data.resolver';
import { BOOKING_INITIAL_STATE_KEY } from './booking-initial-state';
import { testProviders } from '../../testing/test-providers';
import { AuthService } from '../services/auth.service';
import { AccountStatusService } from '../services/account-status.service';
import { BookingCatalogueStore } from '../services/booking-catalogue-store.service';

/**
 * An in-app navigation to /booking waits (never more than BOOKING_RESOLVE_CAP_MS) for step 1's
 * data, so the page is drawn whole in its first frame instead of offers or a Reorder button
 * appearing - or a placeholder collapsing - afterwards.
 */
describe('bookingDataResolver', () => {
  let loads: string[];
  let contextLoads: number;

  function setup(opts: { platform?: string; signedIn?: boolean; data?: Observable<unknown>; context?: Observable<unknown> } = {}) {
    loads = [];
    contextLoads = 0;
    TestBed.configureTestingModule({
      providers: [
        ...testProviders,
        { provide: PLATFORM_ID, useValue: opts.platform ?? 'browser' },
        { provide: AuthService, useValue: { isLoggedIn: () => !!opts.signedIn } },
        { provide: BookingCatalogueStore, useValue: { load: (part: string) => { loads.push(part); return opts.data ?? of([]); } } },
        { provide: AccountStatusService, useValue: { loadBookingContext: () => { contextLoads++; return opts.context ?? of(null); } } }
      ]
    });
  }
  const resolve = () => TestBed.runInInjectionContext(() =>
    bookingDataResolver({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)) as Observable<null>;
  const settleTime = async (o: Observable<null>) => {
    const started = Date.now();
    await new Promise<void>(done => o.subscribe({ complete: () => done() }));
    return Date.now() - started;
  };

  afterEach(() => TestBed.resetTestingModule());

  it('does nothing on the server', async () => {
    setup({ platform: 'server', signedIn: true });

    await settleTime(resolve());

    expect(loads).toEqual([]);
    expect(contextLoads).toBe(0);
  });

  it('does nothing for hydration (the page draws the server\'s state)', async () => {
    setup({ signedIn: true });
    TestBed.inject(TransferState).set(BOOKING_INITIAL_STATE_KEY, {} as any);

    await settleTime(resolve());

    expect(loads).toEqual([]);
  });

  it('warms the public data for a guest, and not a signed-in context', async () => {
    setup();

    await settleTime(resolve());

    expect(loads).toEqual(['serviceTypes', 'subscriptions', 'blockedTimeSlots']);
    expect(contextLoads).toBe(0);
  });

  it('also waits for a signed-in visitor\'s booking context', async () => {
    setup({ signedIn: true });

    await settleTime(resolve());

    expect(contextLoads).toBe(1);
  });

  it('never holds the navigation longer than the cap', async () => {
    setup({ signedIn: true, context: NEVER });

    const waited = await settleTime(resolve());

    expect(waited).toBeGreaterThanOrEqual(BOOKING_RESOLVE_CAP_MS - 20);
    expect(waited).toBeLessThan(BOOKING_RESOLVE_CAP_MS + 1000);
  });
});
