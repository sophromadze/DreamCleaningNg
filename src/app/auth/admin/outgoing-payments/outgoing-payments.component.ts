import { Component, OnInit, OnDestroy, ChangeDetectorRef, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';

import {
  OutgoingPaymentService,
  OutgoingPaymentList,
  OutgoingPaymentOrder,
  OutgoingPaymentCleaner,
  OutgoingPaymentPaidFilter
} from '../../../services/outgoing-payment.service';
import {
  CleanerPaymentMethod,
  CLEANER_PAYMENT_METHOD_INDEX,
  normalizeCleanerPaymentMethod
} from '../../../services/cleaner-management.service';
import { DurationUtils } from '../../../utils/duration.utils';
import { extractApiErrorMessage } from '../../../utils/http-error.utils';
import { resolveServiceTypeShortLabel } from '../../../shared/admin/service-type-short-label';

/**
 * Outgoing Payments (SuperAdmin) — what we owe cleaners for finished jobs, and the record of
 * paying it.
 *
 * Laid out like the admin Orders tab: a compact row per order, 20 to a page, and everything else
 * behind a right-hand slide-in panel. A busy month runs to 60+ cleanings, so a card per job
 * turned the page into a scroll. The row carries only what you need to decide whether to open it
 * — order, date, service type, who cleaned it, duration, total, payout, paid/unpaid, and a ⚠ if
 * something needs a look; the full WhatsApp-style breakdown lives in the panel.
 *
 * `orders.component.scss` is listed FIRST in styleUrls so the table, panel, badges and pagination
 * come from the Orders tab rather than being re-invented; this component's own stylesheet holds
 * only what is unique to payouts. Same arrangement order-edit uses with booking.component.scss.
 *
 * Two rules the UI has to keep:
 *
 *  - Every figure comes from the server. The component formats and never recomputes; a local
 *    "helpful" recalculation is exactly how the number on screen starts disagreeing with the
 *    number that was paid.
 *  - A PAID line is frozen. Rate and hours are read-only until the payment is undone, because
 *    the recorded amount is a historical fact about money that already left.
 */
@Component({
  selector: 'app-outgoing-payments',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './outgoing-payments.component.html',
  styleUrls: ['../orders/orders.component.scss', './outgoing-payments.component.scss']
})
export class OutgoingPaymentsComponent implements OnInit, OnDestroy {
  data: OutgoingPaymentList | null = null;
  loading = false;
  error = '';
  successMessage = '';

  // ===== Filters =====
  /** First day of the month on screen. Opens on the current month — the recent jobs are the ones being paid. */
  monthAnchor: Date = this.startOfMonth(new Date());
  paidStatus: OutgoingPaymentPaidFilter = 'all';
  warningsOnly = false;
  searchTerm = '';

  page = 1;
  /** 20 a page, matching the Orders tab. */
  readonly pageSize = 20;

  private readonly search$ = new Subject<string>();
  private readonly destroy$ = new Subject<void>();

  // ===== Slide-in panel =====
  /**
   * The panel holds its OWN copy of the order rather than pointing into `data.orders`. A write
   * reloads the list, and under the Unpaid filter the order being paid legitimately drops out of
   * it — pointing into the list would slam the panel shut in the middle of the job.
   */
  selectedOrder: OutgoingPaymentOrder | null = null;
  selectedOrderId: number | null = null;

  // ===== Order-level hourly rate =====
  /** True while the order's rate (the default every un-overridden cleaner follows) is being edited. */
  editingOrderRate = false;
  orderRateInput: number | null = null;
  savingOrderRate = false;

  // ===== Inline rate/hours editing =====
  /** `${orderId}:${orderCleanerId}` of the line being edited, or null. Only one line at a time. */
  editingKey: string | null = null;
  editRate: number | null = null;
  editHours: number | null = null;
  savingEdit = false;

  // ===== Pay modal =====
  payOrder: OutgoingPaymentOrder | null = null;
  /** null when paying the WHOLE order; a cleaner when paying one line. */
  payCleaner: OutgoingPaymentCleaner | null = null;
  payVia: CleanerPaymentMethod | '' = '';
  payNote = '';
  paying = false;

  readonly paymentMethodOptions: { value: CleanerPaymentMethod | ''; label: string }[] = [
    { value: '', label: 'Not recorded' },
    { value: 'Zelle', label: 'Zelle' },
    { value: 'Cash', label: 'Cash' },
    { value: 'Check', label: 'Check' },
    { value: 'Other', label: 'Other' }
  ];

  /**
   * `${orderCleanerId}` whose payment details were just copied, so the button can confirm it.
   * Cleared on a timer — a tick that never goes away stops meaning anything.
   */
  copiedCleanerId: number | null = null;
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private service: OutgoingPaymentService,
    private cdr: ChangeDetectorRef,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {}

  ngOnInit(): void {
    this.search$
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(() => {
        this.page = 1;
        this.load();
      });

    this.load();
  }

  ngOnDestroy(): void {
    if (this.copiedTimer) clearTimeout(this.copiedTimer);
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ===== Loading =====

  load(): void {
    this.loading = true;
    this.error = '';

    this.service
      .getPayments({
        from: this.toDateParam(this.monthAnchor),
        to: this.toDateParam(this.endOfMonth(this.monthAnchor)),
        paidStatus: this.paidStatus,
        warningsOnly: this.warningsOnly,
        search: this.searchTerm,
        page: this.page,
        pageSize: this.pageSize
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: data => {
          this.data = data;
          this.loading = false;
          this.cdr.markForCheck();
        },
        error: err => {
          this.error = extractApiErrorMessage(err, 'Could not load outgoing payments.');
          this.loading = false;
          this.cdr.markForCheck();
        }
      });
  }

  onSearchChange(value: string): void {
    this.searchTerm = value;
    this.search$.next(value);
  }

  setPaidStatus(status: OutgoingPaymentPaidFilter): void {
    if (this.paidStatus === status) return;
    this.paidStatus = status;
    this.page = 1;
    this.load();
  }

  toggleWarningsOnly(): void {
    this.warningsOnly = !this.warningsOnly;
    this.page = 1;
    this.load();
  }

  // ===== Panel =====

  openPanel(order: OutgoingPaymentOrder): void {
    this.selectedOrder = order;
    this.selectedOrderId = order.orderId;
    this.cancelEdit();
    this.cancelOrderRateEdit();
    this.error = '';
  }

  closePanel(): void {
    this.selectedOrder = null;
    this.selectedOrderId = null;
    this.cancelEdit();
    this.cancelOrderRateEdit();
  }

  // ===== Month navigation =====

  prevMonth(): void {
    this.monthAnchor = new Date(this.monthAnchor.getFullYear(), this.monthAnchor.getMonth() - 1, 1);
    this.page = 1;
    this.load();
  }

  nextMonth(): void {
    this.monthAnchor = new Date(this.monthAnchor.getFullYear(), this.monthAnchor.getMonth() + 1, 1);
    this.page = 1;
    this.load();
  }

  goToCurrentMonth(): void {
    this.monthAnchor = this.startOfMonth(new Date());
    this.page = 1;
    this.load();
  }

  get isCurrentMonth(): boolean {
    const now = this.startOfMonth(new Date());
    return this.monthAnchor.getFullYear() === now.getFullYear()
      && this.monthAnchor.getMonth() === now.getMonth();
  }

  get monthLabel(): string {
    return this.monthAnchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  // ===== Paging =====

  get totalPages(): number {
    if (!this.data) return 1;
    return Math.max(1, Math.ceil(this.data.totalCount / this.data.pageSize));
  }

  /** Up to 7 page buttons centred on the current page — the Orders tab's pagination shape. */
  get pageWindow(): number[] {
    const total = this.totalPages;
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

    const start = Math.max(1, Math.min(this.page - 3, total - 6));
    return Array.from({ length: 7 }, (_, i) => start + i);
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages || page === this.page) return;
    this.page = page;
    this.load();
  }

  // ===== Display helpers =====

  /**
   * Durations are formatted WITHOUT re-rounding: the minutes came from the same function the
   * salary was computed from, and a label that re-rounds ends up contradicting the money beside it.
   */
  formatDuration(minutes: number): string {
    return DurationUtils.formatMinutes(minutes || 0);
  }

  /** "4.50" — the hours figure in the "$21 × 4.50 = $94.50" working. */
  hoursOf(minutes: number): string {
    return ((minutes || 0) / 60).toFixed(2);
  }

  /** "$21 × 4.50 = $94.50" — the whole point of the panel, shown per cleaner. */
  salaryWorking(cleaner: OutgoingPaymentCleaner): string {
    const rate = (cleaner.hourlyRate ?? 0).toFixed(2).replace(/\.00$/, '');
    return `$${rate} × ${this.hoursOf(cleaner.billableMinutes)} = $${(cleaner.salary ?? 0).toFixed(2)}`;
  }

  cleanerName(cleaner: OutgoingPaymentCleaner): string {
    return `${cleaner.firstName} ${cleaner.lastName}`.trim() || `Cleaner #${cleaner.cleanerId}`;
  }

  /** Full names for the row's title tooltip. */
  cleanerNamesFull(order: OutgoingPaymentOrder): string {
    return order.cleaners.map(c => this.cleanerName(c)).join(', ');
  }

  /**
   * "Irma Xar., Maia Nia." — abbreviated surnames keep the narrow column on one line, the same
   * trick the Orders tab's cleaners column uses. The full names stay in the tooltip.
   */
  cleanerNamesShort(order: OutgoingPaymentOrder): string {
    return order.cleaners
      .map(c => {
        const first = (c.firstName || '').trim();
        const last = (c.lastName || '').trim();
        if (!last) return first || `#${c.cleanerId}`;
        return `${first} ${last.length > 4 ? last.slice(0, 3) + '.' : last}`.trim();
      })
      .join(', ');
  }

  methodLabel(value: CleanerPaymentMethod | number | null | undefined): string {
    return normalizeCleanerPaymentMethod(value) ?? '';
  }

  /** "Zelle · 6465550134", or empty when nothing is on file. */
  payoutDestination(cleaner: OutgoingPaymentCleaner): string {
    const method = this.methodLabel(cleaner.paymentMethod);
    const details = (cleaner.paymentDetails || '').trim();
    if (!method && !details) return '';
    if (!details) return method;
    return method ? `${method} · ${details}` : details;
  }

  /** Just the destination — the Zelle number / payee name, with no method prefix. */
  payoutDetails(cleaner: OutgoingPaymentCleaner): string {
    return (cleaner.paymentDetails || '').trim();
  }

  /**
   * Copies a cleaner's payment destination. What gets copied is the DETAILS ALONE — a Zelle
   * number is pasted into a banking app, and "Zelle · " in front of it makes the paste useless.
   *
   * `navigator.clipboard` needs a browser and a secure context; the execCommand fallback covers
   * the rest, and a failure sets an error rather than pretending it worked, because somebody is
   * about to paste an account number somewhere.
   */
  copyPaymentDetails(cleaner: OutgoingPaymentCleaner): void {
    const text = this.payoutDetails(cleaner);
    if (!text || !isPlatformBrowser(this.platformId)) return;

    const confirmCopied = () => {
      this.copiedCleanerId = cleaner.orderCleanerId;
      if (this.copiedTimer) clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => {
        this.copiedCleanerId = null;
        this.cdr.markForCheck();
      }, 2000);
      this.cdr.markForCheck();
    };

    const fallback = () => {
      try {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(area);
        if (ok) confirmCopied();
        else this.error = 'Could not copy that — select it and copy by hand.';
      } catch {
        this.error = 'Could not copy that — select it and copy by hand.';
      }
      this.cdr.markForCheck();
    };

    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(confirmCopied, fallback);
      return;
    }

    fallback();
  }

  isCopied(cleaner: OutgoingPaymentCleaner): boolean {
    return this.copiedCleanerId === cleaner.orderCleanerId;
  }

  /**
   * The SHORT table label — "Regular" / "Deep" / "Move In/Out" / "Construction" — from the same
   * shared function the Orders tab uses, so the two tables can never label one order differently.
   * The full name still travels on the DTO for the warning sentences, which want it spelled out.
   */
  serviceTypeShort(order: OutgoingPaymentOrder): string {
    return resolveServiceTypeShortLabel({
      serviceTypeName: order.rawServiceTypeName,
      isCustomServiceType: order.isCustomServiceType,
      customServiceDisplayName: order.customServiceDisplayName,
      isDeepCleaning: order.isDeepCleaning
    });
  }

  /** "DoneM" for a Done order settled outside Stripe — the same label the orders panel shows. */
  statusLabel(order: OutgoingPaymentOrder): string {
    if (order.status === 'Refunded') return 'Refunded';
    return (order.paymentMethod && order.paymentMethod !== 'Normal') ? 'DoneM' : 'Done';
  }

  /** The "Paid by cash" note from the WhatsApp messages, when it applies. */
  customerPaymentNote(order: OutgoingPaymentOrder): string {
    return (order.paymentMethod && order.paymentMethod !== 'Normal')
      ? `Paid by ${order.paymentMethod.toLowerCase()}`
      : '';
  }

  // ===== Payment status pill =====
  //
  // Reuses the Orders tab's .status-badge colours: amber = still to do, blue = part done,
  // green = done. Deliberately NOT red — an unpaid cleaner is work outstanding, not an error.

  payStatusLabel(order: OutgoingPaymentOrder): string {
    if (order.cleaners.length === 0) return 'No cleaners';
    if (order.isFullyPaid) return 'Paid';
    if (order.isPartiallyPaid) return 'Part paid';
    return 'Unpaid';
  }

  payStatusClass(order: OutgoingPaymentOrder): string {
    if (order.cleaners.length === 0) return 'status-cancelled';
    if (order.isFullyPaid) return 'status-done';
    if (order.isPartiallyPaid) return 'status-active';
    return 'status-pending';
  }

  payStatusTitle(order: OutgoingPaymentOrder): string {
    if (order.cleaners.length === 0) return 'Nobody is assigned to this order';
    const unpaid = order.cleaners.filter(c => !c.isPaid);
    if (unpaid.length === 0) return 'Every cleaner on this order has been paid';
    return `${unpaid.length} of ${order.cleaners.length} cleaner(s) still to pay`;
  }

  trackByOrder = (_: number, order: OutgoingPaymentOrder) => order.orderId;
  trackByCleaner = (_: number, cleaner: OutgoingPaymentCleaner) => cleaner.orderCleanerId;

  // ===== Order-level hourly rate =====

  startEditOrderRate(order: OutgoingPaymentOrder): void {
    this.editingOrderRate = true;
    this.orderRateInput = order.orderHourlyRate;
    this.error = '';
  }

  cancelOrderRateEdit(): void {
    this.editingOrderRate = false;
    this.orderRateInput = null;
  }

  /** How many cleaners on this order actually follow the order rate (i.e. carry no override). */
  cleanersOnOrderRate(order: OutgoingPaymentOrder): number {
    return order.cleaners.filter(c => !c.rateOverridden).length;
  }

  /** Cleaners the order rate will NOT move, because they carry their own. */
  cleanersWithOwnRate(order: OutgoingPaymentOrder): number {
    return order.cleaners.filter(c => c.rateOverridden).length;
  }

  /**
   * Writes the new order rate through to `Order.CleanerHourlyRate`. Every assigned cleaner
   * without their own rate moves with it, and the order's reported labour cost is re-summed
   * server-side — so Statistics and Finances pick it up with no further action.
   */
  saveOrderRate(order: OutgoingPaymentOrder): void {
    if (this.savingOrderRate) return;

    const rate = this.orderRateInput;
    if (rate == null || rate < 0) {
      this.error = 'An hourly rate must be zero or more.';
      return;
    }

    this.savingOrderRate = true;
    this.error = '';

    this.service
      .updateOrderHourlyRate(order.orderId, rate)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: updated => {
          this.applyUpdatedOrder(updated);
          this.cancelOrderRateEdit();
          this.savingOrderRate = false;
          this.flash(`Order #${order.orderId} now pays $${rate}/hr.`);
        },
        error: err => {
          this.error = extractApiErrorMessage(err, 'Could not change the hourly rate.');
          this.savingOrderRate = false;
          this.cdr.markForCheck();
        }
      });
  }

  // ===== Inline editing =====

  editKey(order: OutgoingPaymentOrder, cleaner: OutgoingPaymentCleaner): string {
    return `${order.orderId}:${cleaner.orderCleanerId}`;
  }

  isEditing(order: OutgoingPaymentOrder, cleaner: OutgoingPaymentCleaner): boolean {
    return this.editingKey === this.editKey(order, cleaner);
  }

  startEdit(order: OutgoingPaymentOrder, cleaner: OutgoingPaymentCleaner): void {
    if (cleaner.isPaid) return;
    this.editingKey = this.editKey(order, cleaner);
    // Seeded with what is IN FORCE, not with the override — so an untouched line shows the
    // automatic figure and saving it unchanged is a no-op rather than a surprise pin.
    this.editRate = cleaner.hourlyRate;
    this.editHours = Number(this.hoursOf(cleaner.billableMinutes));
    this.error = '';
  }

  cancelEdit(): void {
    this.editingKey = null;
    this.editRate = null;
    this.editHours = null;
  }

  saveEdit(order: OutgoingPaymentOrder, cleaner: OutgoingPaymentCleaner): void {
    if (!this.isEditing(order, cleaner) || this.savingEdit) return;

    const rate = this.editRate;
    const hours = this.editHours;

    if (rate == null || rate < 0 || hours == null || hours < 0) {
      this.error = 'Rate and hours must both be zero or more.';
      return;
    }

    this.savingEdit = true;
    this.error = '';

    this.service
      .updateCleanerPayroll(order.orderId, cleaner.orderCleanerId, {
        hourlyRate: rate,
        billableMinutes: Math.round(hours * 60),
        updateHourlyRate: true,
        updateBillableMinutes: true
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: updated => {
          this.applyUpdatedOrder(updated);
          this.cancelEdit();
          this.savingEdit = false;
          this.flash(`Updated ${this.cleanerName(cleaner)}'s pay on order #${order.orderId}.`);
        },
        error: err => {
          this.error = extractApiErrorMessage(err, 'Could not save that change.');
          this.savingEdit = false;
          this.cdr.markForCheck();
        }
      });
  }

  /**
   * Drops both overrides so the line goes back to following the order. Distinct from typing the
   * automatic numbers back in by hand: a cleared override keeps tracking the order if it is
   * re-priced later, a re-typed one does not.
   */
  resetToAutomatic(order: OutgoingPaymentOrder, cleaner: OutgoingPaymentCleaner): void {
    if (cleaner.isPaid || this.savingEdit) return;

    this.savingEdit = true;
    this.service
      .updateCleanerPayroll(order.orderId, cleaner.orderCleanerId, {
        hourlyRate: null,
        billableMinutes: null,
        updateHourlyRate: true,
        updateBillableMinutes: true
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: updated => {
          this.applyUpdatedOrder(updated);
          this.cancelEdit();
          this.savingEdit = false;
          this.flash(`${this.cleanerName(cleaner)} is back on the order's automatic rate and hours.`);
        },
        error: err => {
          this.error = extractApiErrorMessage(err, 'Could not reset that line.');
          this.savingEdit = false;
          this.cdr.markForCheck();
        }
      });
  }

  // ===== Paying =====

  openPayCleaner(order: OutgoingPaymentOrder, cleaner: OutgoingPaymentCleaner): void {
    this.payOrder = order;
    this.payCleaner = cleaner;
    // Default to the cleaner's saved method — it is what will be used if nothing is picked.
    this.payVia = this.methodLabel(cleaner.paymentMethod) as CleanerPaymentMethod | '';
    this.payNote = '';
    this.error = '';
  }

  openPayOrder(order: OutgoingPaymentOrder): void {
    this.payOrder = order;
    this.payCleaner = null;
    // A "pay all" is one action, not one channel: each cleaner is recorded against their OWN
    // saved method, so there is no single method to pick here.
    this.payVia = '';
    this.payNote = '';
    this.error = '';
  }

  closePayModal(): void {
    if (this.paying) return;
    this.payOrder = null;
    this.payCleaner = null;
    this.payNote = '';
  }

  get unpaidInPayOrder(): OutgoingPaymentCleaner[] {
    return this.payOrder?.cleaners.filter(c => !c.isPaid) ?? [];
  }

  get payModalTotal(): number {
    if (this.payCleaner) return this.payCleaner.payout;
    return this.unpaidInPayOrder.reduce((sum, c) => sum + (c.payout || 0), 0);
  }

  confirmPay(): void {
    const order = this.payOrder;
    if (!order || this.paying) return;

    this.paying = true;
    this.error = '';

    const request = this.payCleaner
      ? this.service.markCleanerPaid(order.orderId, this.payCleaner.orderCleanerId, {
          paidVia: this.payVia ? CLEANER_PAYMENT_METHOD_INDEX[this.payVia] : null,
          paymentNote: this.payNote.trim() || null
        })
      : this.service.markOrderPaid(order.orderId, { paymentNote: this.payNote.trim() || null });

    const who = this.payCleaner ? this.cleanerName(this.payCleaner) : `everyone on order #${order.orderId}`;

    request.pipe(takeUntil(this.destroy$)).subscribe({
      next: updated => {
        this.applyUpdatedOrder(updated);
        this.paying = false;
        this.payOrder = null;
        this.payCleaner = null;
        this.payNote = '';
        this.flash(`Marked ${who} as paid.`);
      },
      error: err => {
        this.error = extractApiErrorMessage(err, 'Could not record that payment.');
        this.paying = false;
        this.cdr.markForCheck();
      }
    });
  }

  undoPayment(order: OutgoingPaymentOrder, cleaner: OutgoingPaymentCleaner): void {
    if (!confirm(`Undo the payment recorded for ${this.cleanerName(cleaner)} on order #${order.orderId}?`)) return;

    this.service
      .undoCleanerPayment(order.orderId, cleaner.orderCleanerId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: updated => {
          this.applyUpdatedOrder(updated);
          this.flash(`Payment for ${this.cleanerName(cleaner)} was undone.`);
        },
        error: err => {
          this.error = extractApiErrorMessage(err, 'Could not undo that payment.');
          this.cdr.markForCheck();
        }
      });
  }

  // ===== internals =====

  /**
   * Swaps one refreshed order into the row list and, when it is the one on screen, into the panel.
   *
   * The page-wide SUMMARY is then reloaded rather than patched: it spans the whole filtered range,
   * and reconstructing it from one order would be a second implementation of the totals, free to
   * drift from the server's. The panel keeps its own copy across that reload — under the Unpaid
   * filter, paying the last cleaner legitimately removes the order from the list, and the panel
   * must not vanish mid-job.
   */
  private applyUpdatedOrder(updated: OutgoingPaymentOrder): void {
    if (this.data) {
      const index = this.data.orders.findIndex(o => o.orderId === updated.orderId);
      if (index >= 0) this.data.orders[index] = updated;
    }

    if (this.selectedOrderId === updated.orderId) this.selectedOrder = updated;
    if (this.payOrder?.orderId === updated.orderId) this.payOrder = updated;

    this.load();
  }

  private flash(message: string): void {
    this.successMessage = message;
    this.cdr.markForCheck();
    setTimeout(() => {
      this.successMessage = '';
      this.cdr.markForCheck();
    }, 4000);
  }

  private startOfMonth(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  private endOfMonth(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0);
  }

  /** yyyy-MM-dd from LOCAL parts — toISOString would shift the boundary a day in NY. */
  private toDateParam(date: Date): string {
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
  }
}
