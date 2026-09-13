import { TestBed, discardPeriodicTasks, fakeAsync, tick } from '@angular/core/testing';
import { BehaviorSubject, of, Subject } from 'rxjs';

import {
  NewOrderNotificationService,
  NEW_ORDER_WINDOW_MS
} from './new-order-notification.service';
import { AdminService, UnviewedNewOrder } from './admin.service';
import { AuthService } from './auth.service';
import { SignalRService } from './signalr.service';
import { OrderSoundService } from './order-sound.service';

/**
 * THE GREEN NEW-ORDER HIGHLIGHT IS PER ADMIN, AND IT EXPIRES.
 *
 * Mirrors NewOrderHighlightPolicyTests on the backend. What is worth protecting on this side is
 * the client half: an order that ages past the window must stop being green on a tab that has
 * been open the whole time, and a NewOrderViewed broadcast must clear silently — it now reaches
 * only the admin who did the viewing, so it is never another admin telling us to clear ours.
 *
 * fakeAsync rather than jasmine.clock(): zone.js captures the native timers when it loads, so a
 * later clock patch never reaches the service's setTimeout/setInterval. tick() also advances
 * Date.now() under fakeAsync, which is what makes the window assertions deterministic.
 */
describe('NewOrderNotificationService', () => {
  let service: NewOrderNotificationService;
  let adminService: jasmine.SpyObj<AdminService>;
  let currentUser: BehaviorSubject<any>;
  let isInitialized: BehaviorSubject<boolean>;
  let newOrderCreated: Subject<{ orderId: number } | null>;
  let newOrderViewed: Subject<{ orderId: number } | null>;

  /** Feeds the initial server load. Call before signing an admin in. */
  function serverReturns(orders: UnviewedNewOrder[]): void {
    adminService.getUnviewedNewOrders.and.returnValue(of(orders));
  }

  /** Must be called inside fakeAsync — the service defers its load by 500ms. */
  function signIn(role: string): void {
    service = TestBed.inject(NewOrderNotificationService);
    currentUser.next({ role });
    isInitialized.next(true);
    tick(600);
  }

  function ago(ms: number): string {
    return new Date(Date.now() - ms).toISOString();
  }

  beforeEach(() => {
    currentUser = new BehaviorSubject<any>(null);
    isInitialized = new BehaviorSubject<boolean>(false);
    newOrderCreated = new Subject();
    newOrderViewed = new Subject();

    adminService = jasmine.createSpyObj<AdminService>('AdminService', [
      'getUnviewedNewOrders',
      'markOrderViewed'
    ]);
    adminService.getUnviewedNewOrders.and.returnValue(of([]));
    adminService.markOrderViewed.and.returnValue(of({ message: 'ok' }));

    TestBed.configureTestingModule({
      providers: [
        NewOrderNotificationService,
        { provide: AdminService, useValue: adminService },
        { provide: AuthService, useValue: { currentUser, isInitialized$: isInitialized } },
        {
          provide: SignalRService,
          useValue: {
            newOrderCreated$: newOrderCreated.asObservable(),
            newOrderViewed$: newOrderViewed.asObservable()
          }
        },
        { provide: OrderSoundService, useValue: { playNewOrderAdmin: () => {} } }
      ]
    });
  });

  // ── The 24-hour window ──────────────────────────────────────────────────────────────────

  it('highlights an order the server reports as unviewed', fakeAsync(() => {
    serverReturns([{ orderId: 7, createdAt: ago(60 * 60 * 1000) }]);
    signIn('Admin');

    expect(service.isUnviewed(7)).toBeTrue();
    expect(service.unviewedCount$.value).toBe(1);

    discardPeriodicTasks();
  }));

  /**
   * The tab has been open since before the order aged out. Nobody reloads an admin panel that
   * is left up all day, so the window has to be re-checked rather than trusted from load time.
   */
  it('stops highlighting an order once it crosses 24 hours, with no reload', fakeAsync(() => {
    serverReturns([{ orderId: 7, createdAt: ago(NEW_ORDER_WINDOW_MS - 60 * 1000) }]);
    signIn('Admin');

    expect(service.isUnviewed(7)).toBeTrue();

    tick(2 * 60 * 1000);

    expect(service.isUnviewed(7)).toBeFalse();
    // The sweep must also retract the header badge, which is subscribed app-wide and cannot
    // ask isUnviewed() about an order it does not know exists.
    expect(service.unviewedCount$.value).toBe(0);
    expect(service.hasUnviewedOrders$.value).toBeFalse();

    discardPeriodicTasks();
  }));

  /**
   * An expired order is NOT acknowledged on the server. It fell outside the window; nobody
   * looked at it, and writing a row would be inventing a view that never happened.
   */
  it('does not record a view for an order that merely expired', fakeAsync(() => {
    serverReturns([{ orderId: 7, createdAt: ago(NEW_ORDER_WINDOW_MS - 60 * 1000) }]);
    signIn('Admin');

    tick(2 * 60 * 1000);

    expect(adminService.markOrderViewed).not.toHaveBeenCalled();

    discardPeriodicTasks();
  }));

  /** A stale row the server somehow still returns is dropped rather than shown. */
  it('ignores an already-expired order in the initial load', fakeAsync(() => {
    serverReturns([{ orderId: 7, createdAt: ago(NEW_ORDER_WINDOW_MS + 1000) }]);
    signIn('Admin');

    expect(service.isUnviewed(7)).toBeFalse();
    expect(service.unviewedCount$.value).toBe(0);

    discardPeriodicTasks();
  }));

  /**
   * The API serializes CreatedAt WITHOUT a "Z". A bare `new Date(...)` reads that as
   * browser-local, which for an NY admin stretches the window to 28 hours and puts the client
   * out of step with the cutoff the server just applied — so the shared parseUtcDate is used.
   * This asserts the offset-less form, which is the one that actually comes off the wire.
   */
  it('reads an offset-less CreatedAt as UTC, not as browser-local', fakeAsync(() => {
    const justInside = new Date(Date.now() - (NEW_ORDER_WINDOW_MS - 60 * 60 * 1000));
    const justOutside = new Date(Date.now() - (NEW_ORDER_WINDOW_MS + 60 * 60 * 1000));
    const withoutZ = (d: Date) => d.toISOString().replace('Z', '');

    serverReturns([
      { orderId: 7, createdAt: withoutZ(justInside) },
      { orderId: 8, createdAt: withoutZ(justOutside) }
    ]);
    signIn('Admin');

    expect(service.isUnviewed(7)).toBeTrue();
    expect(service.isUnviewed(8)).toBeFalse();

    discardPeriodicTasks();
  }));

  // ── Per-admin clearing ──────────────────────────────────────────────────────────────────

  it('clears this admin\'s green and records the view when they open the order', fakeAsync(() => {
    serverReturns([{ orderId: 7, createdAt: ago(1000) }]);
    signIn('Admin');

    service.markViewed(7);

    expect(service.isUnviewed(7)).toBeFalse();
    expect(adminService.markOrderViewed).toHaveBeenCalledOnceWith(7);

    discardPeriodicTasks();
  }));

  /**
   * NewOrderViewed now reaches only the admin who did the viewing — their second tab or phone.
   * It must clear silently, WITHOUT posting a second acknowledgment for an already-recorded view.
   */
  it('clears on a NewOrderViewed echo from this admin\'s other session', fakeAsync(() => {
    serverReturns([{ orderId: 7, createdAt: ago(1000) }]);
    signIn('Admin');

    newOrderViewed.next({ orderId: 7 });

    expect(service.isUnviewed(7)).toBeFalse();
    expect(service.unviewedCount$.value).toBe(0);
    expect(adminService.markOrderViewed).not.toHaveBeenCalled();

    discardPeriodicTasks();
  }));

  /** Opening an order that was never green must not write a spurious acknowledgment. */
  it('does nothing when marking an order that is not highlighted', fakeAsync(() => {
    signIn('Admin');

    service.markViewed(999);

    expect(adminService.markOrderViewed).not.toHaveBeenCalled();

    discardPeriodicTasks();
  }));

  // ── The audience ────────────────────────────────────────────────────────────────────────

  /**
   * Moderators hold Permission.View, so the endpoint is reachable to them; they are simply not
   * an audience for the indicator (owner's call, 2026-09). The server answers them empty, and
   * the client neither asks nor accepts an order pushed over the wire.
   */
  it('never highlights anything for a Moderator', fakeAsync(() => {
    serverReturns([{ orderId: 7, createdAt: ago(1000) }]);
    signIn('Moderator');

    expect(adminService.getUnviewedNewOrders).not.toHaveBeenCalled();

    newOrderCreated.next({ orderId: 8 });

    expect(service.isUnviewed(8)).toBeFalse();
    expect(service.hasUnviewedOrders$.value).toBeFalse();

    discardPeriodicTasks();
  }));

  it('highlights an order pushed over SignalR while an admin is signed in', fakeAsync(() => {
    signIn('Admin');

    newOrderCreated.next({ orderId: 8 });

    expect(service.isUnviewed(8)).toBeTrue();

    // And it ages out on the same 24h clock as one that arrived in the initial load.
    tick(NEW_ORDER_WINDOW_MS + 60 * 1000);

    expect(service.isUnviewed(8)).toBeFalse();

    discardPeriodicTasks();
  }));

  it('drops everything when the admin signs out', fakeAsync(() => {
    serverReturns([{ orderId: 7, createdAt: ago(1000) }]);
    signIn('Admin');

    currentUser.next(null);

    expect(service.isUnviewed(7)).toBeFalse();
    expect(service.hasUnviewedOrders$.value).toBeFalse();

    discardPeriodicTasks();
  }));
});
