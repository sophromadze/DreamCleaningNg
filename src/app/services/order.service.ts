import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface OrderList {
  id: number;
  serviceTypeName: string;
  isCustomServiceType: boolean;
  serviceDate: Date;
  serviceTime: string;
  status: string;
  total: number;
  serviceAddress: string;
  orderDate: Date;
  isPaid?: boolean;
  paidAt?: Date;
  /** Sum of unpaid additional payments created by order updates (e.g. admin increased total). */
  pendingUpdateAmount?: number;
  /** Latest unpaid update-history id (if any). */
  pendingUpdateHistoryId?: number;
  /** Optional: for correct pending-display when backend sends them (amount = (total - tips) - (initialTotal - initialTips)). */
  tips?: number;
  companyDevelopmentTips?: number;
  initialTotal?: number;
  initialTips?: number;
  initialCompanyDevelopmentTips?: number;
  cancellationReason?: string;
  isLateCancellation?: boolean;
  pointsRedeemed?: number;
  pointsRedeemedDiscount?: number;
  rewardBalanceUsed?: number;
  pointsEarned?: number;
}

export interface Order {
  id: number;
  userId: number;
  serviceTypeId: number;
  serviceTypeName: string;
  orderDate: Date;
  serviceDate: Date;
  serviceTime: string;
  status: string;
  subTotal: number;
  tax: number;
  tips: number;
  companyDevelopmentTips: number;
  total: number;
  discountAmount: number;
  subscriptionDiscountAmount?: number;
  promoCode?: string;
  giftCardCode?: string;
  giftCardAmountUsed?: number;
  pointsRedeemed?: number;
  pointsRedeemedDiscount?: number;
  rewardBalanceUsed?: number;
  pointsEarned?: number;
  subscriptionId: number;
  subscriptionName: string;
  entryMethod?: string;
  specialInstructions?: string;
  floorTypes?: string;
  floorTypeOther?: string;
  contactFirstName: string;
  contactLastName: string;
  contactEmail: string;
  contactPhone: string;
  serviceAddress: string;
  aptSuite?: string;
  city: string;
  state: string;
  zipCode: string;
  totalDuration: number;
  maidsCount: number;
  isPaid: boolean;
  paidAt?: Date;
  /** Sum of unpaid additional payments created by order updates (e.g. admin increased total). */
  pendingUpdateAmount?: number;
  /** Latest unpaid update-history id (if any). */
  pendingUpdateHistoryId?: number;
  services: OrderService[];
  extraServices: OrderExtraService[];
  specialOfferName?: string;
  userSpecialOfferId?: number;
  promoCodeDetails?: string;
  giftCardDetails?: string;
  initialSubTotal: number;
  initialTax: number;
  initialTips: number;
  initialCompanyDevelopmentTips: number;
  initialTotal: number;
  cleanerHourlyRate: number;
  cleanerTotalSalary: number;
  hasCleanersService: boolean;
  cancellationReason?: string;
  isLateCancellation?: boolean;
}

export interface OrderService {
  id: number;
  serviceId: number;
  serviceName: string;
  quantity: number;
  hours?: number;
  cost: number;
  duration: number;
  priceMultiplier?: number;
}

export interface OrderExtraService {
  id: number;
  extraServiceId: number;
  extraServiceName: string;
  quantity: number;
  hours: number;
  cost: number;
  duration: number;
}

export interface UpdateOrder {
  serviceDate: Date;
  serviceTime: string;
  entryMethod: string;
  specialInstructions?: string;
  floorTypes?: string | null;
  floorTypeOther?: string | null;
  contactFirstName: string;
  contactLastName: string;
  contactEmail: string;
  contactPhone: string;
  serviceAddress: string;
  aptSuite?: string;
  city: string;
  state: string;
  zipCode: string;
  services: { serviceId: number; quantity: number }[];
  extraServices: { extraServiceId: number; quantity: number; hours: number }[];
  tips: number;
  companyDevelopmentTips: number;
  maidsCount: number;
  totalDuration: number;
  calculatedSubTotal: number;
  calculatedTax: number;
  calculatedTotal: number;
  /** Recalculated discount (from ratio) so backend can persist when subtotal changes. */
  discountAmount?: number;
  subscriptionDiscountAmount?: number;
}

export interface CancelOrder {
  reason: string;
}

@Injectable({
  providedIn: 'root'
})
export class OrderService {
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) { }

  getUserOrders(): Observable<OrderList[]> {
    return this.http.get<OrderList[]>(`${this.apiUrl}/order`);
  }

  getOrderById(orderId: number): Observable<Order> {
    return this.http.get<Order>(`${this.apiUrl}/order/${orderId}`);
  }

  updateOrder(orderId: number, updateData: UpdateOrder): Observable<Order> {
    return this.http.put<Order>(`${this.apiUrl}/order/${orderId}`, updateData);
  }

  cancelOrder(orderId: number, cancelData: CancelOrder): Observable<any> {
    return this.http.post(`${this.apiUrl}/order/${orderId}/cancel`, cancelData);
  }

  calculateAdditionalAmount(orderId: number, updateData: UpdateOrder): Observable<{ additionalAmount: number }> {
    return this.http.post<{ additionalAmount: number }>(`${this.apiUrl}/order/${orderId}/calculate-additional`, updateData);
  }

  createUpdatePaymentIntent(orderId: number, updateData: UpdateOrder): Observable<any> {
    return this.http.post(`${this.apiUrl}/order/${orderId}/create-update-payment`, updateData);
  }
  
  confirmUpdatePayment(orderId: number, paymentIntentId: string, updateData: UpdateOrder): Observable<any> {
    return this.http.post(`${this.apiUrl}/order/${orderId}/confirm-update-payment`, {
      paymentIntentId,
      updateOrderData: updateData
    });
  }

  /** When an admin increased the order total, customer can pay the pending additional amount here.
   * Pass amount (in dollars) so the backend can create a payment intent for the correct amount when the
   * stored pendingUpdateAmount was computed including tips (legacy bug). Backend should use this amount
   * when provided. */
  createPendingUpdatePaymentIntent(orderId: number, amount?: number): Observable<any> {
    const body = amount != null && amount > 0 ? { amount } : {};
    return this.http.post(`${this.apiUrl}/order/${orderId}/create-pending-update-payment-intent`, body);
  }

  /** Confirms a pending additional payment and marks related update-history rows as paid. */
  confirmPendingUpdatePayment(orderId: number, paymentIntentId: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/order/${orderId}/confirm-pending-update-payment`, { paymentIntentId });
  }
}