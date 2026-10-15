import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnInit, PLATFORM_ID, computed, inject, signal, viewChild
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { SignalRService } from '../../../services/signalr.service';
import { extractApiErrorMessage } from '../../../utils/http-error.utils';
import {
  AgentChartPart, AgentMessage, AgentPart, AgentSession, AgentStatus, AgentTablePart, AnalyticsAgentService
} from './analytics-agent.service';
import { AgentChartComponent } from './agent-chart.component';
import { renderAgentMarkdown } from './agent-markdown';
import { formatAgentValue, formatCostUsd, formatTokens } from './agent-format';

/** How often a running answer is re-read when SignalR is not delivering (dropped socket, proxy). */
export const AGENT_POLL_MS = 4000;

/** Example questions on an empty chat — English, Georgian and mixed, as the owners ask them. */
export const AGENT_EXAMPLE_PROMPTS: ReadonlyArray<string> = [
  'How many orders did each admin book this month, and what was the Admins-tab net per order? Show a chart by week.',
  'Company Revenue and Statistics Net Income for last month compared with the month before.',
  'Which service types brought the most Company Revenue this year? Show a pie chart.',
  'რამდენი შეკვეთა შესრულდა ამ თვეში და რა იყო საშუალო შემოსავალი ერთ შეკვეთაზე?',
  'Cleaner pay per cleaner for last month — hours, salary and what is still owed.',
  'ამ წელს ტოპ 10 კლიენტი Company Revenue-ის მიხედვით, table-ით.'
];

/**
 * Admin → Analytics Agent (2026-10, SuperAdmin only). A chat that answers business questions from
 * real data: the backend runs the model and its tools in the background, this page shows the
 * question, the live step ("Running query…"), and the answer with its charts, tables and a
 * collapsible "How this was calculated".
 *
 * Access is decided by the server (AdminAgentController's SuperAdmin policy); the admin panel only
 * hides the tab. Progress arrives over SignalR and is backed by polling, so a dropped socket can
 * delay an answer but never lose it.
 */
