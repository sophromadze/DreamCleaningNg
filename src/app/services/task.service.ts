import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// ── Task interfaces ──

export interface AdminTask {
  id: number;
  title: string;
  description?: string;
  priority: string;
  status: string;
  dueDate?: string;
  clientName?: string;
  clientEmail?: string;
  clientPhone?: string;
  clientId?: number;
  orderId?: number;
  createdByAdminId: number;
  createdByAdminName: string;
  createdByAdminRole: string;
  completionNote?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAdminTask {
  title: string;
  description?: string;
  priority: string;
  dueDate?: string;
  clientName?: string;
  clientEmail?: string;
  clientPhone?: string;
  clientId?: number;
  orderId?: number;
}

export interface UpdateAdminTask {
  title?: string;
  description?: string;
  priority?: string;
  status?: string;
  dueDate?: string;
  clientName?: string;
  clientEmail?: string;
  clientPhone?: string;
  clientId?: number;
  orderId?: number;
  completionNote?: string;
}

// ── Client Interaction interfaces ──

export interface ClientInteraction {
  id: number;
  clientName: string;
  clientPhone?: string;
  clientEmail?: string;
  clientId?: number;
  interactionDate: string;
  adminName: string;
  adminRole: string;
  adminId: number;
  type: string;
  notes?: string;
  status: string;
  createdAt: string;
}

export interface CreateClientInteraction {
  clientName: string;
  clientPhone?: string;
  clientEmail?: string;
  clientId?: number;
  type: string;
  notes?: string;
  status: string;
}

export interface UpdateClientInteraction {
  clientName?: string;
  clientPhone?: string;
  clientEmail?: string;
  type?: string;
  notes?: string;
  status?: string;
}

// ── Handover Note interfaces ──

export interface HandoverNote {
  id: number;
  content: string;
  adminName: string;
  adminRole: string;
  adminId: number;
  targetAudience: string;
  createdAt: string;
  taskCount: number;
  interactionCount: number;
}

export interface CreateHandoverNote {
  content: string;
  targetAudience: string;
}

export interface UpdateHandoverNote {
  content?: string;
  targetAudience?: string;
}

// ── Personal Admin Task interfaces ──

export interface PersonalAdminTask {
  id: number;
  title: string;
  description?: string;
  priority: string;
  status: string;
  dueDate?: string;
  assignedToAdminId: number;
  assignedToAdminName: string;
  assignedToAdminRole: string;
  createdByAdminId: number;
  createdByAdminName: string;
  createdByAdminRole: string;
  completionNote?: string;
  completedAt?: string;
  checkedByCreator: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePersonalAdminTask {
  title: string;
  description?: string;
  priority: string;
  dueDate?: string;
  assignedToAdminIds: number[];
}

export interface UpdatePersonalAdminTask {
  title?: string;
  description?: string;
  priority?: string;
  status?: string;
  dueDate?: string;
  assignedToAdminId?: number;
  completionNote?: string;
}

// ── Activity Log interfaces ──

export interface TaskActivityLog {
  id: number;
  entityType: string;
  entityId: number;
  entityTitle?: string;
  action: string;
  changes?: string;
  adminId: number;
  adminName: string;
  adminRole: string;
  createdAt: string;
}

// ── Search result interfaces ──

export interface ClientSearchResult {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
}

export interface OrderSearchResult {
  id: number;
  contactFirstName: string;
  contactLastName: string;
  contactEmail?: string;
  contactPhone?: string;
  serviceAddress?: string;
  serviceTypeName: string;
  serviceDate: string;
  status: string;
}

// ── Service ──

@Injectable({
  providedIn: 'root'
})
export class TaskService {
  private apiUrl = `${environment.apiUrl}/admin/tasks`;
  private personalTasksUrl = `${environment.apiUrl}/admin/personal-tasks`;
  private interactionsUrl = `${environment.apiUrl}/admin/client-interactions`;
  private handoverUrl = `${environment.apiUrl}/admin/handover-notes`;

  constructor(private http: HttpClient) {}

  // ── Search ──

  searchClients(query: string): Observable<ClientSearchResult[]> {
    return this.http.get<ClientSearchResult[]>(`${this.apiUrl}/search-clients`, {
      params: new HttpParams().set('q', query)
    });
  }

  searchOrders(query: string): Observable<OrderSearchResult[]> {
    return this.http.get<OrderSearchResult[]>(`${this.apiUrl}/search-orders`, {
      params: new HttpParams().set('q', query)
    });
  }

  // ── Tasks ──

  getTasks(status?: string, priority?: string): Observable<AdminTask[]> {
    let params = new HttpParams();
    if (status) params = params.set('status', status);
    if (priority) params = params.set('priority', priority);
    return this.http.get<AdminTask[]>(this.apiUrl, { params });
  }

  getTask(id: number): Observable<AdminTask> {
    return this.http.get<AdminTask>(`${this.apiUrl}/${id}`);
  }

