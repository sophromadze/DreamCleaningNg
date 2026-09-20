import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { BillingService, cardExpiry, cardLabel } from './billing.service';
import { testProviders } from '../../testing/test-providers';

describe('BillingService', () => {
  let service: BillingService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [...testProviders] });
    service = TestBed.inject(BillingService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('names cards the one way the whole UI does', () => {
    expect(cardLabel({ brand: 'visa', last4: '4242' })).toBe('Visa ending 4242');
    expect(cardLabel({ brand: null, last4: null })).toBe('Card');
    expect(cardExpiry({ expMonth: 3, expYear: 2029 })).toBe('03/29');
    expect(cardExpiry({ expMonth: null, expYear: null })).toBe('');
  });

  it('asks the server whether saved cards are on — once — and reads a failure as OFF', () => {
    let first: boolean | undefined;
    let second: boolean | undefined;
    service.savedCardsEnabled().subscribe(v => first = v);
    service.savedCardsEnabled().subscribe(v => second = v);

    const req = http.expectOne(r => r.url.endsWith('/billing/config'));
    req.flush('boom', { status: 500, statusText: 'Server Error' });

    expect(first).toBeFalse();
    expect(second).toBeFalse();
  });

  // The card is recorded AFTER the payment is confirmed, so a failure here is not a payment
  // failure and must never reach the customer as one.
  it('turns a failed card recording into null, leaving the completed payment alone', () => {
    let result: unknown = 'untouched';
    service.saveCardFromPayment('pi_123').subscribe(card => result = card);
    const req = http.expectOne(r => r.url.endsWith('/billing/cards/from-payment'));
    expect(req.request.body).toEqual({ paymentIntentId: 'pi_123' });
    req.flush('boom', { status: 500, statusText: 'Server Error' });
    expect(result).toBeNull();
  });

  it('never sends an amount when paying an invoice with a saved card', () => {
    service.payInvoiceWithSavedCard(5, 9).subscribe();
    const req = http.expectOne(r => r.url.endsWith('/billing/invoices/5/pay-with-saved-card'));
    expect(req.request.body).toEqual({ cardId: 9 });
    req.flush({});
  });
});
