import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// ── Pipeline constants ──

export const LEAD_STAGES = ['New', 'Contacted', 'Quoted', 'Won', 'Lost'] as const;
export type LeadStage = typeof LEAD_STAGES[number];

export const LEAD_SOURCES = ['ContactForm', 'QuoteRequest', 'LiveChat', 'Manual', 'Booking'] as const;
export type LeadSource = typeof LEAD_SOURCES[number];

export const LEAD_TYPES = ['Residential', 'Commercial'] as const;
export type LeadType = typeof LEAD_TYPES[number];

export const LEAD_ACTIVITY_TYPES = ['Note', 'StageChange', 'Update', 'Call', 'Email', 'Sms', 'System'] as const;
export type LeadActivityType = typeof LEAD_ACTIVITY_TYPES[number];

/** Date-window filter applied to either the created or last-activity date. */
export const LEAD_PERIODS = ['', 'today', 'week', 'month', 'year'] as const;
export type LeadPeriod = typeof LEAD_PERIODS[number];
export type LeadDateField = 'created' | 'activity';

// ── Interfaces ──

export interface Lead {
  id: number;
  firstName?: string;
  lastName?: string;
  fullName: string;
  email?: string;
  phone?: string;
  serviceAddress?: string;
  cleaningType?: string;
  type: LeadType;
  message?: string;
  stage: LeadStage;
  source: LeadSource;
  estimatedValue?: number;
  assignedToAdminId?: number;
  assignedToAdminName?: string;
  clientId?: number;
  convertedOrderId?: number;
  lostReason?: string;
  nextFollowUpDate?: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  isArchived?: boolean;
  archivedAt?: string;
  /** Admin-only problem flag of the matched customer: 'None' | 'Yellow' | 'Red'. Derived from
   *  User.Flag on the backend; the lead itself is never flagged. Drives the lead-card tint. */
  flag?: string;
  flagReason?: string | null;
}

export interface LeadActivity {
  id: number;
  leadId: number;
  type: LeadActivityType;
  content?: string;
  adminId?: number;
  adminName?: string;
  createdAt: string;
}

export interface LeadDetail extends Lead {
  activities: LeadActivity[];
}

export interface LeadPipelineColumn {
  stage: LeadStage;
  count: number;
  totalEstimatedValue: number;
  leads: Lead[];
}

export interface LeadStats {
  total: number;
  new: number;
  contacted: number;
  quoted: number;
  won: number;
  lost: number;
  openCount: number;
  openPipelineValue: number;
  conversionRate?: number;
  dueFollowUps: number;
}

export interface CreateLead {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  serviceAddress?: string;
  cleaningType?: string;
  type?: LeadType;
  message?: string;
  source?: LeadSource;
  estimatedValue?: number;
  assignedToAdminId?: number;
  clientId?: number;
  /** Order the form was prefilled from (optional) — recorded in the lead's timeline. */
  sourceOrderId?: number;
  nextFollowUpDate?: string;
}

/** Add-lead form values derived from an existing order (order-prefill endpoint). */
export interface LeadOrderPrefill {
  orderId: number;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  serviceAddress?: string;
  cleaningType?: string;
  type: LeadType;
  message?: string;
  estimatedValue?: number;
  clientId?: number;
}

export interface UpdateLead {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  serviceAddress?: string;
  cleaningType?: string;
  type?: LeadType;
  message?: string;
  estimatedValue?: number;
  assignedToAdminId?: number;
  clearAssignedAdmin?: boolean;
  nextFollowUpDate?: string;
  clearNextFollowUpDate?: boolean;
}

export interface UpdateLeadStage {
  stage: LeadStage;
  lostReason?: string;
}

export interface CreateLeadActivity {
  type?: LeadActivityType;
  content: string;
}

// ── Service ──

@Injectable({ providedIn: 'root' })
export class CrmLeadService {
  private apiUrl = `${environment.apiUrl}/crm/leads`;

  constructor(private http: HttpClient) {}

  getPipeline(filters?: { search?: string; source?: string; type?: string; assignedToAdminId?: number; period?: string; dateField?: string }): Observable<LeadPipelineColumn[]> {
    let params = new HttpParams();
    if (filters?.search) params = params.set('search', filters.search);
    if (filters?.source) params = params.set('source', filters.source);
    if (filters?.type) params = params.set('type', filters.type);
    if (filters?.assignedToAdminId != null) params = params.set('assignedToAdminId', filters.assignedToAdminId);
    if (filters?.period) params = params.set('period', filters.period);
    if (filters?.dateField) params = params.set('dateField', filters.dateField);
    return this.http.get<LeadPipelineColumn[]>(`${this.apiUrl}/pipeline`, { params });
  }

  getArchived(filters?: { search?: string; source?: string; type?: string; period?: string; dateField?: string }): Observable<Lead[]> {
    let params = new HttpParams();
    if (filters?.search) params = params.set('search', filters.search);
    if (filters?.source) params = params.set('source', filters.source);
    if (filters?.type) params = params.set('type', filters.type);
    if (filters?.period) params = params.set('period', filters.period);
    if (filters?.dateField) params = params.set('dateField', filters.dateField);
    return this.http.get<Lead[]>(`${this.apiUrl}/archived`, { params });
  }

  getStats(): Observable<LeadStats> {
    return this.http.get<LeadStats>(`${this.apiUrl}/stats`);
  }

  getLeads(filters?: { search?: string; stage?: string; source?: string; type?: string; assignedToAdminId?: number }): Observable<Lead[]> {
    let params = new HttpParams();
    if (filters?.search) params = params.set('search', filters.search);
    if (filters?.stage) params = params.set('stage', filters.stage);
    if (filters?.source) params = params.set('source', filters.source);
    if (filters?.type) params = params.set('type', filters.type);
    if (filters?.assignedToAdminId != null) params = params.set('assignedToAdminId', filters.assignedToAdminId);
    return this.http.get<Lead[]>(this.apiUrl, { params });
  }

  getLead(id: number): Observable<LeadDetail> {
    return this.http.get<LeadDetail>(`${this.apiUrl}/${id}`);
  }

  /** Fetch add-lead form values derived from an existing order (by order id). */
  getOrderPrefill(orderId: number): Observable<LeadOrderPrefill> {
    return this.http.get<LeadOrderPrefill>(`${this.apiUrl}/order-prefill/${orderId}`);
  }

  createLead(lead: CreateLead): Observable<LeadDetail> {
    return this.http.post<LeadDetail>(this.apiUrl, lead);
  }

  updateLead(id: number, lead: UpdateLead): Observable<LeadDetail> {
    return this.http.put<LeadDetail>(`${this.apiUrl}/${id}`, lead);
  }

  updateStage(id: number, payload: UpdateLeadStage): Observable<LeadDetail> {
    return this.http.put<LeadDetail>(`${this.apiUrl}/${id}/stage`, payload);
  }

  addActivity(id: number, activity: CreateLeadActivity): Observable<LeadActivity> {
    return this.http.post<LeadActivity>(`${this.apiUrl}/${id}/activities`, activity);
  }

  archiveLead(id: number): Observable<LeadDetail> {
    return this.http.put<LeadDetail>(`${this.apiUrl}/${id}/archive`, {});
  }

  unarchiveLead(id: number): Observable<LeadDetail> {
    return this.http.put<LeadDetail>(`${this.apiUrl}/${id}/unarchive`, {});
  }

  deleteLead(id: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/${id}`);
  }
}
