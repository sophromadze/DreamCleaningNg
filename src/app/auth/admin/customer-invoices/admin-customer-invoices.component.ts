import { Component, Input, OnDestroy, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, takeUntil } from 'rxjs';
import { UserAdmin } from '../../../services/admin.service';
import {
  CUSTOMER_INVOICE_STATUS_LABELS,
  CustomerInvoice,
  CustomerInvoiceOrderOption,
  CustomerInvoiceService,
  CustomerInvoiceStatus
} from '../../../services/customer-invoice.service';
import { AdminUserSearchComponent } from '../../../booking/admin-user-search/admin-user-search.component';
import { extractApiErrorMessage } from '../../../utils/http-error.utils';

/** How the money arrived when an admin marks an invoice paid by hand. */
export const MANUAL_PAYMENT_OPTIONS = [
  { value: 'BankTransfer', label: 'Bank transfer' },
  { value: 'Zelle', label: 'Zelle' },
  { value: 'Cash', label: 'Cash' },
  { value: 'Check', label: 'Check' },
  { value: 'Other', label: 'Other' }
] as const;

/**
 * Admin → Invoices (2026-09): REGULAR invoices for ordinary customers — always the last tab.
 *
 * One invoice bills one order: either its whole balance, or — when the customer asked to split
 * the payment — one invoice per agreed amount. Every invoice is backed by a part-payment request
 * on the order, so the customer's card payment and an admin recording a bank transfer both settle
 * the order through the paths that already exist. This screen never computes a status or a
 * balance; it renders what the server derived.
 *
 * Commercial invoices (companies, ACH, contracts) stay in Commercial → Invoices.
 */
@Component({
  selector: 'app-admin-customer-invoices',
  standalone: true,
  imports: [CommonModule, FormsModule, AdminUserSearchComponent],
  templateUrl: './admin-customer-invoices.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./admin-customer-invoices.component.scss']
})
export class AdminCustomerInvoicesComponent implements OnInit, OnDestroy {
  @Input() canCreate = false;
  @Input() canUpdate = false;

  readonly statusLabels = CUSTOMER_INVOICE_STATUS_LABELS;
  readonly manualPaymentOptions = MANUAL_PAYMENT_OPTIONS;

  invoices: CustomerInvoice[] = [];
  loading = false;
  search = '';
  statusFilter = 'All';
  message = '';
  error = '';
  busyInvoiceId: number | null = null;

  private readonly search$ = new Subject<void>();
  private readonly destroy$ = new Subject<void>();

  // ── Create ──
  showCreate = false;
  createUser: UserAdmin | null = null;
  orderOptions: CustomerInvoiceOrderOption[] = [];
  loadingOrders = false;
  selectedOrderId: number | null = null;
  splitMode = false;
  splitAmounts: (number | null)[] = [null, null];
  createNote = '';
  createSendEmail = true;
  createSendSms = true;
  creating = false;
  createError = '';

  // ── Mark paid ──
  payingInvoice: CustomerInvoice | null = null;
  payMethod: string = 'BankTransfer';
  payReference = '';
  payNotes = '';
  recordingPayment = false;
  payError = '';

  // ── Void ──
  voidingInvoice: CustomerInvoice | null = null;
  voidReason = '';
  voiding = false;

  constructor(private invoiceService: CustomerInvoiceService) {}

  ngOnInit(): void {
    this.search$.pipe(debounceTime(300), takeUntil(this.destroy$)).subscribe(() => this.load());
    this.load();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ─── List ─────────────────────────────────────────────────────────────────────────────

  load(): void {
    this.loading = true;
    this.invoiceService.list({ search: this.search.trim() || undefined, status: this.statusFilter }).subscribe({
      next: rows => { this.invoices = rows; this.loading = false; },
      error: err => { this.error = extractApiErrorMessage(err, 'Could not load invoices.'); this.loading = false; }
    });
  }

  onSearchChange(): void { this.search$.next(); }

  statusClass(status: CustomerInvoiceStatus): string {
    return 'status-' + status.toLowerCase();
  }

  copyLink(invoice: CustomerInvoice): void {
    this.clearMessages();
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(invoice.publicUrl).then(
        () => this.message = `Link for ${invoice.invoiceNumber} copied.`,
        () => this.message = invoice.publicUrl);
    } else {
      this.message = invoice.publicUrl;
    }
  }

