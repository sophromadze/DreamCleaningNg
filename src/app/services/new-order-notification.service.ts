import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { BehaviorSubject, combineLatest } from 'rxjs';
import { AuthService } from './auth.service';
import { AdminService } from './admin.service';
import { SignalRService } from './signalr.service';

@Injectable({
  providedIn: 'root'
})
export class NewOrderNotificationService {
  private isBrowser: boolean;
  private initialized = false;

  /** Set of order IDs that haven't been viewed by any admin */
  private unviewedOrderIds = new Set<number>();

  /** Whether there are any unviewed new orders */
  hasUnviewedOrders$ = new BehaviorSubject<boolean>(false);

  /** Count of unviewed new orders */
  unviewedCount$ = new BehaviorSubject<number>(0);

  constructor(
    private authService: AuthService,
    private adminService: AdminService,
    private signalRService: SignalRService,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);

    if (this.isBrowser) {
      // Listen for new order created via SignalR
      this.signalRService.newOrderCreated$.subscribe(data => {
        if (data) {
          this.unviewedOrderIds.add(data.orderId);
          this.emit();
          this.sendNewOrderNotification(data.orderId);
        }
      });

      // Listen for order viewed by another admin via SignalR
      this.signalRService.newOrderViewed$.subscribe(data => {
        if (data) {
          this.unviewedOrderIds.delete(data.orderId);
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
            setTimeout(() => this.loadFromServer(), 500);
          }
        } else {
          this.initialized = false;
          this.unviewedOrderIds.clear();
          this.emit();
        }
      });
    }
  }

  /** Check if a specific order is unviewed */
  isUnviewed(orderId: number): boolean {
    return this.unviewedOrderIds.has(orderId);
  }

  /** Mark an order as viewed — calls backend and removes locally */
  markViewed(orderId: number): void {
    if (!this.unviewedOrderIds.has(orderId)) return;

    this.unviewedOrderIds.delete(orderId);
    this.emit();

    // Persist to backend (which broadcasts via SignalR to other admins)
    this.adminService.markOrderViewed(orderId).subscribe({
      error: (err) => console.error('Failed to mark order as viewed:', err)
    });
  }

  private loadFromServer(): void {
    this.adminService.getUnviewedNewOrders().subscribe({
      next: (orderIds) => {
        this.unviewedOrderIds = new Set(orderIds);
        this.emit();
      },
      error: () => {}
    });
  }

  private emit(): void {
    this.hasUnviewedOrders$.next(this.unviewedOrderIds.size > 0);
    this.unviewedCount$.next(this.unviewedOrderIds.size);
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
