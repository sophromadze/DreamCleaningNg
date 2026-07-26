import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

/** The user's saved card. paymentMethodId is returned only to the authenticated owner —
 *  the browser needs it to confirm a PaymentIntent with the saved card. */
export interface SavedCard {
  paymentMethodId: string;
  brand: string | null;
  last4: string | null;
}

export interface OrderSavedCardInfo {
  hasCard: boolean;
  brand: string | null;
  last4: string | null;
}

/**
 * Card on file: one saved card per user, used only for explicit customer/admin-triggered
 * charges. Saving/replacing goes through a Stripe SetupIntent (no charge); paying with the
 * saved card goes through the normal payment endpoints on an explicit Pay/Charge click.
 */
@Injectable({
  providedIn: 'root'
})
export class CardOnFileService {
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  // ── Customer ──

  getSavedCard(): Observable<{ card: SavedCard | null }> {
    return this.http.get<{ card: SavedCard | null }>(`${this.apiUrl}/card-on-file/saved-card`);
  }

  createSetupIntent(): Observable<{ clientSecret: string }> {
    return this.http.post<{ clientSecret: string }>(`${this.apiUrl}/card-on-file/setup-intent`, {});
  }

  saveCard(paymentMethodId: string): Observable<{ card: SavedCard; message: string }> {
    return this.http.put<{ card: SavedCard; message: string }>(
      `${this.apiUrl}/card-on-file/saved-card`, { paymentMethodId });
  }

  removeCard(): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/card-on-file/saved-card`);
  }

  // ── Admin ──

  getOrderSavedCardInfo(orderId: number): Observable<OrderSavedCardInfo> {
    return this.http.get<OrderSavedCardInfo>(`${this.apiUrl}/admin/orders/${orderId}/saved-card-info`);
  }

  chargeOrderSavedCard(orderId: number): Observable<{ charged: boolean; message: string }> {
    return this.http.post<{ charged: boolean; message: string }>(
      `${this.apiUrl}/admin/orders/${orderId}/charge-saved-card`, {});
  }
}
