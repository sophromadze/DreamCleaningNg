import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Router } from '@angular/router';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';
import { AttributionService } from './attribution.service';

export interface ServiceType {
  id: number;
  name: string;
  basePrice: number;
  description?: string;
  services: Service[];
  extraServices: ExtraService[];
  isActive: boolean;
  displayOrder?: number;
  hasPoll: boolean;
  isCustom?: boolean;
  /**
   * Whether this type asks apartment vs house. OPTIONAL, and ABSENT MEANS TRUE - the column is
   * NOT NULL default true, so a stale cached or prerendered payload degrades to showing the
   * selector rather than silently hiding it everywhere. Read it through
   * serviceTypeCollectsPropertyType, never directly.
   */
  collectsPropertyType?: boolean;
  timeDuration: number;
  /** Floor for base price + services. 0 = no floor. Consumed by the shared pricing calculator. */
  minimumPrice?: number;
}

/**
 * One included allowance: at `sourceQuantity` of the source service, this service gets
 * `includedQuantity` units free. Doubles as the Sq.ft slider minimum.
 */
export interface ServiceThreshold {
  id: number;
  serviceId: number;
  sourceServiceId: number;
  /** Informational; resolution is always by sourceServiceId. */
  sourceServiceKey?: string;
  sourceServiceName?: string;
  sourceQuantity: number;
  includedQuantity: number;
}

/** One marginal rate band, measured ABOVE the included allowance rather than in absolute units. */
export interface ServiceRateTier {
  id: number;
  serviceId: number;
  fromQuantity: number;
  cost: number;
  timeDuration: number;
  displayOrder: number;
}

export interface Service {
  id: number;
  name: string;
  serviceKey: string;
  cost: number;
  timeDuration: number;
  serviceTypeId: number;
  inputType: string;
  minValue?: number;
  maxValue?: number;
  stepValue?: number;
  isRangeInput: boolean;
  unit?: string;
  serviceRelationType?: string;
  isActive: boolean;
  displayOrder?: number;

  // Threshold / tier billing. Absent or empty means "price exactly as before".
  chargeAboveThreshold?: boolean;
  zeroQuantityCost?: number | null;
  zeroQuantityDuration?: number | null;
  thresholds?: ServiceThreshold[];
  rateTiers?: ServiceRateTier[];
}

export interface ExtraService {
  id: number;
  name: string;
  description?: string;
  price: number;
  duration: number;
  icon?: string;
  hasQuantity: boolean;
  hasHours: boolean;
  isDeepCleaning: boolean;
  isSuperDeepCleaning: boolean;
  isSameDayService: boolean;
  priceMultiplier: number;
  isAvailableForAll: boolean;
  isActive: boolean;
  displayOrder?: number;
}

export interface Subscription {
  id: number;
  name: string;
  description?: string;
  discountPercentage: number;
  subscriptionDays: number;
  isActive: boolean;
  displayOrder?: number;
}

export interface PromoCodeValidationDto {
  isValid: boolean;
  discountValue: number;
  isPercentage: boolean;
  message?: string;
  isGiftCard?: boolean;
  availableBalance?: number;
}

export interface BookingData {
  serviceTypeId: number;
  services: { serviceId: number; quantity: number }[];
  extraServices: { extraServiceId: number; quantity: number; hours: number }[];
  subscriptionId: number;
  serviceDate: Date;
  serviceTime: string;
  entryMethod: string;
  specialInstructions?: string;
  contactFirstName: string;
  contactLastName: string;
  /** Null only when an admin books for a no-email (cash) customer via create-for-user. */
  contactEmail: string | null;
  contactPhone: string;
  serviceAddress: string;
  aptSuite?: string;
  city: string;
  state: string;
  zipCode: string;
  apartmentId?: number | null;
  apartmentName?: string;
  promoCode?: string;
  userSpecialOfferId?: number;
  tips: number;
  maidsCount: number;
  totalDuration: number;
  discountAmount: number;
  subTotal: number;
}

export interface BlockedTimeSlot {
  id: number;
  date: string;       // YYYY-MM-DD
  isFullDay: boolean;
  blockedHours: string | null;  // comma-separated "08:00,08:30,..."
  reason: string | null;
}

export interface BookingCalculation {
  subTotal: number;
  tax: number;
  discountAmount: number;
  tips: number;
  total: number;
  totalDuration: number;
}

