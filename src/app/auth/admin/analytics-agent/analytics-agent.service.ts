import { inject, Service } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

/** GET api/admin/agent/status */
export interface AgentStatus {
  isConfigured: boolean;
  sqlConfigured: boolean;
  model: string;
  costEstimateAvailable: boolean;
}

export interface AgentSession {
  id: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  estimatedCostUsd: number | null;
}

/** A chart the agent drew (render_chart). Keys are snake_case as the backend stores them. */
export interface AgentChartPart {
  type: 'chart';
  chart_type: 'bar' | 'line' | 'pie' | 'stacked_bar';
  title: string;
  labels: string[];
  series: { name: string; data: (number | null)[] }[];
  format: 'currency' | 'count' | 'percent' | 'number';
  x_label?: string | null;
  y_label?: string | null;
}

export interface AgentTablePart {
  type: 'table';
  title: string;
  columns: { key: string; label: string; format: 'text' | 'currency' | 'count' | 'percent' | 'number' | 'date' }[];
  rows: Record<string, unknown>[];
}

export type AgentPart = AgentChartPart | AgentTablePart;

/** One step of "How this was calculated". */
export interface AgentCalculationStep {
  tool: string;
  label: string;
  input?: unknown;
  date_range?: string | null;
  filters?: string[];
  definition?: string | null;
  sql?: string | null;
  row_count?: number | null;
  truncated?: boolean;
  duration_ms?: number;
  error?: string | null;
}

export interface AgentMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  inputMode?: string | null;
  status: 'running' | 'complete' | 'error';
  progressLabel?: string | null;
  errorMessage?: string | null;
  parts?: AgentPart[] | null;
  calculation?: AgentCalculationStep[] | null;
  model?: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd?: number | null;
  createdAt: string;
  completedAt?: string | null;
}

export interface AgentSessionDetail {
  session: AgentSession;
  messages: AgentMessage[];
}

export interface AgentTurnStarted {
  userMessage: AgentMessage;
  assistantMessage: AgentMessage;
  session: AgentSession;
}

/**
 * The SuperAdmin analytics agent's API (api/admin/agent). Every endpoint is SuperAdmin-only on the
 * server; nothing here decides access.
 */
@Service()
export class AnalyticsAgentService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/admin/agent`;

  status(): Observable<AgentStatus> {
    return this.http.get<AgentStatus>(`${this.base}/status`);
  }

  sessions(): Observable<AgentSession[]> {
    return this.http.get<AgentSession[]>(`${this.base}/sessions`);
  }

  createSession(title?: string): Observable<AgentSession> {
    return this.http.post<AgentSession>(`${this.base}/sessions`, { title: title ?? null });
  }

  session(id: number): Observable<AgentSessionDetail> {
    return this.http.get<AgentSessionDetail>(`${this.base}/sessions/${id}`);
  }

  rename(id: number, title: string): Observable<AgentSession> {
    return this.http.put<AgentSession>(`${this.base}/sessions/${id}`, { title });
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/sessions/${id}`);
  }

  /**
   * Asks a question. Returns immediately; the answer arrives over SignalR and through
   * {@link message}. `inputMode` is 'text' today — a later voice front end sends its transcript
   * through this same call with 'voice'.
   */
  ask(sessionId: number, text: string, inputMode: 'text' | 'voice' = 'text'): Observable<AgentTurnStarted> {
    return this.http.post<AgentTurnStarted>(`${this.base}/sessions/${sessionId}/messages`, { text, inputMode });
  }

  message(sessionId: number, messageId: number): Observable<AgentMessage> {
    return this.http.get<AgentMessage>(`${this.base}/sessions/${sessionId}/messages/${messageId}`);
  }
}
