import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { BookingService } from '../../services/booking.service';
import { BookingDataService } from '../../services/booking-data.service';
import { StripeService } from '../../services/stripe.service';
import { OrderSoundService } from '../../services/order-sound.service';
import { BillingService, SavedCard, cardLabel } from '../../services/billing.service';
import { calculateTotals, splitTaxInclusiveAmount } from '../../shared/pricing/order-pricing.calculator';
import { SaveCardModalComponent } from '../../shared/components/save-card-modal/save-card-modal.component';

@Component({
  selector: 'app-booking-confirmation',
  standalone: true,
  imports: [CommonModule, RouterModule, SaveCardModalComponent],
  templateUrl: './booking-confirmation.component.html',
  styleUrls: ['./booking-confirmation.component.scss']
})
export class BookingConfirmationComponent implements OnInit, OnDestroy {
  orderId: number = 0;
  isProcessing = false;
  paymentCompleted = false;
  errorMessage = '';
  bookingData: any = null;
  paymentClientSecret: string | null = null;
  orderTotal: number = 0;
  currentUser: any;
  cardError: string | null = null;
  showApplePay = false;
  // True when a gift card (or credits) covers the full amount, so no Stripe charge is needed.
  // Drives the UI to hide the card form and confirm the booking directly. The server has the
  // final say via the prepare-payment `requiresPayment` flag.
  fullyCovered = false;

  // Money-sensitive notice (auto-refund outcome from confirm-payment). Shown in its own banner
  // that stays until the customer manually dismisses it — no auto-clear — so they can read it and
  // note the contact details. Severity is keyed off the backend "code", not the human text.
  stickyNotice: { message: string; severity: 'warning' | 'critical' } | null = null;

  // Remove the preparePayment flag - we don't need it anymore
  isPreparing = false;

  // Set when this page is re-entered while a charge started by an earlier instance of it is
  // still finishing. The earlier instance's confirm-payment is deliberately NOT cancelled (the
  // card is already charged by then), so it will complete and navigate on its own.
  resumedInFlight = false;

  private destroy$ = new Subject<void>();

  // Saved cards: offered to the signed-in customer as payment options. Selecting one never
  // charges anything — the charge happens only on the explicit Pay click. null = a new card.
  savedCards: SavedCard[] = [];
  selectedCardId: number | null = null;

