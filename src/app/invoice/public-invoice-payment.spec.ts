import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';

import { PublicInvoiceComponent } from './public-invoice.component';
import {
  InvoiceService, PublicInvoice, InvoiceStatus, InvoiceTaxType,
  InvoicePaymentMethod, InvoicePaymentRecordMethod
} from '../services/invoice.service';

/**
 * THE PUBLIC INVOICE PAYMENT UI.
 *
 * Almost every rule here exists because ACH IS ASYNCHRONOUS. The customer authorizes a debit and
 * is redirected back immediately, but the money takes days — so the page must never confuse
 * "authorized" with "paid", and must not let an impatient customer pay twice while waiting.
 */
describe('PublicInvoiceComponent — payment', () => {
  let fixture: ComponentFixture<PublicInvoiceComponent>;
  let component: PublicInvoiceComponent;
  let service: jasmine.SpyObj<InvoiceService>;

  const baseInvoice = (): PublicInvoice => ({
    invoiceNumber: 'DCI-2026-10713354',
    status: InvoiceStatus.Sent,
    statusLabel: 'Sent',
    invoiceDate: '2026-09-07',
    dueDate: '2026-09-22',
    serviceDates: [],
    clientName: 'Test Commercial Client LLC',
    items: [],
    subTotal: 925.43,
    discountAmount: 0,
    taxType: InvoiceTaxType.Exempt,
    taxAmount: 0,
    total: 925.43,
    amountPaid: 0,
    balanceDue: 925.43,
    currency: 'USD',
    paymentMethod: InvoicePaymentMethod.AchBankTransfer,
    paymentOptions: {
      stripeAchAvailable: true,
      stripeCardAvailable: false,
      manualAchAvailable: true,
      paymentInProgress: false,
      lastAttemptFailed: false,
      // NO FEE by default, so the base fixture exercises the plain payment path. A configured fee
      // interposes a confirmation step before Stripe, which is its own behaviour and is set up
      // explicitly by `withAchFee()` in the fee block at the bottom of this file.
      achProcessingFee: 0,
      achTotalWithFee: 925.43,
      achProcessingFeeLabel: 'ACH Processing Fee',
      manualAchFeeNote: 'No processing fee from Dream Cleaning NYC'
    },
    company: {
      legalName: 'Test Company Inc.',
      dbaName: 'Test Cleaning',
      primaryName: 'DBA Test Cleaning',
      secondaryName: 'Test Company Inc.'
    }
  });

  /**
   * The base invoice with the ACH fee switched on. 0.8% of 925.43 is 7.40, capped at 5.00, so the
   * bank is debited 930.43 — and those are the SERVER's figures: the page displays them and never
   * derives one.
   */
  const withAchFee = (): PublicInvoice => {
    const invoice = baseInvoice();
    invoice.paymentOptions.achProcessingFee = 5.00;
    invoice.paymentOptions.achTotalWithFee = 930.43;
    return invoice;
  };

  function setUp(invoice: PublicInvoice, queryParams: Record<string, string> = {}) {
    service = jasmine.createSpyObj<InvoiceService>('InvoiceService',
      ['getPublic', 'startCheckout', 'downloadPublicPdf']);
    service.getPublic.and.returnValue(of(invoice));

    TestBed.configureTestingModule({
      imports: [PublicInvoiceComponent],
      providers: [
        { provide: InvoiceService, useValue: service },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap({ token: 'a'.repeat(48) }),
              queryParamMap: convertToParamMap(queryParams)
            }
          }
        }
      ]
    });

    fixture = TestBed.createComponent(PublicInvoiceComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  afterEach(() => TestBed.resetTestingModule());

  // ── Button visibility ──

  it('offers Pay from Bank when Stripe ACH is available', () => {
    setUp(baseInvoice());

    expect(component.options?.stripeAchAvailable).toBeTrue();
    expect(component.isProcessing).toBeFalse();

    const html = fixture.nativeElement.textContent as string;
    expect(html).toContain('Pay from Bank');
    expect(html).toContain('Secure ACH bank payment powered by Stripe.');
  });

  it('hides Pay by Card until the owner enables it', () => {
    setUp(baseInvoice());
    expect(fixture.nativeElement.textContent).not.toContain('Pay by Card');

    const withCard = baseInvoice();
    withCard.paymentOptions.stripeCardAvailable = true;
    TestBed.resetTestingModule();
    setUp(withCard);

    expect(fixture.nativeElement.textContent).toContain('Pay by Card');
  });

  /**
   * Bank details start COLLAPSED. Leading with an account number asks the customer to do the hard
   * version of the job before they have seen the easy one.
   */
  it('keeps the manual bank details collapsed until asked for', () => {
    const invoice = baseInvoice();
    invoice.paymentInstructions = {
      method: 'ACH Bank Transfer',
      bankName: 'Test Bank',
      accountHolder: 'Test Holder INC',
      routingNumber: '000000000',
      accountNumber: '0000000000',
      accountType: 'Business Checking',
      paymentReference: 'DCI-2026-10713354'
    };
    setUp(invoice);

    expect(component.manualAchExpanded).toBeFalse();
    expect(fixture.nativeElement.textContent).not.toContain('000000000');

    component.toggleManualAch();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('000000000');
    expect(fixture.nativeElement.textContent).toContain('Copy Payment Details');
  });

  // ── The processing state ──

  /**
   * THE DUPLICATE-PAYMENT GUARD. ACH takes days and the invoice reads unpaid the whole time, so
   * both pay buttons disappear and the page explains why.
   */
  it('replaces the pay buttons with a processing notice while a payment is in flight', () => {
    const invoice = baseInvoice();
    invoice.paymentOptions = {
      stripeAchAvailable: false,
      stripeCardAvailable: false,
      manualAchAvailable: true,
      paymentInProgress: true,
      processingAmount: 925.43,
      lastAttemptFailed: false,
      achProcessingFee: 0,
      achTotalWithFee: 0,
      achProcessingFeeLabel: 'ACH Processing Fee',
      manualAchFeeNote: 'No processing fee from Dream Cleaning NYC'
    };
    setUp(invoice);

    expect(component.isProcessing).toBeTrue();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Payment processing');
    expect(text).toContain('several business days');
    expect(text).toContain('do not need to submit another payment');
    expect(text).not.toContain('Pay from Bank');
  });

  /**
   * The processing state comes from the BACKEND, never from the redirect. A customer who
   * bookmarks the ?payment=processing URL and returns a week later must see what is true then.
   */
  it('derives the processing state from the server, not from the query string', () => {
    const invoice = baseInvoice();          // server says: nothing in flight
    setUp(invoice, { payment: 'processing' });

    expect(component.justReturnedFromCheckout).toBeTrue();
    // ...but the page does not claim a payment is processing.
    expect(component.isProcessing).toBeFalse();
    expect(fixture.nativeElement.textContent).toContain('Pay from Bank');
  });

  /** A success-shaped redirect must never render as PAID. */
  it('never shows Paid on the strength of a redirect', () => {
    setUp(baseInvoice(), { payment: 'processing' });

    expect(component.isPaid).toBeFalse();
    const text = fixture.nativeElement.textContent as string;
    expect(text).not.toContain('Paid in full');
    expect(text).toContain('925.43');
  });

  it('says so when the customer cancelled', () => {
    setUp(baseInvoice(), { payment: 'cancelled' });

    expect(component.checkoutCancelled).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('Nothing has been charged.');
  });

  // ── Starting a payment ──

  it('sends no amount when starting checkout — the server decides it', () => {
    setUp(baseInvoice());
    service.startCheckout.and.returnValue(of({
      checkoutUrl: 'https://checkout.stripe.com/c/pay/test', attemptId: 1,
      amount: 925.43, processingFee: 5, totalCharged: 930.43
    }));
    // Intercepted: the real one navigates away and would disconnect the test runner.
    const redirect = spyOn<any>(component, 'redirectToCheckout');

    component.payFromBank();

    expect(redirect).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/test');

    expect(service.startCheckout).toHaveBeenCalledWith(
      'a'.repeat(48), InvoicePaymentRecordMethod.AchBankTransfer);

    // Two arguments only: the token and the method. There is nowhere to put an amount.
    const args = service.startCheckout.calls.mostRecent().args;
    expect(args.length).toBe(2);
  });

  it('falls back to the manual details when online payment cannot be started', () => {
    setUp(baseInvoice());

    service.startCheckout.and.returnValue(throwError(() => new HttpErrorResponse({
      status: 503,
      error: {
        message: 'Online bank payment is temporarily unavailable. '
          + 'Please use the alternative payment method.'
      }
    })));

    component.payFromBank();
    fixture.detectChanges();

    expect(component.startingPayment).toBeFalse();
    expect(component.paymentError).toContain('temporarily unavailable');

    // The page re-reads, so the buttons reflect whatever the server now says.
    expect(service.getPublic).toHaveBeenCalledTimes(2);
  });

  /** A double-click must not open two Checkout Sessions. */
  it('does not start a second checkout while one is starting', () => {
    setUp(baseInvoice());
    service.startCheckout.and.returnValue(of({
      checkoutUrl: 'https://checkout.stripe.com/c/pay/test', attemptId: 1,
      amount: 925.43, processingFee: 5, totalCharged: 930.43
    }));
    spyOn<any>(component, 'redirectToCheckout');

    component.startingPayment = true;
    component.payFromBank();

    expect(service.startCheckout).not.toHaveBeenCalled();
  });

  // ── Failure and retry ──

  it('invites a retry after a failed payment, in customer-safe wording', () => {
    const invoice = baseInvoice();
    invoice.paymentOptions.lastAttemptFailed = true;
    invoice.paymentOptions.lastFailureMessage =
      'Bank payment was unsuccessful. Please try again or use another payment method.';
    setUp(invoice);

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Bank payment was unsuccessful');
    // Pay from Bank is still offered — a failed attempt is not in flight.
    expect(text).toContain('Pay from Bank');
    // And no Stripe internals leak through.
    expect(text).not.toContain('account_closed');
  });

  // ── Paid ──

  it('shows the settlement and no payment routes once paid', () => {
    const invoice = baseInvoice();
    invoice.status = InvoiceStatus.Paid;
    invoice.statusLabel = 'Paid';
    invoice.amountPaid = 925.43;
    invoice.balanceDue = 0;
    invoice.paidAt = '2026-09-10';
    invoice.paymentOptions = {
      stripeAchAvailable: false,
      stripeCardAvailable: false,
      manualAchAvailable: false,
      paymentInProgress: false,
      lastAttemptFailed: false,
      achProcessingFee: 0,
      achTotalWithFee: 0,
      achProcessingFeeLabel: 'ACH Processing Fee',
      manualAchFeeNote: 'No processing fee from Dream Cleaning NYC'
    };
    setUp(invoice);

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Paid in full');
    expect(text).not.toContain('Pay from Bank');
    expect(text).not.toContain('Pay by Manual ACH Transfer');
  });

  it('offers nothing on a void invoice', () => {
    const invoice = baseInvoice();
    invoice.status = InvoiceStatus.Void;
    invoice.statusLabel = 'Void';
    invoice.paymentInstructions = undefined;
    invoice.paymentOptions = {
      stripeAchAvailable: false,
      stripeCardAvailable: false,
      manualAchAvailable: false,
      paymentInProgress: false,
      lastAttemptFailed: false,
      achProcessingFee: 0,
      achTotalWithFee: 0,
      achProcessingFeeLabel: 'ACH Processing Fee',
      manualAchFeeNote: 'No processing fee from Dream Cleaning NYC'
    };
    setUp(invoice);

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('cancelled and is not payable');
    expect(text).not.toContain('Pay from Bank');
  });

  // ── Copy payment details ──

  it('copies the bank details including the payment reference', async () => {
    const invoice = baseInvoice();
    invoice.paymentInstructions = {
      method: 'ACH Bank Transfer',
      bankName: 'Test Bank',
      accountHolder: 'Test Holder INC',
      routingNumber: '000000000',
      accountNumber: '0000000000',
      accountType: 'Business Checking',
      paymentReference: 'DCI-2026-10713354'
    };
    setUp(invoice);

    // The clipboard is redefined rather than spied on: `navigator.clipboard` is absent in some
    // headless contexts and may already have been replaced by an earlier spec, either of which
    // makes spyOn throw and turns this into an order-dependent failure.
    let copied = '';
    const original = (navigator as any).clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: (text: string) => {
          copied = text;
          return Promise.resolve();
        }
      },
      configurable: true
    });

    try {
      component.copyPaymentDetails();
      await Promise.resolve();
    } finally {
      Object.defineProperty(navigator, 'clipboard', { value: original, configurable: true });
    }

    expect(copied).toContain('Test Holder INC');
    expect(copied).toContain('000000000');
    // The reference is the one thing that makes a transfer matchable on our side.
    expect(copied).toContain('DCI-2026-10713354');
  });

  // ── The sign of money received ──
  //
  // MONEY RECEIVED IS SHOWN POSITIVE. The ledger stores a payment as a positive row and only a
  // reversal as a negative one, so a decorative "−" on the Amount paid line told a customer who
  // had just paid $925.43 by ACH that $925.43 had been taken back off them. Fixed on the public
  // page, the admin form preview and the PDF at once, because each surface had been deciding the
  // sign for itself and they had already drifted apart.

  /** A settled ACH invoice: Total $925.43, Amount paid $925.43, Balance due $0.00. */
  const paidInvoice = (): PublicInvoice => {
    const invoice = baseInvoice();
    invoice.status = InvoiceStatus.Paid;
    invoice.statusLabel = 'Paid';
    invoice.amountPaid = 925.43;
    invoice.balanceDue = 0;
    invoice.paidAt = '2026-09-08T14:02:00Z';
    invoice.paymentOptions = {
      stripeAchAvailable: false,
      stripeCardAvailable: false,
      manualAchAvailable: false,
      paymentInProgress: false,
      lastAttemptFailed: false,
      achProcessingFee: 0,
      achTotalWithFee: 0,
      achProcessingFeeLabel: 'ACH Processing Fee',
      manualAchFeeNote: 'No processing fee from Dream Cleaning NYC'
    };
    return invoice;
  };

  function totalsRow(label: string): HTMLElement | undefined {
    const rows = Array.from(
      fixture.nativeElement.querySelectorAll('.totals .totals-row')) as HTMLElement[];
    return rows.find(r => (r.textContent ?? '').includes(label));
  }

  it('shows a received payment as a positive amount, never as a deduction', () => {
    setUp(paidInvoice());

    const paid = totalsRow('Amount paid');
    expect(paid).toBeTruthy();

    const text = (paid!.textContent ?? '').trim();
    expect(text).toContain('$925.43');
    // Neither the U+2212 minus the template used, nor an ASCII hyphen.
    expect(text).not.toContain('−');
    expect(text).not.toContain('-');
  });

  it('reads Total $925.43, Amount paid $925.43, Balance due $0.00 once ACH settles', () => {
    setUp(paidInvoice());

    expect((totalsRow('Total')?.textContent ?? '')).toContain('$925.43');
    expect((totalsRow('Amount paid')?.textContent ?? '')).toContain('$925.43');
    expect((totalsRow('Balance due')?.textContent ?? '')).toContain('$0.00');

    // And the confirmation reads as money received, not money returned.
    expect(fixture.nativeElement.textContent).toContain('We received your payment of $925.43');
  });

  /**
   * The other half of the rule. Discount IS a reduction of what is billed, so it keeps its sign —
   * removing the minus from Amount paid must not have swept that away too.
   */
  it('still shows a discount as a deduction', () => {
    const invoice = baseInvoice();
    invoice.subTotal = 1000;
    invoice.discountAmount = 74.57;
    invoice.total = 925.43;
    setUp(invoice);

    expect((totalsRow('Discount')?.textContent ?? '')).toContain('−$74.57');
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════
  //  The ACH processing fee (2026-09)
  // ══════════════════════════════════════════════════════════════════════════════════════════
  //
  // The customer is about to authorize a debit LARGER than the invoice in front of them. Every
  // rule below exists so that is never a surprise, and so the browser is never the thing that
  // decides it.

  it('quotes the exact fee and the exact total debit beside the Pay from Bank button', () => {
    setUp(withAchFee());

    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('ACH Processing Fee');
    expect(text).toContain('$5.00');
    expect(text).toContain('$930.43');

    // Never a bare "Fee" — a vague label on a payment page reads as a hidden markup.
    expect(component.options!.achProcessingFeeLabel).toBe('ACH Processing Fee');
  });

  /**
   * The fee is read STRAIGHT off the server's answer. The browser must not be a second place that
   * decides a fee — the checkout endpoint recalculates from the invoice's own balance, so a
   * tampered page can change what is on screen and nothing else.
   */
  it('displays the server-computed fee and never derives one', () => {
    // A deliberately "uncomputable" pair: 0.8% of 925.43 is $7.40, but the server capped it at
    // $5.00. The page must print what it was told, not what it could work out for itself.
    setUp(withAchFee());

    expect(component.achFee).toBe(5.00);
    expect(fixture.nativeElement.textContent).not.toContain('$7.40');
  });

  /** Fee switched off: no fee row anywhere, and Pay from Bank goes straight through. */
  it('shows no fee at all when the fee is disabled', () => {
    const invoice = baseInvoice();
    invoice.paymentOptions.achProcessingFee = 0;
    invoice.paymentOptions.achTotalWithFee = 925.43;
    setUp(invoice);

    expect(component.achFee).toBe(0);
    expect(fixture.nativeElement.textContent).not.toContain('ACH Processing Fee');

    // With nothing extra to confirm, the button does not interpose a confirmation step.
    spyOn<any>(component, 'redirectToCheckout');
    service.startCheckout.and.returnValue(of({
      checkoutUrl: 'https://checkout.stripe.com/c/pay/test',
      attemptId: 1, amount: 925.43, processingFee: 0, totalCharged: 925.43
    }));

    component.payFromBank();

    expect(component.confirmingBankPayment).toBeFalse();
    expect(service.startCheckout).toHaveBeenCalled();
  });

  /**
   * WITH a fee, "Pay from Bank" opens a confirmation FIRST and starts nothing.
   *
   * The customer sees the three lines — balance, fee, total debit — and has to press again. The
   * one thing they must not do is discover the difference on a bank statement.
   */
  it('confirms the total bank debit before opening Stripe', () => {
    setUp(withAchFee());
    service.startCheckout.and.returnValue(of({
      checkoutUrl: 'https://checkout.stripe.com/c/pay/test',
      attemptId: 1, amount: 925.43, processingFee: 5, totalCharged: 930.43
    }));

    component.payFromBank();
    fixture.detectChanges();

    expect(component.confirmingBankPayment).toBeTrue();
    expect(service.startCheckout).not.toHaveBeenCalled();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Confirm bank payment');
    expect(text).toContain('Total bank debit');
    expect(text).toContain('$930.43');

    // Confirming is what actually starts it.
    spyOn<any>(component, 'redirectToCheckout');
    component.confirmBankPayment();

    expect(service.startCheckout)
      .toHaveBeenCalledWith(jasmine.any(String), InvoicePaymentRecordMethod.AchBankTransfer);
  });

  it('lets the customer back out of the confirmation without charging anything', () => {
    setUp(withAchFee());

    component.payFromBank();
    component.cancelBankPayment();
    fixture.detectChanges();

    expect(component.confirmingBankPayment).toBeFalse();
    expect(service.startCheckout).not.toHaveBeenCalled();
  });

  /**
   * Cancel is a NEUTRAL secondary, never the success/green treatment, and never an unstyled native
   * button. Backing out of a payment is not an achievement, and it must not compete with Continue
   * to Stripe for the eye.
   */
  it('styles Cancel as a neutral secondary rather than a positive action', () => {
    setUp(withAchFee());
    component.payFromBank();
    fixture.detectChanges();

    const buttons: HTMLButtonElement[] =
      Array.from(fixture.nativeElement.querySelectorAll('.pay-confirm-actions button'));
    const cancel = buttons.find(b => b.textContent?.trim() === 'Cancel');

    expect(cancel).withContext('the confirmation offers a way out').toBeDefined();
    expect(cancel!.className).toContain('btn-pay-cancel');
    // .btn-pay is the primary treatment; Cancel must not borrow it.
    expect(cancel!.classList.contains('btn-pay')).toBeFalse();
  });

  /**
   * ONE PRESS, ONE SCROLL. Opening the panel brings it into view and moves focus into it, so on a
   * short viewport something visibly happens. Pressing Pay from Bank again while it is already
   * open must NOT re-scroll — the customer is reading it.
   */
  it('reveals the confirmation once and does not yank the page on a second press', () => {
    setUp(withAchFee());
    const reveal = spyOn<any>(component, 'revealConfirmation').and.stub();

    component.payFromBank();
    fixture.detectChanges();
    expect(reveal).toHaveBeenCalledTimes(1);

    component.payFromBank();
    fixture.detectChanges();
    expect(component.confirmingBankPayment).toBeTrue();
    expect(reveal).toHaveBeenCalledTimes(1);
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════
  //  The abandoned checkout, and what Processing must say when it IS real
  // ══════════════════════════════════════════════════════════════════════════════════════════

  /**
   * OPENING STRIPE IS NOT PAYING.
   *
   * A customer who pressed Pay from Bank, looked at the Stripe page and closed the tab has
   * submitted nothing. The server answers `paymentInProgress: false` for that attempt, and this
   * page must render a payable invoice — not a Processing banner and a dead button.
   */
  it('stays payable after the customer abandons the Stripe page', () => {
    setUp(baseInvoice(), { payment: 'cancelled' });

    expect(component.isProcessing).toBeFalse();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Pay from Bank');
    expect(text).not.toContain('Payment processing');
  });

  /**
   * When a payment IS settling, the banner explains the customer's BANK STATEMENT — which shows a
   * single debit LARGER than the invoice. All three figures, from the server.
   */
  it('breaks the processing debit into invoice, fee and total', () => {
    const invoice = baseInvoice();
    invoice.paymentOptions = {
      stripeAchAvailable: false,
      stripeCardAvailable: false,
      manualAchAvailable: true,
      paymentInProgress: true,
      processingAmount: 925.43,
      processingFeeAmount: 5.00,
      processingTotalCharged: 930.43,
      lastAttemptFailed: false,
      achProcessingFee: 0,
      achTotalWithFee: 0,
      achProcessingFeeLabel: 'ACH Processing Fee',
      manualAchFeeNote: 'No processing fee from Dream Cleaning NYC'
    };
    setUp(invoice);

    const breakdown: HTMLElement | null =
      fixture.nativeElement.querySelector('.processing-breakdown');
    expect(breakdown).withContext('the banner shows what the bank will debit').not.toBeNull();

    const text = breakdown!.textContent as string;
    expect(text).toContain('Invoice payment');
    expect(text).toContain('$925.43');
    expect(text).toContain('ACH Processing Fee');
    expect(text).toContain('$5.00');
    expect(text).toContain('Total bank debit');
    expect(text).toContain('$930.43');
  });

  /** No fee was charged, so no fee line — a "$0.00 fee" row invites a question about nothing. */
  it('omits the fee line from the processing banner when there was no fee', () => {
    const invoice = baseInvoice();
    invoice.paymentOptions = {
      ...invoice.paymentOptions,
      stripeAchAvailable: false,
      paymentInProgress: true,
      processingAmount: 925.43,
      processingFeeAmount: 0,
      processingTotalCharged: 925.43
    };
    setUp(invoice);

    const text = fixture.nativeElement.querySelector('.processing-breakdown')!.textContent as string;
    expect(text).toContain('Invoice payment');
    expect(text).not.toContain('ACH Processing Fee');
  });

  /**
   * Manual ACH is a SECOND WAY TO PAY, presented like one: an icon, a title and a one-line
   * explanation, with the no-fee wording as a small badge rather than a loose green sentence
   * hanging under the accordion.
   */
  it('presents manual ACH as a payment method, with the no-fee wording as a badge', () => {
    setUp(baseInvoice());

    const toggle: HTMLElement | null = fixture.nativeElement.querySelector('.manual-toggle');
    expect(toggle).not.toBeNull();
    expect(toggle!.querySelector('.manual-icon')).withContext('bank icon').not.toBeNull();
    expect(toggle!.querySelector('.manual-title')!.textContent)
      .toContain('Pay by Manual ACH Transfer');
    expect(toggle!.querySelector('.manual-sub')!.textContent!.trim().length).toBeGreaterThan(0);

    const badge: HTMLElement | null = toggle!.querySelector('.manual-badge');
    expect(badge).withContext('a chip, not a loose sentence').not.toBeNull();
    expect(badge!.textContent).toContain('No processing fee from Dream Cleaning NYC');

    // The old loose-sentence element is gone for good.
    expect(fixture.nativeElement.querySelector('.manual-fee-note')).toBeNull();
  });

  /**
   * MANUAL ACH IS THE INVOICE BALANCE AND NOTHING MORE, and it says so in words that do not
   * promise anything about the customer's OWN bank — which may still charge them for sending a
   * transfer. A flat "No fee" would be a statement about somebody else's pricing.
   */
  it('says manual transfer carries no Dream Cleaning fee, without promising "no fee"', () => {
    setUp(baseInvoice());

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('No processing fee from Dream Cleaning NYC');
    expect(text).not.toContain('No fee');
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════
  //  Tax, service dates and the company header
  // ══════════════════════════════════════════════════════════════════════════════════════════

  /**
   * A TAX-INCLUSIVE INVOICE STATES THE TAX IN DOLLARS.
   *
   * This row used to print the bare word "Included", which stated the tax nowhere at all: the
   * client could not reconcile it against a sales-tax return, and the subtotal beside it looked
   * wrong too. The "(included)" note handles the original misreading directly instead.
   */
  it('shows the real tax amount on a tax-inclusive invoice, marked as included', () => {
    const invoice = baseInvoice();
    invoice.taxType = InvoiceTaxType.Included;
    invoice.taxRate = 8.875;
    invoice.taxAmount = 75.44;
    setUp(invoice);

    const text = totalsRow('Sales tax')?.textContent ?? '';

    expect(text).toContain('$75.44');
    expect(text).toContain('8.875');
    expect(text).toContain('(included)');
  });

  it('still says Exempt when there is no tax', () => {
    setUp(baseInvoice());
    expect(totalsRow('Sales tax')?.textContent ?? '').toContain('Exempt');
  });

  /**
   * THE TRADING NAME LEADS. The customer booked Dream Cleaning NYC and will look for it on a bank
   * statement; the registered entity is the legal footnote underneath.
   */
  it('leads the company header with the trading name', () => {
    setUp(baseInvoice());

    const name = fixture.nativeElement.querySelector('.company-name') as HTMLElement;
    const dba = fixture.nativeElement.querySelector('.company-dba') as HTMLElement;

    expect(name.textContent).toContain('DBA Test Cleaning');
    expect(dba.textContent).toContain('Test Company Inc.');
  });

  /**
   * The service line uses the LABEL that matches what the invoice records, and is absent entirely
   * when it records nothing — an invented period looks authoritative, and that is the failure this
   * whole area exists to prevent.
   */
  it('names the service dates with the label the server resolved', () => {
    const invoice = baseInvoice();
    invoice.serviceDates = ['2026-10-07', '2026-10-14', '2026-10-21', '2026-10-28'];
    invoice.serviceDateLabel = 'Service dates';
    invoice.serviceDateText = 'October 7, 14, 21, 28, 2026';
    setUp(invoice);

    expect(fixture.nativeElement.textContent)
      .toContain('Service dates: October 7, 14, 21, 28, 2026');
  });

  it('prints no service line at all when the invoice records no period', () => {
    setUp(baseInvoice());

    expect(component.servicePeriod).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Service period:');
    expect(fixture.nativeElement.textContent).not.toContain('Service date:');
  });
});
