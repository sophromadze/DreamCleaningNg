import { Component, OnInit, inject, ChangeDetectionStrategy, signal, computed } from '@angular/core';
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
import { InvoiceRecipientsEditorComponent } from './invoice-recipients-editor.component';

// 'dispose' is the Void / Archive / Full delete CHOICE; 'void' is the reason form it leads to.
type ModalKind = 'none' | 'payment' | 'void' | 'send' | 'reminder' | 'reverse' | 'dispose' | 'recipients';

/**
 * One send in the history: every address it went to, together. An invoice is mailed one message
 * per recipient, and the shared batch id is what groups the rows back into the one action.
 */
export interface InvoiceEmailGroup {
  key: string;
  emailTypeLabel: string;
  sentAt: string;
  logs: InvoiceEmailLog[];
  anyFailed: boolean;
  allFailed: boolean;
}

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
  imports: [CommonModule, FormsModule, RouterLink, InvoiceRecipientsEditorComponent],
  templateUrl: './invoice-detail.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
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

  readonly invoice = signal<InvoiceDetail | undefined>(undefined, { equal: () => false });
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');

  /** A send that reached only SOME recipients: who it missed. Stays until the next action. */
  readonly warning = signal('');

  readonly modal = signal<ModalKind>('none');

  // Record payment
  readonly payAmount = signal<number | null>(null);
  readonly payDate = signal(this.today());
  readonly payMethod = signal<InvoicePaymentRecordMethod>(InvoicePaymentRecordMethod.AchBankTransfer);
  readonly payReference = signal('');
  readonly payNote = signal('');
  readonly payAllowOverpayment = signal(false);

  /**
   * The admin has read the "a bank payment is already settling" warning and wants to record a
   * separate payment anyway.
   *
   * ACH IS ASYNCHRONOUS, and this is the window a double-count happens in: the customer authorized
   * a debit days ago, nothing has settled, and the invoice legitimately still reads unpaid. The
   * server refuses without this, and records the override on the payment's own note so a later
   * duplicate is explainable rather than mysterious.
   */
  readonly payAcknowledgeProcessing = signal(false);

  /** True when this modal was opened by "Mark as Paid" rather than "Record payment". */
  readonly markingAsPaid = signal(false);

  // Void
  readonly voidReason = signal('');

  // Send / reminder — the invoice's recipient list, editable in the dialog. Sending with a changed
  // list replaces the invoice's stored one, so the invoice keeps saying who it went to.
  readonly sendRecipients = signal<string[]>([]);

  // The Recipients dialog
  readonly editRecipients = signal<string[]>([]);
  readonly editRecipientsSaveDefault = signal(false);
  readonly sendMessage = signal('');
  readonly sendAttachPdf = signal(true);
  readonly reminderForce = signal(false);

  // Reverse
  reversingPayment?: InvoicePayment;
  readonly reverseReason = signal('');

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id'));

    // Save & Send hands over a send failure here rather than stranding the form: the invoice IS
    // saved, only the mail failed, and this is the page that can retry it.
    const sendError = this.route.snapshot.queryParamMap.get('sendError');
    if (sendError) this.error.set(sendError);
    const sendNotice = this.route.snapshot.queryParamMap.get('sendNotice');
    if (sendNotice) this.warning.set(sendNotice);

    this.load(id);
  }

  load(id: number): void {
    this.loading.set(true);
    this.invoiceService.get(id)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: inv => this.invoice.set(inv),
        error: err => this.error.set(extractApiErrorMessage(err, 'Could not load the invoice.'))
      });
  }

  private refresh(updated: InvoiceDetail): void {
    this.invoice.set(updated);
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
    if (!this.invoice()) return;

    this.markingAsPaid.set(markPaid);
    this.payAmount.set(markPaid ? this.invoice()!.balanceDue : null);
    this.payDate.set(this.today());
    this.payMethod.set(InvoicePaymentRecordMethod.AchBankTransfer);
    this.payReference.set('');
    this.payNote.set('');
    this.payAllowOverpayment.set(false);
    this.payAcknowledgeProcessing.set(false);
    this.modal.set('payment');
  }

  /** Whether the ACH-still-settling warning applies to this invoice right now. */
  get processingPaymentWarning(): boolean {
    return !!this.invoice()?.hasProcessingStripePayment;
  }

  /** The in-flight Stripe attempt, so the warning can name the amount and the date. */
  get processingAttempt(): InvoicePaymentAttempt | undefined {
    return this.invoice()?.paymentAttempts
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
      || (this.processingPaymentWarning && !this.payAcknowledgeProcessing());
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
    this.hardDeleteConfirmation.set('');
    this.modal.set('dispose');
  }

  /** From the choice dialog into the existing Void reason form, whose behaviour is unchanged. */
  chooseVoid(): void {
    this.voidReason.set('');
    this.modal.set('void');
  }

  /** What the admin has to type to unlock Full delete: `DELETE DCI-2026-48392175`. */
  get hardDeleteConfirmationPhrase(): string {
    return `DELETE ${this.invoice()?.invoiceNumber ?? ''}`;
  }

  readonly hardDeleteConfirmation = signal('');

  /** Trimmed and case-insensitive, matching the server's own check. */
  get hardDeleteConfirmed(): boolean {
    return this.hardDeleteConfirmation().trim().toLowerCase()
      === this.hardDeleteConfirmationPhrase.toLowerCase();
  }

  /** Server-decided. Absent on an older backend, which then simply does not offer the option. */
  get canHardDelete(): boolean {
    return this.invoice()?.canHardDelete === true;
  }

  get hardDeleteBlockedReason(): string | null {
    return this.invoice()?.cannotHardDeleteReason ?? null;
  }

  /** Option B — archive. Preserves everything; reversible from the Archived tab. */
  archiveInvoice(): void {
    if (!this.invoice()) return;

    this.busy.set(true);
    this.error.set('');
    this.closeModal();

    this.invoiceService.archive(this.invoice()!.id)
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: updated => {
          this.refresh(updated);
          this.flash('Invoice archived. Find it again under the Archived filter.');
        },
        error: err => this.error.set(extractApiErrorMessage(err, 'Could not archive the invoice.'))
      });
  }

  unarchiveInvoice(): void {
    if (!this.invoice()) return;

    this.busy.set(true);
    this.error.set('');

    this.invoiceService.unarchive(this.invoice()!.id)
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: updated => {
          this.refresh(updated);
          this.flash('Invoice unarchived.');
        },
        error: err => this.error.set(extractApiErrorMessage(err, 'Could not unarchive the invoice.'))
      });
  }

  /**
   * Option C — permanent delete. The checks here only decide whether to bother asking: the server
   * re-applies `InvoiceHardDeletePolicy` and re-checks the typed confirmation, and refuses the
   * whole request if either fails.
   */
  permanentlyDeleteInvoice(): void {
    if (!this.invoice() || !this.canHardDelete || !this.hardDeleteConfirmed) return;

    const confirmation = this.hardDeleteConfirmation().trim();
    this.busy.set(true);
    this.error.set('');
    this.closeModal();

    this.invoiceService.permanentlyDelete(this.invoice()!.id, confirmation)
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        // Nothing left to refresh — the invoice this panel is showing no longer exists.
        next: () => this.router.navigate(['/admin/commercial/invoices']),
        error: err => this.error.set(extractApiErrorMessage(err, 'Could not delete the invoice.'))
      });
  }

  openSend(): void {
    this.sendRecipients.set([...(this.invoice()?.recipients ?? [])]);
    this.sendMessage.set('');
    this.sendAttachPdf.set(true);
    this.modal.set('send');
  }

  openReminder(): void {
    this.sendRecipients.set([...(this.invoice()?.recipients ?? [])]);
    this.reminderForce.set(false);
    this.modal.set('reminder');
  }

  openRecipients(): void {
    this.editRecipients.set([...(this.invoice()?.recipients ?? [])]);
    this.editRecipientsSaveDefault.set(false);
    this.modal.set('recipients');
  }

  saveRecipients(): void {
    if (!this.invoice() || !this.editRecipients().length) return;

    this.busy.set(true);
    this.error.set('');

    this.invoiceService.updateRecipients(this.invoice()!.id, {
      recipients: this.editRecipients(),
      saveAsClientDefault: this.editRecipientsSaveDefault()
    })
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: updated => {
          this.refresh(updated);
          this.flash(this.editRecipientsSaveDefault()
            ? 'Recipients saved, and saved as this client\'s default for future invoices.'
            : 'Recipients saved.');
        },
        error: err => this.error.set(extractApiErrorMessage(err, 'Could not save the recipients.'))
      });
  }

  openReverse(payment: InvoicePayment): void {
    this.reversingPayment = payment;
    this.reverseReason.set('');
    this.modal.set('reverse');
  }

  closeModal(): void {
    this.modal.set('none');
    this.reversingPayment = undefined;
  }

  // ── Actions ──

  get overpaymentBlocked(): boolean {
    return !!this.invoice()
      && (this.payAmount() ?? 0) > this.invoice()!.balanceDue
      && !this.payAllowOverpayment();
  }

  recordPayment(): void {
    if (!this.invoice() || !this.payAmount() || this.payAmount()! <= 0) return;

    this.busy.set(true);
    this.error.set('');

    this.invoiceService.recordPayment(this.invoice()!.id, {
      amount: this.payAmount()!,
      paymentDate: this.payDate(),
      paymentMethod: this.payMethod(),
      transactionReference: this.payReference().trim() || undefined,
      internalNote: this.payNote().trim() || undefined,
      allowOverpayment: this.payAllowOverpayment(),
      acknowledgeProcessingPayment: this.payAcknowledgeProcessing()
    })
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: updated => {
          const nowPaid = updated.status === InvoiceStatus.Paid;
          this.refresh(updated);
          this.flash(nowPaid
            ? 'Payment recorded. This invoice is now paid in full.'
            : 'Payment recorded.');
        },
        error: err => this.error.set(extractApiErrorMessage(err, 'Could not record the payment.'))
      });
  }

  reversePayment(): void {
    if (!this.invoice() || !this.reversingPayment || !this.reverseReason().trim()) return;

    this.busy.set(true);
    this.error.set('');

    this.invoiceService.reversePayment(
      this.invoice()!.id, this.reversingPayment.id, this.reverseReason().trim())
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: updated => { this.refresh(updated); this.flash('Payment reversed.'); },
        error: err => this.error.set(extractApiErrorMessage(err, 'Could not reverse the payment.'))
      });
  }

  send(): void {
    if (!this.invoice() || !this.sendRecipients().length) return;

    this.busy.set(true);
    this.error.set('');
    this.warning.set('');

    this.invoiceService.send(this.invoice()!.id, {
      recipients: this.sendRecipients(),
      attachPdf: this.sendAttachPdf(),
      message: this.sendMessage().trim() || undefined
    })
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: updated => this.afterSend(updated, `Invoice sent to ${this.sendRecipients().join(', ')}.`),
        error: err => this.failSend(err, 'Could not send the invoice.')
      });
  }

  sendReminder(): void {
    if (!this.invoice() || !this.sendRecipients().length) return;

    this.busy.set(true);
    this.error.set('');
    this.warning.set('');

    this.invoiceService.sendReminder(this.invoice()!.id, {
      recipients: this.sendRecipients(),
      force: this.reminderForce()
    })
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: updated => this.afterSend(updated, `Reminder sent to ${this.sendRecipients().join(', ')}.`),
        error: err => this.failSend(err, 'Could not send the reminder.')
      });
  }

  /**
   * A send that reached SOME of the recipients still succeeded — the invoice did go out — so it
   * refreshes like a success and keeps a warning naming who was missed, rather than an error that
   * would invite a duplicate resend to everybody.
   */
  private afterSend(updated: InvoiceDetail, sentMessage: string): void {
    this.refresh(updated);
    if (updated.actionNotice) this.warning.set(updated.actionNotice);
    else this.flash(sentMessage);
  }

  /** Every recipient failed: the body still carries the refreshed invoice, so the history shows why. */
  private failSend(err: unknown, fallback: string): void {
    const body = (err as { error?: { invoice?: InvoiceDetail } })?.error;
    if (body?.invoice) this.invoice.set(body.invoice);
    this.error.set(extractApiErrorMessage(err, fallback));
  }

  sendReceipt(): void {
    if (!this.invoice()) return;

    this.busy.set(true);
    this.error.set('');

    this.invoiceService.sendReceipt(this.invoice()!.id)
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: updated => {
          this.invoice.set(updated);
          if (updated.actionNotice) this.warning.set(updated.actionNotice);
          else this.flash(`Payment receipt sent to ${updated.recipients.join(', ')}.`);
        },
        error: err => this.error.set(extractApiErrorMessage(err, 'Could not send the receipt.'))
      });
  }

  voidInvoice(): void {
    if (!this.invoice() || !this.voidReason().trim()) return;

    this.busy.set(true);
    this.error.set('');

    this.invoiceService.void(this.invoice()!.id, this.voidReason().trim())
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: updated => {
          this.refresh(updated);
          this.flash('Invoice voided. Its number stays permanently reserved.');
        },
        error: err => this.error.set(extractApiErrorMessage(err, 'Could not void the invoice.'))
      });
  }

  duplicate(): void {
    if (!this.invoice()) return;

    this.busy.set(true);
    this.invoiceService.duplicate(this.invoice()!.id)
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: created => this.router.navigate(['/admin/commercial/invoices', created.id, 'edit']),
        error: err => this.error.set(extractApiErrorMessage(err, 'Could not duplicate the invoice.'))
      });
  }

  deleteDraft(): void {
    if (!this.invoice()) return;
    if (!confirm('Delete this draft invoice? Its number will not be reused.')) return;

    this.busy.set(true);
    this.invoiceService.deleteDraft(this.invoice()!.id)
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: () => this.router.navigate(['/admin/commercial/invoices']),
        error: err => this.error.set(extractApiErrorMessage(err, 'Could not delete the draft.'))
      });
  }

  downloadPdf(): void {
    if (!this.invoice()) return;

    this.invoiceService.downloadPdf(this.invoice()!.id).subscribe({
      next: blob => {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `Dream-Cleaning-Invoice-${this.invoice()!.invoiceNumber}.pdf`;
        anchor.click();
        URL.revokeObjectURL(url);
      },
      error: err => this.error.set(extractApiErrorMessage(err, 'Could not download the PDF.'))
    });
  }

  copyLink(): void {
    if (!this.invoice()) return;
    navigator.clipboard?.writeText(this.invoice()!.publicUrl).then(
      () => this.flash('Invoice link copied.'),
      () => this.error.set('Could not copy the link to the clipboard.'));
  }

  edit(): void {
    if (this.invoice()) this.router.navigate(['/admin/commercial/invoices', this.invoice()!.id, 'edit']);
  }

  // ── Helpers ──

  private flash(message: string): void {
    this.notice.set(message);
    setTimeout(() => this.notice.set(''), 5000);
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
    return this.invoice()?.serviceDateLabel ?? 'Service period';
  }

  get servicePeriod(): string | null {
    if (this.invoice()?.serviceDateText) return this.invoice()!.serviceDateText!;

    if (!this.invoice()?.serviceStartDate && !this.invoice()?.serviceEndDate) return null;

    const start = new Date(this.invoice()!.serviceStartDate ?? this.invoice()!.serviceEndDate!);
    const end = new Date(this.invoice()!.serviceEndDate ?? this.invoice()!.serviceStartDate!);

    const fmt = (d: Date) => d.toLocaleDateString('en-US',
      { month: 'long', day: 'numeric', year: 'numeric' });

    if (start.toDateString() === end.toDateString()) return fmt(start);

    if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
      return `${start.toLocaleDateString('en-US', { month: 'long' })} `
        + `${start.getDate()}–${end.getDate()}, ${start.getFullYear()}`;
    }

    return `${fmt(start)} – ${fmt(end)}`;
  }

  get isVoid(): boolean { return this.invoice()?.status === InvoiceStatus.Void; }
  get isPaid(): boolean { return this.invoice()?.status === InvoiceStatus.Paid; }

  /**
   * A failed send is shown as a failure, not silently omitted. An admin who believes the client
   * has the invoice, when nothing was delivered, is the worst outcome this page can produce.
   */
  /**
   * The send history, one entry per SEND: rows sharing a batch id are one action to several
   * addresses. Rows from before multi-recipient sending have no batch id and stand alone.
   */
  readonly emailGroups = computed<InvoiceEmailGroup[]>(() => {
    const groups: InvoiceEmailGroup[] = [];
    const byKey = new Map<string, InvoiceEmailGroup>();

    for (const log of this.invoice()?.emailHistory ?? []) {
      const key = log.sendBatchId ? `batch:${log.sendBatchId}` : `row:${log.id}`;
      let group = byKey.get(key);
      if (!group) {
        group = { key, emailTypeLabel: log.emailTypeLabel, sentAt: log.sentAt, logs: [], anyFailed: false, allFailed: true };
        byKey.set(key, group);
        groups.push(group);
      }
      group.logs.push(log);
      if (this.isFailed(log)) group.anyFailed = true;
      else group.allFailed = false;
    }

    return groups;
  });

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
