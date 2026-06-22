import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface AutomationRule {
  id: number;
  key: string;
  name: string;
  description?: string;
  isEnabled: boolean;
  thresholdDays: number;
  cooldownDays: number;
  action: string;
  lastRunAt?: string;
  lastRunCreatedCount: number;
  openAlertCount: number;
}

export interface UpdateAutomationRule {
  isEnabled?: boolean;
  thresholdDays?: number;
  cooldownDays?: number;
}

export interface AutomationAlert {
  id: number;
  ruleKey: string;
  userId: number;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  customerLifetimeValue: number;
  lastOrderDate?: string;
  reason: string;
  status: string;
  remindAt?: string;
  attempts: number;
  lastAttemptAt?: string;
  createdAt: string;
  resolvedAt?: string;
  resolvedByAdminName?: string;
}

@Injectable({ providedIn: 'root' })
export class CrmAutomationService {
  private apiUrl = `${environment.apiUrl}/crm/automation`;

  constructor(private http: HttpClient) {}

  getRules(): Observable<AutomationRule[]> {
    return this.http.get<AutomationRule[]>(`${this.apiUrl}/rules`);
  }

  updateRule(id: number, dto: UpdateAutomationRule): Observable<AutomationRule> {
    return this.http.put<AutomationRule>(`${this.apiUrl}/rules/${id}`, dto);
  }

  runRule(id: number): Observable<{ created: number; message: string }> {
    return this.http.post<{ created: number; message: string }>(`${this.apiUrl}/rules/${id}/run`, {});
  }

  getAlerts(status: string = 'Open', ruleKey?: string): Observable<AutomationAlert[]> {
    let params = new HttpParams().set('status', status);
    if (ruleKey) params = params.set('ruleKey', ruleKey);
    return this.http.get<AutomationAlert[]>(`${this.apiUrl}/alerts`, { params });
  }

  updateAlert(id: number, status: string, remindAt?: string): Observable<AutomationAlert> {
    return this.http.put<AutomationAlert>(`${this.apiUrl}/alerts/${id}`, { status, remindAt });
  }

  logNoAnswer(id: number): Observable<AutomationAlert> {
    return this.http.post<AutomationAlert>(`${this.apiUrl}/alerts/${id}/no-answer`, {});
  }
}
