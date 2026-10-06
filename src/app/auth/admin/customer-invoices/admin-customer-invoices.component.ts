import { Component, OnDestroy, OnInit, ChangeDetectionStrategy, inject, input, signal } from '@angular/core';
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./admin-customer-invoices.component.scss']
})
export class AdminCustomerInvoicesComponent implements OnInit, OnDestroy {
  private invoiceService = inject(CustomerInvoiceService);

  readonly canCreate = input(false);
  readonly canUpdate = input(false);

  readonly statusLabels = CUSTOMER_INVOICE_STATUS_LABELS;
  readonly manualPaymentOptions = MANUAL_PAYMENT_OPTIONS;

  readonly invoices = signal<CustomerInvoice[]>([], { equal: () => false });
  readonly loading = signal(false);
  readonly search = signal('');
  readonly statusFilter = signal('All');
  readonly message = signal('');
  readonly error = signal('');
  readonly busyInvoiceId = signal<number | null>(null);

  private readonly search$ = new Subject<void>();
  private readonly destroy$ = new Subject<void>();

  // ── Create ──
  readonly showCreate = signal(false);
  readonly createUser = signal<UserAdmin | null>(null);
  readonly orderOptions = signal<CustomerInvoiceOrderOption[]>([]);
  readonly loadingOrders = signal(false);
  readonly selectedOrderId = signal<number | null>(null);
  readonly splitMode = signal(false);
  readonly splitAmounts = signal<(number | null)[]>([null, null], { equal: () => false });
  readonly createNote = signal('');
  readonly createSendEmail = signal(true);
  readonly createSendSms = signal(true);
  readonly creating = signal(false);
  readonly createError = signal('');

  // ── Mark paid ──
  readonly payingInvoice = signal<CustomerInvoice | null>(null);
  readonly payMethod = signal<string>('BankTransfer');
  readonly payReference = signal('');
  readonly payNotes = signal('');
  readonly recordingPayment = signal(false);
  readonly payError = signal('');

