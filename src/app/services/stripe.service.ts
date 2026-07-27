import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { loadStripe, Stripe, StripeElements, StripeCardElement } from '@stripe/stripe-js';
import { AuthService } from './auth.service';
import { ThemeService } from './theme.service';

@Injectable({
  providedIn: 'root'
})
export class StripeService {
  private stripe: Stripe | null = null;
  private elements: StripeElements | null = null;
  private cardElement: StripeCardElement | null = null;
  private apiUrl = environment.apiUrl;
  private paymentRequest: any = null;
  private prButton: any = null;

  constructor(
    private http: HttpClient,
    private authService: AuthService,
    private themeService: ThemeService
  ) {
    this.initializeStripe();

    // The card field lives in a Stripe iframe, so CSS can't reach it — its colors are baked
    // in at create() time. Re-push them whenever the theme flips, otherwise a field mounted
    // in light mode keeps dark navy text on the dark surface (unreadable, and the guest
    // payment pages are where it shows up most).
    this.themeService.theme$.subscribe(() => this.applyCardElementTheme());
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
  async confirmCardPayment(clientSecret: string, billingDetails?: any): Promise<any> {
    if (!this.stripe || !this.cardElement) {
      throw new Error('Stripe not initialized');
    }

    const { error, paymentIntent } = await this.stripe.confirmCardPayment(clientSecret, {
      payment_method: {
        card: this.cardElement,
        billing_details: billingDetails
      }
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

  // Create a PaymentRequest (Apple Pay / Google Pay). Returns null if the device can't pay.
  async createPaymentRequest(amount: number, label: string): Promise<any | null> {
    if (!this.stripe) {
      await this.initializeStripe();
    }
    if (!this.stripe) return null;

    this.paymentRequest = this.stripe.paymentRequest({
      country: 'US',
      currency: 'usd',
      total: { label, amount: Math.round(amount * 100) },
      requestPayerName: true,
      requestPayerEmail: true,
    });

    const result = await this.paymentRequest.canMakePayment();
    return result ? this.paymentRequest : null;
  }

  // Mount the Apple/Google Pay button. Theme follows the current site theme.
  createPaymentRequestButton(paymentRequest: any, elementId: string): any {
    if (!this.elements) {
      this.createElements();
    }
    if (!this.elements) {
      throw new Error('Stripe Elements not initialized');
    }
    const el = document.getElementById(elementId);
    if (!el) {
      console.error(`Element with id "${elementId}" not found in DOM`);
      return null;
    }
    if (this.prButton) {
      try { this.prButton.destroy(); } catch {}
      this.prButton = null;
    }
    const isDark = this.themeService.theme === 'dark';
    this.prButton = this.elements.create('paymentRequestButton', {
      paymentRequest,
      style: {
        paymentRequestButton: {
          type: 'default',
          theme: isDark ? 'dark' : 'light',
          height: '48px'
        }
      }
    });
    this.prButton.mount(`#${elementId}`);
    return this.prButton;
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

  destroyPaymentRequestButton(): void {
    if (this.prButton) {
      try { this.prButton.destroy(); } catch {}
      this.prButton = null;
    }
    this.paymentRequest = null;
  }
}