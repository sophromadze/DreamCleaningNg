import { Component, Inject, OnDestroy, OnInit, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import { CardOnFileService, SavedCard } from '../../../services/card-on-file.service';
import { StripeService } from '../../../services/stripe.service';
import { CARD_ON_FILE_ENABLED } from '../../../shared/card-on-file.flag';

/**
 * "Saved Card" section embedded in the profile page. View brand/last4, save/replace a card
 * (Stripe SetupIntent — collects the card without charging it), or remove it. The saved card
 * is only ever charged when the customer (or an admin they've asked) explicitly confirms a
 * payment — this section only manages the card itself.
 */
@Component({
  selector: 'app-saved-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './saved-card.component.html',
  styleUrls: ['./saved-card.component.scss']
})
export class SavedCardComponent implements OnInit, OnDestroy {
  readonly featureEnabled = CARD_ON_FILE_ENABLED;
  card: SavedCard | null = null;
  loading = true;
  errorMessage = '';
  successMessage = '';

  showCardForm = false;
  cardSaving = false;
  cardError = '';
  removing = false;
  private setupClientSecret: string | null = null;

  private readonly isBrowser: boolean;
  private destroy$ = new Subject<void>();

  constructor(
    private cardOnFileService: CardOnFileService,
    private stripeService: StripeService,
    @Inject(PLATFORM_ID) platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  ngOnInit(): void {
    if (!this.featureEnabled) return;
    this.cardOnFileService.getSavedCard()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.card = res.card;
          this.loading = false;
        },
        error: () => {
          this.loading = false;
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.isBrowser && this.showCardForm) {
      this.stripeService.destroyCardElement();
    }
  }

  get cardDisplay(): string {
    if (!this.card) return '';
    const brand = this.card.brand
      ? this.card.brand.charAt(0).toUpperCase() + this.card.brand.slice(1)
      : 'Card';
    return this.card.last4 ? `${brand} ending ${this.card.last4}` : brand;
  }

  openCardForm(): void {
    if (!this.isBrowser || this.showCardForm) return;
    this.clearMessages();
    this.cardError = '';
    this.showCardForm = true;

    this.cardOnFileService.createSetupIntent()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.setupClientSecret = res.clientSecret;
          // Let Angular render the container before mounting the card input.
          setTimeout(async () => {
            try {
              await this.stripeService.createCardElementAsync('saved-card-element');
            } catch {
              this.cardError = 'We couldn\'t load the card form. Please refresh and try again.';
            }
          });
        },
        error: (err) => {
          this.cardError = err.error?.message || 'We couldn\'t start saving your card. Please try again.';
        }
      });
  }

  closeCardForm(): void {
    this.showCardForm = false;
    this.cardError = '';
    this.setupClientSecret = null;
    this.stripeService.destroyCardElement();
  }

  async saveCard(): Promise<void> {
    if (!this.setupClientSecret || this.cardSaving) return;
    this.cardSaving = true;
    this.cardError = '';

    try {
      const setupIntent = await this.stripeService.confirmCardSetup(this.setupClientSecret);
      const paymentMethodId: string | undefined =
        typeof setupIntent?.payment_method === 'string'
          ? setupIntent.payment_method
          : setupIntent?.payment_method?.id;

      if (!paymentMethodId) {
        this.cardError = 'We couldn\'t save the card. Please try again.';
        this.cardSaving = false;
        return;
      }

      this.cardOnFileService.saveCard(paymentMethodId)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (res) => {
            this.card = res.card;
            this.successMessage = res.message;
            this.cardSaving = false;
            this.closeCardForm();
          },
          error: (err) => {
            this.cardError = err.error?.message || 'We couldn\'t save the card. Please try again.';
            this.cardSaving = false;
          }
        });
    } catch (err: any) {
      // Stripe returns customer-readable messages for card errors (declined, incomplete, ...).
      this.cardError = err?.message || 'We couldn\'t save the card. Please try again.';
      this.cardSaving = false;
    }
  }

  removeCard(): void {
    if (!this.card || this.removing) return;
    if (!confirm('Remove your saved card? You can always save a new one later.')) return;

    this.removing = true;
    this.clearMessages();
    this.cardOnFileService.removeCard()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.card = null;
          this.successMessage = res.message;
          this.removing = false;
        },
        error: (err) => {
          this.errorMessage = err.error?.message || 'Something went wrong. Please try again.';
          this.removing = false;
        }
      });
  }

  private clearMessages(): void {
    this.errorMessage = '';
    this.successMessage = '';
  }
}
