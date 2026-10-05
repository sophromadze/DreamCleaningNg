import type { MockedObject } from 'vitest';
import { TestBed } from '@angular/core/testing';
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
 * Vitest fake timers (vi.useFakeTimers) replace setTimeout/setInterval AND Date, so advancing the
 * clock also advances Date.now() — which is what makes the window assertions deterministic.
 */
describe('NewOrderNotificationService', () => {
  let service: NewOrderNotificationService;
  let adminService: MockedObject<AdminService>;
  let currentUser: BehaviorSubject<any>;
  let isInitialized: BehaviorSubject<boolean>;
  let newOrderCreated: Subject<{ orderId: number } | null>;
  let newOrderViewed: Subject<{ orderId: number } | null>;

  /** Feeds the initial server load. Call before signing an admin in. */
  function serverReturns(orders: UnviewedNewOrder[]): void {
    adminService.getUnviewedNewOrders.mockReturnValue(of(orders));
  }

  /** Needs fake timers (vi.useFakeTimers) — the service defers its load by 500ms. */
  async function signIn(role: string): Promise<void> {
    service = TestBed.inject(NewOrderNotificationService);
    currentUser.next({ role });
    isInitialized.next(true);
    await vi.advanceTimersByTimeAsync(600);
  }

  function ago(ms: number): string {
    return new Date(Date.now() - ms).toISOString();
  }

  beforeEach(() => {
    currentUser = new BehaviorSubject<any>(null);
    isInitialized = new BehaviorSubject<boolean>(false);
    newOrderCreated = new Subject();
    newOrderViewed = new Subject();

    adminService = {
      getUnviewedNewOrders: vi.fn().mockName('AdminService.getUnviewedNewOrders'),
      markOrderViewed: vi.fn().mockName('AdminService.markOrderViewed')
    } as unknown as MockedObject<AdminService>;
    adminService.getUnviewedNewOrders.mockReturnValue(of([]));
    adminService.markOrderViewed.mockReturnValue(of({ message: 'ok' }));

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

  it('highlights an order the server reports as unviewed', async () => {
    vi.useFakeTimers();
    serverReturns([{ orderId: 7, createdAt: ago(60 * 60 * 1000) }]);
    await signIn('Admin');

    expect(service.isUnviewed(7)).toBe(true);
    expect(service.unviewedCount$.value).toBe(1);

    vi.clearAllTimers();
  });

  /**
   * The tab has been open since before the order aged out. Nobody reloads an admin panel that
   * is left up all day, so the window has to be re-checked rather than trusted from load time.
   */
  it('stops highlighting an order once it crosses 24 hours, with no reload', async () => {
    vi.useFakeTimers();
    serverReturns([{ orderId: 7, createdAt: ago(NEW_ORDER_WINDOW_MS - 60 * 1000) }]);
    await signIn('Admin');

    expect(service.isUnviewed(7)).toBe(true);

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);

    expect(service.isUnviewed(7)).toBe(false);
    // The sweep must also retract the header badge, which is subscribed app-wide and cannot
    // ask isUnviewed() about an order it does not know exists.
    expect(service.unviewedCount$.value).toBe(0);
    expect(service.hasUnviewedOrders$.value).toBe(false);

    vi.clearAllTimers();
  });

  /**
   * An expired order is NOT acknowledged on the server. It fell outside the window; nobody
   * looked at it, and writing a row would be inventing a view that never happened.
   */
  it('does not record a view for an order that merely expired', async () => {
    vi.useFakeTimers();
    serverReturns([{ orderId: 7, createdAt: ago(NEW_ORDER_WINDOW_MS - 60 * 1000) }]);
    await signIn('Admin');

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);

    expect(adminService.markOrderViewed).not.toHaveBeenCalled();

    vi.clearAllTimers();
  });

  /** A stale row the server somehow still returns is dropped rather than shown. */
  it('ignores an already-expired order in the initial load', async () => {
    vi.useFakeTimers();
    serverReturns([{ orderId: 7, createdAt: ago(NEW_ORDER_WINDOW_MS + 1000) }]);
    await signIn('Admin');

    expect(service.isUnviewed(7)).toBe(false);
    expect(service.unviewedCount$.value).toBe(0);

    vi.clearAllTimers();
  });

  /**
   * The API serializes CreatedAt WITHOUT a "Z". A bare `new Date(...)` reads that as
   * browser-local, which for an NY admin stretches the window to 28 hours and puts the client
   * out of step with the cutoff the server just applied — so the shared parseUtcDate is used.
   * This asserts the offset-less form, which is the one that actually comes off the wire.
   */
  it('reads an offset-less CreatedAt as UTC, not as browser-local', async () => {
    vi.useFakeTimers();
    const justInside = new Date(Date.now() - (NEW_ORDER_WINDOW_MS - 60 * 60 * 1000));
    const justOutside = new Date(Date.now() - (NEW_ORDER_WINDOW_MS + 60 * 60 * 1000));
    const withoutZ = (d: Date) => d.toISOString().replace('Z', '');

    serverReturns([
      { orderId: 7, createdAt: withoutZ(justInside) },
      { orderId: 8, createdAt: withoutZ(justOutside) }
    ]);
    await signIn('Admin');

    expect(service.isUnviewed(7)).toBe(true);
    expect(service.isUnviewed(8)).toBe(false);

    vi.clearAllTimers();
  });

  // ── Per-admin clearing ──────────────────────────────────────────────────────────────────

  it('clears this admin\'s green and records the view when they open the order', async () => {
    vi.useFakeTimers();
    serverReturns([{ orderId: 7, createdAt: ago(1000) }]);
    await signIn('Admin');

    service.markViewed(7);

    expect(service.isUnviewed(7)).toBe(false);
    expect(adminService.markOrderViewed).toHaveBeenCalledExactlyOnceWith(7);

    vi.clearAllTimers();
  });

  /**
   * NewOrderViewed now reaches only the admin who did the viewing — their second tab or phone.
   * It must clear silently, WITHOUT posting a second acknowledgment for an already-recorded view.
   */
  it('clears on a NewOrderViewed echo from this admin\'s other session', async () => {
    vi.useFakeTimers();
    serverReturns([{ orderId: 7, createdAt: ago(1000) }]);
    await signIn('Admin');

    newOrderViewed.next({ orderId: 7 });

    expect(service.isUnviewed(7)).toBe(false);
    expect(service.unviewedCount$.value).toBe(0);
    expect(adminService.markOrderViewed).not.toHaveBeenCalled();

    vi.clearAllTimers();
  });

  /** Opening an order that was never green must not write a spurious acknowledgment. */
  it('does nothing when marking an order that is not highlighted', async () => {
    vi.useFakeTimers();
    await signIn('Admin');

    service.markViewed(999);

    expect(adminService.markOrderViewed).not.toHaveBeenCalled();

    vi.clearAllTimers();
  });

  // ── The audience ────────────────────────────────────────────────────────────────────────

  /**
   * Moderators hold Permission.View, so the endpoint is reachable to them; they are simply not
   * an audience for the indicator (owner's call, 2026-09). The server answers them empty, and
   * the client neither asks nor accepts an order pushed over the wire.
   */
  it('never highlights anything for a Moderator', async () => {
    vi.useFakeTimers();
    serverReturns([{ orderId: 7, createdAt: ago(1000) }]);
    await signIn('Moderator');

    expect(adminService.getUnviewedNewOrders).not.toHaveBeenCalled();

    newOrderCreated.next({ orderId: 8 });

    expect(service.isUnviewed(8)).toBe(false);
    expect(service.hasUnviewedOrders$.value).toBe(false);

    vi.clearAllTimers();
  });

  it('highlights an order pushed over SignalR while an admin is signed in', async () => {
    vi.useFakeTimers();
    await signIn('Admin');

    newOrderCreated.next({ orderId: 8 });

    expect(service.isUnviewed(8)).toBe(true);

    // And it ages out on the same 24h clock as one that arrived in the initial load.
    await vi.advanceTimersByTimeAsync(NEW_ORDER_WINDOW_MS + 60 * 1000);

    expect(service.isUnviewed(8)).toBe(false);

    vi.clearAllTimers();
  });

  it('drops everything when the admin signs out', async () => {
    vi.useFakeTimers();
    serverReturns([{ orderId: 7, createdAt: ago(1000) }]);
    await signIn('Admin');

    currentUser.next(null);

    expect(service.isUnviewed(7)).toBe(false);
    expect(service.hasUnviewedOrders$.value).toBe(false);

    vi.clearAllTimers();
  });
});