  /**
   * Set when Stripe HAS taken the money but our confirmation of it failed to reach the server
   * (timeout, 5xx). The page keeps retrying the SAME idempotent confirm and says so — it never
   * shows a payment error, and the Pay button stays down, because "payment failed" after a
   * successful charge is precisely what made customers pay twice (2026-09-16).
   */
  finalizingPayment = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private authService: AuthService,
    private bookingService: BookingService,
    private bookingDataService: BookingDataService,
    private stripeService: StripeService,
    private orderSound: OrderSoundService,
    private billingService: BillingService
  ) {}

  get selectedCard(): SavedCard | null {
    return this.savedCards.find(c => c.id === this.selectedCardId) ?? null;
  }

  get usingSavedCard(): boolean {
    return !!this.selectedCard?.paymentMethodId;
  }

  readonly cardLabel = cardLabel;

  /** null = enter a new card. */
  selectPaymentMethod(cardId: number | null): void {
    if (cardId !== this.selectedCardId) this.saveCardChoice = null;   // a different card is a new question
    this.selectedCardId = cardId;
  }

  // ── "Save your card?", asked before the charge (2026-09) ────────────────────────────────
  //
  // The question is put BETWEEN the Pay click and prepare-payment, so nothing exists yet to
  // duplicate: no session, no PaymentIntent, no charge. The answer rides along to the SAME
  // intent as setup_future_usage at confirmation. There is no prompt after payment.
  showSaveCardModal = false;
  /** The answer for THIS attempt. Kept across a retry so nobody is asked twice for one payment. */
  saveCardChoice: boolean | null = null;
  /** Server rollout switch. */
  savedCardsFeature = false;

  /** A new, reusable card typed by a signed-in customer — the only case worth asking about. */
  private get canAskToSaveCard(): boolean {
    return this.savedCardsFeature && !this.fullyCovered && !this.usingSavedCard
      && this.authService.isLoggedIn() && this.saveCardChoice === null;
  }

  /** The Pay button. Asks first when there is something to ask; otherwise pays exactly as before. */
  onPayClicked(): void {
    if (this.isProcessing) return;
    if (this.canAskToSaveCard) {
      this.showSaveCardModal = true;
      return;
    }
    this.processPayment();
  }

  onSaveCardChoice(save: boolean): void {
    this.saveCardChoice = save;
    this.showSaveCardModal = false;
    this.processPayment();
  }

  /** ✕ / Escape / backdrop: back to the payment form with everything still typed in. Nothing
   *  was prepared or charged, so there is nothing to abandon. */
  onSaveCardDismissed(): void {
    this.showSaveCardModal = false;
  }

  ngOnInit() {
    // Re-entry after the booking already went through (back button off the success page).
    // Checked BEFORE the booking-data guard below, because a completed booking has already had
    // its data cleared — without this it would look like a stale visit and bounce to /booking.
    if (this.bookingDataService.paymentPhase === 'completed') {
      this.paymentCompleted = true;
      this.orderId = this.bookingDataService.completedOrderId ?? 0;
      return;
    }

    // Get booking data from service
    this.bookingData = this.bookingDataService.getBookingData();

    if (!this.bookingData) {
      // No booking data, redirect back to booking
      this.router.navigate(['/booking']);
      return;
    }

    // Re-entry while an earlier instance of this page is still finishing a charge. Hold the Pay
    // button down rather than redirecting: the customer's card may already have been taken, and
    // that earlier request will navigate to the success page when it lands. This is the state
    // that used to be lost with the component, which is how one booking became two.
    if (this.bookingDataService.paymentPhase === 'in-flight') {
      this.resumedInFlight = true;
      this.isProcessing = true;
    }

    // Get current user for billing details
    this.authService.currentUser.subscribe(user => {
      this.currentUser = user;
    });

    // Calculate and display the total
    this.calculateOrderTotal();

    // Saved cards — offered only to a signed-in customer (a guest has none), and only when the
    // server's rollout switch is on. Any failure simply leaves the ordinary card form.
    if (this.authService.isLoggedIn() && !this.fullyCovered) {
      this.billingService.savedCardsEnabled().subscribe(enabled => {
        this.savedCardsFeature = enabled;
        if (!enabled) return;
        this.billingService.getCards().subscribe({
          next: (cards) => {
            this.savedCards = cards.filter(c => c.isUsable && !!c.paymentMethodId);
            // Default to the Primary card; one click switches to any other card or a new one.
            this.selectedCardId = (this.savedCards.find(c => c.isPrimary) ?? this.savedCards[0])?.id ?? null;
          },
          error: () => { /* no saved-card options — normal card form remains */ }
        });
      });
    }

    // Initialize Stripe Elements asynchronously
    this.initializeStripeElements();
    this.initApplePay();
  }

  ngOnDestroy() {
    // Cancels the prepare-payment request only (see processPayment). Anything past the charge
    // is deliberately left to finish.
    this.destroy$.next();
    this.destroy$.complete();

    // Clean up Stripe elements
    this.stripeService.destroyCardElement();
    this.stripeService.destroyPaymentRequestButton();
  }

  private async initApplePay() {
    // No wallet button when a gift card covers the full amount (nothing to charge).
    if (this.fullyCovered) return;
    const pr = await this.stripeService.createPaymentRequest(this.orderTotal, 'Dream Cleaning NYC');
    if (!pr) return;
    this.showApplePay = true;
    setTimeout(() => this.stripeService.createPaymentRequestButton(pr, 'payment-request-button'), 0);

    pr.on('paymentmethod', (ev: any) => {
      // Also refuses to start while a charge from an earlier visit to this page is still
      // settling — isProcessing alone is component-local and resets when the page re-mounts.
      if (this.isProcessing || this.bookingDataService.paymentPhase !== 'idle') {
        ev.complete('fail');
        return;
      }
      this.isProcessing = true;
      this.errorMessage = '';
      // No takeUntil on this one: cancelling it would leave the wallet sheet waiting on an
      // ev.complete() that never comes. The backend's prepare-session reuse covers the
      // duplicate case here.
      this.bookingService.preparePayment(this.bookingData).subscribe({
        next: async (response: any) => {
          try {
            if (response.guestToken && response.guestUser && !this.authService.isLoggedIn()) {
              this.authService.applyGuestAuth(response.guestToken, response.guestRefreshToken, response.guestUser);
              this.currentUser = response.guestUser;
            }
            // Already paid on an earlier attempt — close the wallet sheet and settle what
            // exists instead of charging the card a second time. Same rule as the card path.
            if (response.orderId > 0 || response.alreadyPaidPaymentIntentId) {
              ev.complete('success');
              this.settleAlreadyPaidAttempt(response, response.sessionId);
              return;
            }

            // Guard up before the charge, same as the card path.
            this.bookingDataService.markPaymentInFlight();
            const paymentIntent = await this.stripeService.confirmPaymentRequest(
              response.paymentClientSecret, ev.paymentMethod.id
            );
            ev.complete('success');
            this.confirmChargedBooking(paymentIntent.id, response.sessionId);
          } catch (payErr: any) {
            ev.complete('fail');
            this.bookingDataService.markPaymentIdle();
            this.errorMessage = payErr.message || 'Payment failed. Please try again.';
            this.isProcessing = false;
          }
        },
        error: (err: any) => {
          ev.complete('fail');
          this.bookingDataService.markPaymentIdle();
          this.errorMessage = err.error?.message || 'Failed to prepare payment';
          this.isProcessing = false;
        }
      });
    });
  }

  private async initializeStripeElements() {
    try {
      await this.stripeService.initializeElements();
      const cardElement = this.stripeService.createCardElement('card-element');
      
      if (cardElement) {
        // Listen for card errors
        cardElement.on('change', (event: any) => {
          this.cardError = event.error ? event.error.message : null;
        });
      }
    } catch (error) {
      console.error('Failed to initialize Stripe elements:', error);
      this.errorMessage = 'Failed to initialize payment form';
    }
  }

  // NEW METHOD: Just calculate the total for display
  calculateOrderTotal() {
    let total;
    
    // First try to use the pre-calculated total
    if (this.bookingData.calculation?.total !== undefined && this.bookingData.calculation?.total !== null) {
      total = this.bookingData.calculation.total;
    } else if (this.bookingData.total !== undefined && this.bookingData.total !== null) {
      total = this.bookingData.total;
    } else {
      // Fallback calculation through the shared calculator — only fires when
      // bookingData.total is missing, but must match the booking page exactly
      // (loyalty included) so we don't quietly drop a discount and overcharge.
      // Custom Pricing splits its tax out of the admin-entered tax-inclusive amount, so the
      // fallback has to reuse that split rather than taxing the subtotal again.
      const taxOverride = this.bookingData.isCustomPricing && this.bookingData.customAmount > 0
        ? splitTaxInclusiveAmount(this.bookingData.customAmount).tax
        : null;

      const totals = calculateTotals({
        subTotal: this.bookingData.subTotal || 0,
        taxOverride,
        discountAmount: this.bookingData.discountAmount || 0,
        subscriptionDiscountAmount: this.bookingData.subscriptionDiscountAmount || 0,
        loyaltyDiscountAmount: this.bookingData.loyaltyDiscountAmount || 0,
        tips: this.bookingData.tips || 0,
        giftCardAmountUsed: this.bookingData.giftCardAmountToUse || 0
      });
      total = totals.total;
    }

    this.orderTotal = total;
    // Below Stripe's $0.50 minimum the charge is impossible — treat as fully covered.
    this.fullyCovered = total < 0.5;
  }

  // REMOVE the old preparePayment method entirely

  // Prepare payment and get payment intent WITHOUT creating order
  async processPayment() {
    if (this.isProcessing || (!this.fullyCovered && !this.usingSavedCard && this.cardError)) return;

    this.isProcessing = true;
    this.errorMessage = '';
    this.stickyNotice = null;

    try {
      // Prepare payment - this creates payment intent but NOT the order.
      //
      // takeUntil is applied HERE and nowhere else in this method. Nothing has been charged
      // yet, so abandoning the page mid-prepare costs nothing: the server keeps the prepare
      // session for 20 minutes and hands the same PaymentIntent back if the customer returns.
      // The confirm-payment calls below are deliberately left unguarded — by the time they run
      // the card HAS been charged, and aborting the request that records it would leave the
      // customer paid-up with no order.
      this.bookingService.preparePayment(this.bookingData).pipe(takeUntil(this.destroy$)).subscribe({
        next: async (response) => {
          this.paymentClientSecret = response.paymentClientSecret;
          this.orderTotal = response.total;
          const sessionId = response.sessionId; // Store sessionId for confirm-payment

          // Guest booking: auto-login user that was created during preparePayment
          if (response.guestToken && response.guestUser && !this.authService.isLoggedIn()) {
            this.authService.applyGuestAuth(response.guestToken, response.guestRefreshToken, response.guestUser);
            this.currentUser = response.guestUser;
          }

          // This attempt has ALREADY been paid for. The server found the PaymentIntent it
          // prepared earlier and saw that the money had moved (see the backend's
          // ResolveAlreadyChargedPrepareAsync). Both shapes are checked BEFORE the
          // gift-card branch below, which confirms with an EMPTY intent id — taking that
          // branch here would ask the server to build an order against no payment at all.
          if (this.settleAlreadyPaidAttempt(response, sessionId)) return;

          // Gift card (or credits) fully covered the order — the server skipped Stripe.
          // Confirm the booking directly without a card charge.
          if (response.requiresPayment === false || !response.paymentClientSecret) {
            this.fullyCovered = true;
            // No charge, but an order is about to exist — same guard applies.
            this.bookingDataService.markPaymentInFlight();
            this.bookingService.confirmPayment(0, '', sessionId).subscribe({
              next: (confirmResponse) => {
                this.orderId = confirmResponse.orderId;
                this.handlePaymentSuccess();
              },
              error: (error) => this.handleConfirmError(error)
            });
            return;
          }

          // Server says payment IS required but the UI assumed full coverage (e.g. the gift
          // card balance dropped since validation). Reveal the card form for the remainder.
          if (this.fullyCovered) {
            this.fullyCovered = false;
            this.errorMessage = 'Your gift card no longer covers the full amount. Please enter your card details to pay the remaining balance.';
            this.isProcessing = false;
            this.initApplePay();
            return;
          }

          try {
            // Past this point the card can be charged, so the guard goes up BEFORE the call —
            // it must already be set if the customer navigates away mid-charge and returns.
            this.bookingDataService.markPaymentInFlight();

            // Confirm the payment — with the saved card when selected (explicit Pay click;
            // confirmPaymentRequest accepts any payment-method id and handles 3DS in-browser),
            // otherwise with the freshly entered card element.
            const paymentIntent = this.usingSavedCard && this.selectedCard?.paymentMethodId
              ? await this.stripeService.confirmPaymentRequest(
                  response.paymentClientSecret,
                  this.selectedCard.paymentMethodId
                )
              : await this.stripeService.confirmCardPayment(
                  response.paymentClientSecret,
                  this.billingDetails,
                  // The customer's answer from the modal, applied to THIS intent — and only when
                  // the server says the intent can carry it (it holds their Stripe Customer).
                  this.saveCardChoice === true && response.canSaveCard === true
                );

            // Payment successful, confirm it with backend (this will create the order)
            // Use orderId 0 and pass sessionId since order doesn't exist yet
            this.confirmChargedBooking(paymentIntent.id, sessionId);
          } catch (paymentError: any) {
            // Payment failed - no order was created, so nothing to clean up.
            // Release the guard: a declined card must leave the customer able to try again.
            this.bookingDataService.markPaymentIdle();
            this.errorMessage = paymentError.message || 'Payment failed. Please try again.';
            this.isProcessing = false;
          }
        },
        error: (error) => {
          this.errorMessage = error.error?.message || 'Failed to prepare payment';
          this.isProcessing = false;
        }
      });
    } catch (error: any) {
      this.errorMessage = 'An unexpected error occurred';
      this.isProcessing = false;
    }
  }

  /**
   * Handles a prepare-payment response that says this booking has already been paid for,
   * and reports whether it took over. Returns false for an ordinary response, so a caller
   * can guard with `if (settleAlreadyPaidAttempt(...)) return;`.
   *
   * Two outcomes, and only one of them still has work to do:
   *   - `orderId` set: the charge produced an order. Show it. Nothing to confirm.
   *   - `alreadyPaidPaymentIntentId` set: the charge went through but the order was never
   *     created (a confirm-payment that failed after the money moved). Confirm against THAT
   *     intent, never a fresh one.
   *
   * Neither branch may fall through to the card step. On 2026-09-16 the second case did:
   * the customer was shown an error, clicked Pay again, and paid $386.16 twice for one
   * cleaning.
   */
  private settleAlreadyPaidAttempt(response: any, sessionId: string): boolean {
    if (response?.orderId > 0) {
      this.orderId = response.orderId;
      this.handlePaymentSuccess();
      return true;
    }

    if (response?.alreadyPaidPaymentIntentId) {
      // An order is about to exist and the card is already charged — same guard the card
      // path raises before a charge.
      this.bookingDataService.markPaymentInFlight();
      this.confirmChargedBooking(response.alreadyPaidPaymentIntentId, sessionId);
      return true;
    }

    return false;
  }

  /**
   * Confirms a booking whose card Stripe HAS ALREADY CHARGED. The server's confirm is idempotent
   * (one intent → one order), so a transport failure — no response, a timeout, a 5xx — is retried
   * with the same intent rather than reported: telling someone whose money has been taken that
   * their payment failed is how the same cleaning got paid for twice. While retrying the page
   * shows a "finalising" state and the Pay button stays down. A definite answer from the server
   * (a 4xx, or the refund codes) is still handled by handleConfirmError exactly as before.
   */
  private confirmChargedBooking(paymentIntentId: string, sessionId: string, attempt = 1): void {
    this.bookingService.confirmPayment(0, paymentIntentId, sessionId).subscribe({
      next: (confirmResponse: any) => {
        this.finalizingPayment = false;
        this.orderId = confirmResponse.orderId;
        this.handlePaymentSuccess();
      },
      error: (error: any) => {
        const transient = !error?.status || error.status === 0 || error.status >= 500;
        if (!transient) {
          this.finalizingPayment = false;
          this.handleConfirmError(error);
          return;
        }

        this.finalizingPayment = true;
        this.errorMessage = '';
        this.isProcessing = true; // the Pay button stays down — the card is already charged
        if (attempt >= 4) {
          // Still no answer. The money is safe and the booking will be finalised from the same
          // intent; the guard stays up so this page never offers to take it again.
          return;
        }
        setTimeout(() => this.confirmChargedBooking(paymentIntentId, sessionId, attempt + 1), 2000 * attempt);
      }
    });
  }

  private handlePaymentSuccess() {
    this.paymentCompleted = true;
    this.isProcessing = false;
    this.resumedInFlight = false;

    // The order exists. Recorded on the service so a back-navigation onto this page shows the
    // booking as done instead of offering to pay for it again.
    this.bookingDataService.markPaymentSettled(this.orderId);

    // Celebratory cue — payment confirmed and order created.
    this.orderSound.playBookingConfirmed();

    // Clear the booking data
    this.bookingDataService.clearBookingData();
    
    // Handle subscription refresh if needed
    const selectedSubscription = this.bookingData.subscription;
    if (selectedSubscription && selectedSubscription.subscriptionDays > 0) {
      this.bookingService.getUserSubscription().subscribe({
        next: (subscriptionData) => {
          // Subscription data refreshed successfully
        },
        error: (error) => {
          // 401 is expected if user is not authenticated (e.g. guest flow)
          if (error?.status !== 401) {
            console.error('Failed to refresh subscription data:', error);
          }
        }
      });
    }
    
    // Refresh user profile
    this.authService.refreshUserProfile().subscribe({
      next: () => {
        // User profile refreshed successfully
      },
      error: (error) => {
        console.error('Failed to refresh user profile:', error);
      }
    });
    
    // Navigate to booking-success for Google Ads conversion tracking, then auto-redirect to order
    this.router.navigate(['/booking-success', this.orderId], {
      state: { paymentSuccess: true, contactEmail: this.bookingData?.contactEmail }
    });
  }

  get billingDetails() {
    const firstName = this.currentUser?.firstName ?? this.bookingData?.contactFirstName ?? '';
    const lastName = this.currentUser?.lastName ?? this.bookingData?.contactLastName ?? '';
    return {
      name: `${firstName} ${lastName}`.trim(),
      email: this.currentUser?.email ?? this.bookingData?.contactEmail,
      phone: this.currentUser?.phone || this.bookingData?.contactPhone
    };
  }

  // REMOVE the old onPaymentComplete method - we don't need it anymore

  // REMOVE the old onPaymentError method - we don't need it anymore

  // REMOVE the retryPayment method - we'll handle retries differently

  // Shared confirm-payment error handler. Severity is keyed off the backend error code (not the
  // human text), so the message can be reworded without breaking detection. Codes are emitted by
  // the refund catch in BookingController.ConfirmPayment.
  private handleConfirmError(error: any) {
    const msg = error.error?.message || 'Payment confirmation failed';
    const code = error.error?.code;
    if (code === 'booking_refunded') {
      // Charge WAS refunded — reassuring, lower severity.
      this.stickyNotice = { message: msg, severity: 'warning' };
    } else if (code === 'booking_refund_failed') {
      // Charge was NOT refunded — customer must contact us; highest severity.
      this.stickyNotice = { message: msg, severity: 'critical' };
    } else {
      this.errorMessage = msg;
    }

    // `booking_refund_failed` is the one outcome that must NOT release the guard. The charge
    // went through, the automatic refund did not, and the message the customer is reading
    // says in as many words not to retry — so the Pay button stays down. Re-enabling it here
    // would invite a second charge on top of one that is still unresolved, which is the exact
    // failure this whole change exists to prevent. The only ways out are deliberate: reload
    // the page, or contact support (as the notice instructs).
    if (code === 'booking_refund_failed') {
      this.resumedInFlight = false;
      return;
    }

    this.isProcessing = false;
    this.resumedInFlight = false;
    // Every other outcome is a terminal failure the customer can act on: release the guard so
    // they can try again. A declined card must never strand somebody who simply wants to pay.
    this.bookingDataService.markPaymentIdle();
    // Order was not created (or already handled server-side), so no cleanup needed
  }

  dismissStickyNotice() {
    this.stickyNotice = null;
  }

  cancelBooking() {
    // Clear the booking data
    this.bookingDataService.clearBookingData();
    this.router.navigate(['/booking']);
  }
}