import { Component, OnInit, OnDestroy, OnChanges, SimpleChanges, ChangeDetectionStrategy, inject, output, input, signal } from '@angular/core';
import { StripeService } from '../../services/stripe.service';

@Component({
  selector: 'app-payment',
  standalone: true,
  imports: [],
  templateUrl: './payment.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./payment.component.scss']
})
export class PaymentComponent implements OnInit, OnDestroy, OnChanges {
  private stripeService = inject(StripeService);

  readonly amount = input.required<number>();
  readonly clientSecret = input.required<string>();
  readonly billingDetails = input<any>();
  readonly paymentComplete = output<any>();
  readonly paymentError = output<any>();

  readonly isProcessing = signal(false);
  readonly cardError = signal<string | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly showApplePay = signal(false);
  private applePayInited = false;
  private previousClientSecret: string | null = null;

  ngOnInit() {
    this.initializeStripeElements();
    this.initApplePay();
  }

  ngOnDestroy() {
    this.stripeService.destroyCardElement();
    this.stripeService.destroyPaymentRequestButton();
  }

  ngOnChanges(changes: SimpleChanges) {
    const clientSecret = this.clientSecret();
    if (changes['clientSecret'] && clientSecret && this.previousClientSecret !== clientSecret) {
      this.previousClientSecret = clientSecret;
      this.resetPaymentState();
      this.initApplePay();
    }
  }

  private async initApplePay() {
    const amount = this.amount();
    if (this.applePayInited || !this.clientSecret() || !amount) return;
    const pr = await this.stripeService.createPaymentRequest(amount, 'Dream Cleaning NYC');
    if (!pr) return;
    this.applePayInited = true;
    this.showApplePay.set(true);
    setTimeout(() => this.stripeService.createPaymentRequestButton(pr, 'card-element-pr'), 0);

    pr.on('paymentmethod', async (ev: any) => {
      if (this.isProcessing()) { ev.complete('fail'); return; }
      this.isProcessing.set(true);
      this.errorMessage.set(null);
      try {
        const paymentIntent = await this.stripeService.confirmPaymentRequest(
          this.clientSecret(), ev.paymentMethod.id
        );
        ev.complete('success');
        this.paymentComplete.emit(paymentIntent);
      } catch (payErr: any) {
        ev.complete('fail');
        this.errorMessage.set(payErr.message || 'Payment failed. Please try again.');
        this.paymentError.emit(payErr);
      } finally {
        this.isProcessing.set(false);
      }
    });
  }

  private async initializeStripeElements() {
    try {
      await this.stripeService.initializeElements();
      const cardElement = this.stripeService.createCardElement('card-element');
      
      // cardElement is returned synchronously after elements are initialized
      if (cardElement) {
        cardElement.on('change', (event: any) => {
          this.cardError.set(event.error ? event.error.message : null);
        });
      }
    } catch (error) {
      console.error('Failed to initialize Stripe elements:', error);
      this.errorMessage.set('Failed to initialize payment form');
    }
  }

  private resetPaymentState() {
    this.isProcessing.set(false);
    this.errorMessage.set(null);
    this.cardError.set(null);
  }

  async processPayment() {
    if (this.isProcessing()) return;

    this.isProcessing.set(true);
    this.errorMessage.set(null);
    this.cardError.set(null);

    try {
      const paymentIntent = await this.stripeService.confirmCardPayment(
        this.clientSecret(),
        this.billingDetails()
      );

      this.paymentComplete.emit(paymentIntent);
    } catch (error: any) {
      this.errorMessage.set(error.message || 'Payment failed. Please try again.');
      this.paymentError.emit(error);
    } finally {
      this.isProcessing.set(false);
    }
  }

  // Method to clear error states
  clearErrors() {
    this.errorMessage.set(null);
    this.cardError.set(null);
  }
}