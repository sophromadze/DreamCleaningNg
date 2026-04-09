import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { HubConnection, HubConnectionBuilder, LogLevel, HttpTransportType } from '@microsoft/signalr';
import { BehaviorSubject, Subject } from 'rxjs';
import { environment } from '../../environments/environment';

export interface ChatMessage {
  id: string;
  content?: string;
  imageBase64?: string;
  imageMimeType?: string;
  isFromVisitor: boolean;
  timestamp: Date;
}

export type ChatStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

// localStorage keys — shared across all tabs of the same origin
const SESSION_KEY = 'livechat_session';
const MSGS_KEY = (sessionId: string) => `livechat_msgs_${sessionId}`;

@Injectable({
  providedIn: 'root'
})
export class LiveChatService {
  private hubConnection?: HubConnection;
  private isBrowser: boolean;
  private sessionId: string | null = null;

  private messagesSubject = new BehaviorSubject<ChatMessage[]>([]);
  private statusSubject = new BehaviorSubject<ChatStatus>('disconnected');
  private errorSubject = new Subject<string>();
  private chatEnabledSubject = new BehaviorSubject<boolean>(true);

  public messages$ = this.messagesSubject.asObservable();
  public status$ = this.statusSubject.asObservable();
  public error$ = this.errorSubject.asObservable();
  public chatEnabled$ = this.chatEnabledSubject.asObservable();

