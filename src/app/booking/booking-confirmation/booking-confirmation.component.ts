import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { BookingService } from '../../services/booking.service';
import { BookingDataService } from '../../services/booking-data.service';
import { StripeService } from '../../services/stripe.service';

@Component({
  selector: 'app-booking-confirmation',
  standalone: true,
  imports: [CommonModule, RouterModule],
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

  // Remove the preparePayment flag - we don't need it anymore
  isPreparing = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private authService: AuthService,
    private bookingService: BookingService,
    private bookingDataService: BookingDataService,
    private stripeService: StripeService
  ) {}

  ngOnInit() {
    // Get booking data from service
    this.bookingData = this.bookingDataService.getBookingData();
    
    if (!this.bookingData) {
      // No booking data, redirect back to booking
      this.router.navigate(['/booking']);
      return;
    }

    // Get current user for billing details
    this.authService.currentUser.subscribe(user => {
      this.currentUser = user;
    });

    // Calculate and display the total
    this.calculateOrderTotal();
    
    // Initialize Stripe Elements asynchronously
    this.initializeStripeElements();
  }

  ngOnDestroy() {
    // Clean up Stripe elements
    this.stripeService.destroyCardElement();
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
      // Fallback calculation
      const subTotal = this.bookingData.subTotal || 0;
      const tips = this.bookingData.tips || 0;
      const companyDevelopmentTips = this.bookingData.companyDevelopmentTips || 0;
      const discountAmount = this.bookingData.discountAmount || 0;
      const subscriptionDiscountAmount = this.bookingData.subscriptionDiscountAmount || 0;
      const giftCardAmountToUse = this.bookingData.giftCardAmountToUse || 0;
      
      // Calculate total discount
      const totalDiscountAmount = discountAmount + subscriptionDiscountAmount;
      
      // Calculate tax on DISCOUNTED subtotal
      const discountedSubTotal = subTotal - totalDiscountAmount;
      const tax = Math.round(discountedSubTotal * 0.08875 * 100) / 100;
      
      // Calculate final total
      const totalBeforeGiftCard = discountedSubTotal + tax + tips + companyDevelopmentTips;
      total = Math.max(0, totalBeforeGiftCard - giftCardAmountToUse);
      total = Math.round(total * 100) / 100;
    }
    
    this.orderTotal = total;
  }

  // REMOVE the old preparePayment method entirely

  // Prepare payment and get payment intent WITHOUT creating order
  async processPayment() {
    if (this.isProcessing || this.cardError) return;

    this.isProcessing = true;
    this.errorMessage = '';

    try {
      // Prepare payment - this creates payment intent but NOT the order
      this.bookingService.preparePayment(this.bookingData).subscribe({
        next: async (response) => {
          this.paymentClientSecret = response.paymentClientSecret;
          this.orderTotal = response.total;
          const sessionId = response.sessionId; // Store sessionId for confirm-payment

          // Guest booking: auto-login user that was created during preparePayment
          if (response.guestToken && response.guestUser && !this.authService.isLoggedIn()) {
            this.authService.applyGuestAuth(response.guestToken, response.guestRefreshToken, response.guestUser);
            this.currentUser = response.guestUser;
          }

          try {
            // Now immediately confirm the payment
            const paymentIntent = await this.stripeService.confirmCardPayment(
              response.paymentClientSecret,
              this.billingDetails
            );

            // Payment successful, confirm it with backend (this will create the order)
            // Use orderId 0 and pass sessionId since order doesn't exist yet
            this.bookingService.confirmPayment(0, paymentIntent.id, sessionId).subscribe({
              next: (confirmResponse) => {
                this.orderId = confirmResponse.orderId; // Get the created order ID
                this.handlePaymentSuccess();
              },
              error: (error) => {
                this.errorMessage = error.error?.message || 'Payment confirmation failed';
                this.isProcessing = false;
                // Order was not created, so no cleanup needed
              }
            });
          } catch (paymentError: any) {
            // Payment failed - no order was created, so nothing to clean up
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

  private handlePaymentSuccess() {
    this.paymentCompleted = true;
    this.isProcessing = false;
    
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

  cancelBooking() {
    // Clear the booking data
    this.bookingDataService.clearBookingData();
    this.router.navigate(['/booking']);
  }
}