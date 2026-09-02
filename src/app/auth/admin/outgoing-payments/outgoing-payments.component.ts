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
  OutgoingPaymentPaidFilter,
  AdminSalaryPayoutList,
  AdminSalaryPayout,
  AdminSalaryInstalment
} from '../../../services/outgoing-payment.service';
import { currencySymbol } from '../../../shared/admin/salary-expense.rules';
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

  // ===== Tabs =====
  /**
   * The page pays two different kinds of people. A cleaner is paid per ORDER for hours worked; an
   * employee is paid a monthly salary in two instalments, with no order, hours or rate behind it.
   * Nothing about the two shares a column, a filter or a pager, so they are tabs rather than two
   * blocks stacked on one screen.
   *
   * BOTH are loaded on entry even though only one is on screen: the inactive tab's badge is what
   * says money is still owed over there, and a badge that only appears once you click the tab is
   * no use at all.
   */
  activeTab: 'cleaners' | 'employees' = 'cleaners';

  // ===== Staff salaries (Employees tab) =====
  /**
   * The employees' monthly salaries for the month on screen, each split into the two instalments
   * they are actually paid in.
   *
   * Deliberately NOT touched by the cleaner tab's paid/warnings/search filters. Those describe
   * orders, and carrying them across would mean a search typed on one tab silently emptied the
   * other — which reads as "nobody is owed a salary".
   */
  salaries: AdminSalaryPayoutList | null = null;
  salariesLoading = false;

  /** The instalment a note is being typed for, as "payeeKey|half". Null = no pay dialog open. */
  payingInstalmentKey: string | null = null;
  salaryPaymentNote = '';
  salarySaving = false;

  /** The payee whose payment destination is being edited, by key. Null = nobody. */
  editingDetailsKey: string | null = null;
  detailsInput = '';
  savingDetails = false;
  /** The payee whose destination was just copied, so the button can confirm it. */
  copiedPayeeKey: string | null = null;

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

    this.reloadAll();
  }

  ngOnDestroy(): void {
    if (this.copiedTimer) clearTimeout(this.copiedTimer);
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ===== Loading =====

  /**
   * Reloads both halves of the page. Separate from `load()` because the salaries depend ONLY on
   * the month — re-fetching them on every debounced keystroke in the cleaner search would be
   * pure waste — so only the month controls and an explicit Refresh come through here.
   */
  reloadAll(): void {
    this.loadSalaries();
    this.load();
  }

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

  // ===== Staff salaries =====

  loadSalaries(): void {
    this.salariesLoading = true;
    this.service
      .getSalaries(this.monthAnchor.getFullYear(), this.monthAnchor.getMonth() + 1)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: data => {
          this.salaries = data;
          this.salariesLoading = false;
          this.cdr.markForCheck();
        },
        error: err => {
          // Reported into the section rather than the page-level banner: the cleaner list beside
          // it may have loaded perfectly well, and one failure must not read as both failing.
          this.salaries = null;
          this.salariesLoading = false;
          this.error = extractApiErrorMessage(err, 'Could not load staff salaries');
          this.cdr.markForCheck();
        }
      });
  }

  // ===== Tabs =====

  setTab(tab: 'cleaners' | 'employees'): void {
    if (this.activeTab === tab) return;
    this.activeTab = tab;
    // Both tabs are already loaded, so switching fetches nothing. What it does clear is the
    // transient state of the tab being left — a half-typed payment note or a half-edited account
    // number must not still be sitting there on the way back.
    this.cancelPayInstalment();
    this.cancelEditDetails();
    this.error = '';
  }

  /** What the month still owes on the tab that is NOT on screen — the tab badge. */
  get unpaidForTab(): { cleaners: number; employees: number } {
    return {
      cleaners: this.data?.summary.unpaidPayout ?? 0,
      employees: this.salaries?.unpaidUsd ?? 0
    };
  }

  /** "Still to pay" in the month bar follows the tab you are looking at. */
  get activeTabUnpaid(): number {
    return this.activeTab === 'cleaners' ? this.unpaidForTab.cleaners : this.unpaidForTab.employees;
  }

  instalmentKey(payee: AdminSalaryPayout, instalment: AdminSalaryInstalment): string {
    return `${payee.payeeKey}|${instalment.half}`;
  }

  isPayingInstalment(payee: AdminSalaryPayout, instalment: AdminSalaryInstalment): boolean {
    return this.payingInstalmentKey === this.instalmentKey(payee, instalment);
  }

  /** Opens the note box for one instalment. Nothing is recorded until it is confirmed. */
  startPayInstalment(payee: AdminSalaryPayout, instalment: AdminSalaryInstalment): void {
    this.payingInstalmentKey = this.instalmentKey(payee, instalment);
    this.salaryPaymentNote = '';
    this.error = '';
  }

  cancelPayInstalment(): void {
    this.payingInstalmentKey = null;
    this.salaryPaymentNote = '';
  }

  confirmPayInstalment(payee: AdminSalaryPayout, instalment: AdminSalaryInstalment): void {
    if (this.salarySaving) return;
    this.salarySaving = true;

    this.service
      .markSalaryPaid(
        this.salaries!.year, this.salaries!.month, instalment.half, payee.payeeKey,
        { paymentNote: this.salaryPaymentNote.trim() || null })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        // The write answers with the WHOLE month, so the section redraws from one response
        // instead of being patched in place and drifting from the server.
        next: data => this.afterSalaryWrite(data, `${payee.name} — ${instalment.label} recorded`),
        error: err => this.afterSalaryError(err, 'Could not record that payment')
      });
  }

  undoInstalment(payee: AdminSalaryPayout, instalment: AdminSalaryInstalment): void {
    if (this.salarySaving) return;
    this.salarySaving = true;

    this.service
      .undoSalaryPayment(this.salaries!.year, this.salaries!.month, instalment.half, payee.payeeKey)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: data => this.afterSalaryWrite(data, `${payee.name} — ${instalment.label} undone`),
        error: err => this.afterSalaryError(err, 'Could not undo that payment')
      });
  }

  private afterSalaryWrite(data: AdminSalaryPayoutList, message: string): void {
    this.salaries = data;
    this.salarySaving = false;
    this.payingInstalmentKey = null;
    this.salaryPaymentNote = '';
    this.flash(message);
    this.cdr.markForCheck();
  }

  private afterSalaryError(err: unknown, fallback: string): void {
    this.salarySaving = false;
    this.error = extractApiErrorMessage(err, fallback);
    this.cdr.markForCheck();
  }

  // ── Where the salary is sent ───────────────────────────────────────────────
  //
  // An IBAN, a bank card or an ID number — whatever the person is paid against. Free text on
  // purpose: the format differs by country and by person, and validating one we cannot know
  // would block a real payment.

  startEditDetails(payee: AdminSalaryPayout): void {
    this.editingDetailsKey = payee.payeeKey;
    this.detailsInput = payee.paymentDetails ?? '';
    this.error = '';
  }

  cancelEditDetails(): void {
    this.editingDetailsKey = null;
    this.detailsInput = '';
  }

  isEditingDetails(payee: AdminSalaryPayout): boolean {
    return this.editingDetailsKey === payee.payeeKey;
  }

  saveDetails(payee: AdminSalaryPayout): void {
    if (this.savingDetails) return;
    this.savingDetails = true;

    this.service
      // An empty box CLEARS it. A destination that turns out to be wrong has to be removable,
      // not only replaceable — a stale account number on file is how money goes astray.
      .updateSalaryPayeeDetails(
        this.salaries!.year, this.salaries!.month, payee.payeeKey, this.detailsInput.trim() || null)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: data => {
          this.salaries = data;
          this.savingDetails = false;
          this.editingDetailsKey = null;
          this.detailsInput = '';
          this.flash(`${payee.name} — payment details saved`);
          this.cdr.markForCheck();
        },
        error: err => {
          this.savingDetails = false;
          this.error = extractApiErrorMessage(err, 'Could not save those payment details');
          this.cdr.markForCheck();
        }
      });
  }

  /**
   * Copies the destination ALONE — no name, no label. It is being pasted into a banking app,
   * where anything in front of the account number makes the paste useless. Same rule as the
   * cleaner payout panel.
   */
  copySalaryDetails(payee: AdminSalaryPayout): void {
    this.copyText(payee.paymentDetails ?? null, () => {
      this.copiedPayeeKey = payee.payeeKey;
      this.armCopiedTimer(() => { this.copiedPayeeKey = null; });
    });
  }

  isDetailsCopied(payee: AdminSalaryPayout): boolean {
    return this.copiedPayeeKey === payee.payeeKey;
  }

  /** Display only — the server sends both the entered amount and its USD equivalent. */
  salarySymbol(currency: string | null | undefined): string {
    return currencySymbol(currency);
  }

  /** True when the amount is in a currency the USD figure had to be converted from. */
  isConverted(currency: string | null | undefined): boolean {
    return (currency ?? 'USD').toUpperCase() !== 'USD';
  }

  salaryStatusLabel(payee: AdminSalaryPayout): string {
    if (payee.isFullyPaid) return 'Paid';
    if (payee.isPartiallyPaid) return 'Part paid';
    return 'Unpaid';
  }

  /**
   * Amber = unpaid, blue = part paid, green = paid — the same mapping the cleaner rows use.
   * Never red: an unpaid salary is work outstanding, not an error.
   */
  salaryStatusClass(payee: AdminSalaryPayout): string {
    if (payee.isFullyPaid) return 'status-done';
    if (payee.isPartiallyPaid) return 'status-active';
    return 'status-pending';
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
    this.reloadAll();
  }

  nextMonth(): void {
    this.monthAnchor = new Date(this.monthAnchor.getFullYear(), this.monthAnchor.getMonth() + 1, 1);
    this.page = 1;
    this.reloadAll();
  }

  goToCurrentMonth(): void {
    this.monthAnchor = this.startOfMonth(new Date());
    this.page = 1;
    this.reloadAll();
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
   * A PER-CLEANER duration — formatted WITHOUT re-rounding. These minutes came from the same
   * function the salary was computed from and are already snapped to the 30-minute increment, so
   * re-rounding could only make the label contradict the money beside it.
   */
  formatDuration(minutes: number): string {
    return DurationUtils.formatMinutes(minutes || 0);
  }

  /**
   * The ORDER's total duration, rounded the way every other customer- and admin-facing surface
   * rounds it (nearest 30 minutes). The stored total can be an odd figure like 370 minutes; the
   * rest of the app shows that as "6h", and a payouts page reading "6h 10m" beside it looks wrong
   * even though both are true.
   */
  formatTotalDuration(minutes: number): string {
    return DurationUtils.formatDurationRounded(minutes || 0);
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
    this.copyText(this.payoutDetails(cleaner), () => {
      this.copiedCleanerId = cleaner.orderCleanerId;
      this.armCopiedTimer(() => { this.copiedCleanerId = null; });
    });
  }

  /**
   * The copy mechanism itself, shared by the cleaner rows and the employee tab — there is one
   * account number being pasted into a banking app either way, and two copies of the fallback
   * would be free to diverge on the failure path, which is the half that matters.
   */
  private copyText(text: string | null, confirmCopied: () => void): void {
    if (!text || !isPlatformBrowser(this.platformId)) return;

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

  /** Clears the "copied" tick after a moment — one that never goes away stops meaning anything. */
  private armCopiedTimer(clear: () => void): void {
    if (this.copiedTimer) clearTimeout(this.copiedTimer);
    this.copiedTimer = setTimeout(() => {
      clear();
      this.cdr.markForCheck();
    }, 2000);
    this.cdr.markForCheck();
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

  /**
   * How the CUSTOMER settled, when it was not a card — just "Cash" / "Zelle" / "Check". The tag
   * sits beside the service type where a "Paid by" prefix only ate column width; the tooltip
   * carries the full sentence for anyone who needs it.
   */
  customerPaymentNote(order: OutgoingPaymentOrder): string {
    return (order.paymentMethod && order.paymentMethod !== 'Normal') ? order.paymentMethod : '';
  }

  /** The full sentence, for the tag's tooltip. */
  customerPaymentTitle(order: OutgoingPaymentOrder): string {
    const method = this.customerPaymentNote(order);
    return method ? `The customer paid by ${method.toLowerCase()}` : '';
  }

  /** Every payout line on the order — assigned first, then the unassigned staffing slots. */
  allPayoutLines(order: OutgoingPaymentOrder): OutgoingPaymentCleaner[] {
    return [...order.cleaners, ...(order.unassignedCleaners || [])];
  }

  /** True when the job was staffed for more people than are on file. */
  hasUnassignedSlots(order: OutgoingPaymentOrder): boolean {
    return (order.unassignedCleaners?.length ?? 0) > 0;
  }

  /**
   * "(2) Irma Xar., Maia Nia." — or "(2 of 3)" when the job was staffed for more people than are
   * recorded, so the row says up front that the list is incomplete.
   */
  cleanerCountLabel(order: OutgoingPaymentOrder): string {
    return this.hasUnassignedSlots(order)
      ? `(${order.cleaners.length} of ${order.splitCount})`
      : `(${order.cleaners.length})`;
  }

  // ===== Payment status pill =====
  //
  // Reuses the Orders tab's .status-badge colours: amber = still to do, blue = part done,
  // green = done. Deliberately NOT red — an unpaid cleaner is work outstanding, not an error.

  // The pill counts EVERY payout line, named or not — an unassigned slot is a real payout that
  // can be recorded, so an order is only "Paid" once all of them are settled.

  payStatusLabel(order: OutgoingPaymentOrder): string {
    if (this.allPayoutLines(order).length === 0) return 'No payouts';
    if (order.isFullyPaid) return 'Paid';
    if (order.isPartiallyPaid) return 'Part paid';
    return 'Unpaid';
  }

  payStatusClass(order: OutgoingPaymentOrder): string {
    if (this.allPayoutLines(order).length === 0) return 'status-cancelled';
    if (order.isFullyPaid) return 'status-done';
    if (order.isPartiallyPaid) return 'status-active';
    return 'status-pending';
  }

  payStatusTitle(order: OutgoingPaymentOrder): string {
    const lines = this.allPayoutLines(order);
    if (lines.length === 0) return 'This order has no payouts recorded against it';

    const unpaid = lines.filter(c => !c.isPaid);
    if (unpaid.length === 0) return 'Every payout on this order has been recorded';
    return `${unpaid.length} of ${lines.length} payout(s) still to record`;
  }

  trackByOrder = (_: number, order: OutgoingPaymentOrder) => order.orderId;
  trackByCleaner = (_: number, cleaner: OutgoingPaymentCleaner) => cleaner.orderCleanerId;
  /** Unassigned slots share orderCleanerId 0, so they track by slot index instead. */
  trackBySlot = (_: number, slot: OutgoingPaymentCleaner) => slot.slotIndex ?? _;

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

  /**
   * Everything "Mark all paid" will settle — assigned cleaners AND unassigned staffing slots,
   * because the endpoint pays both. Listing only the named ones would understate the total the
   * modal is asking you to confirm.
   */
  get unpaidInPayOrder(): OutgoingPaymentCleaner[] {
    return this.payOrder ? this.allPayoutLines(this.payOrder).filter(c => !c.isPaid) : [];
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

    const body = {
      paidVia: this.payVia ? CLEANER_PAYMENT_METHOD_INDEX[this.payVia] : null,
      paymentNote: this.payNote.trim() || null
    };

    // An unassigned slot has no assignment id, so it is addressed by its slot index instead.
    const request = !this.payCleaner
      ? this.service.markOrderPaid(order.orderId, { paymentNote: body.paymentNote })
      : this.payCleaner.isUnassigned
        ? this.service.markUnassignedSlotPaid(order.orderId, this.payCleaner.slotIndex ?? 0, body)
        : this.service.markCleanerPaid(order.orderId, this.payCleaner.orderCleanerId, body);

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

    const request = cleaner.isUnassigned
      ? this.service.undoUnassignedSlotPayment(order.orderId, cleaner.slotIndex ?? 0)
      : this.service.undoCleanerPayment(order.orderId, cleaner.orderCleanerId);

    request
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
