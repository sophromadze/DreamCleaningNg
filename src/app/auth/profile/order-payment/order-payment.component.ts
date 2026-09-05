import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../../../services/auth.service';
import { BookingService } from '../../../services/booking.service';
import { OrderService, Order } from '../../../services/order.service';
import { StripeService } from '../../../services/stripe.service';
import { CardOnFileService, SavedCard } from '../../../services/card-on-file.service';
import {
  SMS_CONSENT_LEAD,
  CANCELLATION_CONSENT_TEXT,
  TERMS_CONSENT_LEAD
} from '../../../shared/booking/consent-texts';
import { CARD_ON_FILE_ENABLED } from '../../../shared/card-on-file.flag';
import {
  buildSupplyChecklistItems,
  extraServiceNamesOf,
  hasCleaningSuppliesExtra,
  resolveSupplyChecklistFacts
} from '../../../shared/booking/supply-checklist.utils';

@Component({
  selector: 'app-order-payment',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './order-payment.component.html',
  styleUrls: ['./order-payment.component.scss']
})
export class OrderPaymentComponent implements OnInit, OnDestroy {
  orderId: number = 0;
  order: Order | null = null;
  isProcessing = false;
  paymentCompleted = false;
  errorMessage = '';
  paymentClientSecret: string | null = null;
  /** Payment intent ID from backend (create-payment-intent) - use this for confirm-payment, same as booking flow */
  paymentIntentId: string | null = null;
  orderTotal: number = 0;
  paymentType: 'order' | 'update' = 'order';
  hasCleaningSupplies = false;
  isCustomServiceType = false;
  /**
   * The customer's "please provide" list, straight from the shared checklist builder so this
   * page, the confirmation email and the SMS cannot name different products. Empty means the
   * customer bought their way out of every item — rendered as "nothing to prepare".
   */
  supplyChecklistItems: string[] = [];
  currentUser: any;
  cardError: string | null = null;
  isLoading = true;
  showApplePay = false;
  // True when a gift card covers the full order amount (server returns requiresPayment=false).
  // Skips Stripe entirely and confirms the order directly.
  fullyCovered = false;
  /** Secret payment-link token (?t=...) — lets anyone with the link use this page,
   *  logged out OR logged in as a different user. Backend re-validates it on every
   *  call and only while something is unpaid. */
  guestToken: string | null = null;
  /** True when paying via the token rather than as the order's own logged-in owner
   *  (covers both logged-out visitors and other logged-in users). Determined after
   *  the order loads. */
  isGuestMode = false;
  private hasInitialized = false;

  // ── Consent gate (admin-created orders only) ──────────────────────────────────────────
  // A customer who books themselves ticks SMS / cancellation-fee / terms on /booking before
  // the order exists. When an admin books for them over the phone the admin ticks those boxes,
  // so the customer has agreed to nothing — they just get a payment link. Those orders collect
  // the same three consents here, and the backend refuses to create a PaymentIntent until it
  // has them, so no card can be charged first. Initial payment only.
  consentRequired = false;
  consentAccepted = false;
  consentAcceptedAt: string | null = null;
  consentSubmitting = false;
  consentError = '';
  smsConsent = false;
  cancellationConsent = false;
  termsConsent = false;
  // Same wording as the booking form — one source, two surfaces.
  readonly smsConsentLead = SMS_CONSENT_LEAD;
  readonly cancellationConsentText = CANCELLATION_CONSENT_TEXT;
  readonly termsConsentLead = TERMS_CONSENT_LEAD;

