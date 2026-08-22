import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface OrderList {
  id: number;
  /** Owner of the order — used to flag the customer from the orders panel. */
  userId?: number;
  /** Owner's admin-only problem flag: 'None' | 'Yellow' | 'Red'. Drives the row tint. */
  flag?: string;
  /** Optional admin note on why the customer is flagged (shown in the row tooltip). */
  flagReason?: string | null;
  serviceTypeName: string;
  isCustomServiceType: boolean;
  /** Bare admin-chosen label for custom orders (no "Cleaning" suffix), e.g. "Deep". */
  customServiceDisplayName?: string | null;
  serviceDate: Date;
  serviceTime: string;
  status: string;
  total: number;
  serviceAddress: string;
  city?: string;
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
  /** Phase 1 manual payment tracking — surfaced on the list DTO so the admin orders table
   *  can render the "DoneM" badge + Payment Method filter without a per-row detail fetch. */
  paymentMethod?: string;
  paymentReference?: string | null;
  paymentNotes?: string | null;
  /** Admin currently assigned to this order. Drives the "By: F. LastName" pill and
   *  admin-bonus payroll. Null = unassigned. */
  assignedAdminId?: number | null;
  assignedAdminFirstName?: string | null;
  assignedAdminLastName?: string | null;
  assignedAdminDisplayName?: string | null;
}

export interface Order {
  id: number;
  userId: number;
  /** Owner's admin-only problem flag: 'None' | 'Yellow' | 'Red'. */
  flag?: string;
  /** Optional admin note on why the customer is flagged. */
  flagReason?: string | null;
  serviceTypeId: number;
  serviceTypeName: string;
  /** True when this order uses the custom ("Pre-Arranged") service type. */
  isCustomServiceType?: boolean;
  /** Bare admin-chosen label for custom orders (no "Cleaning" suffix), e.g. "Deep". */
  customServiceDisplayName?: string | null;
  orderDate: Date;
  serviceDate: Date;
  serviceTime: string;
  status: string;
  subTotal: number;
  tax: number;
  tips: number;
  /** RETIRED field, read-only. Always 0 on new orders; non-zero only on legacy orders,
   *  where it is still part of `total`. Never displayed, never editable, never sent. */
  companyDevelopmentTips: number;
  total: number;
  discountAmount: number;
  subscriptionDiscountAmount?: number;
  /** Loyalty Discount snapshot from the order (Phase 6). Always present on a Phase 6+ order;
   *  optional only for backward compat with older clients. */
  loyaltyDiscountAmount?: number;
  loyaltyDiscountPercentage?: number;
  /** Phase 1 manual payment tracking. 'Normal' = Stripe-flow order; otherwise the literal
   *  value of the backend PaymentMethod enum (Cash/Zelle/Check/Other). */
  paymentMethod?: string;
  paymentReference?: string | null;
  paymentNotes?: string | null;
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
  /** True when the order OWNER'S ACCOUNT has no email address on file (no-email cash customer).
   *  `contactEmail` above is frozen on the order at booking time and can show a real-looking
   *  address while this is true — the admin panel warns off THIS flag, never off contactEmail. */
  customerHasNoAccountEmail?: boolean;
  /** The owner's real account email, or null when the account has none. Rendered only when it
   *  differs from `contactEmail`. */
  customerAccountEmail?: string | null;
  /** Where a payment reminder / updated-payment mail for this order would actually land (order
   *  contact email first, account email as the fallback). Null = those can only go by text. */
  notificationEmailTarget?: string | null;
  serviceAddress: string;
  aptSuite?: string;
  city: string;
  state: string;
  zipCode: string;
  totalDuration: number;
  maidsCount: number;
  bedroomsQuantity?: number;
  bathroomsQuantity?: number;
  /** "Apartment" or "House". Null/undefined for legacy orders - render nothing, not an empty row. */
  propertyType?: string | null;
  /** Levels for a house; null whenever propertyType is not "House". Display only. */
  levelsQuantity?: number | null;
  isPaid: boolean;
  paidAt?: Date;
  /** True when an admin created this order (create-for-user) instead of the customer booking
   *  it themselves. Such an order's customer never saw the /booking consent checkboxes, so the
   *  payment page collects them before the first payment. */
  bookedByAdmin?: boolean;
  /** When the payer accepted the SMS / cancellation-fee / terms consents on the payment page.
   *  Null/undefined on an admin-created order means it cannot be paid yet. */
  paymentConsentAcceptedAt?: string | null;
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
  /** Admin currently assigned to this order. */
  assignedAdminId?: number | null;
  assignedAdminFirstName?: string | null;
  assignedAdminLastName?: string | null;
  assignedAdminDisplayName?: string | null;
  /** Marketing attribution (admin Origin line). First touch = how they first found us;
   *  converting = the session that placed this order (shown only when it differs). */
  acquisitionChannel?: string | null;
  acquisitionSource?: string | null;
  acquisitionMedium?: string | null;
  acquisitionCampaign?: string | null;
  convertingChannel?: string | null;
  convertingSource?: string | null;
  convertingMedium?: string | null;
  convertingCampaign?: string | null;
}

