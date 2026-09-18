import { ComponentFixture, TestBed } from '@angular/core/testing';

import { of } from 'rxjs';

import { BookingConfirmationComponent } from './booking-confirmation.component';
import { BookingDataService } from '../../services/booking-data.service';
import { BookingService } from '../../services/booking.service';
import { StripeService } from '../../services/stripe.service';
import { OrderSoundService } from '../../services/order-sound.service';
import { Router } from '@angular/router';

import { testProviders } from '../../../testing/test-providers';

describe('BookingConfirmationComponent', () => {
  let component: BookingConfirmationComponent;
  let fixture: ComponentFixture<BookingConfirmationComponent>;
  let bookingDataService: BookingDataService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [...testProviders],
      imports: [BookingConfirmationComponent]
    })
    .compileComponents();

    bookingDataService = TestBed.inject(BookingDataService);
    fixture = TestBed.createComponent(BookingConfirmationComponent);
    component = fixture.componentInstance;
    // NOTE: detectChanges() is deliberately left to each test — the whole point of
    // the regression case below is what the FIRST change-detection pass does.
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  // Regression guard. BookingDataService keeps booking data in an in-memory
  // BehaviorSubject seeded with null (no sessionStorage), so a refresh or deep-link
  // onto /booking-confirmation arrives with bookingData === null. ngOnInit redirects
  // away, but router.navigate is async — the template still renders once in the same
  // change-detection pass. It used to deref bookingData.serviceDate unguarded and
  // throw "Cannot read properties of null (reading 'serviceDate')".
  it('should not throw during first render when bookingData is null', () => {
    expect(bookingDataService.getBookingData()).toBeNull();

    expect(() => fixture.detectChanges()).not.toThrow();

    expect(component.bookingData).toBeNull();
    // Withheld entirely rather than rendered half-built.
    expect(fixture.nativeElement.querySelector('.confirmation-content')).toBeNull();
  });

  // Guards the fix's additivity: adding `&& bookingData` must not suppress the
  // block in the normal case (data present, payment not yet completed).
  it('should still render the confirmation content when bookingData is present', () => {
    bookingDataService.setBookingData({
      serviceDate: '2026-08-20',
      serviceTime: '10:00',
      total: 250
    });

    fixture.detectChanges();

    expect(component.paymentCompleted).toBeFalse();
    expect(component.bookingData).toBeTruthy();

    const content: HTMLElement | null =
      fixture.nativeElement.querySelector('.confirmation-content');
    expect(content).not.toBeNull();
    expect(content!.textContent).toContain('Booking Summary');
  });

  // ── a retry after the card was already charged (2026-09-16) ──────────────────────────────
  //
  // The incident: confirm-payment charged the card, created the order, then failed in its
  // notification tail. The customer read the error as a decline and pressed Pay again — and
  // prepare-payment happily minted a second PaymentIntent, so one cleaning was charged twice
  // ($386.16, 33 seconds apart, orders 369 and 370).
  //
  // The server now answers a retry with what it found. These two tests are the page's half of
  // that: neither shape may reach the card step.
  describe('a prepare-payment response that says this booking is already paid for', () => {
    let bookingService: BookingService;
    let stripeService: StripeService;

    beforeEach(() => {
      bookingService = TestBed.inject(BookingService);
      stripeService = TestBed.inject(StripeService);

      // Enough for processPayment to run; the figures are irrelevant here.
      component.bookingData = { serviceTypeId: 1, total: 386.16 };
      component.orderTotal = 386.16;

      spyOn(stripeService, 'confirmCardPayment').and.callFake(((): Promise<never> =>
        Promise.reject(new Error('the card must never be charged on either of these paths'))) as any);

      // Both paths end in handlePaymentSuccess, which navigates and plays a cue. Neither is
      // what these tests are about, and the audio one needs a real device.
      spyOn(TestBed.inject(Router), 'navigate').and.returnValue(Promise.resolve(true));
      spyOn(TestBed.inject(OrderSoundService), 'playBookingConfirmed').and.stub();
    });

    it('shows the order that the first charge already created, without charging again', async () => {
      spyOn(bookingService, 'preparePayment').and.returnValue(of({
        orderId: 369,
        status: 'Active',
        total: 386.16,
        requiresPayment: false,
        paymentIntentId: 'pi_first',
        paymentClientSecret: null,
        alreadyPaidPaymentIntentId: null,
        sessionId: 'prepare_payment_1_638'
      }));
      const confirm = spyOn(bookingService, 'confirmPayment').and.returnValue(of({ orderId: 369 }));

      await component.processPayment();

      expect(component.orderId).toBe(369);
      expect(component.paymentCompleted).toBeTrue();
      expect(stripeService.confirmCardPayment).not.toHaveBeenCalled();
      // The order exists — there is nothing left to confirm either.
      expect(confirm).not.toHaveBeenCalled();
    });

    it('confirms against the intent that was already charged rather than paying again', async () => {
      spyOn(bookingService, 'preparePayment').and.returnValue(of({
        orderId: 0,
        status: 'Pending',
        total: 386.16,
        requiresPayment: false,
        paymentIntentId: 'pi_first',
        paymentClientSecret: null,
        alreadyPaidPaymentIntentId: 'pi_first',
        sessionId: 'prepare_payment_1_638'
      }));
      const confirm = spyOn(bookingService, 'confirmPayment').and.returnValue(of({ orderId: 370 }));

      await component.processPayment();

      expect(stripeService.confirmCardPayment).not.toHaveBeenCalled();
      // The REAL intent id, never the empty string: an empty one takes the server's
      // gift-card branch, which would build an order nobody paid for.
      expect(confirm).toHaveBeenCalledWith(0, 'pi_first', 'prepare_payment_1_638');
      expect(component.orderId).toBe(370);
    });
  });
});