@Component({
  selector: 'app-analytics-agent',
  imports: [FormsModule, AgentChartComponent],
  templateUrl: './analytics-agent.component.html',
  styleUrls: ['./analytics-agent.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AnalyticsAgentComponent implements OnInit {
  private readonly api = inject(AnalyticsAgentService);
  private readonly signalR = inject(SignalRService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly examplePrompts = AGENT_EXAMPLE_PROMPTS;
  readonly messageList = viewChild<ElementRef<HTMLElement>>('messageList');

  readonly status = signal<AgentStatus | null>(null);
  readonly sessions = signal<AgentSession[]>([]);
  readonly activeSessionId = signal<number | null>(null);
  readonly messages = signal<AgentMessage[]>([]);
  readonly draft = signal('');
  readonly sending = signal(false);
  readonly loadingSession = signal(false);
  readonly errorMessage = signal('');
  readonly renamingId = signal<number | null>(null);
  readonly renameDraft = signal('');

  readonly activeSession = computed(() => this.sessions().find(s => s.id === this.activeSessionId()) ?? null);
  readonly runningMessage = computed(() => this.messages().find(m => m.status === 'running') ?? null);
  readonly canSend = computed(() =>
    !!this.status()?.isConfigured && !this.sending() && !this.runningMessage() && this.draft().trim().length > 0);

  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  /** Rendered markdown per message id + content, so a re-render does not re-parse. */
  private readonly htmlCache = new Map<string, string>();

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => this.stopPolling());
    if (!this.isBrowser) return;

    this.api.status().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: s => this.status.set(s),
      error: err => this.errorMessage.set(extractApiErrorMessage(err, 'Could not load the analytics agent.'))
    });
    this.loadSessions(true);

    this.signalR.adminAgentEvents$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(evt => {
      if (evt.sessionId !== this.activeSessionId()) {
        if (evt.kind === 'completed') this.loadSessions(false);
        return;
      }
      if (evt.kind === 'progress') {
        this.patchMessage(evt.messageId, { progressLabel: evt.label ?? null });
      } else {
        this.refreshMessage(evt.sessionId, evt.messageId);
      }
    });
  }

  // ── Sessions ─────────────────────────────────────────────────────────────────────────────────

  private loadSessions(selectFirst: boolean): void {
    this.api.sessions().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: list => {
        this.sessions.set(list);
        if (selectFirst && list.length > 0 && this.activeSessionId() === null) this.openSession(list[0].id);
      },
      error: err => this.errorMessage.set(extractApiErrorMessage(err, 'Could not load your chats.'))
    });
  }

  openSession(id: number): void {
    this.stopPolling();
    this.activeSessionId.set(id);
    this.messages.set([]);
    this.errorMessage.set('');
    this.loadingSession.set(true);
    this.api.session(id)
      .pipe(finalize(() => this.loadingSession.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: detail => {
          if (this.activeSessionId() !== id) return;
          this.upsertSession(detail.session);
          this.messages.set(detail.messages);
          this.ensurePolling();
          this.scrollToEnd();
        },
        error: err => this.errorMessage.set(extractApiErrorMessage(err, 'Could not open this chat.'))
      });
  }

  newChat(): void {
    this.stopPolling();
    this.activeSessionId.set(null);
    this.messages.set([]);
    this.draft.set('');
    this.errorMessage.set('');
  }

  startRename(session: AgentSession): void {
    this.renamingId.set(session.id);
    this.renameDraft.set(session.title);
  }

  cancelRename(): void {
    this.renamingId.set(null);
  }

  saveRename(session: AgentSession): void {
    const title = this.renameDraft().trim();
    if (!title || title === session.title) {
      this.renamingId.set(null);
      return;
    }
    this.api.rename(session.id, title).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: updated => {
        this.upsertSession(updated);
        this.renamingId.set(null);
      },
      error: err => this.errorMessage.set(extractApiErrorMessage(err, 'Could not rename the chat.'))
    });
  }

  deleteSession(session: AgentSession): void {
    if (this.isBrowser && !window.confirm(`Delete "${session.title}"? This cannot be undone.`)) return;
    this.api.delete(session.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.sessions.update(list => list.filter(s => s.id !== session.id));
        if (this.activeSessionId() === session.id) this.newChat();
      },
      error: err => this.errorMessage.set(extractApiErrorMessage(err, 'Could not delete the chat.'))
    });
  }

  // ── Asking ───────────────────────────────────────────────────────────────────────────────────

  useExample(prompt: string): void {
    this.draft.set(prompt);
    this.send();
  }

  onComposerKeydown(event: KeyboardEvent): void {
    // Enter sends; Shift+Enter is a new line. Never while an IME is composing (Georgian input).
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      this.send();
    }
  }

  retry(message: AgentMessage): void {
    const index = this.messages().findIndex(m => m.id === message.id);
    const question = index > 0 ? this.messages()[index - 1] : null;
    if (question?.role === 'user') {
      this.draft.set(question.content);
      this.send();
    }
  }

  send(): void {
    const text = this.draft().trim();
    if (!text || this.sending() || this.runningMessage() || !this.status()?.isConfigured) return;
    this.sending.set(true);
    this.errorMessage.set('');

    const ask = (sessionId: number) => this.api.ask(sessionId, text)
      .pipe(finalize(() => this.sending.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: started => {
          this.draft.set('');
          this.upsertSession(started.session);
          if (this.activeSessionId() === sessionId)
            this.messages.update(list => [...list, started.userMessage, started.assistantMessage]);
          this.ensurePolling();
          this.scrollToEnd();
        },
        error: err => this.errorMessage.set(extractApiErrorMessage(err, 'The question could not be sent.'))
      });

    const current = this.activeSessionId();
    if (current !== null) {
      ask(current);
      return;
    }
    this.api.createSession().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: session => {
        this.upsertSession(session);
        this.activeSessionId.set(session.id);
        this.messages.set([]);
        ask(session.id);
      },
      error: err => {
        this.sending.set(false);
        this.errorMessage.set(extractApiErrorMessage(err, 'Could not start a new chat.'));
      }
    });
  }

  // ── Running answers ──────────────────────────────────────────────────────────────────────────

  private ensurePolling(): void {
    if (this.pollTimer !== null || !this.isBrowser) return;
    const running = this.runningMessage();
    const sessionId = this.activeSessionId();
    if (!running || sessionId === null) return;
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      const stillRunning = this.runningMessage();
      if (stillRunning && this.activeSessionId() === sessionId)
        this.refreshMessage(sessionId, stillRunning.id);
    }, AGENT_POLL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private refreshMessage(sessionId: number, messageId: number): void {
    this.api.message(sessionId, messageId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: m => {
        if (this.activeSessionId() !== sessionId) return;
        const wasRunning = this.messages().some(x => x.id === m.id && x.status === 'running');
        this.messages.update(list => list.map(x => x.id === m.id ? m : x));
        if (wasRunning && m.status !== 'running') {
          // The answer landed: refresh the session's running cost, and show the answer.
          this.loadSessions(false);
          this.scrollToEnd();
        }
        this.ensurePolling();
      },
      // A failed poll just tries again on the next tick.
      error: () => this.ensurePolling()
    });
  }

  private patchMessage(id: number, patch: Partial<AgentMessage>): void {
    this.messages.update(list => list.map(m => m.id === id && m.status === 'running' ? { ...m, ...patch } : m));
  }

  private upsertSession(session: AgentSession): void {
    this.sessions.update(list => {
      const rest = list.filter(s => s.id !== session.id);
      return [session, ...rest].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
  }

  private scrollToEnd(): void {
    if (!this.isBrowser) return;
    setTimeout(() => {
      const el = this.messageList()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    }, 0);
  }

  // ── Template helpers ─────────────────────────────────────────────────────────────────────────

  html(message: AgentMessage): string {
    const key = `${message.id}:${message.content.length}`;
    let html = this.htmlCache.get(key);
    if (html === undefined) {
      html = renderAgentMarkdown(message.content);
      this.htmlCache.set(key, html);
    }
    return html;
  }

  asChart(part: AgentPart): AgentChartPart | null {
    return part.type === 'chart' ? part : null;
  }

  asTable(part: AgentPart): AgentTablePart | null {
    return part.type === 'table' ? part : null;
  }

  cell(row: Record<string, unknown>, key: string, format: string): string {
    return formatAgentValue(row[key], format as never);
  }

  isNumeric(format: string): boolean {
    return format === 'currency' || format === 'count' || format === 'percent' || format === 'number';
  }

  sessionCost(session: AgentSession | null): string {
    return session ? formatCostUsd(session.estimatedCostUsd) : '—';
  }

  sessionTokens(session: AgentSession | null): string {
    if (!session) return '0';
    return formatTokens(session.inputTokens + session.outputTokens + session.cacheReadTokens + session.cacheWriteTokens);
  }

  messageTokens(m: AgentMessage): string {
    return formatTokens(m.inputTokens + m.outputTokens + m.cacheReadTokens + m.cacheWriteTokens);
  }

  messageCost(m: AgentMessage): string {
    return formatCostUsd(m.costUsd);
  }

  sessionDate(iso: string): string {
    const d = new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  inputJson(value: unknown): string {
    return value === undefined || value === null ? '' : JSON.stringify(value);
  }
}