  send(invoice: CustomerInvoice): void {
    if (!invoice.canSend || this.busyInvoiceId) return;
    this.clearMessages();
    this.busyInvoiceId = invoice.id;
    this.invoiceService.send(invoice.id, true, true).subscribe({
      next: res => { this.message = res.message; this.replace(res.invoice); this.busyInvoiceId = null; },
      error: err => { this.error = extractApiErrorMessage(err, 'The invoice could not be sent.'); this.busyInvoiceId = null; }
    });
  }

  private replace(updated: CustomerInvoice | null | undefined): void {
    if (!updated) return;
    const i = this.invoices.findIndex(x => x.id === updated.id);
    if (i >= 0) this.invoices[i] = updated;
  }

  private clearMessages(): void {
    this.message = '';
    this.error = '';
  }

  // ─── Create ───────────────────────────────────────────────────────────────────────────

  openCreate(): void {
    this.clearMessages();
    this.showCreate = true;
    this.createUser = null;
    this.orderOptions = [];
    this.selectedOrderId = null;
    this.splitMode = false;
    this.splitAmounts = [null, null];
    this.createNote = '';
    this.createSendEmail = true;
    this.createSendSms = true;
    this.createError = '';
  }

  closeCreate(): void {
    if (this.creating) return;
    this.showCreate = false;
  }

  onCreateUserSelected(user: UserAdmin): void {
    this.createUser = user;
    this.selectedOrderId = null;
    this.orderOptions = [];
    this.loadingOrders = true;
    this.createError = '';
    this.invoiceService.ordersForUser(user.id).subscribe({
      next: orders => {
        this.orderOptions = orders;
        // One billable order is the common case — select it rather than make the admin click.
        const billable = orders.filter(o => o.canInvoice);
        if (billable.length === 1) this.selectedOrderId = billable[0].orderId;
        this.loadingOrders = false;
      },
      error: err => {
        this.createError = extractApiErrorMessage(err, 'Could not load this customer\'s orders.');
        this.loadingOrders = false;
      }
    });
  }

  onCreateUserCleared(): void {
    this.createUser = null;
    this.orderOptions = [];
    this.selectedOrderId = null;
  }

  get selectedOrder(): CustomerInvoiceOrderOption | null {
    return this.orderOptions.find(o => o.orderId === this.selectedOrderId) ?? null;
  }

  /**
   * Split whenever the admin chose it — and always once the order already carries a split
   * invoice: a whole-balance invoice cannot sit beside split ones (the server refuses it), so the
   * form does not offer it.
   */
  get isSplit(): boolean {
    // An extra charge added after payment is billed as one amount — never split.
    if (this.selectedOrder?.isAdditionalCharge) return false;
    return this.splitMode || (this.selectedOrder?.openInvoiceNumbers.length ?? 0) > 0;
  }

  trackByIndex(index: number): number {
    return index;
  }

  addSplitRow(): void {
    if (this.splitAmounts.length < 12) this.splitAmounts.push(null);
  }

  removeSplitRow(index: number): void {
    if (this.splitAmounts.length > 1) this.splitAmounts.splice(index, 1);
  }

  /** Puts whatever is not yet allocated into this row — the usual "and the rest" last invoice. */
  fillRemainder(index: number): void {
    const others = this.splitAmounts.reduce<number>((sum, a, i) => i === index ? sum : sum + (Number(a) || 0), 0);
    const rest = Math.round(((this.selectedOrder?.availableToInvoice ?? 0) - others) * 100) / 100;
    if (rest > 0) this.splitAmounts[index] = rest;
  }

  get splitTotal(): number {
    return Math.round(this.splitAmounts.reduce<number>((sum, a) => sum + (Number(a) || 0), 0) * 100) / 100;
  }

