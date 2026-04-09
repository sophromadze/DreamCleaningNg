import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

const ROLES = ['Customer', 'Cleaner', 'Admin', 'SuperAdmin', 'Moderator'] as const;
export type MailRole = typeof ROLES[number];

export interface ScheduledMailDto {
  id: number;
  subject: string;
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

export interface CreateScheduledMailDto {
  subject: string;
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

export interface UpdateScheduledMailDto {
  subject?: string;
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

export interface MailUserCountDto {
  role: string;
  total: number;
  canReceive: number;
}

export interface MailStatsDto {
  draftCount: number;
  scheduledCount: number;
  sentCount: number;
  totalMailsSent: number;
}

export { ROLES };

@Injectable({ providedIn: 'root' })
export class MailService {
  private api = `${environment.apiUrl}/Admin/mails`;

  constructor(private http: HttpClient) {}

  getMails(status?: number): Observable<ScheduledMailDto[]> {
    const q = status != null ? `?status=${status}` : '';
    return this.http.get<ScheduledMailDto[]>(`${this.api}${q}`);
  }

  getMail(id: number): Observable<ScheduledMailDto> {
    return this.http.get<ScheduledMailDto>(`${this.api}/${id}`);
  }

  createMail(dto: CreateScheduledMailDto): Observable<ScheduledMailDto> {
    return this.http.post<ScheduledMailDto>(this.api, dto);
  }

  updateMail(id: number, dto: UpdateScheduledMailDto): Observable<ScheduledMailDto> {
    return this.http.put<ScheduledMailDto>(`${this.api}/${id}`, dto);
  }

  deleteMail(id: number): Observable<void> {
    return this.http.delete<void>(`${this.api}/${id}`);
  }

  sendNow(id: number): Observable<ScheduledMailDto> {
    return this.http.post<ScheduledMailDto>(`${this.api}/${id}/send`, {});
  }

  disableMail(id: number): Observable<ScheduledMailDto> {
    return this.http.post<ScheduledMailDto>(`${this.api}/${id}/disable`, {});
  }

  enableMail(id: number): Observable<ScheduledMailDto> {
    return this.http.post<ScheduledMailDto>(`${this.api}/${id}/enable`, {});
  }

  getStats(): Observable<MailStatsDto> {
    return this.http.get<MailStatsDto>(`${this.api}/stats`);
  }

  getUserCounts(): Observable<MailUserCountDto[]> {
    return this.http.get<MailUserCountDto[]>(`${this.api}/user-counts`);
  }
}
