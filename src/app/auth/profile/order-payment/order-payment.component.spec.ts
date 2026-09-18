import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { EMPTY, of } from 'rxjs';

import { OrderPaymentComponent } from './order-payment.component';
import { AuthService } from '../../../services/auth.service';
import { BookingService } from '../../../services/booking.service';
import { OrderService, Order } from '../../../services/order.service';
import { StripeService } from '../../../services/stripe.service';
import { CardOnFileService } from '../../../services/card-on-file.service';
import { testProviders } from '../../../../testing/test-providers';

/**
 * THE PAYMENT-PAGE CONSENT GATE.
 *
 * An order booked by an admin over the phone reaches the customer as a payment link, and its
 * customer never saw the /booking form's SMS / cancellation-fee / terms checkboxes — the admin
 * ticked those. So the payment page re-asks, and it must not request a PaymentIntent until the
 * payer agrees: that request is what yields the client secret, i.e. the ability to charge a card.
 *
 * The regressions these specs exist to catch:
 *   - asking a self-booking customer to consent twice,
 *   - asking again on a follow-up (additional) payment,
 *   - creating the PaymentIntent before consent — which would make the checkboxes decorative.
 */
describe('OrderPaymentComponent — consent gate', () => {
  let fixture: ComponentFixture<OrderPaymentComponent>;
  let component: OrderPaymentComponent;
  let bookingService: jasmine.SpyObj<BookingService>;
  let orderService: jasmine.SpyObj<OrderService>;

  const USER_ID = 42;

  function makeOrder(overrides: Partial<Order> = {}): Order {
    return {
      id: 7,
      userId: USER_ID,
      serviceTypeId: 1,
      serviceTypeName: 'Residential Cleaning',
      orderDate: new Date(),
      serviceDate: new Date(),
      serviceTime: '10:00:00',
      status: 'Pending',
      subTotal: 200,
      tax: 17.75,
      tips: 0,
      total: 217.75,
      isPaid: false,
      paymentMethod: 'Normal',
      services: [],
      extraServices: [],
      ...overrides
    } as unknown as Order;
  }

  function setup(order: Order): void {
    orderService.getOrderById.and.returnValue(of(order));
    fixture = TestBed.createComponent(OrderPaymentComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(async () => {
    bookingService = jasmine.createSpyObj<BookingService>('BookingService', [
      'acceptPaymentConsent', 'createPaymentIntentForOrder', 'confirmPayment'
    ]);
    // Never emits: the specs assert the CALL, not the Stripe mounting that follows it.
    bookingService.createPaymentIntentForOrder.and.returnValue(EMPTY);
    bookingService.acceptPaymentConsent.and.returnValue(
      of({ orderId: 7, acceptedAt: '2026-08-18T15:00:00Z' })
    );

    orderService = jasmine.createSpyObj<OrderService>('OrderService', [
      'getOrderById', 'getOrderByIdGuest', 'createPendingUpdatePaymentIntent'
    ]);
    orderService.createPendingUpdatePaymentIntent.and.returnValue(EMPTY);

    await TestBed.configureTestingModule({
      imports: [OrderPaymentComponent],
      providers: [
        ...testProviders,
        { provide: BookingService, useValue: bookingService },
        { provide: OrderService, useValue: orderService },
        {
          provide: AuthService,
          useValue: { currentUser: of({ id: USER_ID }), refreshUserProfile: () => of(null) }
        },
        {
          provide: StripeService,
          useValue: jasmine.createSpyObj('StripeService', [
            'initializeElements', 'createCardElement', 'destroyCardElement',
            'destroyPaymentRequestButton', 'createPaymentRequest', 'createPaymentRequestButton',
            'confirmCardPayment', 'confirmPaymentRequest'
          ])
        },
        {
          provide: CardOnFileService,
          useValue: { getSavedCard: () => of({ card: null }) }
        },
        {
          provide: ActivatedRoute,
          useValue: {
            params: of({ id: '7' }),
            snapshot: { queryParamMap: { get: () => null } }
          }
        }
      ]
    }).compileComponents();
  });

  it('blocks the payment intent on an admin-created order until consent is given', () => {
    setup(makeOrder({ bookedByAdmin: true }));

    expect(component.consentRequired).toBeTrue();
    expect(component.consentAccepted).toBeFalse();
    expect(component.showPaymentSection).toBeFalse();
    // The gate is only real if no client secret is requested — without one, no card can be charged.
    expect(bookingService.createPaymentIntentForOrder).not.toHaveBeenCalled();
  });

  it('records consent and only then creates the payment intent', () => {
    setup(makeOrder({ bookedByAdmin: true }));

    component.smsConsent = true;
    component.cancellationConsent = true;
    component.acceptConsentAndContinue();
    // Two of three: still nothing recorded, still nothing chargeable.
    expect(bookingService.acceptPaymentConsent).not.toHaveBeenCalled();
    expect(bookingService.createPaymentIntentForOrder).not.toHaveBeenCalled();

    component.termsConsent = true;
    component.acceptConsentAndContinue();

    expect(bookingService.acceptPaymentConsent).toHaveBeenCalledWith(
      7, { smsConsent: true, cancellationConsent: true, termsConsent: true }, undefined
    );
    expect(bookingService.createPaymentIntentForOrder).toHaveBeenCalled();
    expect(component.showPaymentSection).toBeTrue();
  });

  it('does not ask a self-booking customer to consent again', () => {
    setup(makeOrder({ bookedByAdmin: false }));

    expect(component.consentRequired).toBeFalse();
    expect(component.showPaymentSection).toBeTrue();
    expect(bookingService.createPaymentIntentForOrder).toHaveBeenCalled();
  });

  it('skips the gate once consent is already recorded on the order', () => {
    setup(makeOrder({ bookedByAdmin: true, paymentConsentAcceptedAt: '2026-08-17T12:00:00Z' }));

    expect(component.consentAccepted).toBeTrue();
    expect(component.showPaymentSection).toBeTrue();
    expect(bookingService.createPaymentIntentForOrder).toHaveBeenCalled();
  });

  it('never gates an additional payment on an already-paid admin order', () => {
    setup(makeOrder({ bookedByAdmin: true, isPaid: true, pendingUpdateAmount: 40 }));

    expect(component.paymentType).toBe('update');
    expect(component.consentRequired).toBeFalse();
    expect(orderService.createPendingUpdatePaymentIntent).toHaveBeenCalled();
  });

  it('keeps the payer on the checkboxes when recording consent fails', () => {
    setup(makeOrder({ bookedByAdmin: true }));
    bookingService.acceptPaymentConsent.and.returnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { subscribe: ({ error }: any) => error({ error: { message: 'nope' } }) } as any
    );

    component.smsConsent = true;
    component.cancellationConsent = true;
    component.termsConsent = true;
    component.acceptConsentAndContinue();

    expect(component.consentError).toBe('nope');
    expect(component.consentAccepted).toBeFalse();
    expect(bookingService.createPaymentIntentForOrder).not.toHaveBeenCalled();
  });
});

/**
 * PART-PAYMENTS ON THE PAYMENT PAGE.
 *
 * An admin can agree a deposit with the customer and ask for it on its own — "$1,000 now, the
 * rest before the cleaning". The order stays unpaid and carries a balance until the last slice
 * lands, so this page has to charge the REQUESTED amount rather than the order's total, and say
 * plainly why the figure is smaller than the one the customer was quoted.
 *
 * The regressions these exist to catch:
 *   - charging order.total on an order that has already taken a deposit (double-charging it),
 *   - treating a deposit as a completed booking on the success screen,
 *   - skipping the consent gate because the payment "isn't the full amount",
 *   - dead-ending the payer when the admin cancels the request out from under them.
 */
describe('OrderPaymentComponent — part-payments', () => {
  let fixture: ComponentFixture<OrderPaymentComponent>;
  let component: OrderPaymentComponent;
  let bookingService: jasmine.SpyObj<BookingService>;
  let orderService: jasmine.SpyObj<OrderService>;
  let stripeService: jasmine.SpyObj<StripeService>;

  const USER_ID = 42;

  function makeOrder(overrides: Partial<Order> = {}): Order {
    return {
      id: 7,
      userId: USER_ID,
      serviceTypeId: 1,
      serviceTypeName: 'Residential Cleaning',
      orderDate: new Date(),
      serviceDate: new Date(),
      serviceTime: '10:00:00',
      status: 'Pending',
      subTotal: 2519.93,
      tax: 223.72,
      tips: 0,
      total: 2743.65,
      isPaid: false,
      paymentMethod: 'Normal',
      services: [],
      extraServices: [],
      ...overrides
    } as unknown as Order;
  }

  /** An order carrying a live $1,000 request against a $2,743.65 total. */
  function orderWithRequest(overrides: Partial<Order> = {}): Order {
    return makeOrder({
      amountPaid: 0,
      amountDue: 2743.65,
      isPartiallyPaid: false,
      pendingPartialPayment: {
        id: 3,
        orderId: 7,
        requestedAmount: 1000,
        status: 'Pending',
        createdAt: '2026-09-15T12:00:00Z'
      },
      ...overrides
    });
  }

  function setup(order: Order): void {
    orderService.getOrderById.and.returnValue(of(order));
    fixture = TestBed.createComponent(OrderPaymentComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(async () => {
    // Stubbed so the Stripe mount that follows a successful intent is a no-op: these specs are
    // about which amount is charged, not about Elements.
    stripeService = jasmine.createSpyObj<StripeService>("StripeService", [
      "initializeElements", "createCardElement", "destroyCardElement",
      "destroyPaymentRequestButton", "createPaymentRequest", "createPaymentRequestButton",
      "confirmCardPayment", "confirmPaymentRequest"
    ]);
    stripeService.initializeElements.and.returnValue(Promise.resolve() as any);
    stripeService.createCardElement.and.returnValue({ on: () => {} } as any);
    stripeService.createPaymentRequest.and.returnValue(Promise.resolve(null) as any);

    bookingService = jasmine.createSpyObj<BookingService>('BookingService', [
      'acceptPaymentConsent', 'createPaymentIntentForOrder', 'confirmPayment',
      'createPartialPaymentIntent', 'confirmPartialPayment'
    ]);
    bookingService.createPaymentIntentForOrder.and.returnValue(EMPTY);
    bookingService.createPartialPaymentIntent.and.returnValue(EMPTY);
    bookingService.confirmPartialPayment.and.returnValue(EMPTY);
    bookingService.acceptPaymentConsent.and.returnValue(
      of({ orderId: 7, acceptedAt: '2026-09-15T15:00:00Z' })
    );

    orderService = jasmine.createSpyObj<OrderService>('OrderService', [
      'getOrderById', 'getOrderByIdGuest', 'createPendingUpdatePaymentIntent'
    ]);
    orderService.createPendingUpdatePaymentIntent.and.returnValue(EMPTY);

    await TestBed.configureTestingModule({
      imports: [OrderPaymentComponent],
      providers: [
        ...testProviders,
        { provide: BookingService, useValue: bookingService },
        { provide: OrderService, useValue: orderService },
        {
          provide: AuthService,
          useValue: { currentUser: of({ id: USER_ID }), refreshUserProfile: () => of(null) }
        },
        { provide: StripeService, useValue: stripeService },
        { provide: CardOnFileService, useValue: { getSavedCard: () => of({ card: null }) } },
        {
          provide: ActivatedRoute,
          useValue: {
            params: of({ id: '7' }),
            snapshot: { queryParamMap: { get: () => null } }
          }
        }
      ]
    }).compileComponents();
  });

  it('charges the amount the admin asked for, not the order total', () => {
    setup(orderWithRequest());

    expect(component.paymentType).toBe('partial');
    expect(component.orderTotal).toBe(1000);
    expect(component.remainingAfterPayment).toBe(1743.65);
    expect(component.isFinalPartialPayment).toBeFalse();
    expect(bookingService.createPartialPaymentIntent).toHaveBeenCalledWith(7, undefined, false);
    expect(bookingService.createPaymentIntentForOrder).not.toHaveBeenCalled();
  });

  it('asks only for the outstanding balance when a deposit has already been paid', () => {
    // No new request open — the customer came back through a plain payment link. Charging
    // order.total here would take the $1,000 deposit a second time.
    setup(makeOrder({ amountPaid: 1000, amountDue: 1743.65, isPartiallyPaid: true }));

    expect(component.paymentType).toBe('order');
    expect(component.orderTotal).toBe(1743.65);
    expect(component.amountAlreadyPaid).toBe(1000);
    expect(bookingService.createPaymentIntentForOrder).toHaveBeenCalled();
  });

  it('clamps the request to what is still owed', () => {
    // An admin lowered the price after asking for the deposit. The old, larger figure must not
    // survive into the charge.
    setup(orderWithRequest({ total: 600, amountDue: 600 }));

    expect(component.orderTotal).toBe(600);
    expect(component.isFinalPartialPayment).toBeTrue();
  });

  it('lets the payer settle the whole balance instead', () => {
    setup(orderWithRequest());
    bookingService.createPartialPaymentIntent.calls.reset();

    component.selectPayFullBalance(true);

    expect(component.payFullBalance).toBeTrue();
    // Re-asked rather than re-computed locally: the server decides the amount and cancels the
    // previous client secret before issuing a replacement.
    expect(bookingService.createPartialPaymentIntent).toHaveBeenCalledWith(7, undefined, true);
  });

  it('adopts the amount the server says it will charge', () => {
    bookingService.createPartialPaymentIntent.and.returnValue(of({
      orderId: 7, partialPaymentId: 3, amount: 1000, requestedAmount: 1000,
      amountDue: 2743.65, remainingAfterPayment: 1743.65, isFinalPayment: false,
      paymentIntentId: 'pi_1', paymentClientSecret: 'secret', requiresPayment: true
    }) as any);

    setup(orderWithRequest());

    expect(component.orderTotal).toBe(1000);
    expect(component.remainingAfterPayment).toBe(1743.65);
  });

  it('still gates an admin-created order on consent — a deposit is a first payment', () => {
    setup(orderWithRequest({ bookedByAdmin: true }));

    expect(component.consentRequired).toBeTrue();
    expect(bookingService.createPartialPaymentIntent).not.toHaveBeenCalled();
  });

  it('falls back to the full balance when the request was cancelled underneath the payer', () => {
    bookingService.createPartialPaymentIntent.and.returnValue(
      { subscribe: ({ error }: any) => error({ status: 400, error: { noPartialRequest: true } }) } as any
    );

    setup(orderWithRequest());

    expect(component.paymentType).toBe('order');
    expect(component.orderTotal).toBe(2743.65);
    expect(bookingService.createPaymentIntentForOrder).toHaveBeenCalled();
    expect(component.errorMessage).toBe('');
  });

  it('reports the remaining balance instead of confirming a booking that is not paid for', () => {
    setup(orderWithRequest());

    component['handlePaymentSuccess']({ orderFullyPaid: false, amountDue: 1743.65 });

    expect(component.paymentCompleted).toBeTrue();
    expect(component.partialPaymentRemaining).toBe(1743.65);
  });

  it('confirms the booking once the final slice clears the balance', () => {
    setup(orderWithRequest());
    // A settled order redirects to booking-success; the spy keeps that out of the assertion.
    spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);

    // The server hands the last slice to the ordinary confirmation path, whose response has no
    // orderFullyPaid flag at all — absent must read as "settled", not as "still owing".
    component['handlePaymentSuccess']({ success: true, orderId: 7, status: 'Active' });

    expect(component.partialPaymentRemaining).toBeNull();
  });
});
