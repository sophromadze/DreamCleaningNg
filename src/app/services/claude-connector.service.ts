import { inject, Service } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

/** POST api/oauth/authorize/check — what the consent page shows. */
export interface ConnectorAuthorizeCheck {
  clientName: string;
  /** Where the answer is sent; shown on the page so nobody approves a lookalike. */
  redirectHost: string;
  signedIn: boolean;
  /** Only a SuperAdmin may approve — the server decides, and checks again on Allow. */
  canApprove: boolean;
  userName?: string | null;
}

/** One live Claude connector session (Admin → Claude Connector). */
export interface ConnectorSession {
  id: number;
  userId: number;
  userName: string;
  clientName?: string | null;
  clientId: string;
  createdAt: string;
  lastUsedAt?: string | null;
  expiresAt?: string | null;
  toolCalls: number;
}

export interface ConnectorSessions {
  /** The URL to paste into Claude → Add custom connector. */
  serverUrl: string;
  sessions: ConnectorSession[];
}

/**
 * The Claude connector (2026-10): the OAuth consent page's two calls, and the SuperAdmin sessions
 * list. Every rule — who may approve, which redirect is allowed, who may list or revoke — is
 * enforced by the server; nothing here decides access.
 */
@Service()
export class ClaudeConnectorService {
  private readonly http = inject(HttpClient);
  private readonly api = environment.apiUrl;

  /** `query` is the consent page's own query string, as Claude sent it (without '?'). */
  check(query: string): Observable<ConnectorAuthorizeCheck> {
    return this.http.post<ConnectorAuthorizeCheck>(`${this.api}/oauth/authorize/check`, { query, approve: false });
  }

  /** Answers the URL to send the browser to: back to Claude with a code, or with access_denied. */
  decide(query: string, approve: boolean): Observable<{ redirectUrl: string }> {
    return this.http.post<{ redirectUrl: string }>(`${this.api}/oauth/authorize/decision`, { query, approve });
  }

  sessions(): Observable<ConnectorSessions> {
    return this.http.get<ConnectorSessions>(`${this.api}/admin/mcp/sessions`);
  }

  revoke(id: number): Observable<void> {
    return this.http.delete<void>(`${this.api}/admin/mcp/sessions/${id}`);
  }
}