  /** What the split leaves unbilled; negative means it asks for more than is owed. */
  get splitUnallocated(): number {
    return Math.round(((this.selectedOrder?.availableToInvoice ?? 0) - this.splitTotal) * 100) / 100;
  }

  get canSubmitCreate(): boolean {
    const order = this.selectedOrder;
    if (!order || !order.canInvoice || this.creating) return false;
    if (!this.isSplit) return true;
    const amounts = this.splitAmounts.map(a => Number(a) || 0);
    return amounts.length > 0 && amounts.every(a => a >= 0.5) && this.splitUnallocated >= -0.001;
  }

  submitCreate(): void {
    const order = this.selectedOrder;
    if (!order || !this.canSubmitCreate) return;
    this.creating = true;
    this.createError = '';
    this.invoiceService.create({
      orderId: order.orderId,
      splitAmounts: this.isSplit ? this.splitAmounts.map(a => Number(a) || 0) : undefined,
      note: this.createNote.trim() || null,
      sendEmail: this.createSendEmail,
      sendSms: this.createSendSms
    }).subscribe({
      next: res => {
        this.creating = false;
        this.showCreate = false;
        this.message = res.message;
        this.load();
      },
      error: err => {
        this.creating = false;
        this.createError = extractApiErrorMessage(err, 'The invoice could not be created.');
      }
    });
  }

  // ─── Mark paid (money received outside the website) ────────────────────────────────────

  openRecordPayment(invoice: CustomerInvoice): void {
    if (!invoice.canRecordPayment) return;
    this.clearMessages();
    this.payingInvoice = invoice;
    this.payMethod = 'BankTransfer';
    this.payReference = '';
    this.payNotes = '';
    this.payError = '';
  }

  closeRecordPayment(): void {
    if (this.recordingPayment) return;
    this.payingInvoice = null;
  }

  submitRecordPayment(): void {
    const invoice = this.payingInvoice;
    if (!invoice || this.recordingPayment) return;

    // "Bank transfer" is recorded as Other with the invoice number as its reference — the order's
    // payment methods predate it, and the reference is what an admin matches a bank statement to.
    const isBankTransfer = this.payMethod === 'BankTransfer';
    const method = isBankTransfer ? 'Other' : this.payMethod;
    const reference = this.payReference.trim()
      || (isBankTransfer ? `Bank transfer — ${invoice.invoiceNumber}` : invoice.invoiceNumber);

    this.recordingPayment = true;
    this.payError = '';
    this.invoiceService.recordPayment(invoice, method, reference, this.payNotes.trim() || null).subscribe({
      next: res => {
        this.recordingPayment = false;
        this.payingInvoice = null;
        this.message = res.orderFullyPaid
          ? `${invoice.invoiceNumber} marked paid. Order #${invoice.orderId} is fully paid and now ${res.status}.`
          : `${invoice.invoiceNumber} marked paid. Order #${invoice.orderId} still has a balance on its other invoices.`;
        this.load();
      },
      error: err => {
        this.recordingPayment = false;
        this.payError = extractApiErrorMessage(err, 'The payment could not be recorded.');
      }
    });
  }

  // ─── Void ─────────────────────────────────────────────────────────────────────────────

  openVoid(invoice: CustomerInvoice): void {
    if (!invoice.canVoid) return;
    this.clearMessages();
    this.voidingInvoice = invoice;
    this.voidReason = '';
  }

  closeVoid(): void {
    if (this.voiding) return;
    this.voidingInvoice = null;
  }

  confirmVoid(): void {
    const invoice = this.voidingInvoice;
    if (!invoice || this.voiding) return;
    this.voiding = true;
    this.invoiceService.void(invoice.id, this.voidReason.trim() || null).subscribe({
      next: res => {
        this.voiding = false;
        this.voidingInvoice = null;
        this.message = `${invoice.invoiceNumber} voided.`;
        this.replace(res.invoice);
      },
      error: err => {
        this.voiding = false;
        this.voidingInvoice = null;
        this.error = extractApiErrorMessage(err, 'The invoice could not be voided.');
      }
    });
  }
}
