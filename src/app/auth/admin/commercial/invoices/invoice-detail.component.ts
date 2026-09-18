import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs/operators';

import {
  InvoiceService, InvoiceDetail, InvoiceStatus, InvoiceTaxType, InvoicePaymentRecordMethod,
  InvoicePayment, InvoiceEmailLog, InvoiceEmailStatus, InvoicePaymentAttempt,
  InvoicePaymentAttemptStatus, invoiceStatusClass, PAYMENT_RECORD_METHODS
} from '../../../../services/invoice.service';
import { extractApiErrorMessage } from '../../../../utils/http-error.utils';

// 'dispose' is the Void / Archive / Full delete CHOICE; 'void' is the reason form it leads to.
type ModalKind = 'none' | 'payment' | 'void' | 'send' | 'reminder' | 'reverse' | 'dispose';

/**
 * One commercial invoice: everything about it, and every action on it.
 *
 * WHAT THE ADMIN MAY DO IS DECIDED BY THE SERVER. Every button is gated on a capability flag from
 * the detail DTO (canEdit, canRecordPayment, canVoid, ...) rather than on a status test written
 * again here. A second copy of the state machine in the browser is how a "Mark as paid" button
 * ends up on an already-paid invoice.
 *
 * "Mark as paid" is deliberately NOT a separate action - it opens the Record Payment modal with
 * the balance prefilled. There is no endpoint that just sets the status, because a paid invoice
 * with no payment behind it cannot be reconciled against a bank statement.
 */
@Component({
  selector: 'app-invoice-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './invoice-detail.component.html',
  styleUrls: ['./invoice-detail.component.scss']
})
export class InvoiceDetailComponent implements OnInit {
  private invoiceService = inject(InvoiceService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  readonly InvoiceStatus = InvoiceStatus;
  readonly InvoiceTaxType = InvoiceTaxType;
  readonly statusClass = invoiceStatusClass;
  readonly paymentMethods = PAYMENT_RECORD_METHODS;

  invoice?: InvoiceDetail;
  loading = true;
  busy = false;
  error = '';
  notice = '';

  modal: ModalKind = 'none';

  // Record payment
  payAmount: number | null = null;
  payDate = this.today();
  payMethod: InvoicePaymentRecordMethod = InvoicePaymentRecordMethod.AchBankTransfer;
  payReference = '';
  payNote = '';
  payAllowOverpayment = false;

  /**
   * The admin has read the "a bank payment is already settling" warning and wants to record a
   * separate payment anyway.
   *
   * ACH IS ASYNCHRONOUS, and this is the window a double-count happens in: the customer authorized
   * a debit days ago, nothing has settled, and the invoice legitimately still reads unpaid. The
   * server refuses without this, and records the override on the payment's own note so a later
   * duplicate is explainable rather than mysterious.
   */
  payAcknowledgeProcessing = false;

  /** True when this modal was opened by "Mark as Paid" rather than "Record payment". */
  markingAsPaid = false;

  // Void
  voidReason = '';

  // Send / reminder
  sendEmail = '';
  sendMessage = '';
  sendAttachPdf = true;
  reminderForce = false;

  // Reverse
  reversingPayment?: InvoicePayment;
  reverseReason = '';

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id'));

    // Save & Send hands over a send failure here rather than stranding the form: the invoice IS
    // saved, only the mail failed, and this is the page that can retry it.
    const sendError = this.route.snapshot.queryParamMap.get('sendError');
    if (sendError) this.error = sendError;

    this.load(id);
  }

  load(id: number): void {
    this.loading = true;
    this.invoiceService.get(id)
      .pipe(finalize(() => this.loading = false))
      .subscribe({
        next: inv => this.invoice = inv,
        error: err => this.error = extractApiErrorMessage(err, 'Could not load the invoice.')
      });
  }

  private refresh(updated: InvoiceDetail): void {
    this.invoice = updated;
    this.closeModal();
  }

  // ── Modals ──

  /**
   * Opens the Record Payment modal. "Mark as Paid" is the same modal with the balance prefilled.
   *
   * IT IS NOT A STATUS ASSIGNMENT, and there is deliberately no endpoint that writes Status = Paid.
   * An admin marking an invoice paid still confirms the amount, the date, the method and
   * (optionally) the bank's reference, because a paid invoice with no payment behind it cannot be
   * reconciled against a bank statement six months later.
   *
   * The payment recorded here is always MANUAL — money that arrived by bank transfer, cheque or
   * cash and was read off a statement. Nothing on this path is ever presented as a Stripe payment:
   * the two reconcile against completely different records, and only Stripe's own webhook writes
   * a Stripe-provider row.
   */
  openPayment(markPaid: boolean): void {
    if (!this.invoice) return;

    this.markingAsPaid = markPaid;
    this.payAmount = markPaid ? this.invoice.balanceDue : null;
    this.payDate = this.today();
    this.payMethod = InvoicePaymentRecordMethod.AchBankTransfer;
    this.payReference = '';
    this.payNote = '';
    this.payAllowOverpayment = false;
    this.payAcknowledgeProcessing = false;
    this.modal = 'payment';
  }

