import { inject, Service } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  loadStripe, Stripe, StripeElements, StripeCardElement, StripeExpressCheckoutElement,
  StripeExpressCheckoutElementOptions
} from '@stripe/stripe-js';
import { AuthService } from './auth.service';
import { ThemeService } from './theme.service';

/**
 * A page's Apple Pay / Google Pay button (see {@link StripeService.mountWalletButton}). The wallet
 * only produces a card PaymentMethod; the page charges it through its own PaymentIntent exactly
 * like a saved card, so the server side of every payment flow is the same for all three.
 */
export interface WalletButtonOptions {
  /** Id of the element the button mounts into. It must be rendered (not display:none) first. */
  elementId: string;
  /** The amount in dollars the wallet sheet shows. Keep it current with updateWalletAmount(). */
  amount: number;
  /** Asked when the button is tapped; false keeps the sheet closed (a payment is already running). */
  canStart: () => boolean;
  /** Whether this device offers Apple Pay or Google Pay — the page shows the button's row only then. */
  onAvailability: (available: boolean) => void;
  /** The customer authorised a card in the wallet sheet: the PaymentMethod id to charge. */
  onPaymentMethod: (paymentMethodId: string) => void;
  /** The sheet could not produce a payment method (nothing was charged). */
  onError: (message: string) => void;
}

@Service()
export class StripeService {
  private http = inject(HttpClient);
  private authService = inject(AuthService);
  private themeService = inject(ThemeService);

  private stripe: Stripe | null = null;
  private elements: StripeElements | null = null;
  private cardElement: StripeCardElement | null = null;
  private apiUrl = environment.apiUrl;
  // Apple Pay / Google Pay. The Express Checkout Element needs a deferred-intent Elements group
  // of its own (mode + amount); the card field's group above has no such options.
  private walletElements: StripeElements | null = null;
  private walletButton: StripeExpressCheckoutElement | null = null;
  private walletOptions: WalletButtonOptions | null = null;

  constructor() {
    this.initializeStripe();

    // The card field lives in a Stripe iframe, so CSS can't reach it — its colors are baked
    // in at create() time. Re-push them whenever the theme flips, otherwise a field mounted
    // in light mode keeps dark navy text on the dark surface (unreadable, and the guest
    // payment pages are where it shows up most). The wallet button's theme can't be updated in
    // place, so it is rebuilt.
    this.themeService.theme$.subscribe(() => {
      this.applyCardElementTheme();
      this.applyWalletButtonTheme();
    });
  }

  private getCardElementStyle(): { base: any; invalid: any } {
    const isDark = this.themeService.theme === 'dark';
    return {
      base: {
        fontSize: '16px',
        color: isDark ? '#ffffff' : '#32325d',
        fontFamily: '"Helvetica Neue", Helvetica, sans-serif',
        iconColor: isDark ? '#e2e8f0' : '#32325d',
        '::placeholder': {
          color: isDark ? '#b0b0b0' : '#aab7c4'
        }
      },
      invalid: {
        color: '#fa755a',
        iconColor: '#fa755a'
      }
    };
  }

  // Re-apply the theme-dependent style to the mounted card element (no-op when none is mounted).
  private applyCardElementTheme(): void {
    if (!this.cardElement) return;
    try {
      this.cardElement.update({ style: this.getCardElementStyle() });
    } catch {
      // Element was destroyed between the theme change and this call — nothing to restyle.
    }
  }

  private async initializeStripe() {
    this.stripe = await loadStripe(environment.stripePublishableKey);
  }

  // Initialize Stripe Elements
  async initializeElements(): Promise<void> {
    if (!this.stripe) {
      await this.initializeStripe();
    }
    
    if (this.stripe && !this.elements) {
      this.elements = this.stripe.elements();
    }
  }

  // Create Stripe Elements (for backward compatibility)
  createElements(): StripeElements | null {
    // This is synchronous for backward compatibility
    // But elements might not be ready if stripe isn't loaded
    if (!this.stripe) {
      console.warn('Stripe not initialized. Call initializeElements() first.');
      return null;
    }
    
    if (!this.elements && this.stripe) {
      this.elements = this.stripe.elements();
    }
    
    return this.elements;
  }

  // Create and mount card element
  createCardElement(elementId: string): StripeCardElement | null {
    // Synchronous version for backward compatibility
    if (!this.elements) {
      this.createElements();
    }
    
    if (!this.elements) {
      throw new Error('Stripe Elements not initialized');
    }

    // Destroy existing card element if any
    if (this.cardElement) {
      this.cardElement.destroy();
    }

    // Check if DOM element exists before creating Stripe element
    const element = document.getElementById(elementId);
    if (!element) {
      console.error(`Element with id "${elementId}" not found in DOM`);
      return null;
    }

    // Create new card element (theme-aware text color)
    this.cardElement = this.elements.create('card', {
      style: this.getCardElementStyle()
    });

    // Mount to DOM
    this.cardElement.mount(`#${elementId}`);
    return this.cardElement;
  }