  // ── Void ──
  readonly voidingInvoice = signal<CustomerInvoice | null>(null);
  readonly voidReason = signal('');
  readonly voiding = signal(false);

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
    this.loading.set(true);
    this.invoiceService.list({ search: this.search().trim() || undefined, status: this.statusFilter() }).subscribe({
      next: rows => { this.invoices.set(rows); this.loading.set(false); },
      error: err => { this.error.set(extractApiErrorMessage(err, 'Could not load invoices.')); this.loading.set(false); }
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
        () => this.message.set(`Link for ${invoice.invoiceNumber} copied.`),
        () => this.message.set(invoice.publicUrl));
    } else {
      this.message.set(invoice.publicUrl);
    }
  }

  send(invoice: CustomerInvoice): void {
    if (!invoice.canSend || this.busyInvoiceId()) return;
    this.clearMessages();
    this.busyInvoiceId.set(invoice.id);
    this.invoiceService.send(invoice.id, true, true).subscribe({
      next: res => { this.message.set(res.message); this.replace(res.invoice); this.busyInvoiceId.set(null); },
      error: err => { this.error.set(extractApiErrorMessage(err, 'The invoice could not be sent.')); this.busyInvoiceId.set(null); }
    });
  }

  private replace(updated: CustomerInvoice | null | undefined): void {
    if (!updated) return;
    const i = this.invoices().findIndex(x => x.id === updated.id);
    if (i >= 0) { this.invoices()[i] = updated; this.invoices.set(this.invoices()); }
  }

  private clearMessages(): void {
    this.message.set('');
    this.error.set('');
  }

  // ─── Create ───────────────────────────────────────────────────────────────────────────

  openCreate(): void {
    this.clearMessages();
    this.showCreate.set(true);
    this.createUser.set(null);
    this.orderOptions.set([]);
    this.selectedOrderId.set(null);
    this.splitMode.set(false);
    this.splitAmounts.set([null, null]);
    this.createNote.set('');
    this.createSendEmail.set(true);
    this.createSendSms.set(true);
    this.createError.set('');
  }

  closeCreate(): void {
    if (this.creating()) return;
    this.showCreate.set(false);
  }

  onCreateUserSelected(user: UserAdmin): void {
    this.createUser.set(user);
    this.selectedOrderId.set(null);
    this.orderOptions.set([]);
    this.loadingOrders.set(true);
    this.createError.set('');
    this.invoiceService.ordersForUser(user.id).subscribe({
      next: orders => {
        this.orderOptions.set(orders);
        // One billable order is the common case — select it rather than make the admin click.
        const billable = orders.filter(o => o.canInvoice);
        if (billable.length === 1) this.selectedOrderId.set(billable[0].orderId);
        this.loadingOrders.set(false);
      },
      error: err => {
        this.createError.set(extractApiErrorMessage(err, 'Could not load this customer\'s orders.'));
        this.loadingOrders.set(false);
      }
    });
  }

  onCreateUserCleared(): void {
    this.createUser.set(null);
    this.orderOptions.set([]);
    this.selectedOrderId.set(null);
  }

  get selectedOrder(): CustomerInvoiceOrderOption | null {
    return this.orderOptions().find(o => o.orderId === this.selectedOrderId()) ?? null;
  }

  /**
   * Split whenever the admin chose it — and always once the order already carries a split
   * invoice: a whole-balance invoice cannot sit beside split ones (the server refuses it), so the
   * form does not offer it.
   */
  get isSplit(): boolean {
    // An extra charge added after payment is billed as one amount — never split.
    if (this.selectedOrder?.isAdditionalCharge) return false;
    return this.splitMode() || (this.selectedOrder?.openInvoiceNumbers.length ?? 0) > 0;
  }

  trackByIndex(index: number): number {
    return index;
  }

  addSplitRow(): void {
    if (this.splitAmounts().length < 12) { this.splitAmounts().push(null); this.splitAmounts.set(this.splitAmounts()); }
  }

  removeSplitRow(index: number): void {
    if (this.splitAmounts().length > 1) { this.splitAmounts().splice(index, 1); this.splitAmounts.set(this.splitAmounts()); }
  }

  /** Puts whatever is not yet allocated into this row — the usual "and the rest" last invoice. */
  fillRemainder(index: number): void {
    const others = this.splitAmounts().reduce<number>((sum, a, i) => i === index ? sum : sum + (Number(a) || 0), 0);
    const rest = Math.round(((this.selectedOrder?.availableToInvoice ?? 0) - others) * 100) / 100;
    if (rest > 0) { this.splitAmounts()[index] = rest; this.splitAmounts.set(this.splitAmounts()); }
  }

  get splitTotal(): number {
    return Math.round(this.splitAmounts().reduce<number>((sum, a) => sum + (Number(a) || 0), 0) * 100) / 100;
  }

  /** What the split leaves unbilled; negative means it asks for more than is owed. */
  get splitUnallocated(): number {
    return Math.round(((this.selectedOrder?.availableToInvoice ?? 0) - this.splitTotal) * 100) / 100;
  }

  get canSubmitCreate(): boolean {
    const order = this.selectedOrder;
    if (!order || !order.canInvoice || this.creating()) return false;
    if (!this.isSplit) return true;
    const amounts = this.splitAmounts().map(a => Number(a) || 0);
    return amounts.length > 0 && amounts.every(a => a >= 0.5) && this.splitUnallocated >= -0.001;
  }

  submitCreate(): void {
    const order = this.selectedOrder;
    if (!order || !this.canSubmitCreate) return;
    this.creating.set(true);
    this.createError.set('');
    this.invoiceService.create({
      orderId: order.orderId,
      splitAmounts: this.isSplit ? this.splitAmounts().map(a => Number(a) || 0) : undefined,
      note: this.createNote().trim() || null,
      sendEmail: this.createSendEmail(),
      sendSms: this.createSendSms()
    }).subscribe({
      next: res => {
        this.creating.set(false);
        this.showCreate.set(false);
        this.message.set(res.message);
        this.load();
      },
      error: err => {
        this.creating.set(false);
        this.createError.set(extractApiErrorMessage(err, 'The invoice could not be created.'));
      }
    });
  }

  // ─── Mark paid (money received outside the website) ────────────────────────────────────

  openRecordPayment(invoice: CustomerInvoice): void {
    if (!invoice.canRecordPayment) return;
    this.clearMessages();
    this.payingInvoice.set(invoice);
    this.payMethod.set('BankTransfer');
    this.payReference.set('');
    this.payNotes.set('');
    this.payError.set('');
  }

  closeRecordPayment(): void {
    if (this.recordingPayment()) return;
    this.payingInvoice.set(null);
  }

  submitRecordPayment(): void {
    const invoice = this.payingInvoice();
    if (!invoice || this.recordingPayment()) return;

    // "Bank transfer" is recorded as Other with the invoice number as its reference — the order's
    // payment methods predate it, and the reference is what an admin matches a bank statement to.
    const isBankTransfer = this.payMethod() === 'BankTransfer';
    const method = isBankTransfer ? 'Other' : this.payMethod();
    const reference = this.payReference().trim()
      || (isBankTransfer ? `Bank transfer — ${invoice.invoiceNumber}` : invoice.invoiceNumber);

    this.recordingPayment.set(true);
    this.payError.set('');
    this.invoiceService.recordPayment(invoice, method, reference, this.payNotes().trim() || null).subscribe({
      next: res => {
        this.recordingPayment.set(false);
        this.payingInvoice.set(null);
        this.message.set(res.orderFullyPaid
          ? `${invoice.invoiceNumber} marked paid. Order #${invoice.orderId} is fully paid and now ${res.status}.`
          : `${invoice.invoiceNumber} marked paid. Order #${invoice.orderId} still has a balance on its other invoices.`);
        this.load();
      },
      error: err => {
        this.recordingPayment.set(false);
        this.payError.set(extractApiErrorMessage(err, 'The payment could not be recorded.'));
      }
    });
  }

  // ─── Void ─────────────────────────────────────────────────────────────────────────────

  openVoid(invoice: CustomerInvoice): void {
    if (!invoice.canVoid) return;
    this.clearMessages();
    this.voidingInvoice.set(invoice);
    this.voidReason.set('');
  }

  closeVoid(): void {
    if (this.voiding()) return;
    this.voidingInvoice.set(null);
  }

  confirmVoid(): void {
    const invoice = this.voidingInvoice();
    if (!invoice || this.voiding()) return;
    this.voiding.set(true);
    this.invoiceService.void(invoice.id, this.voidReason().trim() || null).subscribe({
      next: res => {
        this.voiding.set(false);
        this.voidingInvoice.set(null);
        this.message.set(`${invoice.invoiceNumber} voided.`);
        this.replace(res.invoice);
      },
      error: err => {
        this.voiding.set(false);
        this.voidingInvoice.set(null);
        this.error.set(extractApiErrorMessage(err, 'The invoice could not be voided.'));
      }
    });
  }
}
