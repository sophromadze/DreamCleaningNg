import { Component, OnInit, OnDestroy, PLATFORM_ID, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { GiftCardService, CreateGiftCard } from '../../services/gift-card.service';
import { AuthService } from '../../services/auth.service';
import { StripeService } from '../../services/stripe.service';
import { IconComponent } from '../../shared/icons/icon.component';
import { faCircleCheck } from '../../shared/icons/glyphs/faCircleCheck';
import { faEnvelope } from '../../shared/icons/glyphs/faEnvelope';

@Component({
  selector: 'app-gift-card-confirmation',
  standalone: true,
  imports: [CommonModule, RouterModule, IconComponent],
  templateUrl: './gift-card-confirmation.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./gift-card-confirmation.component.scss']
})
export class GiftCardConfirmationComponent implements OnInit, OnDestroy {
  private router = inject(Router);
  private authService = inject(AuthService);
  private giftCardService = inject(GiftCardService);
  private stripeService = inject(StripeService);
  private platformId = inject<Object>(PLATFORM_ID);

  protected readonly icons = { faCircleCheck, faEnvelope };

  giftCardId: number = 0;
  readonly isProcessing = signal(false);
  readonly paymentCompleted = signal(false);
  readonly errorMessage = signal('');
  giftCardData: CreateGiftCard | null = null;
  paymentClientSecret: string | null = null;
  giftCardAmount: number = 0;
  currentUser: any;
  isPreparing = false;

  readonly cardError = signal<string | null>(null);
  readonly showApplePay = signal(false);
  private isBrowser: boolean;

  constructor() {
    this.isBrowser = isPlatformBrowser(this.platformId);
    // Try to get state from navigation
    const navigation = this.router.getCurrentNavigation();
    const state = navigation?.extras?.state as { giftCardData: CreateGiftCard };
    
    if (state?.giftCardData) {
      this.giftCardData = state.giftCardData;
    }
  }

  ngOnInit() {
    // If no gift card data, try to get it from router state
    if (!this.giftCardData && this.isBrowser) {
      const state = history.state as { giftCardData: CreateGiftCard };
      if (state?.giftCardData) {
        this.giftCardData = state.giftCardData;
      }
    }
    
    if (!this.giftCardData) {
      console.error('No gift card data found, redirecting back...');
      this.router.navigate(['/gift-cards']);
      return;
    }

    // Set the amount
    this.giftCardAmount = typeof this.giftCardData.amount === 'string' 
      ? parseFloat(this.giftCardData.amount) 
      : this.giftCardData.amount;

    // Get current user
    this.authService.currentUser.subscribe(user => {
      this.currentUser = user;
    });

    // Initialize Stripe Elements
    this.initializeStripeElements();
  }

  ngOnDestroy() {
    this.stripeService.destroyCardElement();
    this.stripeService.destroyPaymentRequestButton();
  }

  private async initializeStripeElements() {
    try {
      await this.stripeService.initializeElements();
      const cardElement = this.stripeService.createCardElement('card-element');

      if (cardElement) {
        cardElement.on('change', (event: any) => {
          this.cardError.set(event.error ? event.error.message : null);
        });
      }
      this.initApplePay();
    } catch (error) {
      console.error('Failed to initialize Stripe elements:', error);
      this.errorMessage.set('Failed to initialize payment form');
    }
  }

  private async initApplePay() {
    if (!this.isBrowser || !this.giftCardData) return;
    const pr = await this.stripeService.createPaymentRequest(this.giftCardAmount, 'Dream Cleaning NYC');
    if (!pr) return;
    this.showApplePay.set(true);
    setTimeout(() => this.stripeService.createPaymentRequestButton(pr, 'payment-request-button'), 0);

    pr.on('paymentmethod', (ev: any) => {
      if (this.isProcessing()) { ev.complete('fail'); return; }
      this.isProcessing.set(true);
      this.errorMessage.set('');
      this.giftCardService.createGiftCard(this.giftCardData!).subscribe({
        next: async (response: any) => {
          try {
            this.giftCardId = response.giftCardId;
            const paymentIntent = await this.stripeService.confirmPaymentRequest(
              response.paymentClientSecret, ev.paymentMethod.id
            );
            ev.complete('success');
            this.giftCardService.confirmGiftCardPayment(this.giftCardId, paymentIntent.id).subscribe({
              next: () => { this.paymentCompleted.set(true); this.isProcessing.set(false); },
              error: (err: any) => {
                this.errorMessage.set(err.error?.message || 'Payment confirmation failed');
                this.isProcessing.set(false);
              }
            });
          } catch (payErr: any) {
            ev.complete('fail');
            this.errorMessage.set(payErr.message || 'Payment failed. Please try again.');
            this.isProcessing.set(false);
          }
        },
        error: (err: any) => {
          ev.complete('fail');
          this.errorMessage.set(err.error?.message || 'Failed to create gift card. Please try again.');
          this.isProcessing.set(false);
        }
      });
    });
  }

  async processPayment() {
    if (!this.giftCardData || this.isProcessing() || this.cardError()) return;
    
    this.isProcessing.set(true);
    this.errorMessage.set('');
    
    try {
      // Create the gift card and get payment intent
      this.giftCardService.createGiftCard(this.giftCardData).subscribe({
        next: async (response) => {
          this.giftCardId = response.giftCardId;
          this.paymentClientSecret = response.paymentClientSecret;
          
          try {
            // Confirm the payment
            const paymentIntent = await this.stripeService.confirmCardPayment(
              response.paymentClientSecret,
              this.billingDetails
            );
            
            // Confirm payment with backend
            this.giftCardService.confirmGiftCardPayment(this.giftCardId, paymentIntent.id).subscribe({
              next: (confirmResponse) => {
                this.paymentCompleted.set(true);
                this.isProcessing.set(false);
              },
              error: (error) => {
                this.errorMessage.set(error.error?.message || 'Payment confirmation failed');
                this.isProcessing.set(false);
              }
            });
          } catch (paymentError: any) {
            this.errorMessage.set(paymentError.message || 'Payment failed. Please try again.');
            this.isProcessing.set(false);
          }
        },
        error: (error) => {
          if (error.status === 401) {
            // "Send later" answers 401 with its own message when the session has ended.
            this.errorMessage.set(error.error?.message
              || 'Authentication required. Please try again or contact support if the issue persists.');
          } else {
            this.errorMessage.set(error.error?.message || 'Failed to create gift card. Please try again.');
          }
          this.isProcessing.set(false);
        }
      });
    } catch (error: any) {
      this.errorMessage.set('An unexpected error occurred');
      this.isProcessing.set(false);
    }
  }

  get billingDetails() {
    return {
      name: this.giftCardData?.senderName || '',
      email: this.giftCardData?.senderEmail || ''
    };
  }

  cancelPurchase() {
    this.router.navigate(['/gift-cards']);
  }
}