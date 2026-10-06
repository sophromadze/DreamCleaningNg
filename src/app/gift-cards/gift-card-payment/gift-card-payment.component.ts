import { Component, OnInit, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { GiftCardService } from '../../services/gift-card.service';
import { PaymentComponent } from '../../booking/payment/payment.component';
import { AuthService } from '../../services/auth.service';
import { IconComponent } from '../../shared/icons/icon.component';
import { faCircleCheck } from '../../shared/icons/glyphs/faCircleCheck';

@Component({
  selector: 'app-gift-card-payment',
  standalone: true,
  imports: [CommonModule, PaymentComponent, IconComponent],
  templateUrl: './gift-card-payment.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./gift-card-payment.component.scss']
})
export class GiftCardPaymentComponent implements OnInit {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private giftCardService = inject(GiftCardService);
  private authService = inject(AuthService);

  protected readonly icons = { faCircleCheck };

  giftCardId: number | null = null;
  readonly clientSecret = signal<string | null>(null);
  readonly amount = signal<number>(0);
  readonly paymentCompleted = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly currentUser = signal<any>(undefined);

  ngOnInit() {
    this.route.queryParams.subscribe(params => {
      this.giftCardId = params['giftCardId'] ? +params['giftCardId'] : null;
      this.clientSecret.set(params['clientSecret'] || null);
      this.amount.set(params['amount'] ? +params['amount'] : 0);
    });

    this.authService.currentUser.subscribe(user => {
      this.currentUser.set(user);
    });
  }

  get billingDetails() {
    return {
      name: `${this.currentUser()?.firstName} ${this.currentUser()?.lastName}`,
      email: this.currentUser()?.email
    };
  }

  onPaymentComplete(paymentIntent: any) {
    console.log('[GIFT CARD PAYMENT] Payment completed, confirming gift card payment:', {
      giftCardId: this.giftCardId,
      paymentIntentId: paymentIntent.id,
      amount: this.amount()
    });
    
    if (this.giftCardId) {
      this.giftCardService.confirmGiftCardPayment(this.giftCardId, paymentIntent.id).subscribe({
        next: (response) => {
          console.log('[GIFT CARD PAYMENT] Payment confirmation successful:', response);
          this.paymentCompleted.set(true);
        },
        error: (error) => {
          console.error('[GIFT CARD PAYMENT] Payment confirmation failed:', error);
          this.errorMessage.set(error.error?.message || 'Failed to confirm payment');
        }
      });
    } else {
      console.error('[GIFT CARD PAYMENT] Cannot confirm payment: giftCardId is null');
    }
  }

  onPaymentError(error: any) {
    this.errorMessage.set(error.message || 'Payment failed. Please try again.');
  }
}