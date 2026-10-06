import type { Mock } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { of, throwError } from 'rxjs';

import { BookingConfirmationComponent } from './booking-confirmation.component';
import { BookingDataService } from '../../services/booking-data.service';
import { BookingService } from '../../services/booking.service';
import { StripeService } from '../../services/stripe.service';
import { OrderSoundService } from '../../services/order-sound.service';
import { Router, provideRouter } from '@angular/router';
import { AuthService } from '../../services/auth.service';

import { testProviders } from '../../../testing/test-providers';

describe('BookingConfirmationComponent', () => {
  let component: BookingConfirmationComponent;
  let fixture: ComponentFixture<BookingConfirmationComponent>;
  let bookingDataService: BookingDataService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      // Its no-data redirect goes to /booking, which the bare test router lacks.
      providers: [...testProviders, provideRouter([{ path: 'booking', children: [] }])],
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

    expect(component.bookingData()).toBeNull();
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

    expect(component.paymentCompleted()).toBe(false);
    expect(component.bookingData()).toBeTruthy();

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
      component.bookingData.set({ serviceTypeId: 1, total: 386.16 });
      component.orderTotal.set(386.16);

      vi.spyOn(stripeService, 'confirmCardPayment').mockImplementation(((): Promise<never> =>
        Promise.reject(new Error('the card must never be charged on either of these paths'))) as any);

      // Both paths end in handlePaymentSuccess, which navigates and plays a cue. Neither is
      // what these tests are about, and the audio one needs a real device.
      vi.spyOn(TestBed.inject(Router), 'navigate').mockReturnValue(Promise.resolve(true));
      vi.spyOn(TestBed.inject(OrderSoundService), 'playBookingConfirmed').mockImplementation(() => {});
    });

    it('shows the order that the first charge already created, without charging again', async () => {
      vi.spyOn(bookingService, 'preparePayment').mockReturnValue(of({
        orderId: 369,
        status: 'Active',
        total: 386.16,
        requiresPayment: false,
        paymentIntentId: 'pi_first',
        paymentClientSecret: null,
        alreadyPaidPaymentIntentId: null,
        sessionId: 'prepare_payment_1_638'
      }));
      const confirm = vi.spyOn(bookingService, 'confirmPayment').mockReturnValue(of({ orderId: 369 }));

      await component.processPayment();

      expect(component.orderId()).toBe(369);
      expect(component.paymentCompleted()).toBe(true);
      expect(stripeService.confirmCardPayment).not.toHaveBeenCalled();
      // The order exists — there is nothing left to confirm either.
      expect(confirm).not.toHaveBeenCalled();
    });

    it('confirms against the intent that was already charged rather than paying again', async () => {
      vi.spyOn(bookingService, 'preparePayment').mockReturnValue(of({
        orderId: 0,
        status: 'Pending',
        total: 386.16,
        requiresPayment: false,
        paymentIntentId: 'pi_first',
        paymentClientSecret: null,
        alreadyPaidPaymentIntentId: 'pi_first',
        sessionId: 'prepare_payment_1_638'
      }));
      const confirm = vi.spyOn(bookingService, 'confirmPayment').mockReturnValue(of({ orderId: 370 }));

      await component.processPayment();

      expect(stripeService.confirmCardPayment).not.toHaveBeenCalled();
      // The REAL intent id, never the empty string: an empty one takes the server's
      // gift-card branch, which would build an order nobody paid for.
      expect(confirm).toHaveBeenCalledWith(0, 'pi_first', 'prepare_payment_1_638');
      expect(component.orderId()).toBe(370);
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
      component.bookingData.set({ serviceTypeId: 1, total: 120 });
      component.orderTotal.set(120);
      vi.spyOn(TestBed.inject(Router), 'navigate').mockReturnValue(Promise.resolve(true));
      vi.spyOn(TestBed.inject(OrderSoundService), 'playBookingConfirmed').mockImplementation(() => {});
      vi.spyOn(bookingService, 'preparePayment').mockReturnValue(of({
        orderId: 0, status: 'Pending', total: 120, requiresPayment: true,
        paymentIntentId: 'pi_charged', paymentClientSecret: 'secret', alreadyPaidPaymentIntentId: null,
        sessionId: 'prepare_payment_1_1'
      }));
      vi.spyOn(stripeService, 'confirmCardPayment').mockReturnValue(Promise.resolve({ id: 'pi_charged', status: 'succeeded' }));
    });

    it('shows a finalising state instead of an error, keeps Pay disabled, and retries the same intent', async () => {
      vi.useFakeTimers();
      try {
        const markIdle = vi.spyOn(bookingDataService, 'markPaymentIdle');
        let calls = 0;
        const confirm = vi.spyOn(bookingService, 'confirmPayment').mockImplementation((() => {
          calls++;
          return calls === 1
            ? throwError(() => ({ status: 0, error: null }))   // the response never arrived
            : of({ orderId: 501 });
        }) as any);

        await component.processPayment();
        await Promise.resolve();

        expect(component.finalizingPayment()).toBe(true);
        expect(component.errorMessage()).toBe('');
        expect(component.isProcessing()).toBe(true);       // Pay stays down
        expect(markIdle).not.toHaveBeenCalled();         // the in-flight guard stays up

        vi.advanceTimersByTime(2100);

        expect(confirm).toHaveBeenCalledTimes(2);
        expect(vi.mocked(confirm).mock.calls[1]).toEqual([0, 'pi_charged', 'prepare_payment_1_1']);
        expect(component.orderId()).toBe(501);
        expect(component.paymentCompleted()).toBe(true);
        expect(component.finalizingPayment()).toBe(false);
        expect(stripeService.confirmCardPayment).toHaveBeenCalledTimes(1); // never charged twice
      } finally {
        vi.useRealTimers();
      }
    });

    it('still reports a definite server answer (a 4xx) the way it always did', async () => {
      vi.spyOn(bookingService, 'confirmPayment').mockReturnValue(throwError(() => ({ status: 400, error: { message: 'Payment not completed' } })) as any);

      await component.processPayment();
      await Promise.resolve();

      expect(component.finalizingPayment()).toBe(false);
      expect(component.errorMessage()).toContain('Payment not completed');
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
    let prepare: Mock;

    beforeEach(() => {
      bookingService = TestBed.inject(BookingService);
      stripeService = TestBed.inject(StripeService);
      component.bookingData.set({ serviceTypeId: 1, total: 141.54 });
      component.orderTotal.set(141.54);
      component.savedCardsFeature = true;
      component.savedCards.set([]);
      component.selectedCardId.set(null);
      vi.spyOn(TestBed.inject(AuthService), 'isLoggedIn').mockReturnValue(true);

      prepare = vi.spyOn(bookingService, 'preparePayment').mockReturnValue(of({
        orderId: 0, status: 'Pending', total: 141.54, requiresPayment: true,
        paymentIntentId: 'pi_new', paymentClientSecret: 'secret_new',
        alreadyPaidPaymentIntentId: null, canSaveCard: true, sessionId: 'prepare_1'
      }));
      vi.spyOn(stripeService, 'confirmCardPayment').mockReturnValue(Promise.resolve({ id: 'pi_new' }) as any);
      vi.spyOn(bookingService, 'confirmPayment').mockReturnValue(of({ orderId: 501 }));
      vi.spyOn(TestBed.inject(Router), 'navigate').mockReturnValue(Promise.resolve(true));
      vi.spyOn(TestBed.inject(OrderSoundService), 'playBookingConfirmed').mockImplementation(() => {});
    });

    it('asks before anything is prepared or charged', () => {
      component.onPayClicked();

      expect(component.showSaveCardModal()).toBe(true);
      expect(prepare).not.toHaveBeenCalled();
      expect(stripeService.confirmCardPayment).not.toHaveBeenCalled();
    });

    it('closing it charges nothing and leaves the payment form as it was', () => {
      component.onPayClicked();
      component.onSaveCardDismissed();

      expect(component.showSaveCardModal()).toBe(false);
      expect(prepare).not.toHaveBeenCalled();
      expect(stripeService.confirmCardPayment).not.toHaveBeenCalled();
      expect(component.isProcessing()).toBe(false);
    });

    it('"Save Card & Pay" pays ONCE, with the save applied to that same intent', async () => {
      component.onPayClicked();
      component.onSaveCardChoice(true);
      await fixture.whenStable();

      expect(prepare).toHaveBeenCalledTimes(1);
      expect(stripeService.confirmCardPayment).toHaveBeenCalledTimes(1);
      expect(vi.mocked((stripeService.confirmCardPayment as Mock)).mock.lastCall![2]).toBe(true);
      expect(component.paymentCompleted()).toBe(true);
    });

    it('"Pay Without Saving" pays ONCE and saves nothing', async () => {
      component.onPayClicked();
      component.onSaveCardChoice(false);
      await fixture.whenStable();

      expect(prepare).toHaveBeenCalledTimes(1);
      expect(vi.mocked((stripeService.confirmCardPayment as Mock)).mock.lastCall![2]).toBe(false);
      expect(component.paymentCompleted()).toBe(true);
    });

    it('never saves when the server says this intent cannot carry the choice', async () => {
      prepare.mockReturnValue(of({
        orderId: 0, status: 'Pending', total: 141.54, requiresPayment: true,
        paymentIntentId: 'pi_new', paymentClientSecret: 'secret_new',
        alreadyPaidPaymentIntentId: null, canSaveCard: false, sessionId: 'prepare_1'
      }));

      component.onPayClicked();
      component.onSaveCardChoice(true);
      await fixture.whenStable();

      expect(vi.mocked((stripeService.confirmCardPayment as Mock)).mock.lastCall![2]).toBe(false);
      expect(component.paymentCompleted()).toBe(true);   // the payment is unaffected
    });

    it('does not ask again once answered, and never asks for a SAVED card', () => {
      component.onPayClicked();
      component.onSaveCardChoice(false);
      component.showSaveCardModal.set(false);

      component.onPayClicked();
      expect(component.showSaveCardModal()).toBe(false);   // same attempt, same answer

      component.savedCards.set([{ id: 7, paymentMethodId: 'pm_saved', isPrimary: true } as any]);
      component.selectPaymentMethod(7);
      component.onPayClicked();
      expect(component.showSaveCardModal()).toBe(false);   // a saved card is already saved
    });

    it('asks again when the customer switches from a saved card to a new one', async () => {
      component.savedCards.set([{ id: 7, paymentMethodId: 'pm_saved', isPrimary: true } as any]);
      component.selectPaymentMethod(7);
      component.onPayClicked();
      expect(component.showSaveCardModal()).toBe(false);   // a saved card is never asked about

      // Let that attempt settle before the next click — the Pay button is held down while a
      // payment is in flight, which is a separate guarantee from this one.
      await fixture.whenStable();
      component.isProcessing.set(false);
      component.paymentCompleted.set(false);

      component.selectPaymentMethod(null);
      component.onPayClicked();
      expect(component.showSaveCardModal()).toBe(true);
    });
  });
});
