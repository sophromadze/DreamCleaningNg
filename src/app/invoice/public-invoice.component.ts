import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { finalize } from 'rxjs/operators';

import {
  InvoiceService, PublicInvoice, InvoiceStatus, InvoiceTaxType, InvoicePaymentMethod,
  InvoicePaymentRecordMethod
} from '../services/invoice.service';
import { extractApiErrorMessage } from '../utils/http-error.utils';

/**
 * The client-facing invoice page, behind /invoice/{token}.
 *
 * UNAUTHENTICATED BY DESIGN. A commercial client has no account here, so the opaque token in the
 * URL is the whole authorization - the same shape as the contract review pages and the tokenized
 * customer payment links. The route is deliberately unguarded in app.routes.ts and
 * RenderMode.Client in app.routes.server.ts: server-side rendering would put one client's invoice,
 * bank details and all, into a cacheable response.
 *
 * READ-ONLY. Nothing on this page can change the invoice. The only state the visit moves is the
 * view counter, recorded server-side as a side effect of loading, and that can never take an
 * invoice out of Paid or Void.
 *
 * The payload it renders (PublicInvoiceDto) is a separate type from the admin one rather than a
 * filtered copy, so the internal note, the activity log and the row id are not merely hidden here
 * - they never leave the server.
 */
@Component({
  selector: 'app-public-invoice',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './public-invoice.component.html',
  styleUrls: ['./public-invoice.component.scss']
})
export class PublicInvoiceComponent implements OnInit {
  private invoiceService = inject(InvoiceService);
  private route = inject(ActivatedRoute);

  readonly InvoiceStatus = InvoiceStatus;
  readonly InvoiceTaxType = InvoiceTaxType;

  invoice?: PublicInvoice;
  token = '';
  loading = true;
  error = '';
  copied = false;
  downloading = false;

  /** Set by the logo's (error) handler so a missing asset degrades to the company name in text. */
  logoFailed = false;

  /** True between clicking a pay button and the browser leaving for Stripe. */
  startingPayment = false;

  /** Shown when online payment could not be started; manual ACH stays available beneath it. */
  paymentError = '';

  /** True when the customer has just come back from Stripe having authorized a debit. */
  justReturnedFromCheckout = false;

  /** True when they came back having cancelled. */
  checkoutCancelled = false;

  /** The manual bank block starts COLLAPSED — see the template for why. */
  manualAchExpanded = false;

  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';

    if (!this.token) {
      this.loading = false;
      this.error = 'This invoice link is not valid.';
      return;
    }

    // The ?payment= flag is a HINT ABOUT NAVIGATION, never a claim about money. Stripe redirects
    // here the moment the customer authorizes an ACH debit — days before it settles — so it only
    // decides which message to show while the authoritative state is fetched from the backend.
    const paymentParam = this.route.snapshot.queryParamMap.get('payment');
    this.justReturnedFromCheckout = paymentParam === 'processing';
    this.checkoutCancelled = paymentParam === 'cancelled';

