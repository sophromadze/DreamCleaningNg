import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams, HttpResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { ServiceType, Service, ExtraService, Subscription, ServiceThreshold, ServiceRateTier } from './booking.service';
import { Order, OrderList } from './order.service';
import { Apartment, CreateApartment } from './profile.service';
import { UserSpecialOffer } from './special-offer.service';

export interface ExpenseBreakdownItem {
  expenseId: number;
  name: string;
  categoryId: number;
  categoryName: string;
  date: string;
  amount: number;
  isRecurring: boolean;
}

export interface ExpenseCategoryBreakdown {
  categoryId: number;
  categoryName: string;
  total: number;
  items: ExpenseBreakdownItem[];
}

export interface ExpenseBreakdown {
  total: number;
  byCategory: ExpenseCategoryBreakdown[];
}

export interface OrderStatistics {
  totalOrders: number;
  /**
   * Taxable cleaning revenue — order subtotals AFTER discounts, before tax, without tips,
   * net of refunds. Backend: OrderRevenueMath.Split.
   */
  totalAmount: number;
  /**
   * Sales tax collected. Always exactly 8.875% of totalAmount — both come from the same
   * post-discount base and shrink together when an order is refunded. It is charged on top
   * of the price, so it is a pass-through owed to the state, NOT a cost against totalAmount.
   */
  totalTaxes: number;
  totalTips: number;
  /** Promo/first-time + subscription + loyalty discounts granted. Informational only. */
  totalDiscounts: number;
  totalCleanersSalary: number;
  /** Company expenses inside the window (recurring expanded into per-occurrence amounts). */
  totalExpenses: number;
  /** Pre-expense revenue (totalAmount − salaries). Kept for reference in the breakdown. */
  totalCompanyRevenueGross: number;
  /** NET — gross minus expenses. The headline number. */
  totalCompanyRevenue: number;
  expensesBreakdown?: ExpenseBreakdown | null;
  /** Stripe processing fees (2.9% + $0.30/order) — already included in totalExpenses. */
  stripeFees: number;
  /** Admin bonuses for the window in USD (GEL converted at each month's locked rate). */
  adminBonusesUsd: number;
  /** The same admin bonuses in raw GEL, for reference. */
  adminBonusesGel: number;
  /**
   * Booked orders in the window that have not happened yet (Active/Pending). Always
   * reported, so a caller can label an "include unfinished cleanings" toggle before
   * turning it on.
   */
  upcomingOrders: number;
  /** True when every figure above is a projection that already folds in those orders. */
  includesUpcoming: boolean;
  /** Google Ads spend actually recorded in the window (never includes the forecast below). */
  googleAdsSpend: number;
  /** Elapsed days of the window — the average's denominator ($0 days count). */
  googleAdsCoveredDays: number;
  /** googleAdsSpend ÷ googleAdsCoveredDays. */
  googleAdsDailyAverage: number;
  /** Days of the window still to come (0 for a period entirely in the past). */
  googleAdsProjectedDays: number;
  /**
   * Forecast ad spend for those remaining days — 0 unless includeUpcoming was set. When
   * non-zero it is ALREADY inside the Google Ads category, totalExpenses and
   * totalCompanyRevenue; never add it a second time.
   */
  googleAdsProjectedSpend: number;
}

export interface DailyStatistics {
  date: string;
  orders: number;
  amount: number;
  taxes: number;
  tips: number;
  cleanersSalary: number;
  /** GRAND total expenses for the day (table + Stripe fees + admin bonuses). */
  expenses: number;
  /** NET revenue for this day. */
  companyRevenue: number;
  /** Itemised computed expenses (already inside `expenses`). */
  stripeFees: number;
  adminBonuses: number;
}

/** One month's locked GEL→USD rate + frozen bonus rate, for the statistics rates panel. */
export interface MonthlyFinancialRate {
  year: number;
  month: number;
  monthKey: string;
  usdPerGel: number;
  adminBonusRatePerOrderGel: number;
  fxSource: string;       // 'auto' | 'manual' | 'fallback'
  isFinalized: boolean;
  updatedAt: string;
  updatedByUserName?: string | null;
}

export interface AdminOrderList {
  id: number;
  userId: number;
  contactEmail: string;
  contactFirstName: string;
  contactLastName: string;
  serviceTypeName: string;
  isCustomServiceType: boolean;
  /** Bare admin-chosen label for custom orders (no "Cleaning" suffix), e.g. "Deep". */
  customServiceDisplayName?: string | null;
  serviceDate: Date;
  serviceTime: string;
  status: string;
  total: number;
  serviceAddress: string;
  city: string;
  orderDate: Date;
  totalDuration: number;
  /** Staffing-review badge inputs: per-cleaner load > 6h warns (regular types only). */
  maidsCount?: number;
  /** True for cleaner+hours service types (TotalDuration is per-cleaner) — badge skips those. */
  hasCleanersService?: boolean;
  tips: number;
  /** RETIRED, read-only. 0 on new orders; legacy orders keep theirs inside `total`. */
  companyDevelopmentTips: number;
  cancellationReason?: string;
  isLateCancellation?: boolean;
  /** True when an admin created the order (create-for-user) rather than the customer. */
  bookedByAdmin?: boolean;
  /** Money already refunded. Header-card revenue totals subtract this, so a retained
   *  cancellation fee still counts as income. */
  totalRefundedAmount?: number;
  /** Soft-hidden from the default list view. Only present when includeHidden was requested. */
  isHidden?: boolean;
}

export interface AuditLog {
  id: number;
  entityType?: string;
  entityId?: number;
  action: string;
  createdAt: Date;
  changedBy?: string;
  changedByEmail?: string;
  oldValues?: any;
  newValues?: any;
  changedFields?: string[] | null;
  undoneAt?: Date | null;
}

export interface UserPermissions {
  role: string;
  /**
   * True when this user's order edits apply immediately instead of going to a SuperAdmin for
   * approval. Resolved server-side through Helpers/OrderEditApprovalPolicy so a grant made while
   * the admin is logged in takes effect on their next page load, not their next login.
   */
  canSaveOrderEditsDirectly?: boolean;
  permissions: {
    canView: boolean;
    canCreate: boolean;
    canUpdate: boolean;
    canDelete: boolean;
    canActivate: boolean;
    canDeactivate: boolean;
  };
}

/** Assigned cleaner row from admin API (includes whether assignment email was sent). */
export interface AssignedCleanerAdmin {
  id: number;
  name: string;
  assignmentNotificationSentAt?: string | null;
}

export interface UsersResponse {
  users: UserAdmin[];
  currentUserRole: string;
}

// DTOs
export interface PromoCode {
  id: number;
  code: string;
  description?: string;
  isPercentage: boolean;
  discountValue: number;
  maxUsageCount?: number;
  currentUsageCount: number;
  maxUsagePerUser?: number;
  validFrom?: Date;
  validTo?: Date;
  minimumOrderAmount?: number;
  isActive: boolean;
}

export interface CreatePromoCode {
  code: string;
  description?: string;
  isPercentage: boolean;
  discountValue: number;
  maxUsageCount?: number;
  maxUsagePerUser?: number;
  validFrom?: Date;
  validTo?: Date;
  minimumOrderAmount?: number;
}

export interface UpdatePromoCode {
  description?: string;
  isPercentage: boolean;
  discountValue: number;
  maxUsageCount?: number;
  maxUsagePerUser?: number;
  validFrom?: Date;
  validTo?: Date;
  minimumOrderAmount?: number;
  isActive: boolean;
}

/** One SuperAdmin order transfer (order moved between customer accounts). */
export interface OrderTransferInfo {
  id: number;
  orderId: number;
  fromUserId: number;
  fromUserName: string;
  toUserId: number;
  toUserName: string;
  transferredByUserId: number;
  transferredByName: string;
  notes?: string;
  createdAt: string;
  isUndone: boolean;
  undoneAt?: string;
  undoneByName?: string;
  pointsMoved: number;
  spentAmountMoved: number;
  photosMoved: number;
}

