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

type ModalKind = 'none' | 'payment' | 'void' | 'send' | 'reminder' | 'reverse';

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

  openPayment(markPaid: boolean): void {
    if (!this.invoice) return;
    // "Mark as paid" only PREFILLS the balance - the admin still confirms the date and method, so
    // the payment record says what actually happened rather than what was assumed.
    this.payAmount = markPaid ? this.invoice.balanceDue : null;
    this.payDate = this.today();
    this.payMethod = InvoicePaymentRecordMethod.AchBankTransfer;
    this.payReference = '';
    this.payNote = '';
    this.payAllowOverpayment = false;
    this.modal = 'payment';
  }

  openVoid(): void {
    this.voidReason = '';
    this.modal = 'void';
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
      allowOverpayment: this.payAllowOverpayment
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

  /** "September 1–30, 2026" style, matching the PDF's own formatting. */
  get servicePeriod(): string | null {
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