  // Card on file: offered ONLY to the logged-in owner — never in guest/token mode, where
  // the payer is often a relative who must not touch the owner's card. Selecting it never
  // charges anything; the Pay button click does.
  savedCard: SavedCard | null = null;
  payWithSavedCard = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private authService: AuthService,
    private bookingService: BookingService,
    private orderService: OrderService,
    private stripeService: StripeService,
    private cardOnFileService: CardOnFileService,
    private cdr: ChangeDetectorRef
  ) {}

  get usingSavedCard(): boolean {
    return !!this.savedCard && this.payWithSavedCard;
  }

  get savedCardLabel(): string {
    if (!this.savedCard) return '';
    const brand = this.savedCard.brand
      ? this.savedCard.brand.charAt(0).toUpperCase() + this.savedCard.brand.slice(1)
      : 'Card';
    return this.savedCard.last4 ? `${brand} ending ${this.savedCard.last4}` : brand;
  }

  selectPaymentMethod(useSaved: boolean): void {
    this.payWithSavedCard = useSaved;
    this.cdr.detectChanges();
  }

  ngOnInit() {
    this.guestToken = this.route.snapshot.queryParamMap.get('t');

    // Get current user for billing details
    this.authService.currentUser.subscribe(user => {
      this.currentUser = user;
      this.tryInit();
    });

    this.route.params.subscribe(params => {
      // Route is /order/:id/pay
      this.orderId = +params['id'];
      this.tryInit();
    });
  }

  ngOnDestroy() {
    // Clean up Stripe elements
    this.stripeService.destroyCardElement();
    this.stripeService.destroyPaymentRequestButton();
  }

  private tryInit() {
    if (this.hasInitialized) return;
    if (!this.orderId || Number.isNaN(this.orderId)) return;
    // With a payment-link token the page works logged-out; otherwise wait for the user.
    if (!this.currentUser?.id && !this.guestToken) return;

    this.hasInitialized = true;
    this.loadOrder();
  }

  loadOrder() {
    this.isLoading = true;
    const loggedIn = !!this.currentUser?.id;
    // Logged-in users try the owner-scoped endpoint first (works even on fully-paid
    // orders); if the order belongs to someone else and we hold a link token, fall
    // back to the token-gated guest endpoint. Logged-out visitors go straight there.
    const order$ = loggedIn
      ? this.orderService.getOrderById(this.orderId).pipe(
          catchError(err => this.guestToken
            ? this.orderService.getOrderByIdGuest(this.orderId, this.guestToken)
            : throwError(() => err))
        )
      : this.orderService.getOrderByIdGuest(this.orderId, this.guestToken!);
    order$.subscribe({
      next: (order) => {
        // Token mode = anyone who isn't the order's own logged-in owner.
        this.isGuestMode = !!this.guestToken && order.userId !== this.currentUser?.id;
        this.order = order;
        // Decide what kind of payment is needed:
        // - Unpaid order (initial booking payment)
        // - Pending additional payment after an admin/customer update
        const pendingUpdateAmount = order.pendingUpdateAmount ?? 0;
        // Manual-paid orders (Cash/Zelle/Check/Other) were settled outside Stripe and keep
        // isPaid=false by backend design — there is nothing to pay on the website.
        if (order.paymentMethod && order.paymentMethod !== 'Normal') {
          this.errorMessage = 'This order was paid outside the website and has no payment due.';
          this.isLoading = false;
          return;
        }
        if (!order.isPaid) {
          this.paymentType = 'order';
          this.orderTotal = order.total;
        } else if (pendingUpdateAmount > 0.01) {
          this.paymentType = 'update';
          // Backend sends the correct additional amount (difference without tips). Use as-is; do not add tips.
          this.orderTotal = Math.round(pendingUpdateAmount * 100) / 100;
        } else {
          this.errorMessage = 'This order has no pending payments';
          this.isLoading = false;
          return;
        }

        // Ownership check for logged-in users. Guest mode skips it — the backend already
        // validated the secret link token and the unpaid-amount rule.
        if (!this.isGuestMode && order.userId !== this.currentUser?.id) {
          this.errorMessage = 'You do not have permission to pay for this order';
          this.isLoading = false;
          return;
        }

        const extraNames = extraServiceNamesOf(order.extraServices ?? []);
        this.hasCleaningSupplies = hasCleaningSuppliesExtra(extraNames);
        this.isCustomServiceType = this.isCustomServiceTypeOrder(order);
        this.supplyChecklistItems = buildSupplyChecklistItems(
          resolveSupplyChecklistFacts(extraNames, this.isCustomServiceType)
        );

        // Consent gate — see the field block above. Only the INITIAL payment of an
        // admin-created order asks; a pending additional amount never does.
        this.consentRequired = this.paymentType === 'order' && !!order.bookedByAdmin;
        this.consentAccepted = !!order.paymentConsentAcceptedAt;
        this.consentAcceptedAt = order.paymentConsentAcceptedAt ?? null;

        // Saved card — logged-in owner only (guest/token payers never see it).
        if (CARD_ON_FILE_ENABLED && !this.isGuestMode && order.userId === this.currentUser?.id) {
          this.cardOnFileService.getSavedCard().subscribe({
            next: (res) => {
              if (res.card) {
                this.savedCard = res.card;
                this.payWithSavedCard = true; // default to the faster path
                this.cdr.detectChanges();
              }
            },
            error: () => { /* no saved-card option — normal card form remains */ }
          });
        }

        // Consent still owed: don't ask the backend for a PaymentIntent — it would refuse,
        // and the payer would see an error instead of the checkboxes. The card form (and
        // Apple Pay, which needs the client secret) appear once they agree.
        if (this.consentRequired && !this.consentAccepted) {
          this.isLoading = false;
          this.cdr.detectChanges();
          return;
        }

        // Create payment intent
        this.createPaymentIntent();
      },
      error: (error) => {
        // Guest link on an already-settled order: backend returns 403 with a helpful message.
        this.errorMessage = error.status === 403
          ? (error.error?.message || 'This order has no pending payments. Please log in to view its details.')
          : 'Failed to load order';
        this.isLoading = false;
        console.error('Error loading order:', error);
      }
    });
  }

  private isCustomServiceTypeOrder(order: Order): boolean {
    const services = order.services ?? [];
    const hasCustomServiceMarker = services.some(s => Number(s?.serviceId) === 0);
    const hasNoRegularServices = services.length === 0 || (services.length === 1 && Number(services[0]?.serviceId) === 0);
    return hasCustomServiceMarker || hasNoRegularServices;
  }

  createPaymentIntent() {
    const guestToken = this.isGuestMode ? this.guestToken! : undefined;
    const request$ = this.paymentType === 'order'
      ? this.bookingService.createPaymentIntentForOrder(this.orderId, guestToken)
      : this.orderService.createPendingUpdatePaymentIntent(this.orderId, this.orderTotal, guestToken);

    request$.subscribe({
      next: (response: any) => {
        // Gift card covers the full amount — server skipped Stripe. Confirm directly, no card form.
        if (response.requiresPayment === false) {
          this.fullyCovered = true;
          this.isLoading = false;
          this.cdr.detectChanges();
          return;
        }

        this.paymentClientSecret = response.paymentClientSecret;
        this.paymentIntentId = response.paymentIntentId ?? response.PaymentIntentId ?? null;
        this.isLoading = false;

        // Force change detection to ensure DOM is updated
        this.cdr.detectChanges();

        // Wait for DOM to be ready before initializing Stripe Elements
        requestAnimationFrame(() => {
          setTimeout(() => {
            this.initializeStripeElements();
          }, 200);
        });
      },
      error: (error) => {
        // Server says consent is still owed (stale tab, or an order that became admin-booked
        // after this page loaded) — fall back to the checkboxes instead of a dead-end error.
        if (error.status === 400 && error.error?.requiresConsent) {
          this.consentRequired = true;
          this.consentAccepted = false;
          this.isLoading = false;
          this.cdr.detectChanges();
          return;
        }
        this.errorMessage = error.error?.message || 'Failed to create payment intent';
        this.isLoading = false;
        console.error('Error creating payment intent:', error);
      }
    });
  }

  private async initializeStripeElements() {
    try {
      await this.stripeService.initializeElements();
      
      // Wait for Angular to render the DOM element
      // Use a retry mechanism to ensure the element exists
      let attempts = 0;
      const maxAttempts = 20;
      
      const tryMountElement = () => {
        const cardElementContainer = document.getElementById('card-element');
        
        if (!cardElementContainer) {
          if (attempts < maxAttempts) {
            attempts++;
            setTimeout(tryMountElement, 50);
            return;
          } else {
            console.error('Card element container not found in DOM after multiple attempts');
            this.errorMessage = 'Payment form not ready. Please refresh the page.';
            return;
          }
        }

        // Element exists, now create and mount Stripe card element
        try {
          const cardElement = this.stripeService.createCardElement('card-element');
          
          if (cardElement) {
            // Listen for card errors
            cardElement.on('change', (event: any) => {
              this.cardError = event.error ? event.error.message : null;
              this.cdr.detectChanges();
            });
            
            console.log('Stripe card element mounted successfully');
          } else {
            console.error('Failed to create card element - element may not exist in DOM');
            this.errorMessage = 'Failed to initialize payment form. Please refresh the page.';
          }
        } catch (mountError: any) {
          console.error('Error mounting Stripe element:', mountError);
          this.errorMessage = mountError.message || 'Failed to initialize payment form. Please refresh the page.';
        }
      };
      
      // Start trying to mount immediately
      tryMountElement();
      this.initApplePay();
    } catch (error: any) {
      console.error('Failed to initialize Stripe elements:', error);
      this.errorMessage = error.message || 'Failed to initialize payment form. Please refresh the page.';
    }
  }

  private async initApplePay() {
    if (!this.paymentClientSecret) return;
    const pr = await this.stripeService.createPaymentRequest(this.orderTotal, 'Dream Cleaning NYC');
    if (!pr) return;
    this.showApplePay = true;
    this.cdr.detectChanges();
    setTimeout(() => this.stripeService.createPaymentRequestButton(pr, 'payment-request-button'), 0);

    pr.on('paymentmethod', async (ev: any) => {
      if (this.isProcessing) { ev.complete('fail'); return; }
      this.isProcessing = true;
      this.errorMessage = '';
      try {
        const paymentIntent = await this.stripeService.confirmPaymentRequest(
          this.paymentClientSecret!, ev.paymentMethod.id
        );
        ev.complete('success');
        const idForConfirm = paymentIntent?.id ?? this.paymentIntentId;
        const guestToken = this.isGuestMode ? this.guestToken! : undefined;
        const confirm$ = this.paymentType === 'order'
          ? this.bookingService.confirmPayment(this.orderId, idForConfirm, undefined, guestToken)
          : this.orderService.confirmPendingUpdatePayment(this.orderId, idForConfirm, guestToken);
        confirm$.subscribe({
          next: () => this.handlePaymentSuccess(),
          error: (err: any) => {
            this.errorMessage = err.error?.message || err.message || 'Payment confirmation failed';
            this.isProcessing = false;
            this.cdr.detectChanges();
          }
        });
      } catch (payErr: any) {
        ev.complete('fail');
        this.errorMessage = payErr.message || 'Payment failed. Please try again.';
        this.isProcessing = false;
        this.cdr.detectChanges();
      }
    });
  }


  /** All three consents ticked — the only state from which the payer may continue. */
  get allConsentsChecked(): boolean {
    return this.smsConsent && this.cancellationConsent && this.termsConsent;
  }

  /** The card form / Apple Pay / Pay button are shown only once consent is settled. */
  get showPaymentSection(): boolean {
    return !this.consentRequired || this.consentAccepted;
  }

  /**
   * Records the agreement, then asks for the PaymentIntent. Kept in this order deliberately:
   * the backend will not issue a client secret before the consent row exists, so a failure
   * here leaves the payer on the checkboxes with nothing charged.
   */
  acceptConsentAndContinue(): void {
    if (!this.allConsentsChecked || this.consentSubmitting) return;

    this.consentSubmitting = true;
    this.consentError = '';
    this.bookingService.acceptPaymentConsent(
      this.orderId,
      { smsConsent: true, cancellationConsent: true, termsConsent: true },
      this.isGuestMode ? this.guestToken! : undefined
    ).subscribe({
      next: (res) => {
        this.consentSubmitting = false;
        this.consentAccepted = true;
        this.consentAcceptedAt = res?.acceptedAt ?? new Date().toISOString();
        this.isLoading = true;
        this.cdr.detectChanges();
        this.createPaymentIntent();
      },
      error: (err) => {
        this.consentSubmitting = false;
        this.consentError = err.error?.message
          || 'Could not record your agreement. Please try again.';
        this.cdr.detectChanges();
      }
    });
  }

  /** "August 18, 2026, 3:04 PM" for the accepted-on note. */
  formatDateTime(value: string | null): string {
    if (!value) return '';
    const d = new Date(value);
    return isNaN(d.getTime()) ? '' : d.toLocaleString();
  }

  async processPayment() {
    // Belt and braces: the template hides the Pay button until consent is recorded, and the
    // backend never issued a client secret without it — but never let a click through here.
    if (this.consentRequired && !this.consentAccepted) return;
    if (this.isProcessing) return;
    if (!this.fullyCovered && ((!this.usingSavedCard && this.cardError) || !this.paymentClientSecret)) return;

    this.isProcessing = true;
    this.errorMessage = '';

    // Fully covered by gift card — confirm the order with no Stripe charge.
    if (this.fullyCovered) {
      this.bookingService.confirmPayment(this.orderId, '', undefined, this.isGuestMode ? this.guestToken! : undefined).subscribe({
        next: () => this.handlePaymentSuccess(),
        error: (error) => {
          this.errorMessage = error.error?.message || error.message || 'Payment confirmation failed';
          this.isProcessing = false;
          this.cdr.detectChanges();
        }
      });
      return;
    }

    try {
      // Confirm the payment — with the saved card when selected (explicit Pay click;
      // confirmPaymentRequest accepts any payment-method id and handles 3DS in-browser),
      // otherwise with the entered card. Non-null: this path only runs when !fullyCovered,
      // where the early guard above already ensured paymentClientSecret is set.
      const paymentIntent = this.usingSavedCard && this.savedCard
        ? await this.stripeService.confirmPaymentRequest(
            this.paymentClientSecret!,
            this.savedCard.paymentMethodId
          )
        : await this.stripeService.confirmCardPayment(
            this.paymentClientSecret!,
            this.billingDetails
          );
      
      // Same as booking-confirmation: use paymentIntent.id from Stripe after confirmCardPayment
      const idForConfirm = paymentIntent?.id ?? (paymentIntent as any)?.paymentIntent?.id ?? this.paymentIntentId;
      if (!idForConfirm) {
        this.errorMessage = 'Payment succeeded but could not get payment ID. Your order may still be marked paid—please refresh.';
        this.isProcessing = false;
        return;
      }

      const guestToken = this.isGuestMode ? this.guestToken! : undefined;
      const confirm$ = this.paymentType === 'order'
        ? this.bookingService.confirmPayment(this.orderId, idForConfirm, undefined, guestToken)
        : this.orderService.confirmPendingUpdatePayment(this.orderId, idForConfirm, guestToken);

      confirm$.subscribe({
        next: () => {
          this.handlePaymentSuccess();
        },
        error: (error) => {
          const msg = error.error?.message || error.message || 'Payment confirmation failed';
          this.errorMessage = msg;
          this.isProcessing = false;
          console.error('Confirm payment failed', error.status, msg, error.error);
          if (error.status === 400 && msg.toLowerCase().includes('payment not completed')) {
            this.errorMessage += ' If you were charged, refresh the page—your order may already be paid.';
          }
        }
      });
    } catch (paymentError: any) {
      // Payment failed
      this.errorMessage = paymentError.message || 'Payment failed. Please try again.';
      this.isProcessing = false;
    }
  }

  private handlePaymentSuccess() {
    this.paymentCompleted = true;
    this.isProcessing = false;

    if (this.isGuestMode) {
      // No session to refresh and nowhere to redirect (order pages need login) —
      // stay here and show the success state.
      return;
    }

    // Refresh user profile
    this.authService.refreshUserProfile().subscribe({
      next: () => {},
      error: (error) => {
        console.error('Failed to refresh user profile:', error);
      }
    });

    if (this.paymentType === 'update') {
      // Additional payment only: stay on this page.
      // The user will click "View Order Now" when they're ready.
      return;
    }

    // Initial order payment: go to booking-success for Google Ads conversion tracking.
    // No auto-redirect; user decides when to navigate.
    this.router.navigate(['/booking-success', this.orderId], {
      state: { paymentSuccess: true }
    });
  }

  cancelPayment() {
    if (this.isGuestMode) {
      // Guests can't open the order-details page (auth-guarded) — go home instead.
      this.router.navigate(['/']);
      return;
    }
    this.router.navigate(['/order', this.orderId]);
  }

  get billingDetails() {
    return {
      name: this.order ? `${this.order.contactFirstName} ${this.order.contactLastName}` : '',
      email: this.order?.contactEmail || this.currentUser?.email || '',
      phone: this.order?.contactPhone || this.currentUser?.phone || ''
    };
  }

  // ── Order-summary display helpers (mirror order-details.component conventions:
  //    quantities only, never per-item prices; deep cleaning shown as Cleaning Type) ──

  getCleaningTypeText(): string {
    const extras = this.order?.extraServices ?? [];
    const hasSuperDeep = extras.some(s => (s.extraServiceName ?? '').toLowerCase().includes('super deep cleaning'));
    const hasDeep = extras.some(s => {
      const n = (s.extraServiceName ?? '').toLowerCase();
      return n.includes('deep cleaning') && !n.includes('super');
    });
    if (hasSuperDeep) return 'Super Deep Cleaning';
    if (hasDeep) return 'Deep Cleaning';
    return 'Regular Cleaning';
  }

  /** Deep/super-deep cleaning is shown under Cleaning Type, not as a line item. */
  private isCleaningTypeExtra(extraServiceName: string): boolean {
    return (extraServiceName ?? '').toLowerCase().includes('deep cleaning');
  }

  getDisplayExtraServices() {
    return (this.order?.extraServices ?? []).filter(e => !this.isCleaningTypeExtra(e.extraServiceName));
  }

  /** Quantity label for a service line: "Studio" for bedrooms=0, hours for cleaners, plain qty otherwise. */
  getServiceQuantityLabel(service: { serviceName: string; quantity: number; duration: number }): string {
    const name = (service.serviceName ?? '').toLowerCase();
    if (name.includes('bedroom') && service.quantity === 0) return 'Studio';
    if (name.includes('cleaner')) return `Qty: ${service.quantity} | Hours: ${service.duration / 60}`;
    return `Qty: ${service.quantity}`;
  }

  formatDate(date: any): string {
    return new Date(date).toLocaleDateString();
  }

  formatTime(time: string): string {
    const [hours, minutes] = time.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  }
}