  // Async version for new implementations
  async createCardElementAsync(elementId: string): Promise<StripeCardElement | null> {
    await this.initializeElements();
    
    if (!this.elements) {
      throw new Error('Stripe Elements not initialized');
    }

    // Destroy existing card element if any
    if (this.cardElement) {
      this.cardElement.destroy();
    }

    // Create new card element (theme-aware text color)
    this.cardElement = this.elements.create('card', {
      style: this.getCardElementStyle()
    });

    // Mount to DOM
    const element = document.getElementById(elementId);
    if (element) {
      this.cardElement.mount(`#${elementId}`);
    }

    return this.cardElement;
  }

  // Confirm card payment
  /**
   * @param saveForFutureUse ONLY when the customer ticked "save this card" before paying. Stripe
   * then attaches the card to their Customer for later payments (setup_future_usage=off_session);
   * the server verifies that flag on the intent before recording the card, so nothing is saved
   * without this explicit choice. Saving never turns AutoPay on.
   */
  async confirmCardPayment(clientSecret: string, billingDetails?: any, saveForFutureUse = false): Promise<any> {
    if (!this.stripe || !this.cardElement) {
      throw new Error('Stripe not initialized');
    }

    const { error, paymentIntent } = await this.stripe.confirmCardPayment(clientSecret, {
      payment_method: {
        card: this.cardElement,
        billing_details: billingDetails
      },
      ...(saveForFutureUse ? { setup_future_usage: 'off_session' as const } : {})
    });

    if (error) {
      throw error;
    }

    return paymentIntent;
  }

  // Confirm a SetupIntent with the mounted card element — saves a card WITHOUT charging it
  // (profile "card on file" management). Returns the SetupIntent whose payment_method id
  // the backend stores as the user's saved card.
  async confirmCardSetup(clientSecret: string, billingDetails?: any): Promise<any> {
    if (!this.stripe || !this.cardElement) {
      throw new Error('Stripe not initialized');
    }

    const { error, setupIntent } = await this.stripe.confirmCardSetup(clientSecret, {
      payment_method: {
        card: this.cardElement,
        billing_details: billingDetails
      }
    });

    if (error) {
      throw error;
    }

    return setupIntent;
  }

  // Get payment intent
  async getPaymentIntentAsync(paymentIntentId: string): Promise<any> {
    if (!this.stripe) {
      await this.initializeStripe();
    }
    
    if (!this.stripe) {
      throw new Error('Stripe not initialized');
    }
    
    const result = await this.stripe.retrievePaymentIntent(paymentIntentId);
    return result.paymentIntent;
  }

  // Destroy card element
  destroyCardElement(): void {
    if (this.cardElement) {
      this.cardElement.destroy();
      this.cardElement = null;
    }
  }

