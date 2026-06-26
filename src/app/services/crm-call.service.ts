import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// ── Interfaces ──

export type CallCategory = 'Customer' | 'Cleaner' | 'Spam' | 'Unknown';

export interface CallRecord {
  id: number;
  provider: string;
  externalId: string;
  sessionId?: string;
  direction: string;
  result: string;
  fromNumber?: string;
  fromName?: string;
  toNumber?: string;
  startTimeUtc: string;
  durationSeconds: number;
  recordingUrl?: string;
  leadId?: number;
  leadName?: string;
  category: CallCategory;
  /** Independent of category: call was placed to the dedicated Google Ads tracking number. */
  isAdCall: boolean;
  matchedCleanerId?: number;
  matchedCleanerName?: string;
  createdAt: string;
}

export interface CallListResult {
  items: CallRecord[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export interface CallDayCount {
  date: string;
  total: number;
  answered: number;
  missed: number;
}

export interface CallSummary {
  total: number;
  answered: number;
  missed: number;
  inbound: number;
  answerRate: number;
  customer: number;
  cleaner: number;
  spam: number;
  unknown: number;
  adCall: number;
  perDay: CallDayCount[];
}

export interface ReclassifyResult {
  reclassified: number;
  customer: number;
  cleaner: number;
  spam: number;
  unknown: number;
  adCall: number;
}

export interface CallFilters {
  from?: string;
  to?: string;
  direction?: string;
  category?: string;
  excludeNonCustomer?: boolean;
  adOnly?: boolean;
  page?: number;
  pageSize?: number;
}

// ── Service ──

@Injectable({ providedIn: 'root' })
export class CrmCallService {
  private apiUrl = `${environment.apiUrl}/admin/calls`;

  constructor(private http: HttpClient) {}

  getCalls(filters?: CallFilters): Observable<CallListResult> {
    let params = new HttpParams();
    if (filters?.from) params = params.set('from', filters.from);
    if (filters?.to) params = params.set('to', filters.to);
    if (filters?.direction) params = params.set('direction', filters.direction);
    if (filters?.category) params = params.set('category', filters.category);
    if (filters?.excludeNonCustomer) params = params.set('excludeNonCustomer', true);
    if (filters?.adOnly) params = params.set('adOnly', true);
    if (filters?.page != null) params = params.set('page', filters.page);
    if (filters?.pageSize != null) params = params.set('pageSize', filters.pageSize);
    return this.http.get<CallListResult>(this.apiUrl, { params });
  }

  getSummary(filters?: { from?: string; to?: string; direction?: string }): Observable<CallSummary> {
    let params = new HttpParams();
    if (filters?.from) params = params.set('from', filters.from);
    if (filters?.to) params = params.set('to', filters.to);
    if (filters?.direction) params = params.set('direction', filters.direction);
    return this.http.get<CallSummary>(`${this.apiUrl}/summary`, { params });
  }

  exportExcel(filters?: { from?: string; to?: string; direction?: string; category?: string; excludeNonCustomer?: boolean; adOnly?: boolean }): Observable<Blob> {
    let params = new HttpParams();
    if (filters?.from) params = params.set('from', filters.from);
    if (filters?.to) params = params.set('to', filters.to);
    if (filters?.direction) params = params.set('direction', filters.direction);
    if (filters?.category) params = params.set('category', filters.category);
    if (filters?.excludeNonCustomer) params = params.set('excludeNonCustomer', true);
    if (filters?.adOnly) params = params.set('adOnly', true);
    return this.http.get(`${this.apiUrl}/export`, { params, responseType: 'blob' });
  }

  reclassify(): Observable<ReclassifyResult> {
    return this.http.post<ReclassifyResult>(`${this.apiUrl}/reclassify`, {});
  }
}
