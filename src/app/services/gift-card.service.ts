import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

export interface CreateGiftCard {
  amount: number;
  recipientName: string;
  recipientEmail: string;
  senderName: string;
  senderEmail: string;
  message?: string;
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

@Injectable({
  providedIn: 'root'
})
export class GiftCardService {
  private apiUrl = environment.apiUrl;

  constructor(
    private http: HttpClient,
    private authService: AuthService
  ) {}

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