/** One recorded refund on an order. */
export interface OrderRefundInfo {
  id: number;
  amount: number;
  /** "succeeded" | "pending" | "Failed" | Stripe's own status. */
  status: string;
  /** Internal admin note — never shown to the customer. */
  reason?: string;
  failureReason?: string;
  /** "Crm" = issued here. "Stripe" = found by reconciling against Stripe (Dashboard refund). */
  source: string;
  refundedByName: string;
  createdAt: string;
  emailSent: boolean;
}

/** Refund state for one order. remainingRefundable is read live from the payment provider,
 *  so it already accounts for refunds issued outside this panel. */
export interface OrderRefundSummary {
  orderId: number;
  totalCharged: number;
  totalRefunded: number;
  remainingRefundable: number;
  canRefund: boolean;
  unavailableReason?: string;
  /** A chargeback exists on one of this order's charges. Disputes are NOT refunds and never
   *  show up in the refunded totals — this drives a warning, not an amount. */
  hasDispute: boolean;
  /** Refunded at Stripe but with no record here — money refunded outside the CRM.
   *  Non-zero is what prompts "Sync from Stripe". */
  unrecordedRefundAmount: number;
  refunds: OrderRefundInfo[];
}

/** Result of reconciling one order against Stripe. */
export interface RefundSyncResult {
  success: boolean;
  message: string;
  refundsImported: number;
  amountImported: number;
  hasDispute: boolean;
  summary?: OrderRefundSummary;
}

/** Result of the paged backfill sweep. Keep calling with lastOrderId while hasMore is true. */
export interface RefundBackfillResult {
  ordersScanned: number;
  ordersWithImports: number;
  refundsImported: number;
  amountImported: number;
  failures: number;
  disputesFound: number;
  lastOrderId?: number;
  hasMore: boolean;
  message: string;
}

/** Outcome of a refund attempt. success=false with amountRefunded>0 means a PARTIAL refund
 *  went through — the money already moved and must not be silently retried in full. */
export interface RefundResult {
  success: boolean;
  message: string;
  refundIds: string[];
  amountRefunded: number;
  emailSent: boolean;
  summary?: OrderRefundSummary;
}

export interface UserAdmin {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  /** True for admin-created cash customers with no email; email arrives blank from the API. */
  isNoEmailUser?: boolean;
  /** Avatar image (Google/Apple photo from social login, or an uploaded one). Missing = show initials. */
  profilePictureUrl?: string | null;
  phone?: string;
  role: string;
  authProvider?: string;
  subscriptionName?: string;
  firstTimeOrder: boolean;
  isActive: boolean;
  createdAt: Date;
  /** When true, user can receive emails and (in future) SMS from the company. */
  canReceiveCommunications: boolean;
  /** When true, user can receive emails. Optional for backward compat. */
  canReceiveEmails?: boolean;
  /** When true, user can receive SMS/messages. Optional for backward compat. */
  canReceiveMessages?: boolean;
  /** Admin-only notes about this user. Not visible to the user. */
  adminNotes?: string | null;
  /** Restricted-admin-page keys this (Admin-role) user has been granted read-only access to. */
  viewablePages?: string[];
  /** True when a SuperAdmin has granted this Admin direct order-edit saves (no approval step). */
  canEditOrdersWithoutApproval?: boolean;
  /** True if user has an active connection (on site). */
  isOnline?: boolean;

  // ── Customer-care snapshot fields populated by the backend list endpoint ──
  /** Service date of the user's most recent non-cancelled order. */
  lastCleaningDate?: string | Date | null;
  /** Service type name of the user's most recent non-cancelled order. */
  lastCleaningServiceType?: string | null;
  lastBedrooms?: number | null;
  lastBathrooms?: number | null;
  /** Total number of non-cancelled orders this user has placed. */
  totalOrdersCount?: number;
  /** Admin-only problem flag: 'None' | 'Yellow' | 'Red'. Drives the row/background tint. */
  flag?: string;
  /** Optional admin note on why this customer is flagged. */
  flagReason?: string | null;
}

// ── Customer-care notes & photos ──

export interface UserNote {
  id: number;
  userId: number;
  type: 'General';
  content: string;
  createdByAdminId?: number | null;
  createdByAdminName?: string | null;
  createdAt: string;
  updatedAt?: string | null;
}

export interface CreateUserNoteDto {
  type: 'General';
  content: string;
}

export interface UpdateUserNoteDto {
  content: string;
}

export interface UserCleaningPhoto {
  id: number;
  userId: number;
  orderId?: number | null;
  photoUrl: string;
  sizeBytes: number;
  uploadedByAdminName?: string | null;
  caption?: string | null;
  createdAt: string;
}

export interface UserCleaningPhotosByOrder {
  orderId?: number | null;
  orderServiceDate?: string | null;
  orderServiceTypeName?: string | null;
  photos: UserCleaningPhoto[];
}

export interface UserCleaningPhotoUploadResult {
  photo: UserCleaningPhoto;
  prunedCount: number;
}

/** SuperAdmin-only: full user update. All changes are audit-logged. */
export interface SuperAdminUpdateUserDto {
  firstName: string;
  lastName: string;
  /** Null when left blank (only valid for no-email cash accounts). */
  email: string | null;
  phone?: string | null;
  role: string;
  isActive: boolean;
  firstTimeOrder: boolean;
  canReceiveCommunications: boolean;
  canReceiveEmails: boolean;
  canReceiveMessages: boolean;
}

/** SuperAdmin-only: full order update. All changes are audit-logged. */
export interface SuperAdminUpdateOrderDto {
  contactFirstName?: string | null;
  contactLastName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  serviceAddress?: string | null;
  aptSuite?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  serviceDate?: string | null;
  serviceTime?: string | null;
  maidsCount?: number | null;
  totalDuration?: number | null;
  bedroomsQuantity?: number | null;
  bathroomsQuantity?: number | null;
  /**
   * "Apartment" or "House". Null/undefined means NO CHANGE on this path, unlike the
   * customer-facing update DTO - an admin editing only the service date must not strip the
   * property type off the order. The level count travels as an ordinary service row.
   */
  propertyType?: string | null;
  /**
   * Informational level count, for an order whose service type has no priced levels row. Ignored
   * when a priced row exists - that row is the source of truth. Null means no change.
   */
  levelsQuantity?: number | null;
  entryMethod?: string | null;
  specialInstructions?: string | null;
  floorTypes?: string | null;
  floorTypeOther?: string | null;
  tips?: number | null;
  // companyDevelopmentTips is deliberately absent: the field is retired and the backend
  // preserves whatever a legacy order already stores. Do not re-add it here.
  status?: string | null;
  cancellationReason?: string | null;
  subTotal?: number | null;
  // Tax and total are sent for the preview/audit trail but NOT applied server-side: the update
  // path recomputes both through the shared calculator.
  tax?: number | null;
  total?: number | null;
  /**
   * Set when the admin typed a TOTAL rather than a subtotal: the exact tax inside that
   * tax-inclusive figure, so the charged total matches it to the cent. Honoured server-side only
   * while `taxOverrideBase` still equals the subtotal this order's discounts leave behind.
   */
  taxOverride?: number | null;
  /** The discounted subtotal `taxOverride` was split out of. */
  taxOverrideBase?: number | null;
  discountAmount?: number | null;
  subscriptionDiscountAmount?: number | null;
  /** Loyalty Discount amount rescaled when subTotal changes during an admin edit.
   *  Backend keeps the original LoyaltyDiscountPercentage snapshot untouched. */
  loyaltyDiscountAmount?: number | null;
  cleanerHourlyRate?: number | null;
  cleanerTotalSalary?: number | null;
  /** Custom ("Pre-Arranged") orders only: display label. '' clears it, null = no change. */
  customServiceDisplayName?: string | null;
  services?: { orderServiceId: number; quantity: number; cost: number }[] | null;
  /** Existing rows: orderExtraServiceId = row id. New rows: orderExtraServiceId = 0 and extraServiceId required. */
  extraServices?: { orderExtraServiceId: number; extraServiceId?: number; quantity: number; hours: number; cost: number }[] | null;
}