  /** Whether the ACH-still-settling warning applies to this invoice right now. */
  get processingPaymentWarning(): boolean {
    return !!this.invoice?.hasProcessingStripePayment;
  }

  /** The in-flight Stripe attempt, so the warning can name the amount and the date. */
  get processingAttempt(): InvoicePaymentAttempt | undefined {
    return this.invoice?.paymentAttempts
      ?.find(a => a.status === InvoicePaymentAttemptStatus.Processing);
  }

  /**
   * Whether Record Payment is blocked pending an acknowledgement.
   *
   * Two separate confirmations, for two separate mistakes: recording more than is owed, and
   * recording a payment while a bank debit for the same money is still settling. Either can be
   * legitimate, so both are confirmations rather than refusals.
   */
  get paymentBlocked(): boolean {
    return this.overpaymentBlocked
      || (this.processingPaymentWarning && !this.payAcknowledgeProcessing);
  }

  /**
   * THE VOID / ARCHIVE / FULL DELETE CHOICE.
   *
   * Void and Archive mean genuinely different things and neither is a delete: Void is a permanent
   * financial statement that a number was issued and cancelled, Archive is a filing decision that
   * states nothing. Full delete is the third, and is for a test invoice that never touched money.
   * Offering all three behind one button is what stops an admin voiding a test invoice because it
   * was the only option, and permanently reserving a number for something that never existed.
   */
  openDispose(): void {
    this.hardDeleteConfirmation = '';
    this.modal = 'dispose';
  }

  /** From the choice dialog into the existing Void reason form, whose behaviour is unchanged. */
  chooseVoid(): void {
    this.voidReason = '';
    this.modal = 'void';
  }

  /** What the admin has to type to unlock Full delete: `DELETE DCI-2026-48392175`. */
  get hardDeleteConfirmationPhrase(): string {
    return `DELETE ${this.invoice?.invoiceNumber ?? ''}`;
  }

  hardDeleteConfirmation = '';

  /** Trimmed and case-insensitive, matching the server's own check. */
  get hardDeleteConfirmed(): boolean {
    return this.hardDeleteConfirmation.trim().toLowerCase()
      === this.hardDeleteConfirmationPhrase.toLowerCase();
  }

  /** Server-decided. Absent on an older backend, which then simply does not offer the option. */
  get canHardDelete(): boolean {
    return this.invoice?.canHardDelete === true;
  }

  get hardDeleteBlockedReason(): string | null {
    return this.invoice?.cannotHardDeleteReason ?? null;
  }

  /** Option B — archive. Preserves everything; reversible from the Archived tab. */
  archiveInvoice(): void {
    if (!this.invoice) return;

    this.busy = true;
    this.error = '';
    this.closeModal();

    this.invoiceService.archive(this.invoice.id)
      .pipe(finalize(() => this.busy = false))
      .subscribe({
        next: updated => {
          this.refresh(updated);
          this.flash('Invoice archived. Find it again under the Archived filter.');
        },
        error: err => this.error = extractApiErrorMessage(err, 'Could not archive the invoice.')
      });
  }

  unarchiveInvoice(): void {
    if (!this.invoice) return;

    this.busy = true;
    this.error = '';

    this.invoiceService.unarchive(this.invoice.id)
      .pipe(finalize(() => this.busy = false))
      .subscribe({
        next: updated => {
          this.refresh(updated);
          this.flash('Invoice unarchived.');
        },
        error: err => this.error = extractApiErrorMessage(err, 'Could not unarchive the invoice.')
      });
  }

  /**
   * Option C — permanent delete. The checks here only decide whether to bother asking: the server
   * re-applies `InvoiceHardDeletePolicy` and re-checks the typed confirmation, and refuses the
   * whole request if either fails.
   */
  permanentlyDeleteInvoice(): void {
    if (!this.invoice || !this.canHardDelete || !this.hardDeleteConfirmed) return;

    const confirmation = this.hardDeleteConfirmation.trim();
    this.busy = true;
    this.error = '';
    this.closeModal();

    this.invoiceService.permanentlyDelete(this.invoice.id, confirmation)
      .pipe(finalize(() => this.busy = false))
      .subscribe({
        // Nothing left to refresh — the invoice this panel is showing no longer exists.
        next: () => this.router.navigate(['/admin/commercial/invoices']),
        error: err => this.error = extractApiErrorMessage(err, 'Could not delete the invoice.')
      });
  }

