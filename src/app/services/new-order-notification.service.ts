import { Injectable, Inject, PLATFORM_ID, OnDestroy } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { BehaviorSubject, combineLatest } from 'rxjs';
import { AuthService } from './auth.service';
import { AdminService } from './admin.service';
import { SignalRService } from './signalr.service';
import { OrderSoundService } from './order-sound.service';
import { parseUtcDate } from '../shared/ny-time.util';

/**
 * How long an order counts as "new", measured from when it was CREATED.
 * Mirrors `NewOrderHighlightPolicy.WindowHours` on the backend — change both together.
 */
export const NEW_ORDER_WINDOW_MS = 24 * 60 * 60 * 1000;

/** How often the window is re-checked so a row and the header badge decay on an open tab. */
const EXPIRY_SWEEP_MS = 60 * 1000;

/**
 * The green new-order highlight, which is PER ADMIN (2026-09).
 *
 * Each admin clears only their own green: one admin opening an order tells the others nothing,
 * because the point of the indicator is "I personally have not looked at this yet". The
 * server-side half is `NewOrderHighlightPolicy`; the two rules that matter here are that
 * `NewOrderViewed` now arrives only for the admin who did the viewing (their other tabs), and
 * that an order stops being green 24 hours after it was created whether or not anyone opened
 * it. Without that window, going per-admin would have turned the entire order history green
 * for every admin who had never personally clicked a row.
 *
 * Moderators are not an audience for this at all: the service only initializes for Admin and
 * SuperAdmin, and `addUnviewed` refuses while uninitialized so a stray broadcast cannot seed it.
 */
@Injectable({
  providedIn: 'root'
})
export class NewOrderNotificationService implements OnDestroy {
  private isBrowser: boolean;
  private initialized = false;

  /**
   * Order id → creation time in epoch ms. A Map rather than a Set because expiry is read on
   * every row render, and re-deriving "how old is this" from the orders list would tie the
   * header badge to a page that may not be open.
   */
  private unviewedOrders = new Map<number, number>();

  private sweepHandle: ReturnType<typeof setInterval> | null = null;

  /** Whether there are any unviewed new orders */
  hasUnviewedOrders$ = new BehaviorSubject<boolean>(false);

  /** Count of unviewed new orders */
  unviewedCount$ = new BehaviorSubject<number>(0);

  constructor(
    private authService: AuthService,
    private adminService: AdminService,
    private signalRService: SignalRService,
    private orderSound: OrderSoundService,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);

