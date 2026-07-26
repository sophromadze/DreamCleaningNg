import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type KeywordsPeriod = 'last30' | 'week' | 'month' | 'year' | 'all' | 'custom';

export interface OrganicKeywordRow {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;         // percent
  avgPosition: number;
}

export interface OrganicTotals {
  queries: number;
  clicks: number;
  impressions: number;
  ctr: number;
}

export interface OrganicKeywordResponse {
  from: string;
  to: string;
  items: OrganicKeywordRow[];
  totals: OrganicTotals;
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export interface PaidKeywordRow {
  searchTerm: string;
  clicks: number;
  impressions: number;
  costUsd: number;
  conversions: number;
  cpc: number;
}

export interface PaidTotals {
  terms: number;
  clicks: number;
  impressions: number;
  costUsd: number;
  conversions: number;
}

export interface PaidKeywordResponse {
  from: string;
  to: string;
  items: PaidKeywordRow[];
  totals: PaidTotals;
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export interface KeywordsQuery {
  period?: KeywordsPeriod;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

@Injectable({ providedIn: 'root' })
export class CrmKeywordsService {
  private apiUrl = `${environment.apiUrl}/crm/keywords`;

  constructor(private http: HttpClient) {}

  getOrganic(q: KeywordsQuery): Observable<OrganicKeywordResponse> {
    return this.http.get<OrganicKeywordResponse>(`${this.apiUrl}/organic`, { params: this.toParams(q) });
  }

  getPaid(q: KeywordsQuery): Observable<PaidKeywordResponse> {
    return this.http.get<PaidKeywordResponse>(`${this.apiUrl}/paid`, { params: this.toParams(q) });
  }

  exportExcel(q: KeywordsQuery): Observable<Blob> {
    const { page, pageSize, ...rangeOnly } = q;
    return this.http.get(`${this.apiUrl}/export`, { params: this.toParams(rangeOnly), responseType: 'blob' });
  }

  private toParams(q: KeywordsQuery): HttpParams {
    let params = new HttpParams();
    if (q.period && q.period !== 'custom') params = params.set('period', q.period);
    if (q.from) params = params.set('from', q.from);
    if (q.to) params = params.set('to', q.to);
    if (q.page != null) params = params.set('page', q.page);
    if (q.pageSize != null) params = params.set('pageSize', q.pageSize);
    return params;
  }
}