/** Pending order edit list item (admin-submitted, awaiting SuperAdmin approval). */
export interface PendingOrderEditListDto {
  id: number;
  orderId: number;
  orderSummary: string;
  requestedByUserId: number;
  requestedByName: string;
  requestedAt: string;
  status: string;
}

/** Pending order edit detail with current order and proposed changes (for diff/approve). */
export interface PendingOrderEditDetailDto {
  id: number;
  orderId: number;
  requestedByUserId: number;
  requestedByName: string;
  requestedAt: string;
  status: string;
  currentOrder?: Order;
  proposedChanges?: SuperAdminUpdateOrderDto;
}

export interface CreateServiceType {
  name: string;
  basePrice: number;
  description?: string;
  displayOrder: number;
  timeDuration: number;
  hasPoll?: boolean;
  /** Whether this type asks apartment vs house. Absent means true (column default). */
  collectsPropertyType?: boolean;
  isCustom?: boolean;
  /** Floor for base price + services. 0 = no floor. */
  minimumPrice?: number;
}

export interface UpdateServiceType {
  name: string;
  basePrice: number;
  description?: string;
  displayOrder: number;
  timeDuration: number;
  hasPoll?: boolean;
  /** Whether this type asks apartment vs house. Absent means true (column default). */
  collectsPropertyType?: boolean;
  isCustom?: boolean;
  /** Floor for base price + services. 0 = no floor. */
  minimumPrice?: number;
}

export interface CreateService {
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
  displayOrder: number;
  // Threshold / tier billing. Nested rows are managed through their own endpoints.
  chargeAboveThreshold?: boolean;
  zeroQuantityCost?: number | null;
  zeroQuantityDuration?: number | null;
}

export interface UpdateService {
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
  serviceRelationType?: string; // Make sure this is included
  displayOrder: number;
  chargeAboveThreshold?: boolean;
  zeroQuantityCost?: number | null;
  zeroQuantityDuration?: number | null;
}

/** Create/update payload for one included-amount row. */
export interface SaveServiceThreshold {
  sourceServiceId: number;
  sourceQuantity: number;
  includedQuantity: number;
}

/** Create/update payload for one rate tier. */
export interface SaveServiceRateTier {
  fromQuantity: number;
  cost: number;
  timeDuration: number;
  displayOrder: number;
}

// ===== Pricing configuration export / import =====
// Resolves by (serviceTypeName, serviceKey) only — never by Id, because production and local
// have diverged on surrogate keys.

export interface PricingConfigurationRateTier {
  fromQuantity: number;
  cost: number;
  timeDuration: number;
  displayOrder: number;
}

export interface PricingConfigurationThreshold {
  sourceServiceKey: string;
  sourceQuantity: number;
  includedQuantity: number;
}

export interface PricingConfigurationService {
  serviceKey: string;
  name?: string;
  cost: number;
  timeDuration: number;
  chargeAboveThreshold: boolean;
  zeroQuantityCost?: number | null;
  zeroQuantityDuration?: number | null;
  thresholds: PricingConfigurationThreshold[];
  rateTiers: PricingConfigurationRateTier[];
}

export interface PricingConfigurationServiceType {
  serviceTypeName: string;
  basePrice: number;
  timeDuration: number;
  minimumPrice: number;
  services: PricingConfigurationService[];
}

export interface PricingConfiguration {
  formatVersion: string;
  exportedAt: string;
  sourceNote?: string;
  serviceTypes: PricingConfigurationServiceType[];
}

export interface PricingFieldChange {
  field: string;
  oldValue: string;
  newValue: string;
  isChanged: boolean;
}

export interface PricingConfigurationServiceDiff {
  serviceKey: string;
  name?: string;
  resolvedServiceId?: number | null;
  changes: PricingFieldChange[];
  thresholdChanges: string[];
  rateTierChanges: string[];
}

export interface PricingConfigurationServiceTypeDiff {
  serviceTypeName: string;
  resolvedServiceTypeId?: number | null;
  changes: PricingFieldChange[];
  services: PricingConfigurationServiceDiff[];
}

export interface PricingConfigurationDiff {
  canApply: boolean;
  errors: string[];
  warnings: string[];
  isNoOp: boolean;
  serviceTypes: PricingConfigurationServiceTypeDiff[];
}

export interface ApplyPricingConfigurationResult {
  success: boolean;
  message: string;
  serviceTypesUpdated: number;
  servicesUpdated: number;
  thresholdsWritten: number;
  rateTiersWritten: number;
}

export interface CreateExtraService {
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
  serviceTypeId?: number;
  isAvailableForAll: boolean;
  displayOrder: number;
}

export interface UpdateExtraService {
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
  serviceTypeId?: number;
  isAvailableForAll: boolean;
  displayOrder: number;
}

export interface CreateSubscription {
  name: string;
  description?: string;
  discountPercentage: number;
  subscriptionDays: number;
  displayOrder: number;
}

export interface UpdateSubscription {
  name: string;
  description?: string;
  discountPercentage: number;
  subscriptionDays: number;
  displayOrder: number;
}

export interface CopyService {
  sourceServiceId: number;
  targetServiceTypeId: number;
}

export interface CopyExtraService {
  sourceExtraServiceId: number;
  targetServiceTypeId: number;
}

export interface DetailedUser extends UserAdmin {
  orders?: OrderList[];
  apartments?: Apartment[];
  totalOrders?: number;
  totalSpent?: number;
  lastOrderDate?: Date;
  registrationDate?: Date;
  /** Admin-only notes (inherited from UserAdmin; can be updated via updateUserAdminNotes). */
  adminNotes?: string | null;
}

export interface OrderUpdateHistory {
  id: number;
  updatedAt: Date;
  updatedBy: string;
  updatedByEmail: string;
  originalSubTotal: number;
  originalTax: number;
  originalTips: number;
  originalCompanyDevelopmentTips: number;
  originalTotal: number;
  newSubTotal: number;
  newTax: number;
  newTips: number;
  newCompanyDevelopmentTips: number;
  newTotal: number;
  additionalAmount: number;
  paymentIntentId: string | null;
  isPaid: boolean;
  paidAt: Date | null;
  updateNotes: string | null;
  updatedPaymentNotificationSentAt: Date | null;
  // Manual (non-Stripe) payment of this additional amount. "Normal" = paid via Stripe or unpaid.
  paymentMethod: string;
  paymentReference: string | null;
  paymentNotes: string | null;
  manualPaymentRecordedAt: Date | null;
}

export interface UserProfile {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  role: string;
  authProvider?: string;
  isActive: boolean;
  firstTimeOrder: boolean;
  subscriptionId?: number;
  subscriptionName?: string;
  subscriptionExpiryDate?: Date;
  createdAt: Date;
  apartments: Apartment[];
  totalOrders: number;
  totalSpent: number;
  lastOrderDate?: Date;
}

export interface PollQuestion {
  id: number;
  question: string;
  questionType: string;
  options?: string;
  isRequired: boolean;
  displayOrder: number;
  isActive: boolean;
  serviceTypeId: number;
}

export interface CreatePollQuestion {
  question: string;
  questionType: string;
  options?: string;
  isRequired: boolean;
  displayOrder: number;
  serviceTypeId: number;
}

// Loyalty Discount (re-engagement system) — admin-facing shapes. Matches the backend
// LoyaltyDiscountDto / LoyaltyDiscountSettingsDto contracts from Phase 3.
export interface LoyaltyDiscountDto {
  percentage: number;
  isManualOverride: boolean;
  activatedAt: string | null;
  lastUsedAt: string | null;
  status: 'None' | 'Auto' | 'Manual' | 'Used';
}

export interface LoyaltyDiscountSettingsDto {
  loyaltyDiscountEnabled: boolean;
  loyaltyDay60Percentage: number;
  loyaltyDay90Percentage: number;
  daysUntilFirstReminder: number;
  daysUntilDiscountActivation: number;
  daysUntilDiscountUpgrade: number;
  minDaysFromLastUseBeforeReActivation: number;
}

