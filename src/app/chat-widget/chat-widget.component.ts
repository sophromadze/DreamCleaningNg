import { Component, ElementRef, Inject, NgZone, OnDestroy, OnInit, PLATFORM_ID, ViewChild } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router } from '@angular/router';
import { Subscription, filter } from 'rxjs';
import {
  ChatWidgetService,
  ChatHistoryMessage
} from '../services/chat-widget.service';
import { AuthService } from '../services/auth.service';
import { ChatMarkdownPipe } from '../shared/pipes/chat-markdown.pipe';

interface WidgetMessage {
  id: string | null; // null = optimistic local copy not yet seen from the server
  role: 'user' | 'assistant' | 'humanAgent';
  content: string | null;
  imagePath: string | null;
  /** Admin-chosen agent name for humanAgent messages; null/absent → "Team". */
  agentName?: string | null;
  createdAt: string | null;
  /** Quick-reply chips (transient — only rendered on the latest message, retired on use). */
  quickReplies?: string[] | null;
  quickRepliesUsed?: boolean;
}

/**
 * Floating AI chat widget, mounted once in the root app shell.
 *
 * Visibility is decided SERVER-side via GET /api/chat/widget-visibility
 * (admin-controlled: Disabled / AdminOnly / Public). When not visible, this
 * component renders nothing and makes no further chat calls. The check runs
 * browser-only (never during SSR/prerender) and re-runs on login/logout so
 * admins see the widget appear in AdminOnly mode without a refresh.
 *
 * After a conversation is escalated to a human, the widget polls the session
 * history every 4s (while open) to pick up team replies relayed from Telegram.
 */
@Component({
  selector: 'app-chat-widget',
  standalone: true,
  imports: [CommonModule, FormsModule, ChatMarkdownPipe],
  templateUrl: './chat-widget.component.html',
  styleUrl: './chat-widget.component.scss'
})
export class ChatWidgetComponent implements OnInit, OnDestroy {
  private static readonly POLL_INTERVAL_MS = 4000;        // panel open, escalated
  private static readonly BG_POLL_INTERVAL_MS = 5000;     // panel closed, escalated only
  /** No user activity for this long → pause BOTH poll rates (protects the server from
   *  tabs left open indefinitely with nobody watching). Resumed by Continue/send/reopen. */
  private static readonly IDLE_TIMEOUT_MS = 15 * 60 * 1000;
  private static readonly MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  /** localStorage key (AuthService house pattern for persisted client state). */
  private static readonly STORAGE_KEY = 'chatWidgetSession';
  /** Client-side sliding resume windows — server rows are never touched. */
  private static readonly RESUME_DAYS_AI = 7;
  private static readonly RESUME_DAYS_ESCALATED = 30;

  visible = false;
  isOpen = false;
  messages: WidgetMessage[] = [];
  draft = '';
  sending = false;
  uploadingImage = false;
  error: string | null = null;
  escalated = false;
  conversationEnded = false;
  unreadCount = 0;
  pendingImage: { path: string; previewUrl: string } | null = null;
  /** Whether a signed-in user owns this widget (their account email is used server-side). */
  isLoggedIn = false;
  /** Optional guest contact email, from the start-of-chat field (first message only). */
  guestEmailInput = '';
  /** Polling suspended after IDLE_TIMEOUT_MS of no user activity. When the panel is open
   *  this drives the "Paused due to inactivity" banner; when closed it's silent. */
  paused = false;

  /** Wall-clock of the last user interaction (send / open panel / click or keydown in the
   *  open panel). Drives the idle-timeout check; refreshed by registerActivity(). */
  private lastActivityAt = Date.now();

  private sessionId: string | null = null;
  /** Newest server-stamped message we KNOW about (polling cursor). */
  private lastSeenTimestamp: string | null = null;
  /** Newest server-stamped message the user has SEEN with the panel open (badge cursor). */
  private lastSeenByUserAt: string | null = null;
  private seenIds = new Set<string>();
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private bgPollHandle: ReturnType<typeof setInterval> | null = null;
  private restoreAttempted = false;
  private authSub?: Subscription;
  private routerSub?: Subscription;
  private lastAuthKey = 'uninitialized';
  private readonly isBrowser: boolean;

