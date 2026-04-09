import { Component, OnInit, OnDestroy, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { GiftCardService, CreateGiftCard } from '../../services/gift-card.service';
import { AuthService } from '../../services/auth.service';
import { StripeService } from '../../services/stripe.service';

@Component({
  selector: 'app-gift-card-confirmation',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './gift-card-confirmation.component.html',
  styleUrls: ['./gift-card-confirmation.component.scss']
})
export class GiftCardConfirmationComponent implements OnInit, OnDestroy {
  giftCardId: number = 0;
  isProcessing = false;
  paymentCompleted = false;
  errorMessage = '';
  giftCardData: CreateGiftCard | null = null;
  paymentClientSecret: string | null = null;
  giftCardAmount: number = 0;
  currentUser: any;
  isPreparing = false;

  cardError: string | null = null;
  private isBrowser: boolean;

  constructor(
    private router: Router,
    private authService: AuthService,
    private giftCardService: GiftCardService,
    private stripeService: StripeService,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
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
  }

  private async initializeStripeElements() {
    try {
      await this.stripeService.initializeElements();
      const cardElement = this.stripeService.createCardElement('card-element');
      
      if (cardElement) {
        cardElement.on('change', (event: any) => {
          this.cardError = event.error ? event.error.message : null;
        });
      }
    } catch (error) {
      console.error('Failed to initialize Stripe elements:', error);
      this.errorMessage = 'Failed to initialize payment form';
    }
  }

  async processPayment() {
    if (!this.giftCardData || this.isProcessing || this.cardError) return;
    
    this.isProcessing = true;
    this.errorMessage = '';
    
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
                this.paymentCompleted = true;
                this.isProcessing = false;
              },
              error: (error) => {
                this.errorMessage = error.error?.message || 'Payment confirmation failed';
                this.isProcessing = false;
              }
            });
          } catch (paymentError: any) {
            this.errorMessage = paymentError.message || 'Payment failed. Please try again.';
            this.isProcessing = false;
          }
        },
        error: (error) => {
          if (error.status === 401) {
            this.errorMessage = 'Authentication required. Please try again or contact support if the issue persists.';
          } else {
            this.errorMessage = error.error?.message || 'Failed to create gift card. Please try again.';
          }
          this.isProcessing = false;
        }
      });
    } catch (error: any) {
      this.errorMessage = 'An unexpected error occurred';
      this.isProcessing = false;
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