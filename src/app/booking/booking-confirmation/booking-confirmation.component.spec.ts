import { ComponentFixture, TestBed } from '@angular/core/testing';

import { of, throwError } from 'rxjs';

import { BookingConfirmationComponent } from './booking-confirmation.component';
import { BookingDataService } from '../../services/booking-data.service';
import { BookingService } from '../../services/booking.service';
import { StripeService } from '../../services/stripe.service';
import { OrderSoundService } from '../../services/order-sound.service';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

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

  // ── the card WAS charged, but our confirmation of it failed to arrive (2026-09 billing) ──────
  //
  // A timeout or a 5xx after Stripe took the money is not a failed payment. Showing "Payment
  // confirmation failed" and re-enabling Pay is exactly what made a customer pay twice. The page
  // must say it is finalising, keep the Pay button down, and retry the SAME idempotent confirm.
  describe('a confirmation that fails in transit after the card was charged', () => {
    let bookingService: BookingService;
    let stripeService: StripeService;

    beforeEach(() => {
      bookingService = TestBed.inject(BookingService);
      stripeService = TestBed.inject(StripeService);
      component.bookingData = { serviceTypeId: 1, total: 120 };
      component.orderTotal = 120;
      spyOn(TestBed.inject(Router), 'navigate').and.returnValue(Promise.resolve(true));
      spyOn(TestBed.inject(OrderSoundService), 'playBookingConfirmed').and.stub();
      spyOn(bookingService, 'preparePayment').and.returnValue(of({
        orderId: 0, status: 'Pending', total: 120, requiresPayment: true,
        paymentIntentId: 'pi_charged', paymentClientSecret: 'secret', alreadyPaidPaymentIntentId: null,
        sessionId: 'prepare_payment_1_1'
      }));
      spyOn(stripeService, 'confirmCardPayment').and.returnValue(Promise.resolve({ id: 'pi_charged', status: 'succeeded' }));
    });

    it('shows a finalising state instead of an error, keeps Pay disabled, and retries the same intent', async () => {
      jasmine.clock().install();
      try {
        const markIdle = spyOn(bookingDataService, 'markPaymentIdle').and.callThrough();
        let calls = 0;
        const confirm = spyOn(bookingService, 'confirmPayment').and.callFake((() => {
          calls++;
          return calls === 1
            ? throwError(() => ({ status: 0, error: null }))   // the response never arrived
            : of({ orderId: 501 });
        }) as any);

        await component.processPayment();
        await Promise.resolve();

        expect(component.finalizingPayment).toBeTrue();
        expect(component.errorMessage).toBe('');
        expect(component.isProcessing).toBeTrue();       // Pay stays down
        expect(markIdle).not.toHaveBeenCalled();         // the in-flight guard stays up

        jasmine.clock().tick(2100);

        expect(confirm).toHaveBeenCalledTimes(2);
        expect(confirm.calls.argsFor(1)).toEqual([0, 'pi_charged', 'prepare_payment_1_1']);
        expect(component.orderId).toBe(501);
        expect(component.paymentCompleted).toBeTrue();
        expect(component.finalizingPayment).toBeFalse();
        expect(stripeService.confirmCardPayment).toHaveBeenCalledTimes(1); // never charged twice
      } finally {
        jasmine.clock().uninstall();
      }
    });

    it('still reports a definite server answer (a 4xx) the way it always did', async () => {
      spyOn(bookingService, 'confirmPayment').and.returnValue(
        throwError(() => ({ status: 400, error: { message: 'Payment not completed' } })) as any);

      await component.processPayment();
      await Promise.resolve();

      expect(component.finalizingPayment).toBeFalse();
      expect(component.errorMessage).toContain('Payment not completed');
    });
  });
  // ── "Save your card?", asked BEFORE the charge (2026-09) ────────────────────────────────
  //
  // The modal replaced both the booking-form tick-box and the post-payment prompt. What matters
  // for payment safety: it is asked between the Pay click and prepare-payment, so opening or
  // closing it can neither create a PaymentIntent nor charge anything.
  describe('the pre-payment save-card modal', () => {
    let bookingService: BookingService;
    let stripeService: StripeService;
    let prepare: jasmine.Spy;

    beforeEach(() => {
      bookingService = TestBed.inject(BookingService);
      stripeService = TestBed.inject(StripeService);
      component.bookingData = { serviceTypeId: 1, total: 141.54 };
      component.orderTotal = 141.54;
      component.savedCardsFeature = true;
      component.savedCards = [];
      component.selectedCardId = null;
      spyOn(TestBed.inject(AuthService), 'isLoggedIn').and.returnValue(true);

      prepare = spyOn(bookingService, 'preparePayment').and.returnValue(of({
        orderId: 0, status: 'Pending', total: 141.54, requiresPayment: true,
        paymentIntentId: 'pi_new', paymentClientSecret: 'secret_new',
        alreadyPaidPaymentIntentId: null, canSaveCard: true, sessionId: 'prepare_1'
      }));
      spyOn(stripeService, 'confirmCardPayment').and.returnValue(Promise.resolve({ id: 'pi_new' }) as any);
      spyOn(bookingService, 'confirmPayment').and.returnValue(of({ orderId: 501 }));
      spyOn(TestBed.inject(Router), 'navigate').and.returnValue(Promise.resolve(true));
      spyOn(TestBed.inject(OrderSoundService), 'playBookingConfirmed').and.stub();
    });

    it('asks before anything is prepared or charged', () => {
      component.onPayClicked();

      expect(component.showSaveCardModal).toBeTrue();
      expect(prepare).not.toHaveBeenCalled();
      expect(stripeService.confirmCardPayment).not.toHaveBeenCalled();
    });

    it('closing it charges nothing and leaves the payment form as it was', () => {
      component.onPayClicked();
      component.onSaveCardDismissed();

      expect(component.showSaveCardModal).toBeFalse();
      expect(prepare).not.toHaveBeenCalled();
      expect(stripeService.confirmCardPayment).not.toHaveBeenCalled();
      expect(component.isProcessing).toBeFalse();
    });

    it('"Save Card & Pay" pays ONCE, with the save applied to that same intent', async () => {
      component.onPayClicked();
      component.onSaveCardChoice(true);
      await fixture.whenStable();

      expect(prepare).toHaveBeenCalledTimes(1);
      expect(stripeService.confirmCardPayment).toHaveBeenCalledTimes(1);
      expect((stripeService.confirmCardPayment as jasmine.Spy).calls.mostRecent().args[2]).toBeTrue();
      expect(component.paymentCompleted).toBeTrue();
    });

    it('"Pay Without Saving" pays ONCE and saves nothing', async () => {
      component.onPayClicked();
      component.onSaveCardChoice(false);
      await fixture.whenStable();

      expect(prepare).toHaveBeenCalledTimes(1);
      expect((stripeService.confirmCardPayment as jasmine.Spy).calls.mostRecent().args[2]).toBeFalse();
      expect(component.paymentCompleted).toBeTrue();
    });

    it('never saves when the server says this intent cannot carry the choice', async () => {
      prepare.and.returnValue(of({
        orderId: 0, status: 'Pending', total: 141.54, requiresPayment: true,
        paymentIntentId: 'pi_new', paymentClientSecret: 'secret_new',
        alreadyPaidPaymentIntentId: null, canSaveCard: false, sessionId: 'prepare_1'
      }));

      component.onPayClicked();
      component.onSaveCardChoice(true);
      await fixture.whenStable();

      expect((stripeService.confirmCardPayment as jasmine.Spy).calls.mostRecent().args[2]).toBeFalse();
      expect(component.paymentCompleted).toBeTrue();   // the payment is unaffected
    });

    it('does not ask again once answered, and never asks for a SAVED card', () => {
      component.onPayClicked();
      component.onSaveCardChoice(false);
      component.showSaveCardModal = false;

      component.onPayClicked();
      expect(component.showSaveCardModal).toBeFalse();   // same attempt, same answer

      component.savedCards = [{ id: 7, paymentMethodId: 'pm_saved', isPrimary: true } as any];
      component.selectPaymentMethod(7);
      component.onPayClicked();
      expect(component.showSaveCardModal).toBeFalse();   // a saved card is already saved
    });

    it('asks again when the customer switches from a saved card to a new one', async () => {
      component.savedCards = [{ id: 7, paymentMethodId: 'pm_saved', isPrimary: true } as any];
      component.selectPaymentMethod(7);
      component.onPayClicked();
      expect(component.showSaveCardModal).toBeFalse();   // a saved card is never asked about

      // Let that attempt settle before the next click — the Pay button is held down while a
      // payment is in flight, which is a separate guarantee from this one.
      await fixture.whenStable();
      component.isProcessing = false;
      component.paymentCompleted = false;

      component.selectPaymentMethod(null);
      component.onPayClicked();
      expect(component.showSaveCardModal).toBeTrue();
    });
  });
});