  openSend(): void {
    this.sendEmail = this.invoice?.billingEmail ?? '';
    this.sendMessage = '';
    this.sendAttachPdf = true;
    this.modal = 'send';
  }

  openReminder(): void {
    this.sendEmail = this.invoice?.billingEmail ?? '';
    this.reminderForce = false;
    this.modal = 'reminder';
  }

  openReverse(payment: InvoicePayment): void {
    this.reversingPayment = payment;
    this.reverseReason = '';
    this.modal = 'reverse';
  }

  closeModal(): void {
    this.modal = 'none';
    this.reversingPayment = undefined;
  }

  // ── Actions ──

  get overpaymentBlocked(): boolean {
    return !!this.invoice
      && (this.payAmount ?? 0) > this.invoice.balanceDue
      && !this.payAllowOverpayment;
  }

  recordPayment(): void {
    if (!this.invoice || !this.payAmount || this.payAmount <= 0) return;

    this.busy = true;
    this.error = '';

    this.invoiceService.recordPayment(this.invoice.id, {
      amount: this.payAmount,
      paymentDate: this.payDate,
      paymentMethod: this.payMethod,
      transactionReference: this.payReference.trim() || undefined,
      internalNote: this.payNote.trim() || undefined,
      allowOverpayment: this.payAllowOverpayment,
      acknowledgeProcessingPayment: this.payAcknowledgeProcessing
    })
      .pipe(finalize(() => this.busy = false))
      .subscribe({
        next: updated => {
          const nowPaid = updated.status === InvoiceStatus.Paid;
          this.refresh(updated);
          this.flash(nowPaid
            ? 'Payment recorded. This invoice is now paid in full.'
            : 'Payment recorded.');
        },
        error: err => this.error = extractApiErrorMessage(err, 'Could not record the payment.')
      });
  }

  reversePayment(): void {
    if (!this.invoice || !this.reversingPayment || !this.reverseReason.trim()) return;

    this.busy = true;
    this.error = '';

    this.invoiceService.reversePayment(
      this.invoice.id, this.reversingPayment.id, this.reverseReason.trim())
      .pipe(finalize(() => this.busy = false))
      .subscribe({
        next: updated => { this.refresh(updated); this.flash('Payment reversed.'); },
        error: err => this.error = extractApiErrorMessage(err, 'Could not reverse the payment.')
      });
  }

  send(): void {
    if (!this.invoice) return;

    this.busy = true;
    this.error = '';

    this.invoiceService.send(this.invoice.id, {
      recipientEmail: this.sendEmail.trim() || undefined,
      attachPdf: this.sendAttachPdf,
      message: this.sendMessage.trim() || undefined
    })
      .pipe(finalize(() => this.busy = false))
      .subscribe({
        next: updated => {
          this.refresh(updated);
          this.flash(`Invoice sent to ${this.sendEmail || 'the billing contact'}.`);
        },
        error: err => this.error = extractApiErrorMessage(err, 'Could not send the invoice.')
      });
  }

  sendReminder(): void {
    if (!this.invoice) return;

    this.busy = true;
    this.error = '';

    this.invoiceService.sendReminder(this.invoice.id, {
      recipientEmail: this.sendEmail.trim() || undefined,
      force: this.reminderForce
    })
      .pipe(finalize(() => this.busy = false))
      .subscribe({
        next: updated => { this.refresh(updated); this.flash('Reminder sent.'); },
        error: err => this.error = extractApiErrorMessage(err, 'Could not send the reminder.')
      });
  }

  sendReceipt(): void {
    if (!this.invoice) return;

    this.busy = true;
    this.error = '';

    this.invoiceService.sendReceipt(this.invoice.id)
      .pipe(finalize(() => this.busy = false))
      .subscribe({
        next: updated => { this.invoice = updated; this.flash('Payment receipt sent.'); },
        error: err => this.error = extractApiErrorMessage(err, 'Could not send the receipt.')
      });
  }

  voidInvoice(): void {
    if (!this.invoice || !this.voidReason.trim()) return;

    this.busy = true;
    this.error = '';

    this.invoiceService.void(this.invoice.id, this.voidReason.trim())
      .pipe(finalize(() => this.busy = false))
      .subscribe({
        next: updated => {
          this.refresh(updated);
          this.flash('Invoice voided. Its number stays permanently reserved.');
        },
        error: err => this.error = extractApiErrorMessage(err, 'Could not void the invoice.')
      });
  }

