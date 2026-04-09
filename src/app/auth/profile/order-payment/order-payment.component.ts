import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { AuthService } from '../../../services/auth.service';
import { BookingService } from '../../../services/booking.service';
import { OrderService, Order } from '../../../services/order.service';
import { StripeService } from '../../../services/stripe.service';

@Component({
  selector: 'app-order-payment',
  standalone: true,
  imports: [CommonModule, RouterModule],
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
  isDeepCleaning = false;
  isCustomServiceType = false;
  currentUser: any;
  cardError: string | null = null;
  isLoading = true;
  private hasInitialized = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private authService: AuthService,
    private bookingService: BookingService,
    private orderService: OrderService,
    private stripeService: StripeService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
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
  }

  private tryInit() {
    if (this.hasInitialized) return;
    if (!this.orderId || Number.isNaN(this.orderId)) return;
    if (!this.currentUser?.id) return;

    this.hasInitialized = true;
    this.loadOrder();
  }

  loadOrder() {
    this.isLoading = true;
    this.orderService.getOrderById(this.orderId).subscribe({
      next: (order) => {
        this.order = order;
        // Decide what kind of payment is needed:
        // - Unpaid order (initial booking payment)
        // - Pending additional payment after an admin/customer update
        const pendingUpdateAmount = order.pendingUpdateAmount ?? 0;
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

        // Check if order belongs to current user
        if (order.userId !== this.currentUser?.id) {
          this.errorMessage = 'You do not have permission to pay for this order';
          this.isLoading = false;
          return;
        }

        const extras = order.extraServices ?? [];
        this.hasCleaningSupplies = extras.some(es =>
          (es.extraServiceName ?? '').toLowerCase().includes('cleaning supplies')
        );

        const deepCleaning = extras.find(s =>
          (s.extraServiceName ?? '').toLowerCase().includes('deep cleaning') &&
          !(s.extraServiceName ?? '').toLowerCase().includes('super')
        );
        const superDeepCleaning = extras.find(s =>
          (s.extraServiceName ?? '').toLowerCase().includes('super deep cleaning')
        );
        this.isDeepCleaning = !!deepCleaning || !!superDeepCleaning;
        this.isCustomServiceType = this.isCustomServiceTypeOrder(order);

        // Create payment intent
        this.createPaymentIntent();
      },
      error: (error) => {
        this.errorMessage = 'Failed to load order';
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
    const request$ = this.paymentType === 'order'
      ? this.bookingService.createPaymentIntentForOrder(this.orderId)
      : this.orderService.createPendingUpdatePaymentIntent(this.orderId, this.orderTotal);

    request$.subscribe({
      next: (response: any) => {
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
    } catch (error: any) {
      console.error('Failed to initialize Stripe elements:', error);
      this.errorMessage = error.message || 'Failed to initialize payment form. Please refresh the page.';
    }
  }

  async processPayment() {
    if (this.isProcessing || this.cardError || !this.paymentClientSecret) return;
    
    this.isProcessing = true;
    this.errorMessage = '';

    try {
      // Confirm the payment
      const paymentIntent = await this.stripeService.confirmCardPayment(
        this.paymentClientSecret,
        this.billingDetails
      );
      
      // Same as booking-confirmation: use paymentIntent.id from Stripe after confirmCardPayment
      const idForConfirm = paymentIntent?.id ?? (paymentIntent as any)?.paymentIntent?.id ?? this.paymentIntentId;
      if (!idForConfirm) {
        this.errorMessage = 'Payment succeeded but could not get payment ID. Your order may still be marked paid—please refresh.';
        this.isProcessing = false;
        return;
      }

      const confirm$ = this.paymentType === 'order'
        ? this.bookingService.confirmPayment(this.orderId, idForConfirm)
        : this.orderService.confirmPendingUpdatePayment(this.orderId, idForConfirm);

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
    this.router.navigate(['/order', this.orderId]);
  }

  get billingDetails() {
    return {
      name: this.order ? `${this.order.contactFirstName} ${this.order.contactLastName}` : '',
      email: this.order?.contactEmail || this.currentUser?.email || '',
      phone: this.order?.contactPhone || this.currentUser?.phone || ''
    };
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
