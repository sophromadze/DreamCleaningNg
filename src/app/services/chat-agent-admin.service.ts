import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type ChatVisibilityMode = 'Disabled' | 'AdminOnly' | 'Public';

export interface ChatAgentSettings {
  escalationEmailEnabled: boolean;
  visibilityMode: ChatVisibilityMode;
  updatedAt: string | null;
  updatedByEmail: string | null;
}

export type ChatSessionStatus = 'AiHandling' | 'EscalatedToHuman' | 'Resolved';

export interface ChatSessionListItem {
  id: string;
  userId: number | null;
  userEmail: string | null;
  guestIdentifier: string | null;
  guestEmail: string | null;
  status: ChatSessionStatus;
  telegramTopicId: number | null;
  createdAt: string;
  lastMessageAt: string;
  messageCount: number;
}

export interface ChatSessionListResponse {
  items: ChatSessionListItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ChatAdminTranscriptMessage {
  id: string;
  role: 'user' | 'assistant' | 'humanAgent' | 'system';
  content: string | null;
  imagePath: string | null;
  createdAt: string;
}

export interface ChatAdminTranscript {
  sessionId: string;
  status: ChatSessionStatus;
  userEmail: string | null;
  guestIdentifier: string | null;
  guestEmail: string | null;
  createdAt: string;
  messages: ChatAdminTranscriptMessage[];
}

export interface ChatSessionFilters {
  status?: ChatSessionStatus | '';
  from?: string; // yyyy-MM-dd
  to?: string;   // yyyy-MM-dd
  page: number;
  pageSize: number;
}

/** Admin API for the AI chat agent: runtime settings + chat history viewer (SuperAdmin/Admin only). */
@Injectable({ providedIn: 'root' })
export class ChatAgentAdminService {
  private apiUrl = `${environment.apiUrl}/admin/chat-agent`;

  constructor(private http: HttpClient) {}

  getSettings(): Observable<ChatAgentSettings> {
    return this.http.get<ChatAgentSettings>(`${this.apiUrl}/settings`);
  }

  getSessions(filters: ChatSessionFilters): Observable<ChatSessionListResponse> {
    const params: string[] = [`page=${filters.page}`, `pageSize=${filters.pageSize}`];
    if (filters.status) params.push(`status=${filters.status}`);
    if (filters.from) params.push(`from=${filters.from}`);
    if (filters.to) params.push(`to=${filters.to}`);
    return this.http.get<ChatSessionListResponse>(`${this.apiUrl}/sessions?${params.join('&')}`);
  }

  getTranscript(sessionId: string): Observable<ChatAdminTranscript> {
    return this.http.get<ChatAdminTranscript>(`${this.apiUrl}/sessions/${sessionId}/messages`);
  }

  /** Admin "Mark Resolved" — ends the conversation from the customer's side too. */
  resolveSession(sessionId: string): Observable<{ status: string }> {
    return this.http.post<{ status: string }>(`${this.apiUrl}/sessions/${sessionId}/resolve`, {});
  }

  /** SuperAdmin hard-delete — permanently removes the session, its messages, and images. */
  deleteSession(sessionId: string): Observable<{ status: string }> {
    return this.http.delete<{ status: string }>(`${this.apiUrl}/sessions/${sessionId}`);
  }

  setVisibility(mode: ChatVisibilityMode): Observable<ChatAgentSettings> {
    return this.http.post<ChatAgentSettings>(`${this.apiUrl}/settings/visibility`, { mode });
  }

  toggleEscalationEmail(): Observable<ChatAgentSettings> {
    return this.http.post<ChatAgentSettings>(`${this.apiUrl}/settings/toggle-escalation-email`, {});
  }
}
