import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type AdsPeriod = 'last30' | 'week' | 'month' | 'year' | 'all' | 'custom';

export interface AdsDailyRow {
  date: string;
  adSpend: number;
  clicks: number;
  googleConversions: number;
  bookedOrders: number;
  googleConversionRate: number;   // conversions ÷ clicks, percent
  bookedConversionRate: number;   // booked orders ÷ clicks, percent
}

export interface AdsTotals {
  adSpend: number;
  clicks: number;
  googleConversions: number;
  bookedOrders: number;
  googleConversionRate: number;
  bookedConversionRate: number;
}

export interface AdsDailyResponse {
  from: string;
  to: string;
  items: AdsDailyRow[];
  totals: AdsTotals;
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export interface AdsQuery {
  period?: AdsPeriod;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

@Injectable({ providedIn: 'root' })
export class CrmAdsService {
  private apiUrl = `${environment.apiUrl}/crm/ads`;

  constructor(private http: HttpClient) {}

  getDaily(q: AdsQuery): Observable<AdsDailyResponse> {
    return this.http.get<AdsDailyResponse>(`${this.apiUrl}/daily`, { params: this.toParams(q) });
  }

  exportExcel(q: AdsQuery): Observable<Blob> {
    // Export ignores paging on purpose — the whole resolved range goes into the file.
    const { page, pageSize, ...rangeOnly } = q;
    return this.http.get(`${this.apiUrl}/export`, { params: this.toParams(rangeOnly), responseType: 'blob' });
  }

  private toParams(q: AdsQuery): HttpParams {
    let params = new HttpParams();
    // 'custom' is implied by sending from/to; don't send it as a period (backend treats it as custom).
    if (q.period && q.period !== 'custom') params = params.set('period', q.period);
    if (q.from) params = params.set('from', q.from);
    if (q.to) params = params.set('to', q.to);
    if (q.page != null) params = params.set('page', q.page);
    if (q.pageSize != null) params = params.set('pageSize', q.pageSize);
    return params;
  }
}
