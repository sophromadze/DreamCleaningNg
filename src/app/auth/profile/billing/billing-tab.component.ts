import { Component, Inject, OnDestroy, OnInit, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Subject, forkJoin, takeUntil } from 'rxjs';
import {
  AutoPayArrangement, AutoPayOverview, BillingHistoryItem, BillingNotice, BillingService,
  OutstandingObligation, SavedCard, cardExpiry, cardLabel
} from '../../../services/billing.service';
import { StripeService } from '../../../services/stripe.service';
import { extractApiErrorMessage } from '../../../utils/http-error.utils';

/** What the authorisation dialog is currently asking the customer to agree to. */
interface TermsDialog {
  kind: 'general' | 'arrangement';
  arrangement: AutoPayArrangement | null;
  title: string;
  text: string;
  version: string;
  loading: boolean;
  allowBackup: boolean;
  accepted: boolean;
  smsConsent: boolean;
  cancellationFeeConsent: boolean;
  termsOfServiceConsent: boolean;
  submitting: boolean;
  error: string;
}

/**
 * The customer's Billing tab — the one place payment settings live.
 *
 * Every rule here is ENFORCED ON THE SERVER; this component only describes it and asks. The
 * server decides which cards exist and which roles they hold, what AutoPay covers, what is owed
 * and what was paid. Nothing charges a card from here except "Pay now" on an invoice, which the
 * server prices itself.
 */
@Component({
  selector: 'app-billing-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './billing-tab.component.html',
  styleUrls: ['./billing-tab.component.scss']
})
export class BillingTabComponent implements OnInit, OnDestroy {
  readonly cardLabel = cardLabel;
  readonly cardExpiry = cardExpiry;

  featureEnabled = false;
  loading = true;
  loadError = '';
  message = '';
  errorMessage = '';

  cards: SavedCard[] = [];
  autoPay: AutoPayOverview | null = null;
  notices: BillingNotice[] = [];
  outstanding: OutstandingObligation[] = [];

  history: BillingHistoryItem[] = [];
  historyPage = 1;
  historyPageSize = 10;
  historyTotal = 0;
  historyLoading = false;

  /** A card action in flight — every card button waits for it. */
  busyCardId: number | null = null;

  // ── Add card ──
  addingCard = false;
  addCardSaving = false;
  addCardError = '';
  private setupIntentId: string | null = null;
  private setupClientSecret: string | null = null;

  // ── Remove card ──
  removeDialog: { card: SavedCard; newPrimaryId: number | null; error: string; busy: boolean } | null = null;

  // ── AutoPay ──
  terms: TermsDialog | null = null;
  autoPayBusy = false;

  // ── Pay an invoice with a saved card ──
  payDialog: { obligation: OutstandingObligation; cardId: number | null; busy: boolean; error: string; result: string } | null = null;

  private readonly isBrowser: boolean;
  private destroy$ = new Subject<void>();

