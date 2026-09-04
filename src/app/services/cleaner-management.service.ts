import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type CleanerRanking = 'Top' | 'Standard' | 'Beginner' | 'Restricted' | 'NoExp';
export type CleanerDocumentType = 'IdCard' | 'Passport' | 'DriverLicense';

/**
 * How a cleaner is paid their WAGES — not how a customer paid us (that is the separate
 * PaymentMethod on an order). Mirrors CleanerPaymentMethod.cs; the numbers are the enum's
 * stored values, and the API accepts either the name or the number.
 */
export type CleanerPaymentMethod = 'Zelle' | 'Cash' | 'Check' | 'Other';

export const CLEANER_PAYMENT_METHOD_INDEX: Record<CleanerPaymentMethod, number> = {
  Zelle: 1,
  Cash: 2,
  Check: 3,
  Other: 4
};

/** Numeric enum value → name, for reading a cleaner back off the API. */
export function normalizeCleanerPaymentMethod(
  value: CleanerPaymentMethod | number | null | undefined
): CleanerPaymentMethod | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value as CleanerPaymentMethod;
  const found = (Object.keys(CLEANER_PAYMENT_METHOD_INDEX) as CleanerPaymentMethod[])
    .find(k => CLEANER_PAYMENT_METHOD_INDEX[k] === value);
  return found ?? null;
}

/**
 * The label shown next to the details field, per method. "Zelle number or email" and "Pay to
 * the order of" are different enough that one generic placeholder would read as a mistake.
 */
export const CLEANER_PAYMENT_DETAILS_LABEL: Record<CleanerPaymentMethod, string> = {
  Zelle: 'Zelle number or email',
  Cash: 'Cash handover note',
  Check: 'Check payable to',
  Other: 'Payment details'
};

export interface CleanerListItem {
  id: number;
  firstName: string;
  lastName: string;
  age?: number | null;
  experience?: string | null;
  isExperienced: boolean;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  /** Borough the cleaner lives in (single). */
  location?: string | null;
  /** Boroughs the cleaner works in, CSV e.g. "Brooklyn,Queens". */
  operatingAreas?: string | null;
  /** Recurring weekdays the cleaner is busy (0=Sun … 6=Sat). */
  busyDaysOfWeek: number[];
  alreadyWorkedWithUs: boolean;
  nationality?: string | null;
  ranking: CleanerRanking | number;
  mainNote?: string | null;
  photoUrl?: string | null;
  isActive: boolean;
  createdAt: string;
  /** How this cleaner is paid their wages. Optional — blank is normal. */
  paymentMethod?: CleanerPaymentMethod | number | null;
  /** Zelle number/email, who a check is written to, etc. Optional. */
  paymentDetails?: string | null;
}

export interface CleanerVacation {
  id?: number | null;
  startDate: string;
  endDate: string;
  note?: string | null;
}

export interface CleanerNote {
  id: number;
  cleanerId: number;
  adminId?: number | null;
  adminDisplayName?: string | null;
  text: string;
  orderId?: number | null;
  orderPerformance?: string | null;
  createdAt: string;
}

export interface CleanerAssignedOrder {
  orderId: number;
  serviceDate: string;
  serviceTime: string;
  serviceAddress?: string | null;
  serviceCity?: string | null;
  serviceTypeName?: string | null;
  status: string;
  assignedAt: string;
  assignmentNotificationSentAt?: string | null;
}

export interface UpsertOrderPerformancePayload {
  orderId: number;
  performance?: string | null;
  text?: string | null;
}

export interface CleanerDetail extends CleanerListItem {
  restrictedReason?: string | null;
  allergies?: string | null;
  restrictions?: string | null;
  mainNote?: string | null;
  documentUrl?: string | null;
  documentType?: CleanerDocumentType | number | null;
  createdAt: string;
  updatedAt?: string | null;
  createdByAdminId?: number | null;
  createdByAdminName?: string | null;
  notes: CleanerNote[];
  assignedOrders: CleanerAssignedOrder[];
  vacations: CleanerVacation[];