  duplicate(): void {
    if (!this.invoice) return;

    this.busy = true;
    this.invoiceService.duplicate(this.invoice.id)
      .pipe(finalize(() => this.busy = false))
      .subscribe({
        next: created => this.router.navigate(['/admin/commercial/invoices', created.id, 'edit']),
        error: err => this.error = extractApiErrorMessage(err, 'Could not duplicate the invoice.')
      });
  }

  deleteDraft(): void {
    if (!this.invoice) return;
    if (!confirm('Delete this draft invoice? Its number will not be reused.')) return;

    this.busy = true;
    this.invoiceService.deleteDraft(this.invoice.id)
      .pipe(finalize(() => this.busy = false))
      .subscribe({
        next: () => this.router.navigate(['/admin/commercial/invoices']),
        error: err => this.error = extractApiErrorMessage(err, 'Could not delete the draft.')
      });
  }

  downloadPdf(): void {
    if (!this.invoice) return;

    this.invoiceService.downloadPdf(this.invoice.id).subscribe({
      next: blob => {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `Dream-Cleaning-Invoice-${this.invoice!.invoiceNumber}.pdf`;
        anchor.click();
        URL.revokeObjectURL(url);
      },
      error: err => this.error = extractApiErrorMessage(err, 'Could not download the PDF.')
    });
  }

  copyLink(): void {
    if (!this.invoice) return;
    navigator.clipboard?.writeText(this.invoice.publicUrl).then(
      () => this.flash('Invoice link copied.'),
      () => this.error = 'Could not copy the link to the clipboard.');
  }

  edit(): void {
    if (this.invoice) this.router.navigate(['/admin/commercial/invoices', this.invoice.id, 'edit']);
  }

  // ── Helpers ──

  private flash(message: string): void {
    this.notice = message;
    setTimeout(() => this.notice = '', 5000);
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /**
   * What cleanings this invoice covers, and the label that fits the shape.
   *
   * RESOLVED BY THE SERVER, not here. `serviceDateLabel` / `serviceDateText` come off the DTO so
   * this panel, the customer's web invoice, the PDF and the email describe the same invoice
   * identically — a local reimplementation is exactly how "September 8-12" appeared on one surface
   * and "September 7" on another. The fallback below only fires for an older cached response.
   */
  get serviceDateLabel(): string {
    return this.invoice?.serviceDateLabel ?? 'Service period';
  }

  get servicePeriod(): string | null {
    if (this.invoice?.serviceDateText) return this.invoice.serviceDateText;

    if (!this.invoice?.serviceStartDate && !this.invoice?.serviceEndDate) return null;

    const start = new Date(this.invoice.serviceStartDate ?? this.invoice.serviceEndDate!);
    const end = new Date(this.invoice.serviceEndDate ?? this.invoice.serviceStartDate!);

    const fmt = (d: Date) => d.toLocaleDateString('en-US',
      { month: 'long', day: 'numeric', year: 'numeric' });

    if (start.toDateString() === end.toDateString()) return fmt(start);

    if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
      return `${start.toLocaleDateString('en-US', { month: 'long' })} `
        + `${start.getDate()}–${end.getDate()}, ${start.getFullYear()}`;
    }

    return `${fmt(start)} – ${fmt(end)}`;
  }

  get isVoid(): boolean { return this.invoice?.status === InvoiceStatus.Void; }
  get isPaid(): boolean { return this.invoice?.status === InvoiceStatus.Paid; }

  /**
   * A failed send is shown as a failure, not silently omitted. An admin who believes the client
   * has the invoice, when nothing was delivered, is the worst outcome this page can produce.
   */
  isFailed(log: InvoiceEmailLog): boolean {
    return log.status === InvoiceEmailStatus.Failed;
  }

  /**
   * Badge colour for an online payment attempt.
   *
   * Processing is AMBER, not green: money is on its way but nothing has settled, and a green
   * badge would read as "paid" — the exact misreading the whole attempt model exists to prevent.
   */
  attemptStatusClass(attempt: InvoicePaymentAttempt): string {
    switch (attempt.status) {
      case InvoicePaymentAttemptStatus.Succeeded: return 'attempt-succeeded';
      case InvoicePaymentAttemptStatus.Processing: return 'attempt-processing';
      case InvoicePaymentAttemptStatus.CheckoutOpen: return 'attempt-processing';
      case InvoicePaymentAttemptStatus.Failed: return 'attempt-failed';
      default: return 'attempt-inactive';
    }
  }
}
