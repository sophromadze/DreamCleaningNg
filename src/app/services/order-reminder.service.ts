import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { BehaviorSubject, combineLatest } from 'rxjs';
import { AuthService } from './auth.service';
import { AdminService } from './admin.service';
import { SignalRService } from './signalr.service';

export interface OrderReminder {
  orderId: number;
  type: 'start' | 'end';
  message: string;
  triggeredAt: Date;
}

interface OrderData {
  id: number;
  serviceDate: Date | string;
  serviceTime: string;
  totalDuration: number;
  status: string;
}

@Injectable({
  providedIn: 'root'
})
export class OrderReminderService {
  private isBrowser: boolean;
  private orders: OrderData[] = [];
  private checkInterval: any;
  private refreshInterval: any;
  private notificationInterval: any;
  private titleFlashInterval: any;
  private initialized = false;
  private originalTitle = '';
  private showingAlertTitle = false;

  /** Web Worker for background-safe timers */
  private timerWorker: Worker | null = null;

  /** All currently active (unacknowledged) reminders, keyed by "orderId_type" */
  private remindersMap = new Map<string, OrderReminder>();

  /** Keys that have been acknowledged — prevents re-triggering */
  private acknowledgedKeys = new Set<string>();

  activeReminders$ = new BehaviorSubject<OrderReminder[]>([]);

  /** Current modal reminder (Admin only — SuperAdmin gets notification only) */
  modalReminder$ = new BehaviorSubject<OrderReminder | null>(null);

  /** Queue of modal reminders waiting to be shown */
  private modalQueue: OrderReminder[] = [];

  constructor(
    private authService: AuthService,
    private adminService: AdminService,
    private signalRService: SignalRService,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);