  @ViewChild('messageList') private messageList?: ElementRef<HTMLDivElement>;
  @ViewChild('messageInput') private messageInput?: ElementRef<HTMLInputElement>;

  constructor(
    private chatService: ChatWidgetService,
    private authService: AuthService,
    private router: Router,
    private ngZone: NgZone,
    @Inject(PLATFORM_ID) platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  ngOnInit(): void {
    // Never during SSR/prerender — the widget (and its network calls) is browser-only.
    if (!this.isBrowser) return;

    // BehaviorSubject emits immediately, so this also performs the initial check;
    // afterwards it re-checks only when the signed-in user actually changes.
    this.authSub = this.authService.currentUser.subscribe(user => {
      this.isLoggedIn = !!user;
      const key = user ? `user-${user.id}` : 'anonymous';
      if (key === this.lastAuthKey) return;
      this.lastAuthKey = key;
      this.checkVisibility();
    });

    // Treat a hidden tab as "not watching" even when the panel is open — so a reply
    // arriving while the customer is on another tab still raises the badge, and
    // returning to a visible tab with the panel open clears it.
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    // Site-wide activity signals: the widget is mounted once in the app shell, so a
    // visitor browsing OTHER pages (SPA navigation, clicks anywhere) is still present —
    // keep the idle clock fresh so background polling isn't wrongly paused on them.
    this.routerSub = this.router.events
      .pipe(filter(e => e instanceof NavigationEnd))
      .subscribe(() => this.onSiteActivity());
    // Registered OUTSIDE Angular's zone: a document-wide click listener would otherwise
    // trigger a change-detection cycle on every click anywhere on the site, and the fast
    // path here is just a timestamp write that no template reads.
    this.ngZone.runOutsideAngular(() =>
      document.addEventListener('click', this.onDocumentClick));
  }

  ngOnDestroy(): void {
    this.stopPolling();
    this.stopBackgroundPolling();
    this.authSub?.unsubscribe();
    this.routerSub?.unsubscribe();
    if (this.isBrowser) {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
      document.removeEventListener('click', this.onDocumentClick);
    }
    this.clearPendingImage();
  }

  private readonly onVisibilityChange = (): void => {
    if (this.isTabVisible() && this.isOpen) this.markAllSeen();
  };

  /** The customer is "watching" only when the panel is open AND the tab is visible. */
  private isTabVisible(): boolean {
    return !this.isBrowser || document.visibilityState === 'visible';
  }

  toggleOpen(): void {
    this.isOpen = !this.isOpen;
    if (this.isOpen) {
      // Opening is activity — resets the idle clock and clears a closed idle-pause so
      // the catch-up below and foreground polling resume normally.
      this.registerActivity();
      this.paused = false;
      this.stopBackgroundPolling();
      this.markAllSeen();
      if (this.escalated && this.sessionId && !this.conversationEnded) {
        this.pollOnce(); // catch up on replies missed while closed
        this.startPolling();
      }
      this.scrollToBottom();
    } else {
      this.stopPolling();
      // If we were idle-paused while open, closing keeps it paused (nobody's watching) —
      // reopening later resumes and catches up.
      if (!this.paused && this.escalated && this.sessionId && !this.conversationEnded) {
        this.startBackgroundPolling();
      }
    }
  }

  /** Customer "End chat" — resolves the session server-side and shows the ended state. */
  endChat(): void {
    if (!this.sessionId || this.conversationEnded) return;
    if (!confirm('End this conversation?')) return;

    const sessionId = this.sessionId;
    this.chatService.resolveSession(sessionId).subscribe({
      next: () => this.enterResolvedState(),
      error: () => {
        this.error = 'Could not end the conversation. Please try again.';
      }
    });
  }

  /** Ended banner's "Start new chat" — fresh session on the next message. */
  startNewChat(): void {
    this.conversationEnded = false;
    this.sessionId = null;
    this.escalated = false;
    this.messages = [];
    this.seenIds.clear();
    this.lastSeenTimestamp = null;
    this.lastSeenByUserAt = null;
    this.unreadCount = 0;
    this.error = null;
    this.paused = false;
    this.guestEmailInput = ''; // never carry a previous visitor's email into a fresh chat
    this.registerActivity();
    this.clearPendingImage();
    this.clearStoredSession();
  }

  private enterResolvedState(): void {
    this.conversationEnded = true;
    this.escalated = false;
    this.paused = false;
    this.stopPolling();
    this.stopBackgroundPolling();
    this.clearStoredSession();
    this.clearPendingImage();
  }

  send(): void {
    if (this.conversationEnded) return; // ended state — Start new chat first
    const text = this.draft.trim();
    const image = this.pendingImage;
    if (this.sending || (!text && !image)) return;

    // A real send always counts as activity and lifts any idle pause — resuming works
    // whether or not they clicked "Continue" first (foreground polling is restarted in
    // the success handler below).
    this.registerActivity();
    this.paused = false;

    // First message of a new guest session may carry the optional email from the
    // start-of-chat field. Basic '@' sanity only — a malformed value is dropped, never
    // blocking the send. Captured before the optimistic push hides the field.
    const guestEmail = !this.sessionId && !this.isLoggedIn && this.guestEmailInput.includes('@')
      ? this.guestEmailInput.trim()
      : null;

    this.error = null;
    this.sending = true;
    this.draft = '';
    this.pendingImage = null; // keep previewUrl alive for the message bubble

    // The conversation is moving on — retire any outstanding quick-reply chips.
    for (const m of this.messages) {
      if (m.quickReplies) m.quickRepliesUsed = true;
    }

    this.messages.push({
      id: null,
      role: 'user',
      content: text || null,
      imagePath: image?.path ?? null,
      createdAt: null
    });
    this.scrollToBottom();

    this.chatService.sendMessage(this.sessionId, text, image?.path ?? null, guestEmail).subscribe({
      next: response => {
        this.sending = false;
        this.focusInput(); // disabling during send dropped focus — give it back
        // The server may hand back a NEW id (e.g. the stored session was resolved
        // by an admin and a fresh one was started) — always adopt and persist it.
        if (this.sessionId !== response.sessionId) {
          this.sessionId = response.sessionId;
          this.seenIds.clear();
          this.lastSeenTimestamp = null;
          this.lastSeenByUserAt = null;
        }
        this.saveStoredSession();

        // reply is null for post-escalation relays — no bubble, no sound; the
        // human's actual answer arrives via polling.
        if (response.reply) {
          this.messages.push({
            id: null,
            role: 'assistant',
            content: response.reply,
            imagePath: null,
            createdAt: null,
            quickReplies: response.quickReplies?.length ? response.quickReplies : null
          });
          this.playNotificationSound();
          this.scrollToBottom();
        }

        if (response.escalated && !this.escalated) {
          this.escalated = true;
          this.syncHistory(); // adopt server ids so polling never duplicates
          this.startPolling();
        } else if (this.escalated && this.isOpen) {
          // Already escalated — make sure foreground polling is live (resumes it if an
          // idle pause had stopped it; no-op when it's already running).
          this.startPolling();
        }
      },
      error: err => {
        this.sending = false;
        this.focusInput(); // same focus restore on failure — they'll want to retry
        this.error = err?.status === 429
          ? "You're sending messages a little fast — give it a few seconds and try again."
          : err?.status === 403
            ? 'Chat is currently unavailable.'
            : 'Something went wrong sending your message. Please try again.';
      }
    });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-picking the same file
    if (!file) return;

    if (file.size > ChatWidgetComponent.MAX_IMAGE_BYTES) {
      this.error = 'Image is too large — maximum size is 5 MB.';
      return;
    }

    this.error = null;
    this.uploadingImage = true;
    this.chatService.uploadImage(file).subscribe({
      next: response => {
        this.uploadingImage = false;
        this.clearPendingImage();
        this.pendingImage = {
          path: response.imagePath,
          previewUrl: URL.createObjectURL(file)
        };
      },
      error: err => {
        this.uploadingImage = false;
        this.error = err?.status === 429
          ? 'Too many requests — give it a few seconds and try again.'
          : 'Could not upload that image (JPG, PNG or WEBP up to 5 MB).';
      }
    });
  }

  clearPendingImage(): void {
    if (this.pendingImage) {
      URL.revokeObjectURL(this.pendingImage.previewUrl);
      this.pendingImage = null;
    }
  }

  get canSend(): boolean {
    return !this.sending && (!!this.draft.trim() || !!this.pendingImage);
  }

  /** The optional email field shows only for a guest's brand-new conversation (no
   * messages yet). The moment the first message is sent, the optimistic bubble makes
   * messages non-empty, so it hides permanently for the rest of the session — and a
   * resumed session always has ≥1 message, so it never reappears on reopen. */
  get showEmailField(): boolean {
    return !this.isLoggedIn && this.messages.length === 0 && !this.conversationEnded;
  }

  /** Chips render only under the newest message so stale choice sets can't linger. */
  isLastMessage(message: WidgetMessage): boolean {
    return this.messages.length > 0 && this.messages[this.messages.length - 1] === message;
  }

  /** A chip click sends its label through the exact normal send flow. */
  onQuickReply(option: string): void {
    if (this.sending) return;
    this.draft = option;
    this.send(); // send() also retires all outstanding chips
  }

  // ===== Visibility =====

  private checkVisibility(): void {
    this.chatService.getVisibility().subscribe({
      next: result => {
        this.visible = result.visible;
        if (!result.visible) {
          this.isOpen = false;
          this.stopPolling();
          this.stopBackgroundPolling();
        } else if (!this.restoreAttempted) {
          this.restoreAttempted = true;
          this.tryRestoreSession();
        }
      },
      error: () => {
        this.visible = false;
        this.stopPolling();
        this.stopBackgroundPolling();
      }
    });
  }

  // ===== Persistence + restore (localStorage, AuthService house pattern) =====

  private saveStoredSession(): void {
    if (!this.isBrowser || !this.sessionId) return;
    try {
      localStorage.setItem(ChatWidgetComponent.STORAGE_KEY, JSON.stringify({
        sessionId: this.sessionId,
        lastSeenMessageAt: this.lastSeenByUserAt
      }));
    } catch { /* private browsing / quota — session just won't resume */ }
  }

  private loadStoredSession(): { sessionId: string; lastSeenMessageAt: string | null } | null {
    if (!this.isBrowser) return null;
    try {
      const raw = localStorage.getItem(ChatWidgetComponent.STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return typeof parsed?.sessionId === 'string'
        ? { sessionId: parsed.sessionId, lastSeenMessageAt: parsed.lastSeenMessageAt ?? null }
        : null;
    } catch {
      return null;
    }
  }

  private clearStoredSession(): void {
    if (!this.isBrowser) return;
    try { localStorage.removeItem(ChatWidgetComponent.STORAGE_KEY); } catch {}
  }

  /** Silent background restore on init: validate the stored session against the
   * server, apply the status-aware sliding expiry (7d AI / 30d escalated), rebuild
   * history + unread badge. The panel stays CLOSED — the badge does the inviting.
   * 404 clears the stored session; 403 (visibility toggled off for the caller) and
   * transient errors keep it for a later attempt. */
  private tryRestoreSession(): void {
    const stored = this.loadStoredSession();
    if (!stored) return;

    this.chatService.getSessionMessages(stored.sessionId, null).subscribe({
      next: history => {
        if (history.status === 'resolved') {
          this.clearStoredSession();
          return;
        }
        const newest = history.messages.length
          ? history.messages[history.messages.length - 1].createdAt
          : null;
        const maxDays = history.status === 'escalatedToHuman'
          ? ChatWidgetComponent.RESUME_DAYS_ESCALATED
          : ChatWidgetComponent.RESUME_DAYS_AI;
        if (newest && Date.now() - this.toUtcDate(newest).getTime() > maxDays * 86_400_000) {
          this.clearStoredSession(); // expired client-side; server row stays for admins
          return;
        }

        this.sessionId = stored.sessionId;
        this.escalated = history.status === 'escalatedToHuman';
        this.messages = history.messages.map(m => this.toWidgetMessage(m));
        this.seenIds = new Set(history.messages.map(m => m.id));
        this.lastSeenTimestamp = newest;
        this.lastSeenByUserAt = stored.lastSeenMessageAt;
        this.unreadCount = history.messages.filter(m =>
          m.role !== 'user' &&
          (!stored.lastSeenMessageAt || m.createdAt > stored.lastSeenMessageAt)).length;

        if (this.escalated) this.startBackgroundPolling();
      },
      error: err => {
        if (err?.status === 404) this.clearStoredSession();
      }
    });
  }

  private toUtcDate(raw: string): Date {
    return new Date(/Z|[+-]\d\d:\d\d$/.test(raw) ? raw : raw + 'Z');
  }

  /** Panel is open and current — reset the badge and advance the seen cursor. */
  private markAllSeen(): void {
    this.unreadCount = 0;
    if (this.lastSeenTimestamp) this.lastSeenByUserAt = this.lastSeenTimestamp;
    this.saveStoredSession();
  }

  // ===== Escalation polling (team replies from Telegram) =====
  // Two rates: 4s while the panel is OPEN, 5s while CLOSED (badge/chirp duty).
  // AI-handled sessions never background-poll — the AI only replies to a message
  // the customer just sent, so there is nothing to discover in the background.

  private startPolling(): void {
    if (this.pollHandle || !this.isOpen) return;
    this.pollHandle = setInterval(() => this.pollOnce(), ChatWidgetComponent.POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }

  private startBackgroundPolling(): void {
    if (this.bgPollHandle || this.isOpen || !this.escalated || !this.sessionId || this.conversationEnded) return;
    this.bgPollHandle = setInterval(() => this.pollOnce(), ChatWidgetComponent.BG_POLL_INTERVAL_MS);
  }

  private stopBackgroundPolling(): void {
    if (this.bgPollHandle) {
      clearInterval(this.bgPollHandle);
      this.bgPollHandle = null;
    }
  }

  // ===== Idle timeout (pause polling when nobody's watching) =====

  /** Keep-alive: refreshes the idle clock on any interaction. Does NOT resume polling —
   *  resume is explicit (Continue button / send / reopen / site activity while closed),
   *  so a stray click on a paused OPEN panel (e.g. the close button) doesn't silently
   *  spin polling back up past its banner. */
  registerActivity(): void {
    this.lastActivityAt = Date.now();
  }

  /** Document-wide click handler, running OUTSIDE Angular's zone. The overwhelmingly
   *  common path is a bare timestamp write (no template state, no change detection);
   *  only the rare resume-from-silent-pause re-enters the zone, because catching up
   *  can touch template-bound state (badge, messages). */
  private readonly onDocumentClick = (): void => {
    if (!this.paused) {
      this.registerActivity();
      return;
    }
    this.ngZone.run(() => this.onSiteActivity());
  };

  /** Site-wide activity (route navigation, any document click): keeps the idle clock
   *  fresh, and quietly resumes a CLOSED-panel idle pause — that state is silent (no
   *  banner to click), so still-present visitors would otherwise miss badges. An OPEN
   *  panel's pause keeps its banner and still requires Continue or a send. */
  private onSiteActivity(): void {
    this.registerActivity();
    if (this.paused && !this.isOpen) {
      this.paused = false;
      if (this.sessionId && this.escalated && !this.conversationEnded) {
        this.pollOnce(); // catch up on anything relayed while paused
        this.startBackgroundPolling();
      }
    }
  }

  /** Idle threshold crossed — suspend both poll rates. Open panels surface the banner
   *  (via the `paused` flag); closed panels pause silently and catch up on reopen. */
  private pauseForIdle(): void {
    this.paused = true;
    this.stopPolling();
    this.stopBackgroundPolling();
  }

  /** "Continue chat" from the idle banner — reset the clock, drop the pause, catch up on
   *  anything relayed while paused, and resume the current context's rate. */
  continueChat(): void {
    this.paused = false;
    this.registerActivity();
    if (!this.sessionId || this.conversationEnded) return;
    this.pollOnce(); // immediate catch-up
    if (this.isOpen) this.startPolling();
    else this.startBackgroundPolling();
  }

  private pollOnce(): void {
    if (!this.sessionId || this.conversationEnded) return;
    // Idle guard piggybacks on every poll tick: no activity for IDLE_TIMEOUT_MS pauses
    // both rates until the user comes back (Continue / send / reopen).
    if (Date.now() - this.lastActivityAt >= ChatWidgetComponent.IDLE_TIMEOUT_MS) {
      this.pauseForIdle();
      return;
    }
    this.chatService.getSessionMessages(this.sessionId, this.lastSeenTimestamp).subscribe({
      next: history => {
        if (history.status === 'resolved') {
          this.mergeServerMessages(history.messages); // show any final replies
          this.enterResolvedState();
          return;
        }
        this.mergeServerMessages(history.messages);
      },
      error: err => {
        if (err?.status === 403 || err?.status === 404) {
          this.stopPolling();
          this.stopBackgroundPolling();
        }
        // other polling errors are transient — stay quiet, next tick retries
      }
    });
  }

  /** Full history fetch after escalation: replaces optimistic local copies with
   * the server's canonical (id-stamped) messages so polling never duplicates. */
  private syncHistory(): void {
    if (!this.sessionId) return;
    this.chatService.getSessionMessages(this.sessionId, null).subscribe({
      next: history => {
        this.messages = history.messages.map(m => this.toWidgetMessage(m));
        this.seenIds = new Set(history.messages.map(m => m.id));
        this.lastSeenTimestamp = history.messages.length
          ? history.messages[history.messages.length - 1].createdAt
          : this.lastSeenTimestamp;
        if (this.isOpen) this.markAllSeen(); // escalation happens with the panel open
        this.saveStoredSession();
        this.scrollToBottom();
      },
      error: () => { /* keep the optimistic view; polling will still merge by id */ }
    });
  }

  private mergeServerMessages(incoming: ChatHistoryMessage[]): void {
    let appended = false;
    let incomingReplies = 0;
    for (const message of incoming) {
      if (this.lastSeenTimestamp === null || message.createdAt > this.lastSeenTimestamp) {
        this.lastSeenTimestamp = message.createdAt;
      }
      if (this.seenIds.has(message.id)) continue;
      this.seenIds.add(message.id);

      // A user message we don't know by id is usually our own optimistic copy
      // coming back from the server — adopt the id instead of duplicating it.
      if (message.role === 'user') {
        const optimistic = this.messages.find(m =>
          m.id === null && m.role === 'user' && (m.content ?? '') === (message.content ?? ''));
        if (optimistic) {
          optimistic.id = message.id;
          optimistic.createdAt = message.createdAt;
          continue;
        }
      }

      this.messages.push(this.toWidgetMessage(message));
      appended = true;
      if (message.role !== 'user') incomingReplies++;
    }
    if (appended) this.scrollToBottom();
    if (incomingReplies > 0) {
      // One chirp per poll batch, replies only — never for the visitor's own messages.
      this.playNotificationSound();
      // "Watching" = panel open AND tab visible. Panel open on a hidden/background
      // tab still accrues a badge, so the customer sees it on return.
      if (this.isOpen && this.isTabVisible()) {
        this.markAllSeen();
      } else {
        this.unreadCount += incomingReplies;
        this.saveStoredSession();
      }
    }
  }

  private toWidgetMessage(message: ChatHistoryMessage): WidgetMessage {
    return {
      id: message.id,
      role: message.role,
      content: message.content,
      imagePath: message.imagePath,
      agentName: message.agentName ?? null,
      createdAt: message.createdAt
    };
  }

  /** Soft chirp for incoming replies (assistant or team) — same sound the legacy
   * live-chat widget used (live-chat.service.ts). Autoplay policies are satisfied
   * in practice: the visitor has always interacted before a reply can arrive;
   * if a browser still blocks it, we fail silently. */
  private playNotificationSound(): void {
    try {
      const audio = new Audio();
      audio.src = 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgkKuwo3xMPWOQsLOugGhYbIGXpJyBcW1wgoqQjYJ5dXd/hYqIgHt4eH2Bg4WDgYCAf4CBgoKCgoKDg4OEhISEhIWFhYWFhYaGhg==';
      audio.volume = 0.3;
      audio.play().catch(() => {});
    } catch {}
  }

  /** Restore focus to the message input after a send completes. `[disabled]="sending"`
   * makes the browser DROP focus (disabled elements can't hold it) and re-enabling does
   * not give it back — without this the customer must click the field after every
   * exchange. setTimeout(0) defers until the re-enabled input has rendered. Deliberately
   * NOT called on polled replies: those never disable the input (no focus was lost), and
   * grabbing focus there would fight e.g. the guest-email field or text selection. */
  private focusInput(): void {
    setTimeout(() => this.messageInput?.nativeElement?.focus());
  }

  private scrollToBottom(): void {
    setTimeout(() => {
      const el = this.messageList?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }
}
