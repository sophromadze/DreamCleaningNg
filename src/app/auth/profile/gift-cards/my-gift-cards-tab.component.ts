import { Component, OnDestroy, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Subscription, finalize } from 'rxjs';
import { GiftCardService, MyGiftCard } from '../../../services/gift-card.service';
import { AuthService } from '../../../services/auth.service';
import { extractApiErrorMessage } from '../../../utils/http-error.utils';
import { describeEmailProblem } from '../../../utils/email.utils';

/**
 * Profile → Gift Cards (2026-10): the gift cards the signed-in customer bought, in both modes.
 * "Buy for myself - send later" cards show their full code and a "Send to someone" form; once
 * sent, the code is masked by the SERVER and only "Resend email" (same recipient) remains.
 * Ownership is enforced server-side — this list is whatever `GET giftcard/mine` returns.
 */
@Component({
  selector: 'app-my-gift-cards-tab',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './my-gift-cards-tab.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./my-gift-cards-tab.component.scss']
})
export class MyGiftCardsTabComponent implements OnInit, OnDestroy {
  cards: MyGiftCard[] = [];
  loading = true;
  error = '';

  /** Card whose "Send to someone" form is open (one at a time). */
  sendingCardId: number | null = null;
  sendForm: FormGroup;
  isSubmitting = false;
  sendError = '';

  resendingCardId: number | null = null;
  /** Per-card in-app confirmation / error shown under the card after an action. */
  notices: Record<number, { kind: 'success' | 'error'; text: string }> = {};

  /** Card whose usage history is expanded. */
  expandedUsageId: number | null = null;

  private defaultSenderName = '';
  private userSub?: Subscription;

  // Same limits as the gift card purchase page, so the card in the email lays out identically.
  readonly recipientNameMax = 15;
  readonly messageMax = 70;

  constructor(
    private giftCardService: GiftCardService,
    private authService: AuthService,
    private fb: FormBuilder
  ) {
    this.sendForm = this.fb.group({
      recipientName: ['', [Validators.required, Validators.maxLength(this.recipientNameMax)]],
      recipientEmail: ['', [Validators.required, Validators.maxLength(255)]],
      senderName: ['', [Validators.required, Validators.maxLength(100)]],
      message: ['', [Validators.required, Validators.maxLength(this.messageMax)]]
    });
  }

  ngOnInit(): void {
    this.userSub = this.authService.currentUser.subscribe(user => {
      this.defaultSenderName = user ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() : '';
    });
    this.load();
  }

  ngOnDestroy(): void {
    this.userSub?.unsubscribe();
  }

  load(): void {
    this.loading = true;
    this.error = '';
    this.giftCardService.getMyGiftCards()
      .pipe(finalize(() => this.loading = false))
      .subscribe({
        next: list => this.cards = list,
        error: err => this.error = extractApiErrorMessage(err, 'Your gift cards could not be loaded.')
      });
  }

  get unsentCount(): number {
    return this.cards.filter(c => c.status === 'NotSent').length;
  }

  statusLabel(card: MyGiftCard): string {
    if (card.status === 'FullyUsed') return 'Fully used';
    if (card.status === 'NotSent') return 'Not sent yet';
    return 'Sent';
  }

  openSendForm(card: MyGiftCard): void {
    this.sendingCardId = card.id;
    this.sendError = '';
    delete this.notices[card.id];
    this.sendForm.reset({
      recipientName: '',
      recipientEmail: '',
      senderName: this.defaultSenderName || card.senderName || '',
      message: ''
    });
  }

  cancelSend(): void {
    this.sendingCardId = null;
    this.sendError = '';
  }

  /** The first thing wrong with the typed email, worded for the customer (null when fine). */
  get recipientEmailProblem(): string | null {
    const control = this.sendForm.get('recipientEmail');
    if (!control || !control.value) return null;
    return describeEmailProblem(control.value);
  }

  submitSend(card: MyGiftCard): void {
    if (this.isSubmitting) return;
    this.sendForm.markAllAsTouched();
    if (this.sendForm.invalid || this.recipientEmailProblem) {
      // The email problem is already shown under its field - don't repeat it in the banner.
      this.sendError = this.recipientEmailProblem ? '' : 'Please fill in all required fields correctly.';
      return;
    }

    const value = this.sendForm.getRawValue();
    this.isSubmitting = true;
    this.sendError = '';
    this.giftCardService.sendMyGiftCard(card.id, {
      recipientName: value.recipientName.trim(),
      recipientEmail: value.recipientEmail.trim(),
      senderName: value.senderName.trim(),
      message: value.message.trim()
    })
      .pipe(finalize(() => this.isSubmitting = false))
      .subscribe({
        next: updated => {
          this.replaceCard(updated);
          this.sendingCardId = null;
          this.notices[updated.id] = {
            kind: 'success',
            text: `Your gift card has been sent to ${updated.recipientName} (${updated.recipientEmail}). We've emailed you a confirmation.`
          };
        },
        error: err => {
          // 502: the card IS assigned to the recipient, only the email failed — show its new state.
          if (err?.status === 502 && err.error?.card) {
            this.replaceCard(err.error.card as MyGiftCard);
            this.sendingCardId = null;
            this.notices[card.id] = { kind: 'error', text: extractApiErrorMessage(err, 'The email could not be delivered.') };
            return;
          }
          this.sendError = extractApiErrorMessage(err, 'The gift card could not be sent. Please try again.');
          // Already sent elsewhere (another tab): refresh so the card shows its real state.
          if (err?.status === 400 || err?.status === 404) this.load();
        }
      });
  }

  resend(card: MyGiftCard): void {
    if (this.resendingCardId !== null) return;
    this.resendingCardId = card.id;
    delete this.notices[card.id];
    this.giftCardService.resendMyGiftCard(card.id)
      .pipe(finalize(() => this.resendingCardId = null))
      .subscribe({
        next: updated => {
          this.replaceCard(updated);
          this.notices[updated.id] = {
            kind: 'success',
            text: `The gift card email has been sent again to ${updated.recipientEmail}.`
          };
        },
        error: err => {
          this.notices[card.id] = {
            kind: 'error',
            text: extractApiErrorMessage(err, 'The email could not be resent. Please try again later.')
          };
        }
      });
  }

  toggleUsage(card: MyGiftCard): void {
    this.expandedUsageId = this.expandedUsageId === card.id ? null : card.id;
  }

  private replaceCard(updated: MyGiftCard): void {
    this.cards = this.cards.map(c => c.id === updated.id ? updated : c);
  }

  trackById(_: number, card: MyGiftCard): number {
    return card.id;
  }
}
