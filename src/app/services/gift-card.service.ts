import { inject, Service } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

export interface CreateGiftCard {
  amount: number;
  /** Omitted in "send later" mode - the recipient is chosen later from the profile. */
  recipientName?: string;
  recipientEmail?: string;
  senderName: string;
  senderEmail: string;
  message?: string;
  /** "Buy for myself - send later" (requires a signed-in buyer). */
  sendLater?: boolean;
}

/** Profile -> Gift Cards: a card the signed-in user purchased. */
export interface MyGiftCard {
  id: number;
  /** Full code while unsent; masked to the last 4 characters once sent. */
  code: string;
  isCodeMasked: boolean;
  originalAmount: number;
  currentBalance: number;
  amountUsed: number;
  purchasedAt: string;
  status: 'NotSent' | 'Sent' | 'FullyUsed';
  isPendingSend: boolean;
  isActive: boolean;
  recipientName?: string | null;
  recipientEmail?: string | null;
  sentAt?: string | null;
  senderName: string;
  message?: string | null;
  canSend: boolean;
  canResend: boolean;
  usages: { usedAt: string; amountUsed: number }[];
}

export interface SendMyGiftCard {
  recipientName: string;
  recipientEmail: string;
  senderName: string;
  message: string;
}

export interface GiftCard {
  id: number;
  code: string;
  originalAmount: number;
  currentBalance: number;
  recipientName: string;
  recipientEmail: string;
  senderName: string;
  senderEmail: string;
  message?: string;
  isActive: boolean;
  isUsed: boolean;
  createdAt: Date;
  usedAt?: Date;
  purchasedByUserName: string;
  usedByUserName?: string;
}

export interface GiftCardPurchaseResponse {
  giftCardId: number;
  code: string;
  amount: number;
  status: string;
  paymentIntentId: string;
  paymentClientSecret: string;
}

export interface GiftCardValidation {
  isValid: boolean;
  availableBalance: number;
  message?: string;
  recipientName?: string;
}

export interface GiftCardUsage {
  id: number;
  giftCardCode: string;
  amountUsed: number;
  balanceAfterUsage: number;
  usedAt: Date;
  orderReference: string;
}

@Service()
export class GiftCardService {
  private http = inject(HttpClient);
  private authService = inject(AuthService);

  private apiUrl = environment.apiUrl;

  private getAuthHeaders(): HttpHeaders {
    const token = this.authService.getToken();
    const headers: any = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return new HttpHeaders(headers);
  }

  createGiftCard(giftCard: CreateGiftCard): Observable<GiftCardPurchaseResponse> {
    console.log('[GIFT CARD FRONTEND] Creating gift card:', giftCard);
    return this.http.post<GiftCardPurchaseResponse>(
      `${this.apiUrl}/giftcard`,
      giftCard,
      { headers: this.getAuthHeaders() }
    );
  }

  validateGiftCard(code: string): Observable<GiftCardValidation> {
    return this.http.post<GiftCardValidation>(
      `${this.apiUrl}/giftcard/validate`,
      { code },
      { headers: this.getAuthHeaders() }
    );
  }

  getUserGiftCards(): Observable<GiftCard[]> {
    return this.http.get<GiftCard[]>(
      `${this.apiUrl}/giftcard`,
      { headers: this.getAuthHeaders() }
    );
  }

  getMyGiftCards(): Observable<MyGiftCard[]> {
    return this.http.get<MyGiftCard[]>(
      `${this.apiUrl}/giftcard/mine`,
      { headers: this.getAuthHeaders() }
    );
  }

  sendMyGiftCard(id: number, dto: SendMyGiftCard): Observable<MyGiftCard> {
    return this.http.post<MyGiftCard>(
      `${this.apiUrl}/giftcard/mine/${id}/send`,
      dto,
      { headers: this.getAuthHeaders() }
    );
  }

  resendMyGiftCard(id: number): Observable<MyGiftCard> {
    return this.http.post<MyGiftCard>(
      `${this.apiUrl}/giftcard/mine/${id}/resend`,
      {},
      { headers: this.getAuthHeaders() }
    );
  }

  getGiftCardUsageHistory(code: string): Observable<GiftCardUsage[]> {
    return this.http.get<GiftCardUsage[]>(
      `${this.apiUrl}/giftcard/${code}/usage-history`,
      { headers: this.getAuthHeaders() }
    );
  }

  simulateGiftCardPayment(giftCardId: number): Observable<any> {
    return this.http.post(
      `${this.apiUrl}/giftcard/simulate-payment/${giftCardId}`,
      {},
      { headers: this.getAuthHeaders() }
    );
  }

  confirmGiftCardPayment(giftCardId: number, paymentIntentId: string): Observable<any> {
    console.log('[GIFT CARD FRONTEND] Confirming payment:', { giftCardId, paymentIntentId });
    // Authentication is optional for gift card payment confirmation
    return this.http.post(
      `${this.apiUrl}/giftcard/confirm-payment/${giftCardId}`,
      { paymentIntentId },
      { headers: this.getAuthHeaders() }
    );
  }
}