    if (this.isBrowser) {
      // Listen for new order created via SignalR
      this.signalRService.newOrderCreated$.subscribe(data => {
        if (!data) return;
        // A brand-new order starts its window now: the server broadcasts this the moment the
        // row is inserted, so local time is effectively its CreatedAt.
        if (!this.addUnviewed(data.orderId, Date.now())) return;
        this.orderSound.playNewOrderAdmin();
        this.sendNewOrderNotification(data.orderId);
      });

      // This admin viewed the order somewhere else — another tab, their phone. It is no longer
      // broadcast to the other admins, so there is nobody else's green to clear here.
      this.signalRService.newOrderViewed$.subscribe(data => {
        if (data && this.unviewedOrders.delete(data.orderId)) {
          this.emit();
        }
      });

      // Auto-initialize when admin/superadmin logs in
      combineLatest([
        this.authService.isInitialized$,
        this.authService.currentUser
      ]).subscribe(([isInitialized, user]) => {
        if (!isInitialized) return;

        if (user && (user.role === 'Admin' || user.role === 'SuperAdmin')) {
          if (!this.initialized) {
            this.initialized = true;
            this.requestNotificationPermission();
            this.startExpirySweep();
            setTimeout(() => this.loadFromServer(), 500);
          }
        } else {
          this.initialized = false;
          this.stopExpirySweep();
          this.unviewedOrders.clear();
          this.emit();
        }
      });
    }
  }

  ngOnDestroy(): void {
    this.stopExpirySweep();
  }

  /** Check if a specific order is unviewed BY THIS ADMIN and still inside the 24h window. */
  isUnviewed(orderId: number): boolean {
    const createdAt = this.unviewedOrders.get(orderId);
    if (createdAt === undefined) return false;
    return Date.now() - createdAt < NEW_ORDER_WINDOW_MS;
  }

  /** Mark an order as viewed — calls backend and removes locally */
  markViewed(orderId: number): void {
    // Deliberately keyed on membership, not on isUnviewed(): an order whose window has just
    // lapsed still holds a stale map entry and no acknowledgment row, and recording the view is
    // what keeps the server's answer and this map agreeing on the next load.
    if (!this.unviewedOrders.has(orderId)) return;

    this.unviewedOrders.delete(orderId);
    this.emit();

    // Persist to backend (which broadcasts via SignalR to this admin's other sessions)
    this.adminService.markOrderViewed(orderId).subscribe({
      error: (err) => console.error('Failed to mark order as viewed:', err)
    });
  }

  /** Returns false when the entry was rejected (not an admin, or already past the window). */
  private addUnviewed(orderId: number, createdAtMs: number): boolean {
    if (!this.initialized) return false;
    if (Date.now() - createdAtMs >= NEW_ORDER_WINDOW_MS) return false;

    this.unviewedOrders.set(orderId, createdAtMs);
    this.emit();
    return true;
  }

  private loadFromServer(): void {
    this.adminService.getUnviewedNewOrders().subscribe({
      next: (orders) => {
        const now = Date.now();
        this.unviewedOrders = new Map(
          orders
            // parseUtcDate, never `new Date(...)`: the API serializes CreatedAt without a "Z",
            // so a bare parse reads it as browser-local and an NY admin gets a 28-hour window
            // that disagrees with the cutoff the server just applied.
            .map(o => [o.orderId, parseUtcDate(o.createdAt)?.getTime() ?? NaN] as [number, number])
            // The server applied the same cutoff, but a clock skew or a slow response can put a
            // row over the line between the query and this assignment.
            .filter(([, createdAt]) =>
              Number.isFinite(createdAt) && now - createdAt < NEW_ORDER_WINDOW_MS)
        );
        this.emit();
      },
      error: () => {}
    });
  }

  /**
   * Drop entries whose window has lapsed. The count feeds the header badge, which is subscribed
   * app-wide, so a lapsed order has to stop being counted without anyone reloading the page.
   */
  private startExpirySweep(): void {
    if (this.sweepHandle !== null) return;
    this.sweepHandle = setInterval(() => this.pruneExpired(), EXPIRY_SWEEP_MS);
  }

  private stopExpirySweep(): void {
    if (this.sweepHandle === null) return;
    clearInterval(this.sweepHandle);
    this.sweepHandle = null;
  }

  private pruneExpired(): void {
    const now = Date.now();
    let removed = false;

    for (const [orderId, createdAt] of Array.from(this.unviewedOrders.entries())) {
      if (now - createdAt >= NEW_ORDER_WINDOW_MS) {
        this.unviewedOrders.delete(orderId);
        removed = true;
      }
    }

    // An expired order is deliberately NOT acknowledged on the server — it simply falls outside
    // the window, and the server applies the same cutoff on the next load. Nothing to persist.
    if (removed) this.emit();
  }

  private emit(): void {
    this.hasUnviewedOrders$.next(this.unviewedOrders.size > 0);
    this.unviewedCount$.next(this.unviewedOrders.size);
  }

  private requestNotificationPermission(): void {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  private sendNewOrderNotification(orderId: number): void {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    const notification = new Notification('New Order Received!', {
      body: `Order #${orderId} has been placed. Click to review.`,
      icon: '/images/logo.svg',
      tag: `new-order-${orderId}`,
      silent: false
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  }
}
