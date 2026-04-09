import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface ScheduledSmsDto {
  id: number;
  content: string;
  targetRoles: string;
  scheduleType: number;
  scheduledDate?: string | null;
  scheduledTime?: string | null;
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  weekOfMonth?: number | null;
  frequency?: number | null;
  scheduleTimezone: string;
  status: number;
  createdById: number;
  createdByEmail?: string | null;
  createdAt: string;
  updatedAt: string;
  sentAt?: string | null;
  lastSentAt?: string | null;
  nextScheduledAt?: string | null;
  recipientCount: number;
  timesSent: number;
  isActive: boolean;
}

export interface CreateScheduledSmsDto {
  content: string;
  targetRoles: string;
  scheduleType: number;
  scheduledDate?: string | null;
  scheduledTime?: string | null;
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  weekOfMonth?: number | null;
  frequency?: number | null;
  scheduleTimezone: string;
  sendNow: boolean;
}

export interface UpdateScheduledSmsDto {
  content?: string;
  targetRoles?: string;
  scheduleType?: number;
  scheduledDate?: string | null;
  scheduledTime?: string | null;
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  weekOfMonth?: number | null;
  frequency?: number | null;
  scheduleTimezone?: string;
  isActive?: boolean;
}

export interface SmsUserCountDto {
  role: string;
  total: number;
  canReceive: number;
  withValidPhone: number;
}

export interface SmsStatsDto {
  draftCount: number;
  scheduledCount: number;
  sentCount: number;
  totalSmsSent: number;
}

@Injectable({ providedIn: 'root' })
export class ScheduledSmsService {
  private api = `${environment.apiUrl}/Admin/sms`;

  constructor(private http: HttpClient) {}

  getList(status?: number): Observable<ScheduledSmsDto[]> {
    const q = status != null ? `?status=${status}` : '';
    return this.http.get<ScheduledSmsDto[]>(`${this.api}${q}`);
  }

  get(id: number): Observable<ScheduledSmsDto> {
    return this.http.get<ScheduledSmsDto>(`${this.api}/${id}`);
  }

  create(dto: CreateScheduledSmsDto): Observable<ScheduledSmsDto> {
    return this.http.post<ScheduledSmsDto>(this.api, dto);
  }

  update(id: number, dto: UpdateScheduledSmsDto): Observable<ScheduledSmsDto> {
    return this.http.put<ScheduledSmsDto>(`${this.api}/${id}`, dto);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.api}/${id}`);
  }

  sendNow(id: number): Observable<ScheduledSmsDto> {
    return this.http.post<ScheduledSmsDto>(`${this.api}/${id}/send`, {});
  }

  disable(id: number): Observable<ScheduledSmsDto> {
    return this.http.post<ScheduledSmsDto>(`${this.api}/${id}/disable`, {});
  }

  enable(id: number): Observable<ScheduledSmsDto> {
    return this.http.post<ScheduledSmsDto>(`${this.api}/${id}/enable`, {});
  }

  getStats(): Observable<SmsStatsDto> {
    return this.http.get<SmsStatsDto>(`${this.api}/stats`);
  }

  getUserCounts(): Observable<SmsUserCountDto[]> {
    return this.http.get<SmsUserCountDto[]>(`${this.api}/user-counts`);
  }
}
