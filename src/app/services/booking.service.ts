import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Router } from '@angular/router';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

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
  timeDuration: number;
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
  contactEmail: string;
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
  companyDevelopmentTips: number;
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
    private authService: AuthService) { }

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
  
  validatePromoCode(code: string): Observable<PromoCodeValidationDto> {
    return this.http.post<PromoCodeValidationDto>(`${this.apiUrl}/booking/validate-promo`, { code });
  }

  // Method to apply gift card during booking
  applyGiftCardToBooking(giftCardCode: string, orderAmount: number, orderId: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/booking/apply-gift-card`, 
      { code: giftCardCode, orderAmount, orderId }
    );
  }

  confirmPayment(orderId: number, paymentIntentId: string, sessionId?: string): Observable<any> {
    const body: any = { paymentIntentId };
    if (sessionId) {
      body.sessionId = sessionId;
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
      bookingData,
      { headers: this.getAuthHeaders() }
    );
  }

  preparePayment(bookingData: any): Observable<any> {
    return this.http.post<any>(
      `${this.apiUrl}/booking/prepare-payment`,
      bookingData,
      { headers: this.getAuthHeaders() }
    );
  }

  createBookingForUser(targetUserId: number, bookingData: any): Observable<any> {
    return this.http.post<any>(
      `${this.apiUrl}/booking/create-for-user`,
      { targetUserId, bookingData },
      { headers: this.getAuthHeaders() }
    );
  }

  createPaymentIntentForOrder(orderId: number): Observable<any> {
    return this.http.post<any>(
      `${this.apiUrl}/booking/create-payment-intent/${orderId}`,
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