  constructor(
    private billing: BillingService,
    private stripe: StripeService,
    @Inject(PLATFORM_ID) platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  ngOnInit(): void {
    if (!this.isBrowser) return;
    this.billing.config().pipe(takeUntil(this.destroy$)).subscribe(config => {
      this.featureEnabled = config.savedCardsEnabled;
      this.reload();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.addingCard) this.stripe.destroyCardElement();
  }

  // ═══ Loading ═══════════════════════════════════════════════════════════════════════════════

  reload(): void {
    this.loading = true;
    this.loadError = '';
    forkJoin({
      cards: this.billing.getCards(),
      autoPay: this.billing.getAutoPay(),
      notices: this.billing.getNotifications(),
      outstanding: this.billing.getOutstanding()
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (r) => {
        this.cards = r.cards;
        this.autoPay = r.autoPay;
        this.notices = r.notices;
        this.outstanding = r.outstanding;
        this.loading = false;
      },
      error: (err) => {
        this.loadError = this.apiError(err) || 'We couldn\'t load your billing details. Please try again.';
        this.loading = false;
      }
    });
    this.loadHistory(1);
  }

  loadHistory(page: number): void {
    this.historyLoading = true;
    this.billing.getHistory(page, this.historyPageSize).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.history = res.items;
        this.historyPage = res.page;
        this.historyTotal = res.totalCount;
        this.historyLoading = false;
      },
      error: () => { this.history = []; this.historyLoading = false; }
    });
  }

  get historyPageCount(): number {
    return Math.max(1, Math.ceil(this.historyTotal / this.historyPageSize));
  }

  /** Unresolved problems first; resolved and informational notices after. */
  get openIssues(): BillingNotice[] {
    return this.notices.filter(n => !n.isResolved && n.severity !== 'info');
  }

  get recentNotices(): BillingNotice[] {
    return this.notices.filter(n => n.isResolved || n.severity === 'info').slice(0, 5);
  }

  get usableCards(): SavedCard[] {
    return this.cards.filter(c => c.isUsable);
  }

  get hasUsablePrimary(): boolean {
    return this.cards.some(c => c.isPrimary && c.isUsable);
  }

  statusClass(status: string): string {
    return 'status-' + status.toLowerCase().replace(/\s+/g, '-');
  }

  /** The server's own explanation, or '' so the caller's specific fallback applies. */
  private apiError(err: any): string {
    return extractApiErrorMessage(err, '');
  }

  private flash(message: string): void {
    this.message = message;
    this.errorMessage = '';
    setTimeout(() => { if (this.message === message) this.message = ''; }, 6000);
  }

  private fail(err: any, fallback: string): void {
    this.errorMessage = this.apiError(err) || fallback;
    this.message = '';
  }

  // ═══ Payment methods ═══════════════════════════════════════════════════════════════════════

  openAddCard(): void {
    if (this.addingCard) return;
    this.addingCard = true;
    this.addCardError = '';
    this.billing.createSetupIntent().pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.setupIntentId = res.setupIntentId;
        this.setupClientSecret = res.clientSecret;
        // Let Angular render the container before Stripe mounts into it.
        setTimeout(async () => {
          try {
            await this.stripe.createCardElementAsync('billing-card-element');
          } catch {
            this.addCardError = 'We couldn\'t load the card form. Please refresh and try again.';
          }
        });
      },
      error: (err) => {
        this.addCardError = this.apiError(err) || 'We couldn\'t start adding your card. Please try again.';
      }
    });
  }

  cancelAddCard(): void {
    this.addingCard = false;
    this.addCardError = '';
    this.setupIntentId = null;
    this.setupClientSecret = null;
    this.stripe.destroyCardElement();
  }

  async saveNewCard(): Promise<void> {
    if (!this.setupClientSecret || !this.setupIntentId || this.addCardSaving) return;
    this.addCardSaving = true;
    this.addCardError = '';
    try {
      // Stripe collects the card and handles any bank verification. Nothing is charged.
      await this.stripe.confirmCardSetup(this.setupClientSecret);
    } catch (err: any) {
      // Stripe's messages are customer-readable (declined, incomplete number, ...).
      this.addCardError = err?.message || 'We couldn\'t save the card. Please try again.';
      this.addCardSaving = false;
      return;
    }

    // Only once Stripe has confirmed does the server record it — verified against Stripe.
    this.billing.completeSetup(this.setupIntentId).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.cards = res.cards;
        this.addCardSaving = false;
        this.cancelAddCard();
        this.flash(res.card.isPrimary ? `${cardLabel(res.card)} was saved as your Primary card.` : `${cardLabel(res.card)} was saved.`);
        this.refreshAutoPay();
      },
      error: (err) => {
        this.addCardSaving = false;
        this.addCardError = this.apiError(err) || 'We couldn\'t save the card. Please try again.';
      }
    });
  }

  setPrimary(card: SavedCard): void {
    if (this.busyCardId !== null) return;
    this.busyCardId = card.id;
    this.billing.setPrimary(card.id).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => { this.cards = res.cards; this.busyCardId = null; this.flash(res.message); this.refreshAutoPay(); },
      error: (err) => { this.busyCardId = null; this.fail(err, 'We couldn\'t change your Primary card.'); }
    });
  }

  setBackup(card: SavedCard | null): void {
    if (this.busyCardId !== null) return;
    this.busyCardId = card?.id ?? -1;
    this.billing.setBackup(card?.id ?? null).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => { this.cards = res.cards; this.busyCardId = null; this.flash(res.message); this.refreshAutoPay(); },
      error: (err) => { this.busyCardId = null; this.fail(err, 'We couldn\'t change your Backup card.'); }
    });
  }

  openRemove(card: SavedCard): void {
    const others = this.usableCards.filter(c => c.id !== card.id);
    this.removeDialog = {
      card,
      newPrimaryId: card.isPrimary ? (others.find(c => c.isBackup) ?? others[0])?.id ?? null : null,
      error: '',
      busy: false
    };
  }

  closeRemove(): void { if (!this.removeDialog?.busy) this.removeDialog = null; }
  closeTerms(): void { if (!this.terms?.submitting) this.terms = null; }
  closePay(): void { if (!this.payDialog?.busy) this.payDialog = null; }

  /** What removing this card will do, in the dialog's own words. */
  removeConsequence(): string {
    const d = this.removeDialog;
    if (!d) return '';
    const others = this.usableCards.filter(c => c.id !== d.card.id);
    if (d.card.isPrimary && others.length === 0) {
      return this.autoPay?.autoPayEnabled
        ? 'This is your only card. Removing it turns Automatic Payments off — nothing can be charged automatically until you add a new card.'
        : 'This is your only card. You can add a new one any time.';
    }
    if (d.card.isPrimary) return 'This is your Primary card — the one automatic payments use. Choose the card that should replace it:';
    if (d.card.isBackup) return 'This is your Backup card. Once it is removed, a failed automatic payment will not fall back to another card.';
    return 'This card has no role; removing it changes nothing else.';
  }

  get removeSuccessorOptions(): SavedCard[] {
    return this.removeDialog ? this.usableCards.filter(c => c.id !== this.removeDialog!.card.id) : [];
  }

  confirmRemove(): void {
    const d = this.removeDialog;
    if (!d || d.busy) return;
    if (d.card.isPrimary && this.removeSuccessorOptions.length > 0 && !d.newPrimaryId) {
      d.error = 'Choose which card should become your Primary card.';
      return;
    }
    d.busy = true;
    d.error = '';
    this.billing.removeCard(d.card.id, d.card.isPrimary ? d.newPrimaryId : null).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.cards = res.cards;
        this.removeDialog = null;
        this.flash(res.message);
        this.refreshAutoPay();
      },
      error: (err) => {
        d.busy = false;
        d.error = this.apiError(err) || 'We couldn\'t remove the card. Please try again.';
      }
    });
  }

  // ═══ Automatic Payments ════════════════════════════════════════════════════════════════════

  private refreshAutoPay(): void {
    this.billing.getAutoPay().pipe(takeUntil(this.destroy$)).subscribe({ next: (a) => this.autoPay = a, error: () => {} });
  }

  toggleAutoPay(): void {
    if (!this.autoPay || this.autoPayBusy) return;
    if (this.autoPay.autoPayEnabled) {
      if (!confirm('Turn off Automatic Payments? Every arrangement below will be paused. Your saved cards, payment history and anything you already owe are unaffected — unpaid cleanings and invoices will need to be paid from your account or a payment link.')) return;
      this.autoPayBusy = true;
      this.billing.disableAutoPay().pipe(takeUntil(this.destroy$)).subscribe({
        next: (a) => { this.autoPay = a; this.autoPayBusy = false; this.flash('Automatic Payments are off. Nothing will be charged automatically.'); },
        error: (err) => { this.autoPayBusy = false; this.fail(err, 'We couldn\'t turn Automatic Payments off.'); }
      });
      return;
    }
    this.openTerms('general', null);
  }

  openTerms(kind: 'general' | 'arrangement', arrangement: AutoPayArrangement | null): void {
    this.terms = {
      kind, arrangement,
      title: kind === 'general' ? 'Turn on Automatic Payments' : `Authorize: ${arrangement!.title}`,
      text: '', version: '', loading: true,
      allowBackup: arrangement?.allowBackupFallback ?? false,
      accepted: false, smsConsent: false, cancellationFeeConsent: false, termsOfServiceConsent: false,
      submitting: false, error: ''
    };
    this.loadTermsText();
  }

  /** The wording depends on the Backup choice, so it is re-fetched when that changes. */
  loadTermsText(): void {
    const t = this.terms;
    if (!t) return;
    t.loading = true;
    t.accepted = false;
    const scope = t.kind === 'general' ? 'general' : t.arrangement!.scope;
    this.billing.getTerms(scope, {
      seriesId: t.arrangement?.recurringSeriesId,
      clientId: t.arrangement?.contractClientId,
      allowBackup: t.allowBackup
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => { if (this.terms === t) { t.text = res.text; t.version = res.version; t.loading = false; } },
      error: (err) => { t.loading = false; t.error = this.apiError(err) || 'We couldn\'t load the terms.'; }
    });
  }

  get hasBackupCard(): boolean {
    return this.cards.some(c => c.isBackup && c.isUsable);
  }

  get termsCanSubmit(): boolean {
    const t = this.terms;
    if (!t || t.loading || t.submitting || !t.accepted || !t.version) return false;
    if (t.arrangement?.scope === 'office') return t.smsConsent && t.cancellationFeeConsent && t.termsOfServiceConsent;
    return true;
  }

  submitTerms(): void {
    const t = this.terms;
    if (!t || !this.termsCanSubmit) return;
    t.submitting = true;
    t.error = '';

    const request$ = t.kind === 'general'
      ? this.billing.enableAutoPay(t.version)
      : this.billing.authorize({
          scope: t.arrangement!.scope,
          recurringSeriesId: t.arrangement!.recurringSeriesId,
          contractClientId: t.arrangement!.contractClientId,
          allowBackupFallback: t.allowBackup,
          acceptTerms: true,
          termsVersion: t.version,
          smsConsent: t.smsConsent,
          cancellationFeeConsent: t.cancellationFeeConsent,
          termsOfServiceConsent: t.termsOfServiceConsent
        });

    request$.pipe(takeUntil(this.destroy$)).subscribe({
      next: (a) => {
        this.autoPay = a;
        this.terms = null;
        this.flash(t.kind === 'general'
          ? 'Automatic Payments are on. Now choose which arrangements they cover.'
          : 'Authorized. You can revoke this any time.');
      },
      error: (err) => {
        t.submitting = false;
        t.error = this.apiError(err) || 'We couldn\'t save this. Please try again.';
        if (err?.error?.code === 'terms_changed') this.loadTermsText();
      }
    });
  }

  revoke(arrangement: AutoPayArrangement): void {
    if (!arrangement.authorizationId || this.autoPayBusy) return;
    if (!confirm(`Revoke "${arrangement.title}"? Future charges for it stop. Anything already paid is unaffected.`)) return;
    this.autoPayBusy = true;
    this.billing.revoke(arrangement.authorizationId).pipe(takeUntil(this.destroy$)).subscribe({
      next: (a) => { this.autoPay = a; this.autoPayBusy = false; this.flash('Authorization revoked.'); },
      error: (err) => { this.autoPayBusy = false; this.fail(err, 'We couldn\'t revoke it. Please try again.'); }
    });
  }

  // ═══ Notices and paying what is owed ═══════════════════════════════════════════════════════

  markRead(notice: BillingNotice): void {
    if (notice.isRead) return;
    notice.isRead = true;
    this.billing.markNotificationRead(notice.id).subscribe({ error: () => {} });
  }

  openPayInvoice(obligation: OutstandingObligation): void {
    const primary = this.usableCards.find(c => c.isPrimary) ?? this.usableCards[0];
    this.payDialog = { obligation, cardId: primary?.id ?? null, busy: false, error: '', result: '' };
  }

  /**
   * Pays one of the customer's own invoices with a saved card. The server prices it from the
   * invoice, holds the obligation's lock, and cancels any open checkout first. A bank challenge
   * is completed here, and the result is then settled from Stripe's own record.
   */
  async confirmPayInvoice(): Promise<void> {
    const d = this.payDialog;
    if (!d || d.busy || !d.cardId) return;
    d.busy = true;
    d.error = '';

    this.billing.payInvoiceWithSavedCard(d.obligation.id, d.cardId).pipe(takeUntil(this.destroy$)).subscribe({
      next: async (res) => {
        if (res.result === 'requires_action' && res.clientSecret && res.paymentIntentId) {
          try {
            await this.stripe.completeBankChallenge(res.clientSecret);
          } catch (err: any) {
            // The server keeps the attempt locked until it settles; refreshing reads the truth.
          }
          this.billing.refreshPayment(res.paymentIntentId).subscribe({
            next: (final) => this.finishPay(final.result, final.message),
            error: () => this.finishPay('pending', 'We are confirming your payment. Refresh in a moment — do not pay again.')
          });
          return;
        }
        this.finishPay(res.result, res.message);
      },
      error: (err) => {
        // No answer is not a failure: the server may have charged. Say so, and never retry blindly.
        d.busy = false;
        d.error = this.apiError(err)
          || 'We could not confirm the result. Do not pay again — refresh this page in a minute to see the invoice status.';
      }
    });
  }

  private finishPay(result: string, message: string): void {
    const d = this.payDialog;
    if (!d) return;
    d.busy = false;
    if (result === 'paid' || result === 'paid_by_backup') {
      this.payDialog = null;
      this.flash(message);
      this.reload();
      return;
    }
    d.error = message;
  }
}