  createTask(task: CreateAdminTask): Observable<AdminTask> {
    return this.http.post<AdminTask>(this.apiUrl, task);
  }

  updateTask(id: number, task: UpdateAdminTask): Observable<AdminTask> {
    return this.http.put<AdminTask>(`${this.apiUrl}/${id}`, task);
  }

  updateTaskStatus(id: number, status: string, completionNote?: string): Observable<AdminTask> {
    return this.http.put<AdminTask>(`${this.apiUrl}/${id}/status`, { status, completionNote });
  }

  deleteTask(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }

  // ── Personal Admin Tasks ──

  getPersonalTasks(status?: string, filter?: string): Observable<PersonalAdminTask[]> {
    let params = new HttpParams();
    if (status) params = params.set('status', status);
    if (filter) params = params.set('filter', filter);
    return this.http.get<PersonalAdminTask[]>(this.personalTasksUrl, { params });
  }

  createPersonalTask(task: CreatePersonalAdminTask): Observable<PersonalAdminTask> {
    return this.http.post<PersonalAdminTask>(this.personalTasksUrl, task);
  }

  updatePersonalTask(id: number, task: UpdatePersonalAdminTask): Observable<PersonalAdminTask> {
    return this.http.put<PersonalAdminTask>(`${this.personalTasksUrl}/${id}`, task);
  }

  updatePersonalTaskStatus(id: number, status: string, completionNote?: string): Observable<PersonalAdminTask> {
    return this.http.put<PersonalAdminTask>(`${this.personalTasksUrl}/${id}/status`, { status, completionNote });
  }

  deletePersonalTask(id: number): Observable<void> {
    return this.http.delete<void>(`${this.personalTasksUrl}/${id}`);
  }

  getAllPersonalTasks(status?: string): Observable<PersonalAdminTask[]> {
    let params = new HttpParams().set('filter', 'all');
    if (status) params = params.set('status', status);
    return this.http.get<PersonalAdminTask[]>(this.personalTasksUrl, { params });
  }

  getPendingPersonalTaskCount(): Observable<number> {
    return this.http.get<number>(`${this.personalTasksUrl}/pending-count`);
  }

  getUncheckedDoneCount(): Observable<number> {
    return this.http.get<number>(`${this.personalTasksUrl}/unchecked-done-count`);
  }

  markTaskCheckedByCreator(id: number): Observable<PersonalAdminTask> {
    return this.http.put<PersonalAdminTask>(`${this.personalTasksUrl}/${id}/mark-checked`, {});
  }

  // ── Client Interactions ──

  getClientInteractions(
    search?: string,
    status?: string,
    adminId?: number,
    period?: string
  ): Observable<ClientInteraction[]> {
    let params = new HttpParams();
    if (search) params = params.set('search', search);
    if (status) params = params.set('status', status);
    if (adminId) params = params.set('adminId', adminId.toString());
    if (period) params = params.set('period', period);
    return this.http.get<ClientInteraction[]>(this.interactionsUrl, { params });
  }

  createClientInteraction(interaction: CreateClientInteraction): Observable<ClientInteraction> {
    return this.http.post<ClientInteraction>(this.interactionsUrl, interaction);
  }

  updateClientInteraction(id: number, interaction: UpdateClientInteraction): Observable<ClientInteraction> {
    return this.http.put<ClientInteraction>(`${this.interactionsUrl}/${id}`, interaction);
  }

  deleteClientInteraction(id: number): Observable<void> {
    return this.http.delete<void>(`${this.interactionsUrl}/${id}`);
  }

  // ── Handover Notes ──

  getHandoverNotes(): Observable<HandoverNote[]> {
    return this.http.get<HandoverNote[]>(this.handoverUrl);
  }

  createHandoverNote(note: CreateHandoverNote): Observable<HandoverNote> {
    return this.http.post<HandoverNote>(this.handoverUrl, note);
  }

  updateHandoverNote(id: number, note: UpdateHandoverNote): Observable<HandoverNote> {
    return this.http.put<HandoverNote>(`${this.handoverUrl}/${id}`, note);
  }

  deleteHandoverNote(id: number): Observable<void> {
    return this.http.delete<void>(`${this.handoverUrl}/${id}`);
  }

  // ── Activity Logs ──

  getTaskActivityLogs(entityType?: string, action?: string, adminId?: number, page = 1, pageSize = 50, entityId?: number): Observable<TaskActivityLog[]> {
    let params = new HttpParams().set('page', page.toString()).set('pageSize', pageSize.toString());
    if (entityType) params = params.set('entityType', entityType);
    if (action) params = params.set('action', action);
    if (adminId) params = params.set('adminId', adminId.toString());
    if (entityId) params = params.set('entityId', entityId.toString());
    return this.http.get<TaskActivityLog[]>(`${environment.apiUrl}/admin/task-activity-logs`, { params });
  }
}
