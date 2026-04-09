import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StripeService } from '../../services/stripe.service';

@Component({
  selector: 'app-payment',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './payment.component.html',
  styleUrls: ['./payment.component.scss']
})
export class PaymentComponent implements OnInit, OnDestroy, OnChanges {
  @Input() amount!: number;
  @Input() clientSecret!: string;
  @Input() billingDetails?: any;
  @Output() paymentComplete = new EventEmitter<any>();
  @Output() paymentError = new EventEmitter<any>();

  isProcessing = false;
  cardError: string | null = null;
  errorMessage: string | null = null;
  private previousClientSecret: string | null = null;

  constructor(private stripeService: StripeService) {}

  ngOnInit() {
    this.initializeStripeElements();
  }

  ngOnDestroy() {
    this.stripeService.destroyCardElement();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['clientSecret'] && this.clientSecret && this.previousClientSecret !== this.clientSecret) {
      this.previousClientSecret = this.clientSecret;
      this.resetPaymentState();
    }
  }

  private async initializeStripeElements() {
    try {
      await this.stripeService.initializeElements();
      const cardElement = this.stripeService.createCardElement('card-element');
      
      // cardElement is returned synchronously after elements are initialized
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

  private resetPaymentState() {
    this.isProcessing = false;
    this.errorMessage = null;
    this.cardError = null;
  }

  async processPayment() {
    if (this.isProcessing) return;

    this.isProcessing = true;
    this.errorMessage = null;
    this.cardError = null;

    try {
      const paymentIntent = await this.stripeService.confirmCardPayment(
        this.clientSecret,
        this.billingDetails
      );

      this.paymentComplete.emit(paymentIntent);
    } catch (error: any) {
      this.errorMessage = error.message || 'Payment failed. Please try again.';
      this.paymentError.emit(error);
    } finally {
      this.isProcessing = false;
    }
  }

  // Method to clear error states
  clearErrors() {
    this.errorMessage = null;
    this.cardError = null;
  }
}