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

  constructor(
    private http: HttpClient,
    private authService: AuthService,
    private themeService: ThemeService
  ) {
    this.initializeStripe();
  }

  private getCardElementStyle(): { base: any; invalid: any } {
    const isDark = this.themeService.theme === 'dark';
    return {
      base: {
        fontSize: '16px',
        color: isDark ? '#ffffff' : '#32325d',
        fontFamily: '"Helvetica Neue", Helvetica, sans-serif',
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
}