import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { PAY_ALL_UNCONFIRMED_MESSAGE, UpcomingRecurringOrdersComponent } from './upcoming-recurring-orders.component';
import { StripeService } from '../../../services/stripe.service';
import { UpcomingRecurringOrders } from '../../../services/recurring-order.service';
import { environment } from '../../../../environments/environment';
import { testProviders } from '../../../../testing/test-providers';

const UPCOMING_URL = `${environment.apiUrl}/my-recurring-orders`;
const PAY_ALL_URL = `${environment.apiUrl}/my-recurring-orders/pay-all`;

/**
 * The customer's upcoming recurring cleanings on My Orders.
 *
 * What these specs pin down is that the component OBEYS the server rather than re-deciding
 * anything: the order of the list, which cleaning may be paid, and what a combined payment costs
 * are all the server's answers. A second copy of the sequential-unlock rule here is precisely how
 * the button and the endpoint would come to disagree.
 */
describe('UpcomingRecurringOrdersComponent', () => {
  let fixture: ComponentFixture<UpcomingRecurringOrdersComponent>;
  let component: UpcomingRecurringOrdersComponent;
  let httpMock: HttpTestingController;

  /** Three fortnightly cleanings: the first payable, the two behind it waiting. */
  function upcoming(overrides: Partial<UpcomingRecurringOrders> = {}): UpcomingRecurringOrders {
    return {
      orders: [
        {
          orderId: 11, serviceDate: '2026-10-04T00:00:00', serviceTime: '09:00:00',
          serviceTypeName: 'Regular Cleaning', status: 'Pending',
          total: 150, amountDue: 150, isPaid: false,
          isPayable: true, queuePosition: 1, blockedReason: null
        },
        {
          orderId: 12, serviceDate: '2026-10-18T00:00:00', serviceTime: '09:00:00',
          serviceTypeName: 'Regular Cleaning', status: 'Pending',
          total: 150, amountDue: 150, isPaid: false,
          isPayable: false, queuePosition: 2,
          blockedReason: 'Available to pay once the cleaning before it has been paid.'
        },
        {
          orderId: 13, serviceDate: '2026-11-01T00:00:00', serviceTime: '09:00:00',
          serviceTypeName: 'Regular Cleaning', status: 'Pending',
          total: 150, amountDue: 150, isPaid: false,
          isPayable: false, queuePosition: 3,
          blockedReason: 'Available to pay once the cleaning before it has been paid.'
        }
      ],
      payAllTotal: 450,
      payAllCount: 3,
      canPayAll: true,
      ...overrides
    };
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UpcomingRecurringOrdersComponent],
      providers: [...testProviders]
    }).compileComponents();

    fixture = TestBed.createComponent(UpcomingRecurringOrdersComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  function load(data: UpcomingRecurringOrders = upcoming()): void {
    fixture.detectChanges();
    httpMock.expectOne(UPCOMING_URL).flush(data);
    fixture.detectChanges();
  }

  it('shows the online payment selection and explicitly excludes Cash and Invoice', () => {
    const data = upcoming();
    data.orders[0].includedInPayAll = true; data.orders[0].paymentMethod = 'Normal';
    data.orders[1] = { ...data.orders[1], paymentMethod: 'Cash', includedInPayAll: false, isPaid: true };
    data.orders[2] = { ...data.orders[2], paymentMethod: 'Invoice', includedInPayAll: false };
    data.payAllCount = 1; data.payAllTotal = 150;
    load(data); component.showPayAll = true; fixture.detectChanges();
    const text = fixture.nativeElement.querySelector('.uro-modal-list').textContent;
    expect(text).toContain('excluded (Cash)'); expect(text).toContain('excluded (Invoice)');
    expect(component.orders.map(o => o.paymentMethod)).toEqual(['Normal', 'Cash', 'Invoice']);
    expect(fixture.nativeElement.querySelector('.uro-modal-summary').textContent).toContain('$150.00');
  });

  it('lists every generated cleaning in the horizon, nearest first', () => {
    load();

    expect(component.orders.length).toBe(3);
    // The SERVER sorts; the component must not re-sort, or the two would disagree the first time
    // a tie-break mattered.
    expect(component.orders.map(o => o.orderId)).toEqual([11, 12, 13]);

    const dates: NodeListOf<HTMLElement> =
      fixture.nativeElement.querySelectorAll('.uro-date');
    expect(dates.length).toBe(3);
  });

  it('offers a Pay button only on the nearest unpaid cleaning', () => {
    load();

    const payButtons: NodeListOf<HTMLElement> =
      fixture.nativeElement.querySelectorAll('.uro-item .uro-pay-btn');
    expect(payButtons.length).withContext('only the head of the queue is payable').toBe(1);
  });

  it('says WHY the later ones are not payable, rather than leaving them inert', () => {
    load();

    const blocked: NodeListOf<HTMLElement> =
      fixture.nativeElement.querySelectorAll('.uro-blocked');
    expect(blocked.length).toBe(2);
    expect(blocked[0].textContent).toContain('once the cleaning before it has been paid');
  });

  it('exposes the next one once the nearest has been paid', () => {
    // The unlock itself is the server's; what matters here is that the component renders whatever
    // it is told rather than caching a decision of its own.
    const data = upcoming();
    data.orders[0] = { ...data.orders[0], isPaid: true, amountDue: 0, isPayable: false, queuePosition: 0 };
    data.orders[1] = { ...data.orders[1], isPayable: true, queuePosition: 1, blockedReason: null };
    data.payAllTotal = 300;
    data.payAllCount = 2;

    load(data);

    expect(component.orders[0].isPaid).toBeTrue();
    const payButtons: NodeListOf<HTMLElement> =
      fixture.nativeElement.querySelectorAll('.uro-item .uro-pay-btn');
    expect(payButtons.length).toBe(1);
    expect(fixture.nativeElement.querySelector('.uro-paid')).not.toBeNull();
  });

  it('shows the combined total the SERVER computed', () => {
    load();

    const button: HTMLElement = fixture.nativeElement.querySelector('.uro-payall-btn');
    expect(button).not.toBeNull();
    expect(button.textContent).toContain('450');
  });

  it('does not offer "pay all" for a single outstanding cleaning', () => {
    // It is already individually payable; a second button doing the same thing is noise.
    load(upcoming({ canPayAll: false, payAllCount: 1, payAllTotal: 150 }));

    expect(fixture.nativeElement.querySelector('.uro-payall-btn')).toBeNull();
  });

  it('sends NEITHER an amount NOR a list of order ids when paying all', async () => {
    load();

    component.openPayAll();

    const request = httpMock.expectOne(PAY_ALL_URL);
    // The whole trust model: the server derives both from the signed-in customer's own upcoming
    // cleanings, so a tampered page can change what is on screen and nothing else.
    expect(request.request.body.amount).toBeUndefined();
    expect(request.request.body.total).toBeUndefined();
    expect(request.request.body.orderIds).toBeUndefined();

    request.flush({
      batchId: 5, amount: 450, orderIds: [11, 12, 13],
      paymentIntentId: 'pi_test', paymentClientSecret: 'pi_test_secret', requiresPayment: true
    });
  });

  it('renders nothing at all for a customer with no recurring plan', () => {
    load(upcoming({ orders: [], payAllCount: 0, payAllTotal: 0, canPayAll: false }));

    expect(component.hasAny).toBeFalse();
    expect(fixture.nativeElement.querySelector('.uro')).toBeNull();
  });

  it('refreshes authoritative payability after closing an unpaid card form', () => {
    load(); component.showPayAll = true;
    component.closePayAll();
    httpMock.expectOne(UPCOMING_URL).flush(upcoming()); fixture.detectChanges();
    expect(component.showPayAll).toBeFalse();
    expect(fixture.nativeElement.querySelector('.uro-payall-btn')).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.uro-item .uro-pay-btn').length).toBe(1);
    expect(fixture.nativeElement.textContent).not.toContain('Payment is already being processed');
  });

  it('survives a failed load without taking the order list down with it', () => {
    fixture.detectChanges();
    httpMock.expectOne(UPCOMING_URL).flush(
      { message: 'boom' }, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(component.errorMessage).toBeTruthy();
    // The section reports itself as broken; it does not throw, and the page around it is fine.
    expect(fixture.nativeElement.querySelector('.uro-error')).not.toBeNull();
  });

  // ── Pay all: an unanswered card step is never reported as a failed payment (2026-09) ──

  it('never tells the customer the payment failed when Stripe.js throws instead of answering', async () => {
    load();
    const stripe = TestBed.inject(StripeService);
    spyOn(stripe, 'confirmCardPayment').and.returnValue(Promise.reject(new Error('network down')));
    (component as any).clientSecret = 'secret_1';

    await component.confirmPayAll();

    expect(component.payAllError).toBe(PAY_ALL_UNCONFIRMED_MESSAGE);
    expect(component.payAllError).toContain("don't pay again");
    expect(component.payAllError).not.toMatch(/could not be completed|declined|failed/i);
    expect(component.payingAll).toBeFalse();
  });

  it('still reports a genuine card decline as a decline', async () => {
    load();
    const stripe = TestBed.inject(StripeService);
    spyOn(stripe, 'confirmCardPayment').and.returnValue(Promise.resolve({ error: { message: 'Your card was declined.' } } as any));
    (component as any).clientSecret = 'secret_1';

    await component.confirmPayAll();

    expect(component.payAllError).toBe('Your card was declined.');
  });
});
