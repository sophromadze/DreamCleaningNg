import { Component, EventEmitter, OnDestroy, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { finalize } from 'rxjs/operators';

import {
  RecurringOrderService,
  UpcomingRecurringOrder,
  UpcomingRecurringOrders
} from '../../../services/recurring-order.service';
import { StripeService } from '../../../services/stripe.service';
import { extractApiErrorMessage } from '../../../utils/http-error.utils';
import { BillingService } from '../../../services/billing.service';
import { SaveCardModalComponent } from '../save-card-modal/save-card-modal.component';

/** Shown when the card step ends without a clear answer. Never phrased as a failure. */
export const PAY_ALL_UNCONFIRMED_MESSAGE =
  "We couldn't confirm your payment. Please don't pay again — refresh this page in a minute to see whether it went through.";

@Component({
  selector: 'app-upcoming-recurring-orders',
  standalone: true,
  imports: [CommonModule, SaveCardModalComponent],
  templateUrl: './upcoming-recurring-orders.component.html',
  styleUrls: ['./upcoming-recurring-orders.component.scss']
})
/**
 * "Your upcoming cleanings" on My Orders — every generated recurring visit in the 30-day horizon,
 * NEAREST FIRST, with what may be paid now.
 *
 * ══ WHAT IT DOES NOT DO ══
 *
 * It does not replace or reorder the existing order list. Recurring cleanings still appear there
 * like every other order; this section sits above it and answers the one question the list cannot:
 * "what is coming up on my plan, and what do I owe next?".
 *
 * ══ THE PAYMENT RULES, AND WHOSE THEY ARE ══
 *
 * Both come from the SERVER. `isPayable` and `blockedReason` are computed by
 * RecurringPaymentPolicy and rendered here verbatim — this component has no copy of the
 * sequential-unlock rule, because a second copy is how the button and the endpoint come to
 * disagree. The same goes for the money: "Pay all upcoming" sends neither an amount nor a list of
 * order ids, and the total on screen is the server's own figure.
 *
 * Paying the whole set is a VOLUNTARY act. Nothing here chases anybody: future cleanings are shown
 * with what they cost and a quiet "available once the one before it is paid", not four Pay buttons.
 */
export class UpcomingRecurringOrdersComponent implements OnInit, OnDestroy {
  /** Raised after a combined payment settles, so the host can reload its list. */
  @Output() paid = new EventEmitter<void>();

  data: UpcomingRecurringOrders | null = null;
  loading = true;
  errorMessage = '';

  // ── Combined payment ────────────────────────────────────────────────────────────────────
  showPayAll = false;
  payingAll = false;
  payAllError = '';
  private clientSecret: string | null = null;
  private paymentIntentId: string | null = null;

  // ── "Save your card?", asked before the charge (2026-09) ────────────────────────────────
  // The batch's PaymentIntent already exists (it was created when this form opened), so the
  // choice is applied to THAT intent at confirmation — no second payment is ever created.
  showSaveCardModal = false;
  saveCardChoice: boolean | null = null;
  canSaveCard = false;
  private cardMounted = false;

  constructor(
    private recurring: RecurringOrderService,
    private stripe: StripeService,
    private router: Router,
    private billing: BillingService
  ) {}

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    if (this.cardMounted) this.stripe.destroyCardElement();
  }

  private load(): void {
    this.loading = true;
    this.recurring.upcoming()
      .pipe(finalize(() => { this.loading = false; }))
      .subscribe({
        next: (data) => { this.data = data; },
        error: (err) => {
          // A failure here must never take the ORDER LIST down with it — this is an extra
          // section on somebody's account page, not the page itself.
          this.errorMessage = extractApiErrorMessage(err, 'Could not load your upcoming cleanings.');
        }
      });
  }

  get orders(): UpcomingRecurringOrder[] {
    return this.data?.orders ?? [];
  }

  get hasAny(): boolean {
    return this.orders.length > 0;
  }

  /** The ordinary single-order payment page — unchanged, and still the normal way to pay one. */
  payOne(order: UpcomingRecurringOrder): void {
    this.router.navigate(['/order', order.orderId, 'pay']);
  }

  // ── Pay all upcoming ────────────────────────────────────────────────────────────────────

  async openPayAll(): Promise<void> {
    if (this.payingAll || !this.data?.canPayAll) return;

    this.payAllError = '';
    this.showPayAll = true;
    this.payingAll = true;

    this.recurring.payAll()
      .pipe(finalize(() => { this.payingAll = false; }))
      .subscribe({
        next: async (batch) => {
          this.clientSecret = batch.paymentClientSecret;
          this.paymentIntentId = batch.paymentIntentId ?? null;
          this.canSaveCard = (batch as any).canSaveCard === true;
          this.saveCardChoice = null;
          // Mounted only once the modal is actually on screen; Stripe needs the target element
          // to exist before it will attach to it.
          setTimeout(() => this.mountCard(), 0);
        },
        error: (err) => {
          this.showPayAll = false;
          this.payAllError = extractApiErrorMessage(err, 'Could not start the payment.');
        }
      });
  }

  private async mountCard(): Promise<void> {
    try {
      await this.stripe.initializeElements();
      const element = await this.stripe.createCardElementAsync('recurring-pay-all-card');
      this.cardMounted = !!element;
      if (!element) this.payAllError = 'The card form could not be loaded. Please try again.';
    } catch {
      this.payAllError = 'The card form could not be loaded. Please try again.';
    }
  }

  closePayAll(): void {
    this.load();
    this.showPayAll = false;
    this.clientSecret = null;
    if (this.cardMounted) {
      this.stripe.destroyCardElement();
      this.cardMounted = false;
    }
  }

  /** The Pay button: ask about saving first when there is something to ask. */
  async confirmPayAll(): Promise<void> {
    if (this.payingAll || !this.clientSecret) return;

    if (this.canSaveCard && this.saveCardChoice === null) {
      this.showSaveCardModal = true;
      return;
    }
    await this.chargeNow();
  }

  onSaveCardChoice(save: boolean): void {
    this.saveCardChoice = save;
    this.showSaveCardModal = false;
    void this.chargeNow();
  }

  /** ✕ / Escape / backdrop: the card form is still filled in and nothing has been charged. The
   *  batch's PaymentIntent is untouched, so pressing Pay again uses that same one. */
  onSaveCardDismissed(): void {
    this.showSaveCardModal = false;
  }

  private async chargeNow(): Promise<void> {
    if (this.payingAll || !this.clientSecret) return;

    this.payingAll = true;
    this.payAllError = '';

    try {
      const result = await this.stripe.confirmCardPayment(
        this.clientSecret,
        undefined,
        // The customer's answer, applied to the batch's existing intent at confirmation.
        this.canSaveCard && this.saveCardChoice === true
      );

      if (result?.error) {
        this.payAllError = result.error.message || 'The card was declined.';
        return;
      }

      // Fire-and-forget, AFTER the charge: the money is in, so a card that cannot be recorded is
      // not a payment problem — the Billing tab's reconciliation with Stripe picks it up.
      if (this.saveCardChoice === true && this.paymentIntentId) {
        this.billing.saveCardFromPayment(this.paymentIntentId).subscribe({ next: () => {}, error: () => {} });
      }

      // NOTHING IS MARKED PAID HERE. The orders are settled by the webhook, in one transaction
      // that re-reads each of them — a browser callback is a hint about navigation, never a
      // financial fact. So the page simply reloads and shows whatever the server now says.
      this.closePayAll();
      this.paid.emit();
    } catch {
      // Stripe.js THREW rather than answering — a dropped connection, possibly AFTER the card
      // was submitted. That is not a decline (a decline arrives as result.error above), so it
      // must never read as one: the charge may well have gone through, and "could not be
      // completed" is an invitation to pay again. The server settles a succeeded charge on its
      // own and refuses a second one while it does.
      this.payAllError = PAY_ALL_UNCONFIRMED_MESSAGE;
    } finally {
      this.payingAll = false;
    }
  }
}
