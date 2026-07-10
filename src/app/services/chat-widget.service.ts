import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface ChatWidgetVisibility {
  visible: boolean;
}

export interface ChatMessageResponse {
  sessionId: string;
  /** Null after escalation — the message was relayed to the team and there is no
   * bot reply to render; the human's answer arrives via polling. */
  reply: string | null;
  escalated: boolean;
  /** Clickable quick-reply options (transient — clicking one sends it as a normal message). */
  quickReplies?: string[] | null;
}

export interface ChatImageUploadResponse {
  imagePath: string;
  expiresAt: string;
}

export interface ChatHistoryMessage {
  id: string;
  role: 'user' | 'assistant' | 'humanAgent';
  content: string | null;
  imagePath: string | null;
  createdAt: string;
}

export interface ChatSessionHistory {
  sessionId: string;
  status: 'aiHandling' | 'escalatedToHuman' | 'resolved';
  messages: ChatHistoryMessage[];
}

/**
 * API client for the AI chat widget (public /api/chat endpoints).
 * Visibility is decided SERVER-side (admin-controlled VisibilityMode +
 * the caller's validated role) — the widget only renders what this says.
 */
@Injectable({ providedIn: 'root' })
export class ChatWidgetService {
  private apiUrl = `${environment.apiUrl}/chat`;

  constructor(private http: HttpClient) {}

  getVisibility(): Observable<ChatWidgetVisibility> {
    return this.http.get<ChatWidgetVisibility>(`${this.apiUrl}/widget-visibility`);
  }

  sendMessage(
    sessionId: string | null,
    message: string,
    imagePath: string | null,
    guestEmail: string | null = null
  ): Observable<ChatMessageResponse> {
    return this.http.post<ChatMessageResponse>(`${this.apiUrl}/message`, {
      sessionId,
      message,
      imagePath,
      guestEmail
    });
  }

  uploadImage(file: File): Observable<ChatImageUploadResponse> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<ChatImageUploadResponse>(`${this.apiUrl}/upload-image`, form);
  }

  getSessionMessages(sessionId: string, after: string | null): Observable<ChatSessionHistory> {
    const query = after ? `?after=${encodeURIComponent(after)}` : '';
    return this.http.get<ChatSessionHistory>(`${this.apiUrl}/session/${sessionId}/messages${query}`);
  }

  /** Customer "End chat" — marks the session Resolved server-side. */
  resolveSession(sessionId: string): Observable<{ status: string }> {
    return this.http.post<{ status: string }>(`${this.apiUrl}/session/${sessionId}/resolve`, {});
  }
}
