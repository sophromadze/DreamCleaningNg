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
      lastAttemptFailed: false
    },
    company: { legalName: 'Test Company Inc.' }
  });

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
      lastAttemptFailed: false
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
      checkoutUrl: 'https://checkout.stripe.com/c/pay/test', attemptId: 1, amount: 925.43
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
      checkoutUrl: 'https://checkout.stripe.com/c/pay/test', attemptId: 1, amount: 925.43
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
      lastAttemptFailed: false
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
      lastAttemptFailed: false
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
      lastAttemptFailed: false
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
});