  // Create payment intent API call
  createPaymentIntent(amount: number, metadata?: any): Observable<any> {
    const headers = new HttpHeaders({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.authService.getToken()}`
    });
    
    const body = {
      amount: Math.round(amount * 100), // Convert to cents
      currency: 'usd',
      metadata: metadata || {}
    };
    
    // Update this URL to match your backend controller route
    return this.http.post(`${this.apiUrl}/stripewebhook/create-payment-intent`, body, { headers });
  }

  // Get card element
  getCardElement(): StripeCardElement | null {
    return this.cardElement;
  }

  /**
   * Mounts the Apple Pay / Google Pay button (Stripe's Express Checkout Element, limited to those
   * two wallets). It replaces the Payment Request Button, which Stripe.js no longer ships.
   *
   * The element group is created in deferred mode with `paymentMethodCreation: 'manual'`, so the
   * wallet sheet only produces a card PaymentMethod (`createPaymentMethod`). Nothing is charged
   * here: the page passes that id to {@link confirmPaymentRequest} against its own PaymentIntent,
   * the same path a saved card takes. The sheet closes once the payment method exists; anything
   * that fails after that is reported on the page.
   *
   * Resolves false when Stripe could not be loaded or the container is missing.
   */
  async mountWalletButton(options: WalletButtonOptions): Promise<boolean> {
    this.destroyWalletButton();
    if (!this.stripe) await this.initializeStripe();
    if (!this.stripe) return false;
    if (!document.getElementById(options.elementId)) {
      console.error(`Element with id "${options.elementId}" not found in DOM`);
      return false;
    }

    this.walletOptions = options;
    this.walletElements = this.stripe.elements({
      mode: 'payment',
      amount: this.toCents(options.amount),
      currency: 'usd',
      paymentMethodCreation: 'manual',
      // Apple Pay and Google Pay hand over cards; nothing else may reach these intents.
      // (Stripe.js 10 / API endive name; it was paymentMethodTypes before.)
      allowedPaymentMethodTypes: ['card'],
    });
    this.createWalletButton();
    return true;
  }

  /** Keeps the amount on the wallet sheet in step with the page's total (coupons, tips, balance). */
  updateWalletAmount(amount: number): void {
    if (!this.walletElements || !this.walletOptions) return;
    const cents = this.toCents(amount);
    if (cents <= 0) return;
    this.walletOptions = { ...this.walletOptions, amount };
    this.walletElements.update({ amount: cents });
  }

  private createWalletButton(): void {
    const options = this.walletOptions;
    const group = this.walletElements;
    if (!options || !group) return;

    const isDark = this.themeService.theme === 'dark';
    const buttonOptions: StripeExpressCheckoutElementOptions = {
      paymentMethods: { applePay: 'auto', googlePay: 'auto', link: 'never', paypal: 'never', amazonPay: 'never', klarna: 'never' },
      // Same look as the old Payment Request Button: plain wallet mark, white on the light
      // theme and black on the dark one, 48px tall, the two wallets stacked full width.
      buttonType: { applePay: 'plain', googlePay: 'plain' },
      buttonTheme: { applePay: isDark ? 'black' : 'white', googlePay: isDark ? 'black' : 'white' },
      buttonHeight: 48,
      // overflow 'never' (no "more" menu) is only accepted with maxRows 0 = as many rows as needed.
      layout: { maxColumns: 1, maxRows: 0, overflow: 'never' },
      emailRequired: true,
    };
    const button = group.create('expressCheckout', buttonOptions);
    this.walletButton = button;

    button.on('ready', ({ availablePaymentMethods }) => {
      if (this.walletButton !== button) return;
      options.onAvailability(!!availablePaymentMethods && (availablePaymentMethods.applePay || availablePaymentMethods.googlePay));
    });
    button.on('click', (event) => {
      if (options.canStart()) event.resolve();
      else event.reject();
    });
    button.on('confirm', async (event) => {
      const stripe = this.stripe;
      if (!stripe || this.walletButton !== button) { event.paymentFailed({ reason: 'fail' }); return; }
      const submitted = await group.submit();
      if (submitted.error) {
        event.paymentFailed({ reason: 'fail' });
        options.onError(submitted.error.message || 'Payment failed. Please try again.');
        return;
      }
      const { error, paymentMethod } = await stripe.createPaymentMethod({ elements: group });
      if (error || !paymentMethod) {
        event.paymentFailed({ reason: 'fail' });
        options.onError(error?.message || 'Payment failed. Please try again.');
        return;
      }
      options.onPaymentMethod(paymentMethod.id);
    });
    button.mount(`#${options.elementId}`);
  }

  // The button's colours are fixed at create() time; rebuild it in the same group on a theme flip.
  private applyWalletButtonTheme(): void {
    if (!this.walletButton || !this.walletOptions || !document.getElementById(this.walletOptions.elementId)) return;
    try { this.walletButton.destroy(); } catch {}
    this.walletButton = null;
    this.createWalletButton();
  }

  private toCents(amount: number): number {
    return Math.round((Number(amount) || 0) * 100);
  }

  // Confirm using the wallet payment method. Handles 3D Secure (requires_action).
  async confirmPaymentRequest(clientSecret: string, paymentMethodId: string): Promise<any> {
    if (!this.stripe) throw new Error('Stripe not initialized');

    const { error, paymentIntent } = await this.stripe.confirmCardPayment(
      clientSecret,
      { payment_method: paymentMethodId },
      { handleActions: false }
    );
    if (error) throw error;

    if (paymentIntent && paymentIntent.status === 'requires_action') {
      const res = await this.stripe.confirmCardPayment(clientSecret);
      if (res.error) throw res.error;
      return res.paymentIntent;
    }
    return paymentIntent;
  }

  /**
   * Completes the bank's challenge (3DS) on an intent the SERVER already confirmed with a saved
   * card while the customer was present. Returns the intent's final state; the server is then
   * asked to settle from Stripe's own record — the browser's answer is never trusted on its own.
   */
  async completeBankChallenge(clientSecret: string): Promise<any> {
    if (!this.stripe) await this.initializeStripe();
    if (!this.stripe) throw new Error('Stripe not initialized');
    const { error, paymentIntent } = await this.stripe.confirmCardPayment(clientSecret);
    if (error) throw error;
    return paymentIntent;
  }

  destroyWalletButton(): void {
    if (this.walletButton) {
      try { this.walletButton.destroy(); } catch {}
      this.walletButton = null;
    }
    this.walletElements = null;
    this.walletOptions = null;
  }
}