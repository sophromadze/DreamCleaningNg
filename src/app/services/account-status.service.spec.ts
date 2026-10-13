import { TestBed } from '@angular/core/testing';
import { TransferState } from '@angular/core';
import { HttpTestingController, TestRequest } from '@angular/common/http/testing';
import { BehaviorSubject } from 'rxjs';

import { AccountStatusService } from './account-status.service';
import { AuthService } from './auth.service';
import { testProviders } from '../../testing/test-providers';
import { ACCOUNT_STATUS_KEY, AccountStatusSnapshot, hasUnpaidOrder } from '../shared/account/account-status';

/**
 * The header's account state (unpaid dot, My Contracts / My Invoices, points badge, staff
 * indicators) is loaded ONCE per page load and shared. It used to be fetched by the header and the
 * points badge on every auth emission and every navigation: /api/order x4, header-summary x3 and
 * the contract / invoice checks x3 on every page.
 */
describe('AccountStatusService', () => {
  let user$: BehaviorSubject<any>;
  let initialized$: BehaviorSubject<boolean>;
  let http: HttpTestingController;
  const CUSTOMER = { id: 71, role: 'Customer', firstName: 'Nate', lastName: 'R' };
  const ADMIN = { id: 5, role: 'Admin', firstName: 'Ada', lastName: 'M' };

  function setup(seed?: AccountStatusSnapshot) {
    user$ = new BehaviorSubject<any>(null);
    initialized$ = new BehaviorSubject(false);
    TestBed.configureTestingModule({
      providers: [
        ...testProviders,
        {
          provide: AuthService,
          useValue: {
            currentUser: user$.asObservable(),
            isInitialized$: initialized$.asObservable(),
            get currentUserValue() { return user$.value; },
            isLoggedIn: () => !!user$.value
          }
        }
      ]
    });
    if (seed) TestBed.inject(TransferState).set(ACCOUNT_STATUS_KEY, seed);
    http = TestBed.inject(HttpTestingController);
    return TestBed.inject(AccountStatusService);
  }
  /** The signed-in services live in a lazily imported chunk. */
  const settle = async () => {
    await import('../header/header-account.services');
    for (let i = 0; i < 3; i++) await new Promise(resolve => setTimeout(resolve, 0));
  };
  const count = (path: string) => http.match(r => r.url.endsWith(path)).length;
  const answer = (path: string, body: any) => http.match(r => r.url.endsWith(path)).forEach((r: TestRequest) => r.flush(body));

  afterEach(() => TestBed.resetTestingModule());

  it('loads each part once however often auth re-announces the same user', async () => {
    const service = setup();
    user$.next(CUSTOMER);        // the cached user, before auth has initialised
    initialized$.next(true);     // initialised
    user$.next({ ...CUSTOMER }); // the current-user answer
    user$.next({ ...CUSTOMER }); // the profile refresh
    await settle();

    const requests = http.match(() => true).map(r => r.request.url.replace(/^.*\/api/, '/api'));
    expect(requests.sort()).toEqual([
      '/api/bubble-points/header-summary', '/api/my-contracts/has-contracts', '/api/my-invoices/has-invoices', '/api/order'
    ]);
    expect(service).toBeTruthy();
  });

  it('fills the indicators from the answers', async () => {
    const service = setup();
    user$.next(CUSTOMER);
    await settle();
    answer('/api/order', [{ status: 'Pending', isPaid: false, paymentMethod: 'Normal' }]);
    answer('/header-summary', { points: 260, pointsSystemEnabled: true });
    answer('/has-contracts', { hasContracts: true });
    answer('/has-invoices', { hasInvoices: false });

    expect(service.hasUnpaidOrders()).toBe(true);
    expect(service.headerSummary()?.points).toBe(260);
    expect(service.headerSummaryState()).toBe('ok');
    expect(service.hasContracts()).toBe(true);
    expect(service.hasInvoices()).toBe(false);
  });

  it('asks for the staff indicators for an admin only', async () => {
    setup();
    user$.next(ADMIN);
    await settle();

    expect(count('/personal-tasks/pending-count')).toBe(1);
    expect(count('/personal-tasks/unchecked-done-count')).toBe(1);
    expect(count('/blog/pending-count')).toBe(1);
  });

  it('takes the server\'s snapshot on /booking instead of fetching anything', async () => {
    const service = setup({
      userId: 71, hasUnpaidOrders: true, hasContracts: false, hasInvoices: true,
      headerSummary: { points: 9 } as any, hasPendingPersonalTasks: false, hasUncheckedDoneTasks: false, pendingBlogDrafts: 0
    });
    user$.next(CUSTOMER);
    await settle();

    expect(http.match(() => true)).toEqual([]);
    expect(service.hasUnpaidOrders()).toBe(true);
    expect(service.headerSummary()?.points).toBe(9);
  });

  it('ignores a snapshot that belongs to somebody else', async () => {
    setup({
      userId: 999, hasUnpaidOrders: true, hasContracts: true, hasInvoices: true, headerSummary: null,
      hasPendingPersonalTasks: false, hasUncheckedDoneTasks: false, pendingBlogDrafts: 0
    });
    user$.next(CUSTOMER);
    await settle();

    expect(count('/api/order')).toBe(1);
  });

  it('shares the order list: a request on the wire is joined, a fresh list reused', async () => {
    const service = setup();
    user$.next(CUSTOMER);
    await settle();
    const lists: number[] = [];
    service.orders().subscribe(o => lists.push(o.length));
    await settle();
    // One request answers both the header's load and this caller (match() also removes it).
    const pending = http.match(r => r.url.endsWith('/api/order'));
    expect(pending.length).toBe(1);
    pending[0].flush([{ id: 1 }, { id: 2 }]);
    service.orders().subscribe(o => lists.push(o.length));
    await settle();

    expect(count('/api/order')).toBe(0);
    expect(lists).toEqual([2, 2]);
  });

  it('a forced reload (maxAge 0) asks again', async () => {
    const service = setup();
    user$.next(CUSTOMER);
    await settle();
    answer('/api/order', []);

    service.orders(0).subscribe();
    await settle();

    expect(count('/api/order')).toBe(1);
  });

  it('refreshes the unpaid dot when orders are reported changed (and reuses a list just loaded)', async () => {
    vi.useFakeTimers();
    const service = setup();
    user$.next(CUSTOMER);
    await import('../header/header-account.services');
    await vi.advanceTimersByTimeAsync(10);
    answer('/api/order', []);
    await vi.advanceTimersByTimeAsync(5000);

    window.dispatchEvent(new Event('ordersUpdated'));
    await vi.advanceTimersByTimeAsync(400);
    expect(count('/api/order')).toBe(1);
    expect(service).toBeTruthy();
    vi.useRealTimers();
  });

  it('forgets everything on sign-out', async () => {
    const service = setup();
    user$.next(CUSTOMER);
    initialized$.next(true);
    await settle();
    answer('/api/order', [{ status: 'Pending', isPaid: false }]);
    expect(service.hasUnpaidOrders()).toBe(true);

    user$.next(null);

    expect(service.hasUnpaidOrders()).toBe(false);
    expect(service.headerSummaryState()).toBe('unknown');
  });

  describe('booking context (what /booking draws an in-app visit from)', () => {
    it('is built once from the same calls the server makes, reusing the shared order list', async () => {
      const service = setup();
      user$.next(CUSTOMER);
      await settle();
      answer('/api/order', [{ id: 1, isCustomServiceType: false }]);

      let context: any;
      service.loadBookingContext().subscribe(c => context = c);
      service.loadBookingContext().subscribe();   // joined, not repeated
      answer('/api/profile', { id: 71, role: 'Customer', firstName: 'Nate', loyaltyDiscountPercentage: 5 });
      answer('/profile/special-offers', [{ id: 3 }]);
      answer('/booking/user-subscription', { hasSubscription: false });
      answer('/bubble-points/summary', { pointsSystemEnabled: true });

      expect(count('/api/order')).toBe(0);
      expect(context.user.id).toBe(71);
      expect(context.loyaltyDiscountPercentage).toBe(5);
      expect(context.hasPreviousOrders).toBe(true);
      expect(service.peekBookingContext()).toBe(context);
    });

    it('is never handed to a different user', async () => {
      const service = setup();
      user$.next(CUSTOMER);
      await settle();
      service.rememberBookingContext({ user: { id: 71 } } as any);
      expect(service.peekBookingContext()).not.toBeNull();

      user$.next(ADMIN);

      expect(service.peekBookingContext()).toBeNull();
    });
  });

  it('the unpaid rule: only what can be paid on the website', () => {
    expect(hasUnpaidOrder([{ status: 'Pending', isPaid: false, paymentMethod: 'Normal' }])).toBe(true);
    expect(hasUnpaidOrder([{ status: 'Pending', isPaid: false, paymentMethod: 'Cash' }])).toBe(false);
    expect(hasUnpaidOrder([{ status: 'Cancelled', isPaid: false }])).toBe(false);
    expect(hasUnpaidOrder([{ status: 'Active', isPaid: true, pendingUpdateAmount: 25 }])).toBe(true);
  });
});
