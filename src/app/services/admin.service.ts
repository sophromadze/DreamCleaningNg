import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { ServiceType, Service, ExtraService, Subscription } from './booking.service';
import { Order, OrderList } from './order.service';
import { Apartment, CreateApartment } from './profile.service';
import { UserSpecialOffer } from './special-offer.service';

export interface OrderStatistics {
  totalOrders: number;
  totalAmount: number;
  totalTaxes: number;
  totalTips: number;
  totalCleanersSalary: number;
  totalCompanyRevenue: number;
}

export interface DailyStatistics {
  date: string;
  orders: number;
  amount: number;
  taxes: number;
  tips: number;
  cleanersSalary: number;
  companyRevenue: number;
}

export interface AdminOrderList {
  id: number;
  userId: number;
  contactEmail: string;
  contactFirstName: string;
  contactLastName: string;
  serviceTypeName: string;
  serviceDate: Date;
  serviceTime: string;
  status: string;
  total: number;
  serviceAddress: string;
  orderDate: Date;
  totalDuration: number;
  tips: number;
  companyDevelopmentTips: number;
  cancellationReason?: string;
  isLateCancellation?: boolean;
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
}

export interface UserPermissions {
  role: string;
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

export interface UserAdmin {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
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
  /** True if user has an active connection (on site). */
  isOnline?: boolean;

  // ── Customer-care snapshot fields populated by the backend list endpoint ──
  /** Service date of the user's most recent non-cancelled order. */
  lastCleaningDate?: string | Date | null;
  /** Service type name of the user's most recent non-cancelled order. */
  lastCleaningServiceType?: string | null;
  lastBedrooms?: number | null;
  lastBathrooms?: number | null;
  /** Most recent follow-up note content (preview) for the table. */
  lastFollowUpNote?: string | null;
  /** Most recent follow-up note's "next offer" suggestion (preview) for the table. */
  nextOfferHint?: string | null;
  /** Total number of non-cancelled orders this user has placed. */
  totalOrdersCount?: number;
}

// ── Customer-care notes & photos ──

export interface UserNote {
  id: number;
  userId: number;
  type: 'General' | 'FollowUp';
  content: string;
  nextOffer?: string | null;
  createdByAdminId?: number | null;
  createdByAdminName?: string | null;
  createdAt: string;
  updatedAt?: string | null;
}

export interface CreateUserNoteDto {
  type: 'General' | 'FollowUp';
  content: string;
  nextOffer?: string | null;
}

export interface UpdateUserNoteDto {
  content: string;
  nextOffer?: string | null;
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
  email: string;
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
  entryMethod?: string | null;
  specialInstructions?: string | null;
  floorTypes?: string | null;
  floorTypeOther?: string | null;
  tips?: number | null;
  companyDevelopmentTips?: number | null;
  status?: string | null;
  cancellationReason?: string | null;
  subTotal?: number | null;
  tax?: number | null;
  total?: number | null;
  discountAmount?: number | null;
  subscriptionDiscountAmount?: number | null;
  cleanerHourlyRate?: number | null;
  cleanerTotalSalary?: number | null;
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
  isCustom?: boolean;
}

export interface UpdateServiceType {
  name: string;
  basePrice: number;
  description?: string;
  displayOrder: number;
  timeDuration: number;
  hasPoll?: boolean; 
  isCustom?: boolean;
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

  registerUser(userData: { firstName: string; lastName: string; email: string; phone?: string }): Observable<any> {
    return this.http.post(`${this.apiUrl}/users/register`, userData);
  }

  updateUserRole(userId: number, role: string): Observable<any> {
    return this.http.put(`${this.apiUrl}/users/${userId}/role`, { role });
  }

  updateUserStatus(userId: number, isActive: boolean): Observable<any> {
    return this.http.put(`${this.apiUrl}/users/${userId}/status`, { isActive });
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

  /** SuperAdmin-only: full user update. All changes are audit-logged. */
  superAdminFullUpdateUser(userId: number, dto: SuperAdminUpdateUserDto): Observable<any> {
    return this.http.put(`${this.apiUrl}/users/${userId}/superadmin-full-update`, dto);
  }

  deleteUser(userId: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/users/${userId}`);
  }

  /** SuperAdmin-only: full order update. All changes are audit-logged. */
  superAdminFullUpdateOrder(orderId: number, dto: SuperAdminUpdateOrderDto): Observable<any> {
    return this.http.put(`${this.apiUrl}/orders/${orderId}/superadmin-full-update`, dto);
  }

  /** Admin-only: submit proposed order changes for SuperAdmin approval. */
  submitPendingOrderEdit(orderId: number, dto: SuperAdminUpdateOrderDto): Observable<PendingOrderEditListDto> {
    return this.http.post<PendingOrderEditListDto>(`${this.apiUrl}/orders/${orderId}/pending-edit`, dto);
  }

  /** SuperAdmin-only: list pending order edits. */
  getPendingOrderEdits(): Observable<PendingOrderEditListDto[]> {
    return this.http.get<PendingOrderEditListDto[]>(`${this.apiUrl}/orders/pending-edits`);
  }

  /** SuperAdmin-only: get one pending edit with current order and proposed changes. */
  getPendingOrderEditDetail(id: number): Observable<PendingOrderEditDetailDto> {
    return this.http.get<PendingOrderEditDetailDto>(`${this.apiUrl}/orders/pending-edits/${id}`);
  }

  /** SuperAdmin-only: approve and apply a pending order edit. */
  approvePendingOrderEdit(id: number): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/orders/pending-edits/${id}/approve`, {});
  }

  /** SuperAdmin-only: reject a pending order edit. */
  rejectPendingOrderEdit(id: number, rejectReason?: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/orders/pending-edits/${id}/reject`, { rejectReason });
  }

  // Orders Management
  getAllOrders(): Observable<AdminOrderList[]> {
    // Note: Just use /orders, not /admin/orders because apiUrl already includes /admin
    return this.http.get<AdminOrderList[]>(`${this.apiUrl}/orders`);
  }

  getOrderDetails(orderId: number): Observable<Order> {
    return this.http.get<Order>(`${this.apiUrl}/orders/${orderId}`);
  }

  updateOrderStatus(orderId: number, status: string): Observable<any> {
    return this.http.put(`${this.apiUrl}/orders/${orderId}/status`, { status });
  }

  cancelOrder(orderId: number, reason: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/orders/${orderId}/cancel`, { reason });
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

  // ── Customer-care: notes (multi-row, type=General|FollowUp) ──

  getUserCareNotes(userId: number, type?: 'General' | 'FollowUp'): Observable<UserNote[]> {
    let params = new HttpParams();
    if (type) params = params.set('type', type);
    return this.http.get<UserNote[]>(`${this.apiUrl}/user-care/users/${userId}/notes`, { params });
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

  /** Send payment reminder (email + SMS) for unpaid additional payment. */
  sendPaymentReminder(orderId: number): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/orders/${orderId}/send-payment-reminder`, {});
  }

  getOrderStatistics(from?: string, to?: string): Observable<OrderStatistics> {
    let params = new HttpParams();
    if (from) params = params.set('from', from);
    if (to) params = params.set('to', to);
    return this.http.get<OrderStatistics>(`${this.apiUrl}/statistics`, { params });
  }

  getDailyStatistics(from?: string, to?: string): Observable<DailyStatistics[]> {
    let params = new HttpParams();
    if (from) params = params.set('from', from);
    if (to) params = params.set('to', to);
    return this.http.get<DailyStatistics[]>(`${this.apiUrl}/statistics/daily`, { params });
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
}