  constructor(
    @Inject(PLATFORM_ID) private platformId: Object,
    private http: HttpClient
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  /** Called by the widget on init to get the current enabled state from the server. */
  loadChatStatus(): void {
    if (!this.isBrowser) return;
    this.http.get<{ isEnabled: boolean }>(`${environment.apiUrl}/livechat/status`)
      .subscribe({ next: res => this.chatEnabledSubject.next(res.isEnabled), error: () => {} });
  }

  /** Admin-only: flips the enabled state on the server and broadcasts to all visitors. */
  toggleChatEnabled() {
    return this.http.post<{ isEnabled: boolean }>(`${environment.apiUrl}/livechat/toggle`, {});
  }

  async startChat(visitorName: string): Promise<void> {
    if (!this.isBrowser) return;
    if (this.hubConnection) return;

    this.statusSubject.next('connecting');

    const baseUrl = environment.apiUrl.replace('/api', '');
    const hubUrl = `${baseUrl}/liveChatHub`;

    this.hubConnection = new HubConnectionBuilder()
      .withUrl(hubUrl, {
        skipNegotiation: false,
        transport: HttpTransportType.WebSockets | HttpTransportType.ServerSentEvents
      })
      .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
      .configureLogging(LogLevel.Warning)
      .build();

    this.setupHandlers();

    try {
      await this.hubConnection.start();
      this.statusSubject.next('connected');

      // localStorage is shared across tabs — existing session reconnects everywhere
      const storedSessionId = localStorage.getItem(SESSION_KEY);
      if (storedSessionId) {
        await this.hubConnection.invoke('ReconnectChat', storedSessionId);
      } else {
        await this.hubConnection.invoke('StartChat', visitorName);
      }
    } catch (error) {
      console.error('LiveChat connection failed:', error);
      this.statusSubject.next('error');
    }
  }

  async sendMessage(message: string): Promise<void> {
    if (!this.hubConnection || this.hubConnection.state !== 'Connected') return;
    await this.hubConnection.invoke('SendMessage', message);
  }

  async sendImage(file: File): Promise<void> {
    if (!this.hubConnection || this.hubConnection.state !== 'Connected') return;

    if (file.size > 5 * 1024 * 1024) {
      this.errorSubject.next('Image too large. Maximum size is 5MB.');
      return;
    }
    if (!file.type.startsWith('image/')) {
      this.errorSubject.next('Only image files are allowed.');
      return;
    }

    const base64 = await this.fileToBase64(file);
    await this.hubConnection.invoke('SendImage', base64, file.type);
  }

  async disconnect(): Promise<void> {
    if (this.hubConnection) {
      await this.hubConnection.stop();
      this.hubConnection = undefined;
    }
    this.statusSubject.next('disconnected');
    this.messagesSubject.next([]);
    if (this.sessionId) {
      localStorage.removeItem(MSGS_KEY(this.sessionId));
    }
    localStorage.removeItem(SESSION_KEY);
    this.sessionId = null;
  }

  private setupHandlers(): void {
    if (!this.hubConnection) return;

    this.hubConnection.on('ChatStarted', (sessionId: string) => {
      this.sessionId = sessionId;
      localStorage.setItem(SESSION_KEY, sessionId);
    });

    this.hubConnection.on('ChatReconnected', (sessionId: string) => {
      this.sessionId = sessionId;
      // Restore persisted messages so history survives refresh and new tabs
      this.loadStoredMessages(sessionId);
    });

    this.hubConnection.on('SessionExpired', () => {
      if (this.sessionId) localStorage.removeItem(MSGS_KEY(this.sessionId));
      localStorage.removeItem(SESSION_KEY);
      this.sessionId = null;
      this.messagesSubject.next([]);
    });

    this.hubConnection.on('ChatError', (error: string) => {
      this.errorSubject.next(error);
      this.statusSubject.next('error');
    });

    this.hubConnection.on('MessageSent', (msg: any) => {
      this.addMessage({
        id: msg.id,
        content: msg.content,
        imageBase64: msg.imageBase64,
        imageMimeType: msg.imageMimeType,
        isFromVisitor: true,
        timestamp: new Date(msg.timestamp)
      });
    });

    this.hubConnection.on('ReceiveMessage', (msg: any) => {
      this.addMessage({
        id: msg.id,
        content: msg.content,
        imageBase64: msg.imageBase64,
        imageMimeType: msg.imageMimeType,
        isFromVisitor: false,
        timestamp: new Date(msg.timestamp)
      });
      this.playNotificationSound();
    });

    this.hubConnection.on('MessageError', (error: string) => {
      this.errorSubject.next(error);
    });

    // Admin broadcast: chat widget toggled on/off
    this.hubConnection.on('ChatWidgetEnabled',  () => this.chatEnabledSubject.next(true));
    this.hubConnection.on('ChatWidgetDisabled', () => this.chatEnabledSubject.next(false));

    this.hubConnection.onreconnecting(() => {
      this.statusSubject.next('connecting');
    });

    this.hubConnection.onreconnected(() => {
      this.statusSubject.next('connected');
      if (this.sessionId) {
        this.hubConnection?.invoke('ReconnectChat', this.sessionId);
      }
    });

    this.hubConnection.onclose(() => {
      this.statusSubject.next('disconnected');
    });
  }

  private addMessage(message: ChatMessage): void {
    const updated = [...this.messagesSubject.value, message];
    this.messagesSubject.next(updated);
    this.saveMessages(updated);
  }

  // ── Message persistence ────────────────────────────────────────────────────
  // Images are not stored (too large for localStorage) — replaced with a label.

  private saveMessages(messages: ChatMessage[]): void {
    if (!this.sessionId) return;
    try {
      const serializable = messages.map(m => ({
        id: m.id,
        content: m.imageBase64 ? (m.content || '📷 Image') : m.content,
        imageMimeType: m.imageMimeType,
        // imageBase64 intentionally omitted — binary data is too large for localStorage
        isFromVisitor: m.isFromVisitor,
        timestamp: m.timestamp
      }));
      localStorage.setItem(MSGS_KEY(this.sessionId), JSON.stringify(serializable));
    } catch {
      // Storage full or unavailable — fail silently
    }
  }

  private loadStoredMessages(sessionId: string): void {
    try {
      const raw = localStorage.getItem(MSGS_KEY(sessionId));
      if (!raw) return;
      const messages: ChatMessage[] = JSON.parse(raw).map((m: any) => ({
        ...m,
        timestamp: new Date(m.timestamp)
      }));
      if (messages.length > 0) {
        this.messagesSubject.next(messages);
      }
    } catch {
      // Corrupted storage — ignore
    }
  }

  private playNotificationSound(): void {
    try {
      const audio = new Audio();
      audio.src = 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgkKuwo3xMPWOQsLOugGhYbIGXpJyBcW1wgoqQjYJ5dXd/hYqIgHt4eH2Bg4WDgYCAf4CBgoKCgoKDg4OEhISEhIWFhYWFhYaGhg==';
      audio.volume = 0.3;
      audio.play().catch(() => {});
    } catch {}
  }

  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
}
