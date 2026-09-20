import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable, of, shareReplay, catchError, map } from 'rxjs';
import { environment } from '../../environments/environment';

/** A saved card. `paymentMethodId` is only ever present for the card's own owner. */
export interface SavedCard {
  id: number;
  paymentMethodId?: string | null;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  wallet: string | null;
  isPrimary: boolean;
  isBackup: boolean;
  isExpired: boolean;
  status: 'active' | 'blocked';
  statusMessage: string | null;
  isUsable: boolean;
  createdAt: string;
}

export interface BillingConfig {
  savedCardsEnabled: boolean;
  autoPayEnabled: boolean;
}

export interface CardMutationResult {
  message: string;
  cards: SavedCard[];
  autoPayEnabled: boolean;
}

export interface AutoPayArrangement {
  scope: 'series' | 'office' | 'client';
  recurringSeriesId: number | null;
  contractClientId: number | null;
  title: string;
  description: string;
  timing: string;
  isAuthorized: boolean;
  isEffective: boolean;
  pausedReason: string | null;
  allowBackupFallback: boolean;
  authorizationId: number | null;
  authorizedAt: string | null;
  termsVersion: string | null;
}

export interface AutoPayOverview {
  featureEnabled: boolean;
  autoPayEnabled: boolean;
  autoPayEnabledAt: string | null;
  primaryCard: SavedCard | null;
  backupCard: SavedCard | null;
  arrangements: AutoPayArrangement[];
}

export interface AutoPayTerms {
  scope: string;
  version: string;
  text: string;
}

export interface AuthorizeArrangementRequest {
  scope: 'series' | 'office' | 'client';
  recurringSeriesId?: number | null;
  contractClientId?: number | null;
  allowBackupFallback: boolean;
  acceptTerms: boolean;
  termsVersion: string;
  smsConsent?: boolean;
  cancellationFeeConsent?: boolean;
  termsOfServiceConsent?: boolean;
}

export interface BillingHistoryItem {
  key: string;
  date: string;
  kind: 'order' | 'invoice' | 'attempt';
  reference: string;
  description: string;
  amount: number;
  status: string;
  paymentMethodLabel: string | null;
  orderId: number | null;
  invoiceId: number | null;
  actionUrl: string | null;
  actionLabel: string | null;
}

export interface BillingHistoryPage {
  items: BillingHistoryItem[];
  page: number;
  pageSize: number;
  totalCount: number;
}

export interface OutstandingObligation {
  type: 'order' | 'invoice';
  id: number;
  reference: string;
  description: string;
  amountDue: number;
  dueDate: string | null;
  payUrl: string;
  paymentInProgress: boolean;
  autoPayFailed: boolean;
}

export interface BillingNotice {
  id: number;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  actionUrl: string | null;
  actionLabel: string | null;
  createdAt: string;
  isRead: boolean;
  isResolved: boolean;
}

export interface SavedCardChargeResult {
  result: 'paid' | 'paid_by_backup' | 'failed' | 'requires_action' | 'in_progress' | 'pending'
    | 'blocked' | 'nothing_due' | 'not_authorized' | 'unknown';
  charged: boolean;
  message: string;
  amount: number;
  paymentIntentId: string | null;
  clientSecret: string | null;
}

export interface AdminBillingAttempt {
  id: number;
  createdAt: string;
  obligation: string;
  orderId: number | null;
  invoiceId: number | null;
  trigger: string;
  cardRole: string;
  cardLabel: string | null;
  amount: number;
  status: string;
  failureCode: string | null;
  failureMessage: string | null;
}

export interface AdminUserBilling {
  featureEnabled: boolean;
  cards: SavedCard[];
  autoPay: AutoPayOverview;
  outstanding: OutstandingObligation[];
  recentAttempts: AdminBillingAttempt[];
  recentHistory: BillingHistoryItem[];
  openIssues: BillingNotice[];
}

export interface AdminOrderSavedCardInfo {
  featureEnabled: boolean;
  hasCard: boolean;
  brand: string | null;
  last4: string | null;
  hasOfficeAuthorization: boolean;
  backupAllowed: boolean;
  amountDue: number;
  unavailableReason: string | null;
}

/** "Visa ending 4242" — the one way a card is named anywhere in the UI. */
export function cardLabel(card: { brand: string | null; last4: string | null } | null | undefined): string {
  if (!card) return 'Card';
  const brand = card.brand ? card.brand.charAt(0).toUpperCase() + card.brand.slice(1) : 'Card';
  return card.last4 ? `${brand} ending ${card.last4}` : brand;
}

/** "12/28", or '' when unknown. */
export function cardExpiry(card: { expMonth: number | null; expYear: number | null } | null | undefined): string {
  if (!card?.expMonth || !card?.expYear) return '';
  return `${String(card.expMonth).padStart(2, '0')}/${String(card.expYear).slice(-2)}`;
}

/**
 * The Billing tab's API — saved cards, AutoPay, history, notices and saved-card payments.
 *
 * Nothing here carries a user id, an amount or a Stripe customer: the server takes the user from
 * the session and every amount from the order or invoice itself. Whether anything is shown at
 * all comes from `config()`, which reflects the SERVER's rollout switches — the old compile-time
 * frontend flag is gone.
 */
@Injectable({ providedIn: 'root' })
export class BillingService {
  private readonly api = `${environment.apiUrl}/billing`;
  private config$?: Observable<BillingConfig>;
  private readonly isBrowser: boolean;