    this.load();
  }

  private load(): void {
    this.invoiceService.getPublic(this.token)
      .pipe(finalize(() => this.loading = false))
      .subscribe({
        next: inv => this.invoice = inv,
        // Deliberately the same message whatever went wrong: a more specific answer would let
        // someone probe which invoices exist.
        error: () => this.error =
          'This invoice link is not valid, or the invoice is no longer available. '
          + 'Please contact us and we will send you a new link.'
      });
  }

  // ── Paying ──

  get options() { return this.invoice?.paymentOptions; }

  /**
   * True when the page should lead with "payment processing" rather than a pay button.
   *
   * Driven by the BACKEND's view of the attempt, not by the redirect: a customer who bookmarks
   * the ?payment=processing URL and returns a week later must see whatever is actually true then.
   */
  get isProcessing(): boolean {
    return !!this.options?.paymentInProgress;
  }

  payFromBank(): void {
    this.startCheckout(InvoicePaymentRecordMethod.AchBankTransfer);
  }

  payByCard(): void {
    this.startCheckout(InvoicePaymentRecordMethod.Card);
  }

  /**
   * Sends the customer into Stripe's hosted flow.
   *
   * `startingPayment` is never released on success — the browser is navigating away, and
   * re-enabling the button first would let a double-click open two Checkout Sessions.
   */
  private startCheckout(method: InvoicePaymentRecordMethod): void {
    if (this.startingPayment || !this.invoice) return;

    this.startingPayment = true;
    this.paymentError = '';

    this.invoiceService.startCheckout(this.token, method).subscribe({
      next: res => this.redirectToCheckout(res.checkoutUrl),
      error: err => {
        this.startingPayment = false;

        // The server sends customer-safe wording for a 503 (payment route unavailable) and for a
        // 400 (already processing). Anything else falls back to a neutral sentence rather than
        // surfacing a raw transport error.
        this.paymentError = extractApiErrorMessage(
          err,
          'Online payment could not be started. Please try again, or use the bank transfer '
          + 'details below.');

        // A refusal usually means the backend knows something the page does not — most often that
        // a payment is already in flight — so re-read rather than leaving stale buttons up.
        this.load();
      }
    });
  }

  /**
   * Sends the browser to Stripe's hosted page.
   *
   * FULL-PAGE NAVIGATION, not a popup or an iframe: Stripe's page must own the address bar so the
   * customer can see the padlock and the stripe.com domain before typing bank details into it.
   * Anything embedded would train people to enter credentials inside someone else's chrome.
   *
   * Its own method purely so tests can intercept it — assigning window.location in a spec
   * navigates the test runner away and disconnects the browser mid-run.
   */
  protected redirectToCheckout(url: string): void {
    window.location.href = url;
  }

  toggleManualAch(): void {
    this.manualAchExpanded = !this.manualAchExpanded;
  }

  /** ACH is the commercial default, and the only method the invoice actually instructs on. */
  get isAchPreferred(): boolean {
    return this.invoice?.paymentMethod === InvoicePaymentMethod.AchBankTransfer;
  }

  get isPaid(): boolean { return this.invoice?.status === InvoiceStatus.Paid; }
  get isVoid(): boolean { return this.invoice?.status === InvoiceStatus.Void; }
  get isOverdue(): boolean { return this.invoice?.status === InvoiceStatus.Overdue; }

  /** "September 1–30, 2026", matching how the PDF prints it. */
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

  /**
   * Copies the whole ACH block as text a client can paste into their bank's transfer form.
   *
   * Includes the payment reference, because an ACH payment with no invoice number in the memo is
   * the single thing that makes a transfer impossible to match on our side.
   */
  copyPaymentDetails(): void {
    const pay = this.invoice?.paymentInstructions;
    if (!pay) return;

    const lines = [
      pay.accountHolder ? `Account Holder: ${pay.accountHolder}` : null,
      pay.bankName ? `Bank: ${pay.bankName}` : null,
      pay.routingNumber ? `Routing Number: ${pay.routingNumber}` : null,
      pay.accountNumber ? `Account Number: ${pay.accountNumber}` : null,
      pay.accountType ? `Account Type: ${pay.accountType}` : null,
      `Payment Reference: ${pay.paymentReference}`,
      `Amount Due: ${this.formatMoney(this.invoice!.balanceDue)}`
    ].filter(Boolean).join('\n');

    navigator.clipboard?.writeText(lines).then(
      () => {
        this.copied = true;
        setTimeout(() => this.copied = false, 3000);
      },
      () => this.error = 'Could not copy to the clipboard. Please copy the details by hand.'
    );
  }

  /**
   * Fetched as a blob rather than linked directly, so a failed download surfaces as a message
   * instead of navigating the client away to a broken page.
   */
  downloadPdf(): void {
    if (!this.invoice) return;

    this.downloading = true;
    this.invoiceService.downloadPublicPdf(this.token)
      .pipe(finalize(() => this.downloading = false))
      .subscribe({
        next: blob => {
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = `Dream-Cleaning-Invoice-${this.invoice!.invoiceNumber}.pdf`;
          anchor.click();
          URL.revokeObjectURL(url);
        },
        error: () => this.error = 'The invoice PDF could not be downloaded. Please try again.'
      });
  }

  private formatMoney(value: number): string {
    return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  }
}