  // ── The login account behind this cleaner (Cleaner.UserId), managed on the admin Cleaners tab ──
  linkedUserId?: number | null;
  linkedAccountName?: string | null;
  /** The address that account signs in with; null for a no-email account. */
  linkedAccountEmail?: string | null;
  /**
   * Whether Email is read-only on this record. The SERVER decides
   * (CleanerAccountLink.EmailIsManagedByAccount) and this is rendered as given - the same
   * predicate rejects the write, so a client-side copy of the rule could only disagree with what
   * the API will accept.
   */
  isEmailManagedByAccount?: boolean;
}

export interface CreateCleanerPayload {
  firstName: string;
  lastName: string;
  age?: number | null;
  experience?: string | null;
  isExperienced?: boolean;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  location?: string | null;
  operatingAreas?: string | null;
  busyDaysOfWeek: number[];
  vacations: CleanerVacation[];
  alreadyWorkedWithUs?: boolean;
  nationality?: string | null;
  ranking?: CleanerRanking | number;
  restrictedReason?: string | null;
  allergies?: string | null;
  restrictions?: string | null;
  mainNote?: string | null;
  documentType?: CleanerDocumentType | number | null;
  paymentMethod?: CleanerPaymentMethod | number | null;
  paymentDetails?: string | null;
}

export interface UpdateCleanerPayload extends CreateCleanerPayload {
  isActive: boolean;
}

export interface CreateCleanerNotePayload {
  text: string;
  orderId?: number | null;
  orderPerformance?: string | null;
}

export interface CleanerImageUploadResult {
  url: string;
  sizeBytes: number;
}

@Injectable({ providedIn: 'root' })
export class CleanerManagementService {
  private apiUrl = `${environment.apiUrl}/admin/cleaners`;

  constructor(private http: HttpClient) {}

  getAll(options: { includeInactive?: boolean; search?: string } = {}): Observable<CleanerListItem[]> {
    let params = new HttpParams();
    if (options.includeInactive) params = params.set('includeInactive', 'true');
    if (options.search && options.search.trim()) params = params.set('search', options.search.trim());
    return this.http.get<CleanerListItem[]>(this.apiUrl, { params });
  }

  getById(id: number): Observable<CleanerDetail> {
    return this.http.get<CleanerDetail>(`${this.apiUrl}/${id}`);
  }

  create(payload: CreateCleanerPayload): Observable<CleanerDetail> {
    return this.http.post<CleanerDetail>(this.apiUrl, payload);
  }

  update(id: number, payload: UpdateCleanerPayload): Observable<CleanerDetail> {
    return this.http.put<CleanerDetail>(`${this.apiUrl}/${id}`, payload);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }

  addNote(cleanerId: number, payload: CreateCleanerNotePayload): Observable<CleanerNote> {
    return this.http.post<CleanerNote>(`${this.apiUrl}/${cleanerId}/notes`, payload);
  }

  updateNote(noteId: number, payload: { text: string }): Observable<CleanerNote> {
    return this.http.put<CleanerNote>(`${this.apiUrl}/notes/${noteId}`, payload);
  }

  deleteNote(noteId: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/notes/${noteId}`);
  }

  upsertOrderPerformance(cleanerId: number, payload: UpsertOrderPerformancePayload): Observable<CleanerNote | null> {
    return this.http.post<CleanerNote | null>(`${this.apiUrl}/${cleanerId}/order-performance`, payload);
  }

  uploadPhoto(cleanerId: number, file: File): Observable<CleanerImageUploadResult> {
    const formData = new FormData();
    formData.append('file', file, file.name);
    return this.http.post<CleanerImageUploadResult>(`${this.apiUrl}/${cleanerId}/photo`, formData);
  }

  uploadDocument(cleanerId: number, file: File): Observable<CleanerImageUploadResult> {
    const formData = new FormData();
    formData.append('file', file, file.name);
    return this.http.post<CleanerImageUploadResult>(`${this.apiUrl}/${cleanerId}/document`, formData);
  }

  static rankingLabel(ranking: CleanerRanking | number): string {
    const map: Record<string, string> = {
      '0': 'Top',
      '1': 'Standard',
      '2': 'Beginner',
      '3': 'Restricted',
      '4': 'NoExp',
      'Top': 'Top',
      'Standard': 'Standard',
      'Beginner': 'Beginner',
      'Restricted': 'Restricted',
      'NoExp': 'NoExp'
    };
    return map[String(ranking)] ?? 'Standard';
  }
}
