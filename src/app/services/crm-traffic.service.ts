import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type TrafficPeriod = 'last30' | 'week' | 'month' | 'year' | 'all' | 'custom';

export interface TrafficChannelCount {
  channel: string;
  count: number;
}

export interface TrafficDailyRow {
  date: string;
  sessions: number;
  channels: TrafficChannelCount[];
  provisional: boolean; // still raw first-party (not yet reconciled to GA4)
}

export interface TrafficTotals {
  sessions: number;
}

export interface TrafficChannelBreakdownRow {
  channel: string;
  sessions: number;
  percentOfTotal: number;
}

export interface TrafficDailyResponse {
  from: string;
  to: string;
  items: TrafficDailyRow[];
  series: TrafficDailyRow[]; // full unpaged daily rows (oldest→newest) for the trend chart
  totals: TrafficTotals;
  channelBreakdown: TrafficChannelBreakdownRow[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export interface TrafficQuery {
  period?: TrafficPeriod;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
  channels?: string; // export-only: mirrors the on-screen channel filter ('' = none)
}

@Injectable({ providedIn: 'root' })
export class CrmTrafficService {
  private apiUrl = `${environment.apiUrl}/crm/traffic`;

  constructor(private http: HttpClient) {}

  getDaily(q: TrafficQuery): Observable<TrafficDailyResponse> {
    return this.http.get<TrafficDailyResponse>(`${this.apiUrl}/daily`, { params: this.toParams(q) });
  }

  exportExcel(q: TrafficQuery): Observable<Blob> {
    const { page, pageSize, ...rangeOnly } = q;
    return this.http.get(`${this.apiUrl}/export`, { params: this.toParams(rangeOnly), responseType: 'blob' });
  }

  private toParams(q: TrafficQuery): HttpParams {
    let params = new HttpParams();
    if (q.period && q.period !== 'custom') params = params.set('period', q.period);
    if (q.from) params = params.set('from', q.from);
    if (q.to) params = params.set('to', q.to);
    if (q.page != null) params = params.set('page', q.page);
    if (q.pageSize != null) params = params.set('pageSize', q.pageSize);
    if (q.channels != null) params = params.set('channels', q.channels);
    return params;
  }
}