    if (this.isBrowser) {
      // Listen for SignalR acknowledgment from other admins
      this.signalRService.reminderAcknowledged$.subscribe(data => {
        if (data) {
          const key = `${data.orderId}_${data.type}`;
          this.acknowledgedKeys.add(key);
          if (this.remindersMap.has(key)) {
            this.remindersMap.delete(key);
            this.emitReminders();
            if (this.remindersMap.size === 0) {
              this.stopNotificationLoop();
              this.stopTitleFlash();
            }
            const current = this.modalReminder$.value;
            if (current && current.orderId === data.orderId && current.type === data.type) {
              this.modalReminder$.next(null);
              this.showNextModal();
            }
          }
        }
      });

      // Create Web Worker for background-safe timers
      this.createTimerWorker();

      // Save original document title
      this.originalTitle = document.title;

      // Track title changes from Angular routing
      const titleObserver = new MutationObserver(() => {
        if (!this.showingAlertTitle && document.title !== this.originalTitle) {
          this.originalTitle = document.title;
        }
      });
      const titleEl = document.querySelector('title');
      if (titleEl) {
        titleObserver.observe(titleEl, { childList: true });
      }

      // Auto-initialize when admin/superadmin logs in AND auth is fully ready
      combineLatest([
        this.authService.isInitialized$,
        this.authService.currentUser
      ]).subscribe(([isInitialized, user]) => {
        if (!isInitialized) return;

        if (user && (user.role === 'Admin' || user.role === 'SuperAdmin')) {
          if (!this.initialized) {
            this.requestNotificationPermission();
            setTimeout(() => this.autoInitialize(), 500);
          }
        } else {
          this.destroy();
          this.remindersMap.clear();
          this.acknowledgedKeys.clear();
          this.emitReminders();
          this.modalReminder$.next(null);
          this.modalQueue = [];
        }
      });
    }
  }

  /** Auto-fetch orders and start checking */
  private autoInitialize(): void {
    this.adminService.getAllOrders().subscribe({
      next: (orders) => {
        this.initialize(orders as OrderData[]);
      },
      error: () => {
        if (!this.initialized) {
          setTimeout(() => {
            this.adminService.getAllOrders().subscribe({
              next: (orders) => this.initialize(orders as OrderData[]),
              error: () => {}
            });
          }, 3000);
        }
      }
    });
  }

  /** Called by orders component after loading orders, or by auto-init */
  initialize(orders: OrderData[]): void {
    this.orders = orders;

    if (!this.initialized && this.isBrowser) {
      this.initialized = true;

      // IMPORTANT: Load server state FIRST, then start checking.
      // This prevents re-triggering already-acknowledged reminders after refresh.
      this.adminService.getActiveOrderReminders().subscribe({
        next: (activeFromServer) => {
          // Build set of keys the server considers active (un-acknowledged)
          const serverActiveKeys = new Set(
            activeFromServer.map(r => `${r.orderId}_${r.type}`)
          );

          // Pre-compute which reminders would be in the 30-min window locally.
          // If a reminder is in the time window but NOT in the server response,
          // it means it was already acknowledged — add to acknowledgedKeys.
          const nowNY = this.getNowInNewYork();
          for (const order of this.orders) {
            const status = order.status?.toLowerCase();
            if (status === 'cancelled' || status === 'done') continue;
            if (!order.serviceTime || !order.totalDuration) continue;

            const startNY = this.getOrderStartNY(order);
            const endNY = this.getOrderEndNY(order);

            const startKey = `${order.id}_start`;
            const alertBeforeStart = new Date(startNY.getTime() - 30 * 60 * 1000);
            if (nowNY >= alertBeforeStart && nowNY <= startNY && !serverActiveKeys.has(startKey)) {
              this.acknowledgedKeys.add(startKey);
            }

            const endKey = `${order.id}_end`;
            const alertBeforeEnd = new Date(endNY.getTime() - 30 * 60 * 1000);
            if (nowNY >= alertBeforeEnd && nowNY <= endNY && !serverActiveKeys.has(endKey)) {
              this.acknowledgedKeys.add(endKey);
            }
          }

          // Seed active reminders from server
          for (const r of activeFromServer) {
            const key = `${r.orderId}_${r.type}`;
            if (!this.acknowledgedKeys.has(key) && !this.remindersMap.has(key)) {
              this.remindersMap.set(key, {
                orderId: r.orderId,
                type: r.type as 'start' | 'end',
                message: r.type === 'start'
                  ? `30 min before cleaning starts — check cleaners for Order #${r.orderId}`
                  : `30 min before cleaning ends — check cleaners for Order #${r.orderId}`,
                triggeredAt: new Date(r.triggeredAt)
              });
            }
          }
          this.emitReminders();

          // Now start periodic checking (acknowledgedKeys is populated)
          this.checkReminders();
          this.startPeriodicChecks();
        },
        error: () => {
          // Fallback: just start checking without server state
          this.checkReminders();
          this.startPeriodicChecks();
        }
      });
    } else {
      this.checkReminders();
    }
  }

  private startPeriodicChecks(): void {
    this.checkInterval = setInterval(() => this.checkReminders(), 30000);
    this.refreshInterval = setInterval(() => {
      this.adminService.getAllOrders().subscribe({
        next: (orders) => {
          this.orders = orders as OrderData[];
          this.checkReminders();
        },
        error: () => {}
      });
    }, 5 * 60 * 1000);
  }

  /** Check if a specific order has any active reminder */
  hasActiveReminder(orderId: number): boolean {
    return this.remindersMap.has(`${orderId}_start`) || this.remindersMap.has(`${orderId}_end`);
  }

  /** Get reminder type for an order (for display purposes) */
  getReminderType(orderId: number): 'start' | 'end' | null {
    if (this.remindersMap.has(`${orderId}_start`)) return 'start';
    if (this.remindersMap.has(`${orderId}_end`)) return 'end';
    return null;
  }

  /** Acknowledge a reminder — calls backend and removes locally */
  acknowledgeReminder(orderId: number, type: 'start' | 'end'): void {
    const key = `${orderId}_${type}`;

    // Mark as acknowledged so it never re-triggers
    this.acknowledgedKeys.add(key);

    // Remove locally
    this.remindersMap.delete(key);
    this.emitReminders();

    if (this.remindersMap.size === 0) {
      this.stopNotificationLoop();
      this.stopTitleFlash();
    }

    // Remove from modal if showing
    const current = this.modalReminder$.value;
    if (current && current.orderId === orderId && current.type === type) {
      this.modalReminder$.next(null);
      this.showNextModal();
    }

    // Remove from modal queue
    this.modalQueue = this.modalQueue.filter(r => !(r.orderId === orderId && r.type === type));

    // Always notify backend so it persists in DB (even if no local reminder was active)
    this.adminService.acknowledgeOrderReminder(orderId, type).subscribe({
      error: (err) => console.error('Failed to acknowledge reminder:', err)
    });
  }

  /** Acknowledge all reminders for an order (when admin opens order details) */
  acknowledgeOrder(orderId: number): void {
    this.acknowledgeReminder(orderId, 'start');
    this.acknowledgeReminder(orderId, 'end');
  }

  /** Clean up all intervals */
  destroy(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    this.stopNotificationLoop();
    this.stopTitleFlash();
    if (this.timerWorker) {
      this.timerWorker.terminate();
      this.timerWorker = null;
    }
    this.initialized = false;
  }

  // ── Private methods ───────────────────────────────────

  private getNowInNewYork(): Date {
    const now = new Date();
    const nyString = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
    return new Date(nyString);
  }

  private getOrderStartNY(order: OrderData): Date {
    const d = new Date(order.serviceDate);
    const year = d.getFullYear();
    const month = d.getMonth();
    const day = d.getDate();
    const [hours, minutes] = order.serviceTime.split(':').map(Number);
    return new Date(year, month, day, hours, minutes, 0, 0);
  }

  private getOrderEndNY(order: OrderData): Date {
    const start = this.getOrderStartNY(order);
    return new Date(start.getTime() + order.totalDuration * 60 * 1000);
  }

  private checkReminders(): void {
    if (!this.isBrowser) return;

    const user = this.authService.currentUserValue;
    if (!user) return;
    const role = user.role;
    if (role !== 'SuperAdmin' && role !== 'Admin') return;

    const nowNY = this.getNowInNewYork();
    let newRemindersAdded = false;

    for (const order of this.orders) {
      const status = order.status?.toLowerCase();
      if (status === 'cancelled' || status === 'done') continue;
      if (!order.serviceTime || !order.totalDuration) continue;

      const startNY = this.getOrderStartNY(order);
      const endNY = this.getOrderEndNY(order);

      // 30 minutes before start
      const alertBeforeStart = new Date(startNY.getTime() - 30 * 60 * 1000);
      const startKey = `${order.id}_start`;
      if (!this.remindersMap.has(startKey) &&
          !this.acknowledgedKeys.has(startKey) &&
          nowNY >= alertBeforeStart && nowNY <= startNY) {
        const reminder: OrderReminder = {
          orderId: order.id,
          type: 'start',
          message: `30 min before cleaning starts — check cleaners for Order #${order.id}`,
          triggeredAt: new Date()
        };
        this.remindersMap.set(startKey, reminder);
        newRemindersAdded = true;

        if (role === 'Admin') {
          this.modalQueue.push(reminder);
        }
      }

      // 30 minutes before end
      const alertBeforeEnd = new Date(endNY.getTime() - 30 * 60 * 1000);
      const endKey = `${order.id}_end`;
      if (!this.remindersMap.has(endKey) &&
          !this.acknowledgedKeys.has(endKey) &&
          nowNY >= alertBeforeEnd && nowNY <= endNY) {
        const reminder: OrderReminder = {
          orderId: order.id,
          type: 'end',
          message: `30 min before cleaning ends — check cleaners for Order #${order.id}`,
          triggeredAt: new Date()
        };
        this.remindersMap.set(endKey, reminder);
        newRemindersAdded = true;

        if (role === 'Admin') {
          this.modalQueue.push(reminder);
        }
      }
    }

    // Clean up reminders whose time window has passed
    for (const [key, reminder] of this.remindersMap.entries()) {
      const order = this.orders.find(o => o.id === reminder.orderId);
      if (!order) {
        this.remindersMap.delete(key);
        continue;
      }

      if (reminder.type === 'start') {
        const startNY = this.getOrderStartNY(order);
        if (nowNY > startNY) {
          this.remindersMap.delete(key);
        }
      } else {
        const endNY = this.getOrderEndNY(order);
        if (nowNY > endNY) {
          this.remindersMap.delete(key);
        }
      }
    }

    this.emitReminders();

    if (newRemindersAdded && !this.modalReminder$.value) {
      this.showNextModal();
    }

    if (this.remindersMap.size > 0) {
      this.startNotificationLoop();
      this.startTitleFlash();
    } else {
      this.stopNotificationLoop();
      this.stopTitleFlash();
    }

    // Send browser notification for newly added reminders
    if (newRemindersAdded) {
      const latest = Array.from(this.remindersMap.values()).pop();
      if (latest) {
        this.sendBrowserNotification(latest);
      }
    }
  }

  private showNextModal(): void {
    if (this.modalQueue.length > 0) {
      const next = this.modalQueue.shift()!;
      const key = `${next.orderId}_${next.type}`;
      if (this.remindersMap.has(key)) {
        this.modalReminder$.next(next);
      } else {
        this.showNextModal();
      }
    }
  }

  private emitReminders(): void {
    this.activeReminders$.next(Array.from(this.remindersMap.values()));
  }

  // ── Notification Permission ──────────────────────────

  private requestNotificationPermission(): void {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  private sendBrowserNotification(reminder: OrderReminder): void {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    const title = reminder.type === 'start'
      ? `Order #${reminder.orderId} — Cleaning starts soon`
      : `Order #${reminder.orderId} — Cleaning ends soon`;

    const notification = new Notification(title, {
      body: reminder.message,
      icon: '/images/logo.svg',
      tag: `order-reminder-${reminder.orderId}-${reminder.type}`,
      requireInteraction: true,
      silent: false
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  }

  /** Send a repeating notification with OS sound */
  private sendRepeatingNotification(): void {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    if (this.remindersMap.size === 0) return;

    const first = this.remindersMap.values().next().value;
    if (!first) return;

    const title = first.type === 'start'
      ? `⚠ Order #${first.orderId} — Cleaning starts soon!`
      : `⚠ Order #${first.orderId} — Cleaning ends soon!`;

    const notification = new Notification(title, {
      body: `Check cleaners now! (${this.remindersMap.size} active reminder${this.remindersMap.size > 1 ? 's' : ''})`,
      icon: '/images/logo.svg',
      tag: `order-alert-${Date.now()}`,
      silent: false
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
    };

    setTimeout(() => notification.close(), 2500);
  }

  // ── Web Worker for background-safe timers ────────────

  private createTimerWorker(): void {
    try {
      const workerCode = `
        let titleTimer = null;
        let notifyTimer = null;

        self.onmessage = function(e) {
          const cmd = e.data.command;
          if (cmd === 'startTitle') {
            if (titleTimer) clearInterval(titleTimer);
            titleTimer = setInterval(() => self.postMessage({ type: 'title' }), 1500);
          } else if (cmd === 'stopTitle') {
            if (titleTimer) { clearInterval(titleTimer); titleTimer = null; }
          } else if (cmd === 'startNotify') {
            if (notifyTimer) clearInterval(notifyTimer);
            self.postMessage({ type: 'notify' });
            notifyTimer = setInterval(() => self.postMessage({ type: 'notify' }), 3000);
          } else if (cmd === 'stopNotify') {
            if (notifyTimer) { clearInterval(notifyTimer); notifyTimer = null; }
          }
        };
      `;
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      this.timerWorker = new Worker(URL.createObjectURL(blob));
      this.timerWorker.onmessage = (e) => {
        if (e.data.type === 'title') {
          this.onWorkerTitleTick();
        } else if (e.data.type === 'notify') {
          this.onWorkerNotifyTick();
        }
      };
    } catch (e) {
      this.timerWorker = null;
    }
  }

  private onWorkerTitleTick(): void {
    if (this.remindersMap.size === 0) {
      this.stopTitleFlash();
      return;
    }
    if (this.showingAlertTitle) {
      document.title = this.originalTitle;
      this.showingAlertTitle = false;
    } else {
      const first = this.remindersMap.values().next().value;
      if (first) {
        document.title = first.type === 'start'
          ? `⚠ Check Order #${first.orderId} — starts soon`
          : `⚠ Check Order #${first.orderId} — ends soon`;
      }
      this.showingAlertTitle = true;
    }
  }

  private onWorkerNotifyTick(): void {
    if (this.remindersMap.size === 0) {
      this.stopNotificationLoop();
      return;
    }
    // Send repeating OS notification with sound
    this.sendRepeatingNotification();
  }

  // ── Tab Title Flashing ──────────────────────────────

  private startTitleFlash(): void {
    if (this.titleFlashInterval) return;
    if (!this.showingAlertTitle) {
      this.originalTitle = document.title;
    }

    if (this.timerWorker) {
      this.titleFlashInterval = true;
      this.timerWorker.postMessage({ command: 'startTitle' });
    } else {
      this.titleFlashInterval = setInterval(() => this.onWorkerTitleTick(), 1500);
    }
  }

  private stopTitleFlash(): void {
    if (this.titleFlashInterval) {
      if (this.timerWorker) {
        this.timerWorker.postMessage({ command: 'stopTitle' });
      } else {
        clearInterval(this.titleFlashInterval);
      }
      this.titleFlashInterval = null;
    }
    if (this.showingAlertTitle) {
      document.title = this.originalTitle;
      this.showingAlertTitle = false;
    }
  }

  // ── Notification Loop ─────────────────────────────────

  private startNotificationLoop(): void {
    if (this.notificationInterval) return;

    if (this.timerWorker) {
      this.notificationInterval = true;
      this.timerWorker.postMessage({ command: 'startNotify' });
    } else {
      this.sendRepeatingNotification();
      this.notificationInterval = setInterval(() => this.onWorkerNotifyTick(), 3000);
    }
  }

  private stopNotificationLoop(): void {
    if (this.notificationInterval) {
      if (this.timerWorker) {
        this.timerWorker.postMessage({ command: 'stopNotify' });
      } else {
        clearInterval(this.notificationInterval);
      }
      this.notificationInterval = null;
    }
  }
}