@Injectable({
  providedIn: 'root'
})
export class AdminService {
  private apiUrl = `${environment.apiUrl}/admin`;

  constructor(private http: HttpClient) { }

  getUserPermissions(): Observable<UserPermissions> {
    return this.http.get<UserPermissions>(`${this.apiUrl}/permissions`);
  }

  // Service Types
  getServiceTypes(): Observable<ServiceType[]> {
    return this.http.get<ServiceType[]>(`${this.apiUrl}/service-types`);
  }

  createServiceType(serviceType: CreateServiceType): Observable<ServiceType> {
    return this.http.post<ServiceType>(`${this.apiUrl}/service-types`, serviceType);
  }

  updateServiceType(id: number, serviceType: UpdateServiceType): Observable<ServiceType> {
    return this.http.put<ServiceType>(`${this.apiUrl}/service-types/${id}`, serviceType);
  }

  deactivateServiceType(id: number): Observable<any> {
    return this.http.put(`${this.apiUrl}/service-types/${id}/deactivate`, {});
  }

  activateServiceType(id: number): Observable<any> {
    return this.http.put(`${this.apiUrl}/service-types/${id}/activate`, {});
  }

  deleteServiceType(id: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/service-types/${id}`);
  }

  // Services
  getServices(): Observable<Service[]> {
    return this.http.get<Service[]>(`${this.apiUrl}/services`);
  }

  createService(service: CreateService): Observable<Service> {
    return this.http.post<Service>(`${this.apiUrl}/services`, service);
  }

  copyService(copyData: CopyService): Observable<Service> {
    return this.http.post<Service>(`${this.apiUrl}/services/copy`, copyData);
  }

  updateService(id: number, service: UpdateService): Observable<Service> {
    return this.http.put<Service>(`${this.apiUrl}/services/${id}`, service);
  }

  deactivateService(id: number): Observable<any> {
    return this.http.put(`${this.apiUrl}/services/${id}/deactivate`, {});
  }

  activateService(id: number): Observable<any> {
    return this.http.put(`${this.apiUrl}/services/${id}/activate`, {});
  }

  deleteService(id: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/services/${id}`);
  }

  // Included amounts (thresholds) — the free allowance a service gets at a given
  // quantity of a source service, e.g. sqft included per bedroom count.
  getServiceThresholds(serviceId: number): Observable<ServiceThreshold[]> {
    return this.http.get<ServiceThreshold[]>(`${this.apiUrl}/services/${serviceId}/thresholds`);
  }

  createServiceThreshold(serviceId: number, row: SaveServiceThreshold): Observable<ServiceThreshold> {
    return this.http.post<ServiceThreshold>(`${this.apiUrl}/services/${serviceId}/thresholds`, row);
  }

  updateServiceThreshold(serviceId: number, id: number, row: SaveServiceThreshold): Observable<ServiceThreshold> {
    return this.http.put<ServiceThreshold>(`${this.apiUrl}/services/${serviceId}/thresholds/${id}`, row);
  }

  deleteServiceThreshold(serviceId: number, id: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/services/${serviceId}/thresholds/${id}`);
  }

  // Rate tiers — marginal bands over the BILLABLE quantity (after the allowance).
  getServiceRateTiers(serviceId: number): Observable<ServiceRateTier[]> {
    return this.http.get<ServiceRateTier[]>(`${this.apiUrl}/services/${serviceId}/rate-tiers`);
  }

  createServiceRateTier(serviceId: number, row: SaveServiceRateTier): Observable<ServiceRateTier> {
    return this.http.post<ServiceRateTier>(`${this.apiUrl}/services/${serviceId}/rate-tiers`, row);
  }

  updateServiceRateTier(serviceId: number, id: number, row: SaveServiceRateTier): Observable<ServiceRateTier> {
    return this.http.put<ServiceRateTier>(`${this.apiUrl}/services/${serviceId}/rate-tiers/${id}`, row);
  }

  deleteServiceRateTier(serviceId: number, id: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/services/${serviceId}/rate-tiers/${id}`);
  }

  // Pricing configuration export / import (import is SuperAdmin-only, enforced server-side)
  exportPricingConfiguration(serviceTypeId?: number): Observable<PricingConfiguration> {
    const query = serviceTypeId ? `?serviceTypeId=${serviceTypeId}` : '';
    return this.http.get<PricingConfiguration>(`${this.apiUrl}/pricing-configuration/export${query}`);
  }

  previewPricingConfiguration(payload: PricingConfiguration): Observable<PricingConfigurationDiff> {
    return this.http.post<PricingConfigurationDiff>(`${this.apiUrl}/pricing-configuration/preview`, payload);
  }

  applyPricingConfiguration(payload: PricingConfiguration): Observable<ApplyPricingConfigurationResult> {
    return this.http.post<ApplyPricingConfigurationResult>(`${this.apiUrl}/pricing-configuration/apply`, payload);
  }

  // Extra Services
  getExtraServices(): Observable<ExtraService[]> {
    return this.http.get<ExtraService[]>(`${this.apiUrl}/extra-services`);
  }

  createExtraService(extraService: CreateExtraService): Observable<ExtraService> {
    return this.http.post<ExtraService>(`${this.apiUrl}/extra-services`, extraService);
  }

  copyExtraService(copyData: CopyExtraService): Observable<ExtraService> {
    return this.http.post<ExtraService>(`${this.apiUrl}/extra-services/copy`, copyData);
  }

  updateExtraService(id: number, extraService: UpdateExtraService): Observable<ExtraService> {
    return this.http.put<ExtraService>(`${this.apiUrl}/extra-services/${id}`, extraService);
  }

  deactivateExtraService(id: number): Observable<any> {
    return this.http.put(`${this.apiUrl}/extra-services/${id}/deactivate`, {});
  }

  activateExtraService(id: number): Observable<any> {
    return this.http.put(`${this.apiUrl}/extra-services/${id}/activate`, {});
  }

  deleteExtraService(id: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/extra-services/${id}`);
  }

  // Subscriptions
  getSubscriptions(): Observable<Subscription[]> {
    return this.http.get<Subscription[]>(`${this.apiUrl}/subscriptions`);
  }

  createSubscription(subscription: CreateSubscription): Observable<Subscription> {
    return this.http.post<Subscription>(`${this.apiUrl}/subscriptions`, subscription);
  }

  updateSubscription(id: number, subscription: UpdateSubscription): Observable<Subscription> {
    return this.http.put<Subscription>(`${this.apiUrl}/subscriptions/${id}`, subscription);
  }

  deleteSubscription(id: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/subscriptions/${id}`);
  }

  deactivateSubscription(id: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/subscriptions/${id}/deactivate`, {});
  }

  activateSubscription(id: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/subscriptions/${id}/activate`, {});
  }

  // Promo Codes
  getPromoCodes(): Observable<PromoCode[]> {
    return this.http.get<PromoCode[]>(`${this.apiUrl}/promo-codes`);
  }

  createPromoCode(promoCode: CreatePromoCode): Observable<PromoCode> {
    // Ensure proper data types
    const payload = {
      ...promoCode,
      isPercentage: Boolean(promoCode.isPercentage),
      discountValue: Number(promoCode.discountValue),
      maxUsageCount: promoCode.maxUsageCount ? Number(promoCode.maxUsageCount) : null,
      maxUsagePerUser: promoCode.maxUsagePerUser ? Number(promoCode.maxUsagePerUser) : null,
      minimumOrderAmount: promoCode.minimumOrderAmount ? Number(promoCode.minimumOrderAmount) : null
    };
    
    return this.http.post<PromoCode>(`${this.apiUrl}/promo-codes`, payload);
  }

  updatePromoCode(id: number, promoCode: UpdatePromoCode): Observable<PromoCode> {
    // Ensure proper data types
    const payload = {
      ...promoCode,
      isPercentage: Boolean(promoCode.isPercentage),
      discountValue: Number(promoCode.discountValue),
      maxUsageCount: promoCode.maxUsageCount ? Number(promoCode.maxUsageCount) : null,
      maxUsagePerUser: promoCode.maxUsagePerUser ? Number(promoCode.maxUsagePerUser) : null,
      minimumOrderAmount: promoCode.minimumOrderAmount ? Number(promoCode.minimumOrderAmount) : null,
      isActive: Boolean(promoCode.isActive)
    };
    
    return this.http.put<PromoCode>(`${this.apiUrl}/promo-codes/${id}`, payload);
  }

  deletePromoCode(id: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/promo-codes/${id}`);
  }

  deactivatePromoCode(id: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/promo-codes/${id}/deactivate`, {});
  }

  activatePromoCode(id: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/promo-codes/${id}/activate`, {});
  }

  // Users
  getUsers(forceRefresh: boolean = false): Observable<UsersResponse | UserAdmin[]> {
    const headers = forceRefresh
      ? new HttpHeaders({
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
          Expires: '0'
        })
      : undefined;

    const params = forceRefresh
      ? new HttpParams().set('_', Date.now().toString())
      : undefined;

    return this.http.get<UsersResponse | UserAdmin[]>(`${this.apiUrl}/users`, { headers, params });
  }

  registerUser(userData: { firstName: string; lastName: string; email?: string; phone?: string; noEmail?: boolean }): Observable<any> {
    return this.http.post(`${this.apiUrl}/users/register`, userData);
  }

  updateUserRole(userId: number, role: string): Observable<any> {
    return this.http.put(`${this.apiUrl}/users/${userId}/role`, { role });
  }

  /** SuperAdmin: grant/revoke a regular Admin read-only access to restricted admin pages. */
  updateUserViewablePages(userId: number, pages: string[]): Observable<{ message: string; pages: string[] }> {
    return this.http.put<{ message: string; pages: string[] }>(
      `${this.apiUrl}/users/${userId}/viewable-pages`,
      { pages }
    );
  }

  updateUserStatus(userId: number, isActive: boolean): Observable<any> {
    return this.http.put(`${this.apiUrl}/users/${userId}/status`, { isActive });
  }

  /**
   * Set/clear a customer's admin-only problem flag. Single source of truth — flagging from an
   * order passes that order's userId here. level: 'None' | 'Yellow' | 'Red'.
   */
  setUserFlag(userId: number, level: string, reason?: string | null): Observable<any> {
    return this.http.put(`${this.apiUrl}/users/${userId}/flag`, { level, reason: reason ?? null });
  }

  /** Admin/SuperAdmin: update user's email or messages preference. Requires canUpdate. */
  updateUserCommunicationPreference(
    userId: number,
    type: 'emails' | 'messages',
    value: boolean
  ): Observable<{ canReceiveEmails: boolean; canReceiveMessages: boolean }> {
    const body = type === 'emails' ? { canReceiveEmails: value } : { canReceiveMessages: value };
    return this.http.patch<{ canReceiveEmails: boolean; canReceiveMessages: boolean }>(
      `${this.apiUrl}/users/${userId}/communication-preference`,
      body
    );
  }

  /** Admin/SuperAdmin: update admin notes for a user. */
  updateUserAdminNotes(userId: number, adminNotes: string | null): Observable<{ adminNotes: string | null; message: string }> {
    return this.http.put<{ adminNotes: string | null; message: string }>(`${this.apiUrl}/users/${userId}/admin-notes`, { adminNotes });
  }

  /** Admin/SuperAdmin: when this user last received a reminder (automatic loyalty 30/60/90 or manual).
   *  hasOrders drives the confirm-dialog wording ("we miss you" vs "book your first cleaning"). */
  getUserReminderStatus(userId: number): Observable<{ lastReminderSentAt: string | null; daysAgo: number | null; lastReminderType: string | null; hasOrders: boolean }> {
    return this.http.get<{ lastReminderSentAt: string | null; daysAgo: number | null; lastReminderType: string | null; hasOrders: boolean }>(
      `${this.apiUrl}/users/${userId}/reminder-status`
    );
  }

  /** Admin/SuperAdmin: manually send the "we miss you" reminder (same copy as the automatic 30-day one). */
  sendUserReminder(userId: number): Observable<{ emailSent: boolean; smsSent: boolean; message: string }> {
    return this.http.post<{ emailSent: boolean; smsSent: boolean; message: string }>(
      `${this.apiUrl}/users/${userId}/send-reminder`,
      {}
    );
  }

  /** SuperAdmin-only: full user update. All changes are audit-logged. */
  superAdminFullUpdateUser(userId: number, dto: SuperAdminUpdateUserDto): Observable<any> {
    return this.http.put(`${this.apiUrl}/users/${userId}/superadmin-full-update`, dto);
  }

  deleteUser(userId: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/users/${userId}`);
  }

  /** SuperAdmin-only: reset a staff member's 2FA PIN + lockout. Clears the PIN and all
   *  trusted devices so they set a fresh PIN on their next login. */
  resetStaffTwoFactorPin(userId: number): Observable<{ message: string; wasLocked: boolean }> {
    return this.http.post<{ message: string; wasLocked: boolean }>(`${this.apiUrl}/users/${userId}/reset-2fa-pin`, {});
  }

  /** SuperAdmin-only: export users list to an .xlsx file. Pass the column keys to include
   *  (empty array exports all). Returns the raw .xlsx blob for the caller to save. */
  exportUsers(columns: string[]): Observable<HttpResponse<Blob>> {
    return this.http.post(`${this.apiUrl}/users/export`, { columns }, {
      responseType: 'blob',
      observe: 'response'
    });
  }

  /** SuperAdmin-only: export orders to an .xlsx file. Pass the column keys to include (empty
   *  array exports all) and the order ids to export (the currently filtered rows; empty = all).
   *  Returns the raw .xlsx blob for the caller to save. */
  exportOrders(columns: string[], orderIds: number[]): Observable<HttpResponse<Blob>> {
    return this.http.post(`${this.apiUrl}/orders/export`, { columns, orderIds }, {
      responseType: 'blob',
      observe: 'response'
    });
  }

  /** SuperAdmin-only: full order update. All changes are audit-logged. */
  superAdminFullUpdateOrder(orderId: number, dto: SuperAdminUpdateOrderDto): Observable<any> {
    return this.http.put(`${this.apiUrl}/orders/${orderId}/superadmin-full-update`, dto);
  }

  /**
   * SuperAdmin-only: grant/revoke a regular Admin the right to save order edits directly, skipping
   * the pending-edit approval step. Same shape as updateUserViewablePages.
   */
  updateUserOrderEditApproval(userId: number, canEditOrdersWithoutApproval: boolean):
    Observable<{ message: string; canEditOrdersWithoutApproval: boolean }> {
    return this.http.put<{ message: string; canEditOrdersWithoutApproval: boolean }>(
      `${this.apiUrl}/users/${userId}/order-edit-approval`,
      { canEditOrdersWithoutApproval }
    );
  }

  /** Admin-only: submit proposed order changes for SuperAdmin approval. */
  submitPendingOrderEdit(orderId: number, dto: SuperAdminUpdateOrderDto): Observable<PendingOrderEditListDto> {
    return this.http.post<PendingOrderEditListDto>(`${this.apiUrl}/orders/${orderId}/pending-edit`, dto);
  }

  /** Reviewers only (SuperAdmin, or an Admin granted direct saves): list pending order edits. */
  getPendingOrderEdits(): Observable<PendingOrderEditListDto[]> {
    return this.http.get<PendingOrderEditListDto[]>(`${this.apiUrl}/orders/pending-edits`);
  }

  /** Reviewers only: get one pending edit with current order and proposed changes. */
  getPendingOrderEditDetail(id: number): Observable<PendingOrderEditDetailDto> {
    return this.http.get<PendingOrderEditDetailDto>(`${this.apiUrl}/orders/pending-edits/${id}`);
  }

  /** Reviewers only: approve and apply a pending order edit. */
  approvePendingOrderEdit(id: number): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/orders/pending-edits/${id}/approve`, {});
  }

  /** Reviewers only: reject a pending order edit. */
  rejectPendingOrderEdit(id: number, rejectReason?: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/orders/pending-edits/${id}/reject`, { rejectReason });
  }

  // Orders Management
  /** @param includeHidden pass true for the "Show hidden orders" view (allowed for all admin roles). */
  getAllOrders(includeHidden = false): Observable<AdminOrderList[]> {
    // Note: Just use /orders, not /admin/orders because apiUrl already includes /admin
    const params = includeHidden ? new HttpParams().set('includeHidden', 'true') : undefined;
    return this.http.get<AdminOrderList[]>(`${this.apiUrl}/orders`, { params });
  }

  /** SuperAdmin-only soft-hide. View filter only — changes no order data, status or revenue. */
  hideOrder(orderId: number): Observable<{ message: string; isHidden: boolean }> {
    return this.http.post<{ message: string; isHidden: boolean }>(`${this.apiUrl}/orders/${orderId}/hide`, {});
  }

  unhideOrder(orderId: number): Observable<{ message: string; isHidden: boolean }> {
    return this.http.post<{ message: string; isHidden: boolean }>(`${this.apiUrl}/orders/${orderId}/unhide`, {});
  }

  getOrderDetails(orderId: number): Observable<Order> {
    return this.http.get<Order>(`${this.apiUrl}/orders/${orderId}`);
  }

  updateOrderStatus(
    orderId: number,
    status: string,
    paymentMethod: string | null = null,
    paymentReference: string | null = null,
    paymentNotes: string | null = null
  ): Observable<any> {
    // Phase 1 manual payment tracking. paymentMethod/Reference/Notes are admin-supplied via
    // the Done modal. When omitted, existing order values are preserved server-side (no
    // clobber). Reference/Notes are sent only for manual methods.
    const body: any = { status };
    if (paymentMethod !== null && paymentMethod !== undefined) {
      body.paymentMethod = paymentMethod;
      if (paymentMethod !== 'Normal') {
        body.paymentReference = paymentReference;
        body.paymentNotes = paymentNotes;
      }
    }
    return this.http.put(`${this.apiUrl}/orders/${orderId}/status`, body);
  }

  cancelOrder(orderId: number, reason: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/orders/${orderId}/cancel`, { reason });
  }

  /** SuperAdmin-only: permanently delete an order (no refund). */
  deleteOrder(orderId: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/orders/${orderId}`);
  }

  sendReviewRequest(orderId: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/orders/${orderId}/send-review-request`, {});
  }

  getUserOnlineStatus(userId: number): Observable<{ userId: number, isOnline: boolean }> {
    return this.http.get<{ userId: number, isOnline: boolean }>(`${this.apiUrl}/admin/users/${userId}/online-status`);
  }

  // Get user's orders (admin endpoint)
  getUserOrders(userId: number): Observable<OrderList[]> {
    return this.http.get<OrderList[]>(`${this.apiUrl}/users/${userId}/orders`);
  }

  // Get user's apartments (admin endpoint)
  getUserApartments(userId: number): Observable<Apartment[]> {
    return this.http.get<Apartment[]>(`${this.apiUrl}/users/${userId}/apartments`);
  }

  // SuperAdmin: add address for a user
  addUserApartment(userId: number, apartment: CreateApartment): Observable<Apartment> {
    return this.http.post<Apartment>(`${this.apiUrl}/users/${userId}/apartments`, apartment);
  }

  // SuperAdmin: update address for a user
  updateUserApartment(userId: number, apartmentId: number, apartment: Apartment): Observable<Apartment> {
    return this.http.put<Apartment>(`${this.apiUrl}/users/${userId}/apartments/${apartmentId}`, apartment);
  }

  // SuperAdmin: delete address for a user
  deleteUserApartment(userId: number, apartmentId: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/users/${userId}/apartments/${apartmentId}`);
  }

  // Get user's special offers (admin endpoint)
  getUserSpecialOffers(userId: number): Observable<UserSpecialOffer[]> {
    return this.http.get<UserSpecialOffer[]>(`${this.apiUrl}/users/${userId}/special-offers`);
  }

  // ── Customer-care: general notes ──

  getUserCareNotes(userId: number): Observable<UserNote[]> {
    return this.http.get<UserNote[]>(`${this.apiUrl}/user-care/users/${userId}/notes`);
  }

  createUserCareNote(userId: number, dto: CreateUserNoteDto): Observable<UserNote> {
    return this.http.post<UserNote>(`${this.apiUrl}/user-care/users/${userId}/notes`, dto);
  }

  updateUserCareNote(noteId: number, dto: UpdateUserNoteDto): Observable<UserNote> {
    return this.http.put<UserNote>(`${this.apiUrl}/user-care/notes/${noteId}`, dto);
  }

  deleteUserCareNote(noteId: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/user-care/notes/${noteId}`);
  }

  // ── Customer-care: cleaning photos (admin-only, last 2 orders kept) ──

  getUserCleaningPhotos(userId: number): Observable<UserCleaningPhotosByOrder[]> {
    return this.http.get<UserCleaningPhotosByOrder[]>(`${this.apiUrl}/user-care/users/${userId}/cleaning-photos`);
  }

  uploadUserCleaningPhoto(userId: number, file: File, orderId?: number, caption?: string): Observable<UserCleaningPhotoUploadResult> {
    const formData = new FormData();
    formData.append('file', file);
    let params = new HttpParams();
    if (orderId != null) params = params.set('orderId', orderId.toString());
    if (caption) params = params.set('caption', caption);
    return this.http.post<UserCleaningPhotoUploadResult>(
      `${this.apiUrl}/user-care/users/${userId}/cleaning-photos`,
      formData,
      { params }
    );
  }

  deleteUserCleaningPhoto(photoId: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/user-care/cleaning-photos/${photoId}`);
  }

  // ── Order-scoped cleaning photos (shared with the per-user library) ──

  getOrderCleaningPhotos(orderId: number): Observable<UserCleaningPhoto[]> {
    return this.http.get<UserCleaningPhoto[]>(`${this.apiUrl}/user-care/orders/${orderId}/cleaning-photos`);
  }

  uploadOrderCleaningPhoto(orderId: number, file: File, caption?: string): Observable<UserCleaningPhotoUploadResult> {
    const formData = new FormData();
    formData.append('file', file);
    let params = new HttpParams();
    if (caption) params = params.set('caption', caption);
    return this.http.post<UserCleaningPhotoUploadResult>(
      `${this.apiUrl}/user-care/orders/${orderId}/cleaning-photos`,
      formData,
      { params }
    );
  }

  // ── Customer-care: communications log (backed by ClientInteractions) ──

  getUserCommunications(userId: number): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/user-care/users/${userId}/communications`);
  }

  createUserCommunication(
    userId: number,
    dto: { type: string; notes?: string; status?: string; clientName?: string }
  ): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/user-care/users/${userId}/communications`, {
      // Backend requires clientName; pass a placeholder if caller didn't supply one,
      // the controller overrides it with the actual user name on save.
      clientName: (dto.clientName && dto.clientName.trim()) || '—',
      type: dto.type,
      notes: dto.notes,
      status: dto.status || 'Pending'
    });
  }

  updateUserCommunication(
    id: number,
    dto: { type?: string; notes?: string | null; status?: string }
  ): Observable<any> {
    return this.http.put<any>(`${this.apiUrl}/user-care/communications/${id}`, dto);
  }

  deleteUserCommunication(id: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/user-care/communications/${id}`);
  }

  // ── Customer-care: tasks linked to a user ──

  getUserTasks(userId: number): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/user-care/users/${userId}/tasks`);
  }

  // Get detailed user information (optional - combines profile, orders, and apartments)
  getUserDetails(userId: number): Observable<DetailedUser> {
    return this.http.get<DetailedUser>(`${this.apiUrl}/users/${userId}/details`);
  }

  // Alternative: Get user profile information
  getUserProfile(userId: number): Observable<UserProfile> {
    return this.http.get<UserProfile>(`${this.apiUrl}/users/${userId}/profile`);
  }

  // Gift Card methods - FIX THE URLS (remove extra /admin)
  getAllGiftCards(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/gift-cards`); // NOT /admin/admin/gift-cards
  }

  getGiftCardDetails(id: number): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/gift-cards/${id}`);
  }

  toggleGiftCardStatus(id: number, action: 'activate' | 'deactivate'): Observable<any> {
    return this.http.post(`${this.apiUrl}/gift-cards/${id}/${action}`, {});
  }

  getEntityAuditHistory(entityType: string, entityId: number): Observable<AuditLog[]> {
    return this.http.get<AuditLog[]>(`${this.apiUrl}/audit-logs/${entityType}/${entityId}`);
  }
  
  // Get recent audit logs
  getRecentAuditLogs(days: number = 7): Observable<AuditLog[]> {
    return this.http.get<AuditLog[]>(`${this.apiUrl}/audit-logs?days=${days}`);
  }

  undoAuditLog(id: number): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/audit-logs/${id}/undo`, {});
  }

  redoAuditLog(id: number): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/audit-logs/${id}/redo`, {});
  }
  
  // Get user's complete update history
  getUserCompleteHistory(userId: number): Observable<AuditLog[]> {
    return this.http.get<AuditLog[]>(`${this.apiUrl}/users/${userId}/history`);
  }

  getGiftCardConfig(): Observable<any> {
    return this.http.get(`${this.apiUrl}/gift-card-config`);
  }

  uploadGiftCardBackground(file: File): Observable<any> {
    const formData = new FormData();
    formData.append('file', file);
    
    return this.http.post(`${this.apiUrl}/upload-gift-card-background`, formData);
  }

  getAssignedCleanersWithIds(orderId: number): Observable<AssignedCleanerAdmin[]> {
    return this.http.get<AssignedCleanerAdmin[]>(`${this.apiUrl}/orders/${orderId}/assigned-cleaners-with-ids`);
  }

  /** Returns assigned cleaners for ALL orders in one request, keyed by orderId (string). */
  getAssignedCleanersWithIdsBulk(): Observable<{ [orderId: string]: AssignedCleanerAdmin[] }> {
    return this.http.get<{ [orderId: string]: AssignedCleanerAdmin[] }>(
      `${this.apiUrl}/orders/assigned-cleaners-with-ids/bulk`
    );
  }

  /** Sends assignment emails only to cleaners who have not been emailed yet for this order. */
  sendCleanerAssignmentMails(orderId: number): Observable<{ emailsSent: number; message: string }> {
    return this.http.post<{ emailsSent: number; message: string }>(
      `${this.apiUrl}/orders/${orderId}/send-cleaner-assignment-mails`,
      {}
    );
  }

  /** Re-sends assignment email for one cleaner and restarts reminder flow only for that cleaner. */
  resendCleanerAssignmentMail(orderId: number, cleanerId: number): Observable<{ emailsSent: number; message: string }> {
    return this.http.post<{ emailsSent: number; message: string }>(
      `${this.apiUrl}/orders/${orderId}/cleaners/${cleanerId}/resend-assignment-mail`,
      {}
    );
  }
  
  getAssignedCleaners(orderId: number): Observable<string[]> {
    return this.http.get<string[]>(`${this.apiUrl}/orders/${orderId}/assigned-cleaners`);
  }

  // Poll Question Methods - use admin endpoint so all questions are returned (including inactive) for the service type
  getPollQuestions(serviceTypeId: number): Observable<PollQuestion[]> {
    return this.http.get<PollQuestion[]>(`${this.apiUrl}/poll-questions/by-service-type/${serviceTypeId}`);
  }
  
  createPollQuestion(pollQuestion: CreatePollQuestion): Observable<PollQuestion> {
    return this.http.post<PollQuestion>(`${this.apiUrl}/poll-questions`, pollQuestion);
  }
  
  updatePollQuestion(id: number, pollQuestion: Partial<PollQuestion>): Observable<any> {
    return this.http.put(`${this.apiUrl}/poll-questions/${id}`, pollQuestion);
  }
  
  deletePollQuestion(id: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/poll-questions/${id}`);
  }

  getOrderUpdateHistory(orderId: number): Observable<OrderUpdateHistory[]> {
    return this.http.get<OrderUpdateHistory[]>(`${this.apiUrl}/orders/${orderId}/update-history`);
  }

  /**
   * Record a non-Stripe payment (Zelle/Cash/Check/Other) for a single additional-amount row.
   * SuperAdmin only. Marks just that update-history row paid; the base order stays a Stripe order.
   */
  recordManualAdditionalPayment(
    orderId: number,
    historyId: number,
    paymentMethod: string,
    paymentReference: string | null,
    paymentNotes: string | null
  ): Observable<{ message: string; historyId: number; paymentMethod: string; paidAt: string; statusReactivated: boolean; status: string | null }> {
    return this.http.post<{ message: string; historyId: number; paymentMethod: string; paidAt: string; statusReactivated: boolean; status: string | null }>(
      `${this.apiUrl}/orders/${orderId}/update-history/${historyId}/record-manual-payment`,
      { paymentMethod, paymentReference, paymentNotes }
    );
  }

  /** SuperAdmin-only: switch an order between the Stripe (Normal) flow and a manual payment
   *  method. The backend re-routes the order (manual tracking fields, Pending/Active status,
   *  Stripe-fee accounting) and returns the resulting method + status to mirror locally. */
  updateOrderPaymentMethod(
    orderId: number,
    paymentMethod: string,
    paymentReference: string | null,
    paymentNotes: string | null
  ): Observable<{ message: string; paymentMethod: string; paymentReference: string | null; paymentNotes: string | null; status: string }> {
    return this.http.put<{ message: string; paymentMethod: string; paymentReference: string | null; paymentNotes: string | null; status: string }>(
      `${this.apiUrl}/orders/${orderId}/payment-method`,
      { paymentMethod, paymentReference, paymentNotes }
    );
  }

  // Re-send the booking confirmation (email + SMS) with the order's CURRENT date/time/address.
  // Used when an admin reschedules an order and the customer asks for an updated confirmation.
  resendConfirmation(orderId: number): Observable<{ message: string; emailSent: boolean; smsSent: boolean }> {
    return this.http.post<{ message: string; emailSent: boolean; smsSent: boolean }>(
      `${this.apiUrl}/orders/${orderId}/resend-confirmation`, {}
    );
  }

  /** Send payment reminder (email + SMS) for unpaid additional payment. */
  sendPaymentReminder(orderId: number): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/orders/${orderId}/send-payment-reminder`, {});
  }

  // One-shot re-send of the original payment-link email/SMS to the customer's current
  // account email/phone (used after an admin corrects a mistyped contact).
  sendPaymentLink(orderId: number, sendEmail: boolean, sendSms: boolean): Observable<{ message: string; sentToEmail?: string; sentToPhone?: string }> {
    return this.http.post<{ message: string; sentToEmail?: string; sentToPhone?: string }>(
      `${this.apiUrl}/orders/${orderId}/send-payment-link`,
      { sendEmail, sendSms }
    );
  }

  // ── SuperAdmin order transfer (move an order between customer accounts, undoable) ──

  transferOrder(orderId: number, targetUserId: number, notes?: string): Observable<OrderTransferInfo> {
    return this.http.post<OrderTransferInfo>(`${this.apiUrl}/orders/${orderId}/transfer`, { targetUserId, notes });
  }

  getOrderTransfers(orderId: number): Observable<OrderTransferInfo[]> {
    return this.http.get<OrderTransferInfo[]>(`${this.apiUrl}/orders/${orderId}/transfers`);
  }

  undoOrderTransfer(transferId: number): Observable<OrderTransferInfo> {
    return this.http.post<OrderTransferInfo>(`${this.apiUrl}/order-transfers/${transferId}/undo`, {});
  }

  sendUpdatedPayment(orderId: number): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/orders/${orderId}/send-updated-payment`, {});
  }

  // ── SuperAdmin refunds (admin-initiated only; nothing refunds automatically) ──

  getOrderRefunds(orderId: number): Observable<OrderRefundSummary> {
    return this.http.get<OrderRefundSummary>(`${this.apiUrl}/orders/${orderId}/refunds`);
  }

  /** amount omitted = refund the full remaining refundable balance. */
  refundOrder(orderId: number, amount: number | null, reason: string | null, sendEmail: boolean): Observable<RefundResult> {
    return this.http.post<RefundResult>(`${this.apiUrl}/orders/${orderId}/refund`, { amount, reason, sendEmail });
  }

  /** Import refunds issued outside the CRM (Stripe Dashboard). Idempotent; sends no email. */
  syncOrderRefunds(orderId: number): Observable<RefundSyncResult> {
    return this.http.post<RefundSyncResult>(`${this.apiUrl}/orders/${orderId}/sync-refunds`, {});
  }

  /** One-time sweep across orders with a card charge. Page through with afterOrderId. */
  backfillRefunds(limit = 200, afterOrderId?: number): Observable<RefundBackfillResult> {
    let params = new HttpParams().set('limit', String(limit));
    if (afterOrderId != null) params = params.set('afterOrderId', String(afterOrderId));
    return this.http.post<RefundBackfillResult>(`${this.apiUrl}/orders/sync-refunds/backfill`, {}, { params });
  }

  /** Manually send (or re-send) the customer's refund confirmation for one recorded refund. */
  sendRefundEmail(orderId: number, refundId: number): Observable<RefundResult> {
    return this.http.post<RefundResult>(`${this.apiUrl}/orders/${orderId}/refunds/${refundId}/send-email`, {});
  }

  /**
   * @param includeUpcoming folds the window's not-yet-performed orders (Active/Pending) into
   *   every total, turning the response into a projection of the period once everything
   *   already booked is done. Off = the confirmed, performed-orders-only report.
   * @param upcomingTo end date for the not-yet-performed COUNT only. A running period reports
   *   money up to today but its unfinished cleanings all sit after today, so the count needs
   *   the real period end. Defaults to `to`.
   */
  getOrderStatistics(
    from?: string,
    to?: string,
    includeUpcoming = false,
    upcomingTo?: string
  ): Observable<OrderStatistics> {
    let params = new HttpParams();
    if (from) params = params.set('from', from);
    if (to) params = params.set('to', to);
    if (includeUpcoming) params = params.set('includeUpcoming', 'true');
    if (upcomingTo) params = params.set('upcomingTo', upcomingTo);
    return this.http.get<OrderStatistics>(`${this.apiUrl}/statistics`, { params });
  }

  getDailyStatistics(from?: string, to?: string): Observable<DailyStatistics[]> {
    let params = new HttpParams();
    if (from) params = params.set('from', from);
    if (to) params = params.set('to', to);
    return this.http.get<DailyStatistics[]>(`${this.apiUrl}/statistics/daily`, { params });
  }

  /** Per-month locked GEL→USD rates (auto-fetched, SuperAdmin-overridable). */
  getFinancialRates(from?: string, to?: string): Observable<MonthlyFinancialRate[]> {
    let params = new HttpParams();
    if (from) params = params.set('from', from);
    if (to) params = params.set('to', to);
    return this.http.get<MonthlyFinancialRate[]>(`${this.apiUrl}/statistics/financial-rates`, { params });
  }

  /** Manually override a month's GEL→USD rate. */
  setFinancialRate(year: number, month: number, usdPerGel: number): Observable<MonthlyFinancialRate> {
    return this.http.put<MonthlyFinancialRate>(
      `${this.apiUrl}/statistics/financial-rates/${year}/${month}`,
      { usdPerGel }
    );
  }

  /** Discard a manual override and re-fetch the auto rate for a month. */
  refetchFinancialRate(year: number, month: number): Observable<MonthlyFinancialRate> {
    return this.http.post<MonthlyFinancialRate>(
      `${this.apiUrl}/statistics/financial-rates/${year}/${month}/refetch`,
      {}
    );
  }

  // Order Reminder Acknowledgment (cross-admin sync)
  acknowledgeOrderReminder(orderId: number, type: 'start' | 'end'): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(
      `${this.apiUrl}/orders/${orderId}/acknowledge-reminder`, { type }
    );
  }

  getActiveOrderReminders(): Observable<{ orderId: number; type: string; triggeredAt: string }[]> {
    return this.http.get<{ orderId: number; type: string; triggeredAt: string }[]>(
      `${this.apiUrl}/orders/active-reminders`
    );
  }

  // Authoritative set of reminders already acknowledged by any admin (DB-backed).
  // Used as the safety net so an acknowledged reminder never re-appears for anyone.
  getAcknowledgedReminders(): Observable<{ orderId: number; type: string }[]> {
    return this.http.get<{ orderId: number; type: string }[]>(
      `${this.apiUrl}/orders/acknowledged-reminders`
    );
  }

  // New Order Notifications
  getUnviewedNewOrders(): Observable<number[]> {
    return this.http.get<number[]>(`${this.apiUrl}/orders/unviewed-new`);
  }

  markOrderViewed(orderId: number): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(
      `${this.apiUrl}/orders/${orderId}/mark-viewed`, {}
    );
  }

  // Blocked Time Slots (Scheduling)
  getBlockedTimeSlots(from?: string, to?: string): Observable<any[]> {
    let url = `${this.apiUrl}/blocked-time-slots`;
    const params: string[] = [];
    if (from) params.push(`from=${from}`);
    if (to) params.push(`to=${to}`);
    if (params.length) url += '?' + params.join('&');
    return this.http.get<any[]>(url);
  }

  createBlockedTimeSlot(dto: { date: string; isFullDay: boolean; blockedHours?: string; reason?: string }): Observable<any> {
    return this.http.post(`${this.apiUrl}/blocked-time-slots`, dto);
  }

  updateBlockedTimeSlot(id: number, dto: { date: string; isFullDay: boolean; blockedHours?: string; reason?: string }): Observable<any> {
    return this.http.put(`${this.apiUrl}/blocked-time-slots/${id}`, dto);
  }

  deleteBlockedTimeSlot(id: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/blocked-time-slots/${id}`);
  }

  refreshTokenIfNeeded(): Observable<any> {
    // This will trigger the auth interceptor to refresh the token if needed
    return this.http.get(`${environment.apiUrl}/auth/current-user`);
  }

  // ─── Loyalty Discount ──────────────────────────────────────────────────────────────
  // User-scoped endpoints (View for read, Update for write — Moderator can read only).
  // Used by the booking page admin-on-behalf flow (Phase 6) and the upcoming Account
  // section in user-details (Phase 7).

  getUserLoyaltyDiscount(userId: number): Observable<LoyaltyDiscountDto> {
    return this.http.get<LoyaltyDiscountDto>(`${this.apiUrl}/users/${userId}/loyalty-discount`);
  }

  setUserLoyaltyDiscount(userId: number, percentage: number): Observable<LoyaltyDiscountDto> {
    return this.http.put<LoyaltyDiscountDto>(
      `${this.apiUrl}/users/${userId}/loyalty-discount`,
      { percentage }
    );
  }

  clearUserLoyaltyDiscount(userId: number): Observable<LoyaltyDiscountDto> {
    return this.http.delete<LoyaltyDiscountDto>(`${this.apiUrl}/users/${userId}/loyalty-discount`);
  }

  getLoyaltyDiscountSettings(): Observable<LoyaltyDiscountSettingsDto> {
    return this.http.get<LoyaltyDiscountSettingsDto>(`${this.apiUrl}/loyalty-discount-settings`);
  }

  updateLoyaltyDiscountSettings(settings: LoyaltyDiscountSettingsDto): Observable<LoyaltyDiscountSettingsDto> {
    return this.http.put<LoyaltyDiscountSettingsDto>(`${this.apiUrl}/loyalty-discount-settings`, settings);
  }
}