@Injectable({
  providedIn: 'root'
})
export class BookingService {
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient, private router: Router,
    private authService: AuthService,
    private attributionService: AttributionService) { }

  /** Merge first-touch + converting-session attribution onto a self-service booking payload. Admin
   *  create-for-user does NOT call this — the backend stamps those "Phone/Unknown" / null. */
  private withAttribution(bookingData: any): any {
    const attribution = this.attributionService.getAttribution();
    const convertingAttribution = this.attributionService.getConvertingAttribution();
    const merged: any = { ...bookingData };
    if (attribution) merged.attribution = attribution;
    if (convertingAttribution) merged.convertingAttribution = convertingAttribution;
    return merged;
  }

    private getAuthHeaders(): HttpHeaders {
      const token = this.authService.getToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      // In cookie-auth mode, token is intentionally not accessible (httpOnly cookie).
      // Only attach Authorization header when we actually have a token.
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      return new HttpHeaders(headers);
    }

  getServiceTypes(): Observable<ServiceType[]> {
    return this.http.get<ServiceType[]>(`${this.apiUrl}/booking/service-types`);
  }

  getSubscriptions(): Observable<Subscription[]> {
    return this.http.get<Subscription[]>(`${this.apiUrl}/booking/subscriptions`);
  }
  
  validatePromoCode(code: string, subTotal?: number): Observable<PromoCodeValidationDto> {
    const body: { code: string; subTotal?: number } = { code };
    if (subTotal !== undefined && subTotal !== null) {
      body.subTotal = subTotal;
    }
    return this.http.post<PromoCodeValidationDto>(`${this.apiUrl}/booking/validate-promo`, body);
  }

  // Method to apply gift card during booking
  applyGiftCardToBooking(giftCardCode: string, orderAmount: number, orderId: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/booking/apply-gift-card`, 
      { code: giftCardCode, orderAmount, orderId }
    );
  }

  confirmPayment(orderId: number, paymentIntentId: string, sessionId?: string, guestToken?: string): Observable<any> {
    const body: any = { paymentIntentId };
    if (sessionId) {
      body.sessionId = sessionId;
    }
    // Secret payment-link token — lets a logged-out payer confirm an existing order's
    // payment (needed when there's no Stripe intent for the backend to resolve them from).
    if (guestToken) {
      body.guestToken = guestToken;
    }
    // Send paymentIntentId in both body and query so backend gets it even if body binding fails
    const url = `${this.apiUrl}/booking/confirm-payment/${orderId}?paymentIntentId=${encodeURIComponent(paymentIntentId)}`;
    return this.http.post(
      url,
      body,
      { headers: this.getAuthHeaders() }
    );
  }

  calculateBooking(bookingData: Partial<BookingData>): Observable<BookingCalculation> {
    return this.http.post<BookingCalculation>(`${this.apiUrl}/booking/calculate`, bookingData);
  }

  createBooking(bookingData: any): Observable<any> {
    return this.http.post<any>(
      `${this.apiUrl}/booking/create`,
      this.withAttribution(bookingData),
      { headers: this.getAuthHeaders() }
    );
  }

  preparePayment(bookingData: any): Observable<any> {
    return this.http.post<any>(
      `${this.apiUrl}/booking/prepare-payment`,
      this.withAttribution(bookingData),
      { headers: this.getAuthHeaders() }
    );
  }

  createBookingForUser(
    targetUserId: number,
    bookingData: any,
    paymentMethod: string = 'Normal',
    paymentReference: string | null = null,
    paymentNotes: string | null = null
  ): Observable<any> {
    // Phase 1 manual payment tracking. Defaults preserve the existing call shape; older
    // callers that don't pass these arguments get Normal/null/null which the backend
    // interprets identically to the pre-Phase-1 behavior (Status=Pending + Stripe reminder).
    return this.http.post<any>(
      `${this.apiUrl}/booking/create-for-user`,
      {
        targetUserId,
        bookingData,
        paymentMethod,
        paymentReference: paymentMethod !== 'Normal' ? paymentReference : null,
        paymentNotes:     paymentMethod !== 'Normal' ? paymentNotes     : null,
      },
      { headers: this.getAuthHeaders() }
    );
  }

  /**
   * Records the payer's SMS / cancellation-fee / terms consents for an admin-created order.
   * Must succeed BEFORE createPaymentIntentForOrder, which refuses to issue a client secret
   * without it — that ordering is what makes the gate un-bypassable rather than cosmetic.
   */
  acceptPaymentConsent(
    orderId: number,
    consents: { smsConsent: boolean; cancellationConsent: boolean; termsConsent: boolean },
    guestToken?: string
  ): Observable<{ orderId: number; acceptedAt: string }> {
    const query = guestToken ? `?guestToken=${encodeURIComponent(guestToken)}` : '';
    return this.http.post<{ orderId: number; acceptedAt: string }>(
      `${this.apiUrl}/booking/accept-payment-consent/${orderId}${query}`,
      consents,
      { headers: this.getAuthHeaders() }
    );
  }

  createPaymentIntentForOrder(orderId: number, guestToken?: string): Observable<any> {
    const query = guestToken ? `?guestToken=${encodeURIComponent(guestToken)}` : '';
    return this.http.post<any>(
      `${this.apiUrl}/booking/create-payment-intent/${orderId}${query}`,
      {},
      { headers: this.getAuthHeaders() }
    );
  }

  getAvailableTimeSlots(date: Date, serviceTypeId: number): Observable<string[]> {
    const dateStr = date.toISOString().split('T')[0];
    return this.http.get<string[]>(`${this.apiUrl}/booking/available-times?date=${dateStr}&serviceTypeId=${serviceTypeId}`);
  }

  getBlockedTimeSlots(from?: string, to?: string): Observable<BlockedTimeSlot[]> {
    let url = `${this.apiUrl}/booking/blocked-time-slots`;
    const params: string[] = [];
    if (from) params.push(`from=${from}`);
    if (to) params.push(`to=${to}`);
    if (params.length) url += '?' + params.join('&');
    return this.http.get<BlockedTimeSlot[]>(url);
  }

  getUserSubscription(): Observable<any> {
    const useCookieAuth = environment.useCookieAuth || false;
    const options = useCookieAuth
      ? { withCredentials: true }
      : { headers: this.getAuthHeaders() };

    return this.http.get(`${this.apiUrl}/booking/user-subscription`, options);
  }
}