export interface OrderService {
  id: number;
  serviceId: number;
  serviceName: string;
  /** Stable catalogue key ("bedrooms", "sqft", "levels"...), independent of the display name. */
  serviceKey?: string | null;
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
  maidsCount: number;
  totalDuration: number;
  bedroomsQuantity?: number;
  bathroomsQuantity?: number;
  /** "Apartment" or "House"; anything else clears the stored level count server-side. */
  propertyType?: string | null;
  /** Informational level count for a service type with no priced levels service. */
  levelsQuantity?: number | null;
  calculatedSubTotal: number;
  calculatedTax: number;
  calculatedTotal: number;
  /** Recalculated discount (from ratio) so backend can persist when subtotal changes. */
  discountAmount?: number;
  subscriptionDiscountAmount?: number;
  /** Recalculated loyalty discount = newSubTotal * lockedPercentage / 100. The order's
   *  LoyaltyDiscountPercentage snapshot stays fixed across edits; only this $ amount moves. */
  loyaltyDiscountAmount?: number;
}

export interface CancelOrder {
  reason: string;
}

/** Returned by PATCH /api/order/{id}/assigned-admin. `displayName` is pre-formatted
 *  by the backend as "F. LastName" (e.g. "J. Smith") so all surfaces render identically. */
export interface AssignedAdminInfo {
  adminId: number | null;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
}

/** Returned by PATCH /api/order/{id}/booked-by-admin. `bookedByAdmin` is the effective
 *  flag after the change — legacy orders with a creation-time manual-payment stamp
 *  stay true even when cleared (the backend fallback still counts them). */
export interface BookedByAdminResult {
  orderId: number;
  bookedByAdmin: boolean;
}

/** Returned by PATCH /api/order/{id}/custom-service-name. */
export interface CustomServiceNameResult {
  orderId: number;
  customServiceDisplayName: string | null;
  serviceTypeName: string;
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

  /** Guest access to the payment page's order details via the secret payment-link token
   *  (?t=... from emailed/SMSed links). Backend allows it only while something is unpaid. */
  getOrderByIdGuest(orderId: number, token: string): Observable<Order> {
    return this.http.get<Order>(`${this.apiUrl}/order/${orderId}/guest`, { params: { token } });
  }

  /** Set, change, or clear (adminId = null) the admin assigned to an order.
   *  Admin/SuperAdmin only — backend enforces. */
  setAssignedAdmin(orderId: number, adminId: number | null): Observable<AssignedAdminInfo> {
    return this.http.patch<AssignedAdminInfo>(
      `${this.apiUrl}/order/${orderId}/assigned-admin`,
      { adminId }
    );
  }

  updateOrder(orderId: number, updateData: UpdateOrder): Observable<Order> {
    return this.http.put<Order>(`${this.apiUrl}/order/${orderId}`, updateData);
  }

  /** SuperAdmin only — mark/unmark an order as admin-booked. Backfill for orders that
   *  predate BookedByAdminUserId (2026-07); new admin bookings are stamped automatically. */
  setBookedByAdmin(orderId: number, bookedByAdmin: boolean): Observable<BookedByAdminResult> {
    return this.http.patch<BookedByAdminResult>(
      `${this.apiUrl}/order/${orderId}/booked-by-admin`,
      { bookedByAdmin }
    );
  }

  /** SuperAdmin only — change the display label of an existing custom ("Pre-Arranged") order.
   *  Backend rejects non-custom orders. Returns the new bare label + effective "<label> Cleaning". */
  setCustomServiceName(orderId: number, customServiceDisplayName: string | null): Observable<CustomServiceNameResult> {
    return this.http.patch<CustomServiceNameResult>(
      `${this.apiUrl}/order/${orderId}/custom-service-name`,
      { customServiceDisplayName }
    );
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
  createPendingUpdatePaymentIntent(orderId: number, amount?: number, guestToken?: string): Observable<any> {
    const body = amount != null && amount > 0 ? { amount } : {};
    const options = guestToken ? { params: { guestToken } } : {};
    return this.http.post(`${this.apiUrl}/order/${orderId}/create-pending-update-payment-intent`, body, options);
  }

  /** Confirms a pending additional payment and marks related update-history rows as paid. */
  confirmPendingUpdatePayment(orderId: number, paymentIntentId: string, guestToken?: string): Observable<any> {
    const options = guestToken ? { params: { guestToken } } : {};
    return this.http.post(`${this.apiUrl}/order/${orderId}/confirm-pending-update-payment`, { paymentIntentId }, options);
  }
}