  constructor(private http: HttpClient, @Inject(PLATFORM_ID) platformId: Object) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  /** Server rollout switches, fetched once per page load. Off on the server during SSR. */
  config(): Observable<BillingConfig> {
    if (!this.isBrowser) return of({ savedCardsEnabled: false, autoPayEnabled: false });
    if (!this.config$) {
      this.config$ = this.http.get<BillingConfig>(`${this.api}/config`).pipe(
        catchError(() => of({ savedCardsEnabled: false, autoPayEnabled: false })),
        shareReplay(1)
      );
    }
    return this.config$;
  }

  savedCardsEnabled(): Observable<boolean> {
    return this.config().pipe(map(c => c.savedCardsEnabled));
  }

  // ── Cards ──
  getCards(): Observable<SavedCard[]> {
    return this.http.get<SavedCard[]>(`${this.api}/cards`);
  }

  createSetupIntent(): Observable<{ clientSecret: string; setupIntentId: string }> {
    return this.http.post<{ clientSecret: string; setupIntentId: string }>(`${this.api}/cards/setup-intent`, {});
  }

  completeSetup(setupIntentId: string): Observable<{ card: SavedCard; cards: SavedCard[]; message: string }> {
    return this.http.post<{ card: SavedCard; cards: SavedCard[]; message: string }>(
      `${this.api}/cards/complete-setup`, { setupIntentId });
  }

  setPrimary(cardId: number): Observable<CardMutationResult> {
    return this.http.post<CardMutationResult>(`${this.api}/cards/${cardId}/primary`, {});
  }

  setBackup(cardId: number | null): Observable<CardMutationResult> {
    return this.http.put<CardMutationResult>(`${this.api}/cards/backup`, { cardId });
  }

  removeCard(cardId: number, newPrimaryCardId?: number | null): Observable<CardMutationResult> {
    const query = newPrimaryCardId ? `?newPrimaryCardId=${newPrimaryCardId}` : '';
    return this.http.delete<CardMutationResult>(`${this.api}/cards/${cardId}${query}`);
  }

  // ── AutoPay ──
  getAutoPay(): Observable<AutoPayOverview> {
    return this.http.get<AutoPayOverview>(`${this.api}/autopay`);
  }

  getTerms(scope: string, options: { seriesId?: number | null; clientId?: number | null; allowBackup?: boolean } = {}):
    Observable<AutoPayTerms> {
    const params: Record<string, string> = { scope, allowBackup: String(!!options.allowBackup) };
    if (options.seriesId) params['seriesId'] = String(options.seriesId);
    if (options.clientId) params['clientId'] = String(options.clientId);
    return this.http.get<AutoPayTerms>(`${this.api}/autopay/terms`, { params });
  }

  enableAutoPay(termsVersion: string): Observable<AutoPayOverview> {
    return this.http.post<AutoPayOverview>(`${this.api}/autopay/enable`, { acceptTerms: true, termsVersion });
  }

  disableAutoPay(): Observable<AutoPayOverview> {
    return this.http.post<AutoPayOverview>(`${this.api}/autopay/disable`, {});
  }

  authorize(request: AuthorizeArrangementRequest): Observable<AutoPayOverview> {
    return this.http.post<AutoPayOverview>(`${this.api}/autopay/authorizations`, request);
  }

  revoke(authorizationId: number): Observable<AutoPayOverview> {
    return this.http.delete<AutoPayOverview>(`${this.api}/autopay/authorizations/${authorizationId}`);
  }

  // ── History, balances, notices ──
  getHistory(page: number, pageSize = 10): Observable<BillingHistoryPage> {
    return this.http.get<BillingHistoryPage>(`${this.api}/history`, { params: { page, pageSize } });
  }

  getOutstanding(): Observable<OutstandingObligation[]> {
    return this.http.get<OutstandingObligation[]>(`${this.api}/outstanding`);
  }

  getNotifications(): Observable<BillingNotice[]> {
    return this.http.get<BillingNotice[]>(`${this.api}/notifications`);
  }

  markNotificationRead(id: number): Observable<unknown> {
    return this.http.post(`${this.api}/notifications/${id}/read`, {});
  }

  /**
   * Records the card that just paid, when the customer chose "Save Card & Pay" in the
   * pre-payment modal. The payment is already confirmed when this runs, so any failure is mapped
   * to null and never surfaced: the Billing tab's reconciliation with Stripe recovers the card.
   */
  saveCardFromPayment(paymentIntentId: string): Observable<SavedCard | null> {
    return this.http.post<SavedCard | null>(`${this.api}/cards/from-payment`, { paymentIntentId }).pipe(
      catchError(() => of(null))
    );
  }

  // ── Paying with a saved card ──
  payInvoiceWithSavedCard(invoiceId: number, cardId: number): Observable<SavedCardChargeResult> {
    return this.http.post<SavedCardChargeResult>(`${this.api}/invoices/${invoiceId}/pay-with-saved-card`, { cardId });
  }

  refreshPayment(paymentIntentId: string): Observable<SavedCardChargeResult> {
    return this.http.post<SavedCardChargeResult>(`${this.api}/payments/${encodeURIComponent(paymentIntentId)}/refresh`, {});
  }

  // ── Admin ──
  getAdminUserBilling(userId: number): Observable<AdminUserBilling> {
    return this.http.get<AdminUserBilling>(`${environment.apiUrl}/admin/users/${userId}/billing`);
  }

  getAdminOrderSavedCardInfo(orderId: number): Observable<AdminOrderSavedCardInfo> {
    return this.http.get<AdminOrderSavedCardInfo>(`${environment.apiUrl}/admin/orders/${orderId}/saved-card-info`);
  }

  adminChargeOrder(orderId: number): Observable<{ charged: boolean; result: string; message: string; amount: number }> {
    return this.http.post<{ charged: boolean; result: string; message: string; amount: number }>(
      `${environment.apiUrl}/admin/orders/${orderId}/charge-saved-card`, {});
  }
}
