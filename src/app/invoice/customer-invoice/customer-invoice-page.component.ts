import { Component, OnDestroy, OnInit, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { finalize } from 'rxjs';
import {
  CUSTOMER_INVOICE_STATUS_LABELS,
  CustomerInvoiceService,
  PublicCustomerInvoice
} from '../../services/customer-invoice.service';
import { IconComponent } from '../../shared/icons/icon.component';
import { faBuildingColumns } from '../../shared/icons/glyphs/faBuildingColumns';
import { faCircleCheck } from '../../shared/icons/glyphs/faCircleCheck';
import { faCreditCard } from '../../shared/icons/glyphs/faCreditCard';
import { faFilePdf } from '../../shared/icons/glyphs/faFilePdf';
import { faHourglassHalf } from '../../shared/icons/glyphs/faHourglassHalf';
import { faMoneyBillTransfer } from '../../shared/icons/glyphs/faMoneyBillTransfer';
import { faSpinner } from '../../shared/icons/glyphs/faSpinner';

/**
 * /pay-invoice/:token — a REGULAR customer invoice (Admin → Invoices, 2026-09).
 *
 * Anonymous by design: whoever holds the link can read the bill and pay it, logged in or not,
 * or logged in as somebody else. Nothing here decides anything — the server says what is owed,
 * whether it can be paid, and where the card payment lives (the order's own payment page, for
 * THIS invoice's part of it). Bank-transfer money never reaches the website, so that option is
 * instructions only; an admin marks the invoice paid when it arrives.
 */
@Component({
  selector: 'app-customer-invoice-page',
  standalone: true,
  imports: [CommonModule, RouterModule, IconComponent],
  templateUrl: './customer-invoice-page.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./customer-invoice-page.component.scss']
})
export class CustomerInvoicePageComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private invoiceService = inject(CustomerInvoiceService);

  protected readonly icons = { faBuildingColumns, faCircleCheck, faCreditCard, faFilePdf, faHourglassHalf, faMoneyBillTransfer, faSpinner };

  readonly invoice = signal<PublicCustomerInvoice | null>(null);
  readonly loading = signal(true);
  readonly notFound = signal(false);
  readonly copied = signal('');
  readonly downloading = signal(false);
  readonly downloadError = signal('');
  private token = '';

  /** Online bank (ACH) payment: the redirect in flight and its error. */
  readonly startingAch = signal(false);
  /** Back from Stripe and the server has not seen the payment yet — re-reading every few seconds. */
  readonly checkingPayment = signal(false);
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private pollsLeft = 0;
  readonly achError = signal('');
  /** ?payment=processing|cancelled from Stripe's redirect — a hint for the message only; the
   *  invoice itself is always re-read from the server. */
  paymentHint: 'processing' | 'cancelled' | null = null;

  readonly statusLabels = CUSTOMER_INVOICE_STATUS_LABELS;

  ngOnInit(): void {
    const token = this.route.snapshot.paramMap.get('token') ?? '';
    this.token = token;
    const hint = this.route.snapshot.queryParamMap.get('payment');
    this.paymentHint = hint === 'processing' || hint === 'cancelled' ? hint : null;
    this.invoiceService.getPublic(token).subscribe({
      next: invoice => {
        this.invoice.set(invoice);
        this.loading.set(false);
        // Stripe sends the customer back the moment they authorize. The server re-checks the
        // payment with Stripe on every read, so keep re-reading for a minute until it shows up.
        if (this.paymentHint === 'processing' && this.needsPaymentCheck(invoice)) {
          this.checkingPayment.set(true);
          this.pollsLeft = 15;
          this.schedulePoll();
        }
      },
      error: () => { this.notFound.set(true); this.loading.set(false); }
    });
  }

  ngOnDestroy(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
  }

  private needsPaymentCheck(invoice: PublicCustomerInvoice): boolean {
    return !invoice.achProcessing && invoice.status !== 'Paid';
  }

  private schedulePoll(): void {
    if (typeof window === 'undefined') return; // never on the server render
    this.pollTimer = setTimeout(() => {
      this.invoiceService.getPublic(this.token).subscribe({
        next: invoice => {
          this.invoice.set(invoice);
          if (this.needsPaymentCheck(invoice) && --this.pollsLeft > 0) this.schedulePoll();
          else this.checkingPayment.set(false);
        },
        error: () => { this.checkingPayment.set(false); }
      });
    }, 4000);
  }

  get isPayable(): boolean {
    return !!this.invoice() && (this.invoice()!.status === 'Sent' || this.invoice()!.status === 'NotSent')
      && this.invoice()!.amountDue > 0;
  }

  get isSplit(): boolean {
    return this.invoice()?.kind === 'Split';
  }

  get isAdditional(): boolean {
    return this.invoice()?.kind === 'Additional';
  }

  /**
   * Sends the customer to Stripe's hosted bank-payment page. The amount and fee are decided on
   * the server from the invoice itself; this page only showed the quote.
   */
  startAch(): void {
    if (!this.invoice()?.achAvailable || this.startingAch()) return;
    this.startingAch.set(true);
    this.achError.set('');
    this.invoiceService.startAchCheckout(this.token).subscribe({
      next: res => {
        if (typeof window !== 'undefined' && res.checkoutUrl) window.location.href = res.checkoutUrl;
        else this.startingAch.set(false);
      },
      error: err => {
        this.startingAch.set(false);
        this.achError.set(err?.error?.message || 'Online bank payment is not available right now. Please pay by card or bank transfer.');
      }
    });
  }

  payByCard(): void {
    if (this.invoice()?.cardPaymentPath) this.router.navigateByUrl(this.invoice()!.cardPaymentPath!);
  }

  formatTime(hhmm: string): string {
    const [h, m] = (hhmm || '').split(':').map(Number);
    if (Number.isNaN(h)) return hhmm;
    const suffix = h >= 12 ? 'PM' : 'AM';
    return `${h % 12 || 12}:${String(m || 0).padStart(2, '0')} ${suffix}`;
  }

  copy(value: string | null | undefined, label: string): void {
    if (!value || typeof navigator === 'undefined' || !navigator.clipboard) return;
    navigator.clipboard.writeText(value).then(() => {
      this.copied.set(label);
      setTimeout(() => { if (this.copied() === label) this.copied.set(''); }, 2000);
    });
  }

  /**
   * Saves the invoice as a real PDF rendered by the server — logo, invoice layout, nothing else.
   * It replaced `window.print()`, which saved the whole web page: site header, footer and the
   * floating buttons around the bill. Fetched as a blob so a failure reads as a message rather
   * than navigating the customer away to a broken page.
   */
  downloadPdf(): void {
    if (!this.invoice() || this.downloading() || typeof document === 'undefined') return;
    this.downloading.set(true);
    this.downloadError.set('');
    const fileName = `Dream-Cleaning-Invoice-${this.invoice()!.invoiceNumber}.pdf`;
    this.invoiceService.downloadPublicPdf(this.token)
      .pipe(finalize(() => this.downloading.set(false)))
      .subscribe({
        next: blob => {
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = fileName;
          anchor.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        },
        error: () => this.downloadError.set('The PDF could not be downloaded. Please try again.')
      });
  }
}
