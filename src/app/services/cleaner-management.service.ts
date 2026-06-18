import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type CleanerRanking = 'Top' | 'Standard' | 'Beginner' | 'Restricted' | 'NoExp';
export type CleanerDocumentType = 'IdCard' | 'Passport' | 'DriverLicense';

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
  location?: string | null;
  /** Recurring weekdays the cleaner is busy (0=Sun … 6=Sat). */
  busyDaysOfWeek: number[];
  alreadyWorkedWithUs: boolean;
  nationality?: string | null;
  ranking: CleanerRanking | number;
  mainNote?: string | null;
  photoUrl?: string | null;
  isActive: boolean;
  createdAt: string;
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
