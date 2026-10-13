import { DOCUMENT, DestroyRef, Injector, PLATFORM_ID, Service, TransferState, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { NavigationEnd, Router } from '@angular/router';
import { Observable, combineLatest, defer, forkJoin, from, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, filter, finalize, map, shareReplay, switchMap, tap } from 'rxjs/operators';
import { AuthService } from './auth.service';
import { BubbleRewardsService, HeaderSummary } from './bubble-rewards.service';
import { BookingCatalogueStore } from './booking-catalogue-store.service';
import type { OrderList } from './order.service';
import { environment } from '../../environments/environment';
import {
  ACCOUNT_STATUS_KEY, AccountStatusSnapshot, hasUnpaidOrder, isInternalRole, isStaffRole
} from '../shared/account/account-status';
import type { SsrBookingSession } from '../shared/ssr/ssr-booking-session.token';

/** How long a loaded order list / booking context is reused before it is asked for again. */
export const ORDERS_REUSE_MS = 2_000;
export const BOOKING_CONTEXT_FRESH_MS = 60_000;
/** A tab coming back to the front reloads the header state if it is older than this. */
export const ACCOUNT_REFOCUS_MS = 60_000;

/**
 * The signed-in account's state that several parts of the page show, loaded ONCE per page load
 * and shared (2026-10). It replaced the header's and the points badge's own fetching, which fired
 * on every auth emission and every navigation - /api/order x4, header-summary x3 and the contract /
 * invoice checks x3 on every page, and again on each in-app navigation.
 *
 * - Loaded when a user is first seen (by id + role; repeated emissions of the same user are
 *   ignored), cleared on sign-out. On /booking the server's session lookup already has it and
 *   ships it in TransferState (ACCOUNT_STATUS_KEY), so nothing is fetched there at all.
 * - Refreshed only on events that can change it: the app's `ordersUpdated` event, arriving on
 *   booking-success or an order payment page, opening the profile / orders pages (they ask for the
 *   order list through orders()), the staff tasks SignalR feed (refreshStaffCounts), and the tab
 *   coming back to the front more than ACCOUNT_REFOCUS_MS after the last load. There is no
 *   customer-facing order/payment SignalR event to listen to.
 * - Also owns the booking context (offers, plan, points, has-orders, loyalty) that /booking draws
 *   step 1 from on an in-app visit - prefetched in idle time on pages with the hero or a Book link,
 *   reusing the same order list.
 *
 * Browser only; on the server it does nothing except hand /booking's session state to the browser.
 */
@Service()
export class AccountStatusService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly rewards = inject(BubbleRewardsService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly transferState = inject(TransferState);
  private readonly document = inject(DOCUMENT);
  private readonly catalogueStore = inject(BookingCatalogueStore);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly apiUrl = environment.apiUrl;

  readonly hasUnpaidOrders = signal(false);
  readonly hasContracts = signal(false);
  readonly hasInvoices = signal(false);
  readonly headerSummary = signal<HeaderSummary | null>(null);
  /** 'ok' / 'unavailable' once the badge's summary has an answer; 'unknown' before. */
  readonly headerSummaryState = signal<'unknown' | 'ok' | 'unavailable'>('unknown');
  readonly hasPendingPersonalTasks = signal(false);
  readonly hasUncheckedDoneTasks = signal(false);
  readonly pendingBlogDrafts = signal(0);

  private user: { id: number; role: string } | null = null;
  private loadedAt = 0;
  private orders$: Observable<OrderList[]> | null = null;
  private ordersAt = 0;
  private bookingContext: { userId: number; at: number; value: SsrBookingSession } | null = null;
  private bookingContext$: Observable<SsrBookingSession | null> | null = null;
  /** The server's snapshot (on /booking), used instead of the first load for that user. */
  private seed: AccountStatusSnapshot | null = null;
  private idlePrefetchDone = false;
  /** Everything this service listens to ends with its injector (an app teardown, a test). */
  private readonly destroyRef = inject(DestroyRef);
  private destroyed = false;

  constructor() {
    if (!this.isBrowser) return;
    if (this.transferState.hasKey(ACCOUNT_STATUS_KEY)) {
      this.seed = this.transferState.get(ACCOUNT_STATUS_KEY, null);
      this.transferState.remove(ACCOUNT_STATUS_KEY);
    }

    this.destroyRef.onDestroy(() => { this.destroyed = true; });
    combineLatest([this.auth.isInitialized$, this.auth.currentUser]).pipe(
      map(([initialized, user]) => user ? `${user.id}|${user.role}` : initialized ? 'none' : null),
      filter((key): key is string => key !== null),
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(key => {
      const user = this.auth.currentUserValue;
      if (key === 'none' || !user) return this.clear();
      this.user = { id: user.id, role: user.role };
      this.orders$ = null;
      if (this.bookingContext?.userId !== user.id) this.bookingContext = null;
      if (this.seed?.userId === user.id) {
        this.apply(this.seed);
        this.loadedAt = Date.now();
        this.seed = null;
      } else {
        this.loadAll();
      }
      this.scheduleIdlePrefetch();
    });

    // Explicit "orders changed" signal from the order pages (cancel, reschedule, pay). The page
    // that sent it has usually just reloaded the list itself; that answer is reused.
    from(fromWindowEvent(this.document, 'ordersUpdated')).pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.orders(ORDERS_REUSE_MS).subscribe({ error: () => {} }));

    // Arriving where money just moved: the unpaid dot and the points balance follow.
    this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd), takeUntilDestroyed(this.destroyRef)).subscribe(e => {
      if (!this.user) return;
      if (/^\/(booking-success\/|order\/[^/]+\/pay)/.test(e.urlAfterRedirects)) {
        this.refreshOrders();
        this.loadHeaderSummary();
      }
    });

    // Back to the tab after a while: anything may have changed meanwhile.
    const onVisibility = () => {
      if (!this.document.hidden && this.user && Date.now() - this.loadedAt > ACCOUNT_REFOCUS_MS) this.loadAll();
    };
    this.document.addEventListener('visibilitychange', onVisibility);
    this.destroyRef.onDestroy(() => this.document.removeEventListener('visibilitychange', onVisibility));
  }

  // ------------------------------------------------------------------------------------------
  // Header state

  private clear() {
    this.user = null;
    this.orders$ = null;
    this.bookingContext = null;
    this.hasUnpaidOrders.set(false);
    this.hasContracts.set(false);
    this.hasInvoices.set(false);
    this.headerSummary.set(null);
    this.headerSummaryState.set('unknown');
    this.hasPendingPersonalTasks.set(false);
    this.hasUncheckedDoneTasks.set(false);
    this.pendingBlogDrafts.set(0);
  }

  private apply(s: AccountStatusSnapshot) {
    this.hasUnpaidOrders.set(s.hasUnpaidOrders);
    this.hasContracts.set(s.hasContracts);
    this.hasInvoices.set(s.hasInvoices);
    this.headerSummary.set(s.headerSummary);
    this.headerSummaryState.set(s.headerSummary ? 'ok' : 'unavailable');
    this.hasPendingPersonalTasks.set(s.hasPendingPersonalTasks);
    this.hasUncheckedDoneTasks.set(s.hasUncheckedDoneTasks);
    this.pendingBlogDrafts.set(s.pendingBlogDrafts);
  }

  /** Everything the header shows, once. */
  private loadAll() {
    if (!this.user) return;
    this.loadedAt = Date.now();
    const role = this.user.role;
    this.refreshOrders();
    this.loadHeaderSummary();
    if (role !== 'Cleaner') {
      this.accountServices().then(s => {
        s.contracts.hasMyContracts().subscribe({ next: r => this.hasContracts.set(!!r?.hasContracts), error: () => this.hasContracts.set(false) });
        s.invoices.hasMyInvoices().subscribe({ next: r => this.hasInvoices.set(!!r?.hasInvoices), error: () => this.hasInvoices.set(false) });
      });
    } else {
      this.hasContracts.set(false);
      this.hasInvoices.set(false);
    }
    if (isStaffRole(role)) this.refreshStaffCounts();
    if (isInternalRole(role)) {
      this.accountServices().then(s => s.blog.adminGetPendingCount()
        .subscribe({ next: r => this.pendingBlogDrafts.set(r?.count ?? 0), error: () => this.pendingBlogDrafts.set(0) }));
    }
  }

  /**
   * My Contracts / My Invoices again (the profile page opening), unless the whole state was loaded
   * less than `maxAgeMs` ago - on a full load of that page, the header's own load is the answer.
   */
  refreshAccountFlags(maxAgeMs = ORDERS_REUSE_MS) {
    if (!this.isBrowser || !this.user || this.user.role === 'Cleaner') return;
    if (Date.now() - this.loadedAt < maxAgeMs) return;
    this.accountServices().then(s => {
      s.contracts.hasMyContracts().subscribe({ next: r => this.hasContracts.set(!!r?.hasContracts), error: () => this.hasContracts.set(false) });
      s.invoices.hasMyInvoices().subscribe({ next: r => this.hasInvoices.set(!!r?.hasInvoices), error: () => this.hasInvoices.set(false) });
    });
  }

  /** The points badge's numbers. */
  loadHeaderSummary() {
    if (!this.isBrowser || !this.user) return;
    this.rewards.getHeaderSummary().subscribe({
      next: data => { this.headerSummary.set(data); this.headerSummaryState.set('ok'); },
      error: () => { this.headerSummary.set(null); this.headerSummaryState.set('unavailable'); }
    });
  }

  /** Admin/SuperAdmin task indicators (also refreshed by the TasksUpdated SignalR feed). */
  refreshStaffCounts() {
    if (!this.isBrowser || !this.user || !isStaffRole(this.user.role)) return;
    this.accountServices().then(s => {
      s.tasks.getPendingPersonalTaskCount().subscribe({
        next: count => this.hasPendingPersonalTasks.set(count > 0),
        error: () => { this.hasPendingPersonalTasks.set(false); this.hasUncheckedDoneTasks.set(false); }
      });
      s.tasks.getUncheckedDoneCount().subscribe({
        next: count => this.hasUncheckedDoneTasks.set(count > 0),
        error: () => this.hasUncheckedDoneTasks.set(false)
      });
    });
  }

  /** Re-checks the unpaid dot (fresh order list). */
  refreshOrders() {
    this.orders(0).subscribe({ error: () => this.hasUnpaidOrders.set(false) });
  }

  /**
   * The signed-in user's order list, shared: a request already on the wire is joined, and a list
   * loaded less than `maxAgeMs` ago is reused. Every load also updates the unpaid dot.
   */
  orders(maxAgeMs = ORDERS_REUSE_MS): Observable<OrderList[]> {
    // A page can ask before this service has seen the auth emission; the signed-in user is the truth.
    const current = this.auth.currentUserValue;
    if (!this.user && current) this.user = { id: current.id, role: current.role };
    if (!this.isBrowser || !this.user) return of([]);
    if (this.orders$ && (this.ordersInFlight || Date.now() - this.ordersAt < maxAgeMs)) return this.orders$;
    const userId = this.user.id;
    this.ordersInFlight = true;
    this.orders$ = from(this.accountServices()).pipe(
      switchMap(s => s.orders.getUserOrders()),
      tap(orders => {
        if (this.user?.id !== userId) return;
        this.ordersAt = Date.now();
        this.hasUnpaidOrders.set(hasUnpaidOrder(orders));
      }),
      finalize(() => { this.ordersInFlight = false; }),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    return this.orders$;
  }
  private ordersInFlight = false;

  // ------------------------------------------------------------------------------------------
  // Booking context (what /booking draws step 1 from for this user)

  /** The context, when it is fresh and belongs to whoever is signed in now. */
  peekBookingContext(): SsrBookingSession | null {
    const ctx = this.bookingContext;
    if (!ctx || !this.user || ctx.userId !== this.user.id) return null;
    return Date.now() - ctx.at < BOOKING_CONTEXT_FRESH_MS ? ctx.value : null;
  }

  /** Records a context the server already looked up (the /booking session). */
  rememberBookingContext(session: SsrBookingSession) {
    if (!this.isBrowser) return;
    this.bookingContext = { userId: session.user.id, at: Date.now(), value: session };
  }

  /**
   * The same lookup the server makes for a signed-in /booking render (ssr-booking-session.ts),
   * in the browser: profile, offers, plan, points, has-orders (from the shared order list) and,
   * for staff, the register permission. Fresh copy, request on the wire, or a new one.
   */
  loadBookingContext(): Observable<SsrBookingSession | null> {
    const fresh = this.peekBookingContext();
    if (fresh) return of(fresh);
    if (!this.isBrowser || !this.user) return of(null);
    if (this.bookingContext$) return this.bookingContext$;
    const user = this.user;
    const get = <T>(path: string) => this.http.get<T>(`${this.apiUrl}${path}`).pipe(catchError(() => of(null)));
    this.bookingContext$ = forkJoin({
      profile: get<any>('/profile'),
      specialOffers: get<unknown[]>('/profile/special-offers'),
      subscription: get<Record<string, unknown>>('/booking/user-subscription'),
      points: get<Record<string, unknown>>('/bubble-points/summary'),
      orders: this.orders(BOOKING_CONTEXT_FRESH_MS).pipe(catchError(() => of(null))),
      permissions: isInternalRole(user.role) ? get<{ permissions?: { canCreate?: boolean } }>('/admin/permissions') : of(null)
    }).pipe(
      map(r => {
        if (!r.profile || this.user?.id !== user.id) return null;
        const session: SsrBookingSession = {
          user: {
            id: r.profile.id, firstName: r.profile.firstName ?? '', lastName: r.profile.lastName ?? '', email: r.profile.email ?? '',
            phone: r.profile.phone ?? null, role: r.profile.role, firstTimeOrder: !!r.profile.firstTimeOrder
          },
          loyaltyDiscountPercentage: Number(r.profile.loyaltyDiscountPercentage) || 0,
          specialOffers: Array.isArray(r.specialOffers) ? r.specialOffers : null,
          subscription: r.subscription,
          points: r.points,
          hasPreviousOrders: Array.isArray(r.orders) ? r.orders.some(o => !o.isCustomServiceType) : null,
          canRegisterCustomers: !isInternalRole(user.role) ? false : r.permissions ? !!r.permissions.permissions?.canCreate : null
        };
        this.bookingContext = { userId: user.id, at: Date.now(), value: session };
        return session;
      }),
      finalize(() => { this.bookingContext$ = null; }),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    return this.bookingContext$;
  }

  /**
   * Once per page load, in idle time: a signed-in visitor on a page whose content has the hero or
   * a link to /booking gets /booking's data ready (their context, the public catalogue), so a tap
   * on Book - phones have no hover - finds everything drawn at once.
   */
  private scheduleIdlePrefetch() {
    if (this.idlePrefetchDone) return;
    this.idlePrefetchDone = true;
    const win = this.document.defaultView as (Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }) | null;
    const run = () => {
      if (this.destroyed || !this.user) return;
      const main = this.document.querySelector('main');
      if (!main?.querySelector('a[href="/booking"], .booking-form-card')) return;
      this.loadBookingContext().subscribe({ error: () => {} });
      this.catalogueStore.prefetch();
    };
    if (win?.requestIdleCallback) {
      win.requestIdleCallback(run, { timeout: 4000 });
    } else {
      const timer = setTimeout(run, 2000);
      this.destroyRef.onDestroy(() => clearTimeout(timer));
    }
  }

  // ------------------------------------------------------------------------------------------

  /**
   * The signed-in-only services, in their own chunk (see header-account.services). If this
   * service's injector is destroyed while the chunk loads (an app teardown, a test), the promise
   * simply never settles: nothing is asked of a destroyed injector, and no caller runs.
   */
  private accountServices(): Promise<{
    orders: import('./order.service').OrderService;
    contracts: import('./contract.service').ContractService;
    invoices: import('./invoice.service').InvoiceService;
    tasks: import('./task.service').TaskService;
    blog: import('./blog.service').BlogService;
  }> {
    return import('../header/header-account.services').then(m => this.destroyed
      ? new Promise<never>(() => {})
      : {
          orders: this.injector.get(m.OrderService),
          contracts: this.injector.get(m.ContractService),
          invoices: this.injector.get(m.InvoiceService),
          tasks: this.injector.get(m.TaskService),
          blog: this.injector.get(m.BlogService)
        });
  }
}

function fromWindowEvent(doc: Document, name: string): Observable<Event> {
  return defer(() => new Observable<Event>(subscriber => {
    const win = doc.defaultView;
    if (!win) return;
    const handler = (e: Event) => subscriber.next(e);
    win.addEventListener(name, handler);
    return () => win.removeEventListener(name, handler);
  }));
}
