import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
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
