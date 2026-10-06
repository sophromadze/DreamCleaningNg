import { Component, OnInit, ChangeDetectionStrategy, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ChatAgentAdminService,
  ChatAdminTranscript,
  ChatSessionListItem,
  ChatSessionStatus,
  TelegramAgentDisplayName,
  UnmappedTelegramSender
} from '../../../services/chat-agent-admin.service';
import { ChatMarkdownPipe } from '../../../shared/pipes/chat-markdown.pipe';

/**
 * Admin "Chats" tab — paginated list of AI chat sessions with a right slide-in
 * transcript panel (Orders/Users detail-panel convention). Rendering mirrors the
 * customer widget (user right, assistant/team left, inline images) plus the
 * admin-only System audit notes (escalation reasons) shown as centered notes.
 * Backend endpoints are SuperAdmin/Admin; the tab button is role-gated in the shell.
 */
@Component({
  selector: 'app-chat-sessions',
  standalone: true,
  imports: [CommonModule, FormsModule, ChatMarkdownPipe],
  templateUrl: './chat-sessions.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './chat-sessions.component.scss'
})
export class ChatSessionsComponent implements OnInit {
  private adminService = inject(ChatAgentAdminService);

  /** Passed from the admin shell — hard-delete is gated to SuperAdmin only. */
  readonly userRole = input('');

  readonly sessions = signal<ChatSessionListItem[]>([]);
  readonly totalCount = signal(0);
  readonly totalPages = signal(0);
  readonly page = signal(1);
  readonly pageSize = 20;

  readonly filterStatus = signal<ChatSessionStatus | ''>('');
  readonly filterFrom = signal('');
  readonly filterTo = signal('');

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  // Slide-in transcript panel
  readonly selectedSession = signal<ChatSessionListItem | null>(null, { equal: () => false });
  readonly transcript = signal<ChatAdminTranscript | null>(null, { equal: () => false });
  readonly transcriptLoading = signal(false);
  readonly transcriptError = signal<string | null>(null);

  // Agent display names panel (Telegram id → visitor-facing name; resolved at
  // read time, so edits retroactively rename that agent's past replies).
  readonly showAgentNames = signal(false);
  readonly agentNames = signal<TelegramAgentDisplayName[]>([]);
  readonly unmappedSenders = signal<UnmappedTelegramSender[]>([]);
  readonly agentNamesLoading = signal(false);
  readonly agentNamesError = signal<string | null>(null);
  /** Per-row edit buffers, keyed by Telegram user id (mappings + unmapped rows). */
  readonly nameEdits = signal<{ [telegramUserId: number]: string }>({}, { equal: () => false });
  readonly newTelegramUserId = signal('');
  readonly newDisplayName = signal('');

  ngOnInit(): void {
    this.loadSessions();
  }

  loadSessions(): void {
    this.loading.set(true);
    this.error.set(null);
    this.adminService.getSessions({
      status: this.filterStatus(),
      from: this.filterFrom() || undefined,
      to: this.filterTo() || undefined,
      page: this.page(),
      pageSize: this.pageSize
    }).subscribe({
      next: response => {
        this.loading.set(false);
        this.sessions.set(response.items);
        this.totalCount.set(response.totalCount);
        this.totalPages.set(response.totalPages);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Could not load chat sessions.');
      }
    });
  }

  applyFilters(): void {
    this.page.set(1);
    this.loadSessions();
  }

  clearFilters(): void {
    this.filterStatus.set('');
    this.filterFrom.set('');
    this.filterTo.set('');
    this.applyFilters();
  }

  goToPage(page: number): void {
    if (page < 1 || (this.totalPages() > 0 && page > this.totalPages()) || page === this.page()) return;
    this.page.set(page);
    this.loadSessions();
  }

  // ===== Transcript panel =====

  openSession(session: ChatSessionListItem): void {
    this.selectedSession.set(session);
    this.transcript.set(null);
    this.loadTranscript();
  }

  closePanel(): void {
    this.selectedSession.set(null);
    this.transcript.set(null);
    this.transcriptError.set(null);
  }

  /** Admin "Mark Resolved" — ends the conversation for the customer too (their
   * widget picks the status up on its next poll and shows the ended state). */
  resolveSelectedSession(): void {
    if (!this.selectedSession() || this.selectedSession()!.status === 'Resolved') return;
    if (!confirm('Mark this conversation as resolved? The customer will no longer be able to reply in it.')) return;

    this.adminService.resolveSession(this.selectedSession()!.id).subscribe({
      next: () => {
        if (this.selectedSession()) { this.selectedSession()!.status = 'Resolved'; this.selectedSession.set(this.selectedSession()); }
        if (this.transcript()) { this.transcript()!.status = 'Resolved'; this.transcript.set(this.transcript()); }
        this.loadTranscript(); // pick up the audit note
        this.loadSessions();   // refresh the list badge
      },
      error: () => {
        this.transcriptError.set('Could not mark the session as resolved.');
      }
    });
  }

  get isSuperAdmin(): boolean {
    return this.userRole() === 'SuperAdmin';
  }

  /** SuperAdmin hard-delete — permanent, removes messages + images. Works from the
   * list row (pass the event to stop the row-open click) or the transcript panel. */
  deleteSession(session: ChatSessionListItem, event?: Event): void {
    event?.stopPropagation();
    if (!this.isSuperAdmin) return;
    if (!confirm('This will permanently delete this entire conversation and all its images. This cannot be undone. Continue?')) return;

    this.adminService.deleteSession(session.id).subscribe({
      next: () => {
        this.sessions.set(this.sessions().filter(s => s.id !== session.id));
        this.totalCount.set(Math.max(0, this.totalCount() - 1));
        if (this.selectedSession()?.id === session.id) this.closePanel();
        this.error.set(null);
        this.successMessage.set('Conversation deleted.');
        setTimeout(() => (this.successMessage.set(null)), 3000);
      },
      error: () => {
        this.transcriptError.set(null);
        this.error.set('Could not delete the conversation.');
      }
    });
  }

  /** Also used by the panel's refresh button while watching an active chat. */
  loadTranscript(): void {
    if (!this.selectedSession()) return;
    this.transcriptLoading.set(true);
    this.transcriptError.set(null);
    this.adminService.getTranscript(this.selectedSession()!.id).subscribe({
      next: transcript => {
        this.transcriptLoading.set(false);
        this.transcript.set(transcript);
      },
      error: () => {
        this.transcriptLoading.set(false);
        this.transcriptError.set('Could not load the transcript.');
      }
    });
  }

  // ===== Agent display names =====

  toggleAgentNames(): void {
    this.showAgentNames.set(!this.showAgentNames());
    if (this.showAgentNames() && this.agentNames().length === 0 && this.unmappedSenders().length === 0) {
      this.loadAgentNames();
    }
  }

  loadAgentNames(): void {
    this.agentNamesLoading.set(true);
    this.agentNamesError.set(null);
    this.adminService.getAgentDisplayNames().subscribe({
      next: response => {
        this.agentNamesLoading.set(false);
        this.agentNames.set(response.mappings);
        this.unmappedSenders.set(response.unmappedSenders);
        this.nameEdits.set({});
        for (const m of response.mappings) {
          this.nameEdits()[m.telegramUserId] = m.displayName;
        }
        this.nameEdits.set(this.nameEdits());
      },
      error: () => {
        this.agentNamesLoading.set(false);
        this.agentNamesError.set('Could not load agent names.');
      }
    });
  }

  /** Upsert from a mapping row's inline edit or an unmapped sender's name input. */
  saveAgentName(telegramUserId: number): void {
    const name = (this.nameEdits()[telegramUserId] || '').trim();
    if (!name) return;
    this.agentNamesError.set(null);
    this.adminService.upsertAgentDisplayName(telegramUserId, name).subscribe({
      next: () => {
        this.loadAgentNames();
        // Names resolve at read time — refresh an open transcript so the rename shows.
        if (this.selectedSession()) this.loadTranscript();
      },
      error: () => {
        this.agentNamesError.set('Could not save the name.');
      }
    });
  }

  addAgentName(): void {
    const id = Number((this.newTelegramUserId() || '').trim());
    const name = (this.newDisplayName() || '').trim();
    if (!Number.isInteger(id) || id <= 0) {
      this.agentNamesError.set('Telegram user ID must be a positive number.');
      return;
    }
    if (!name) {
      this.agentNamesError.set('Display name is required.');
      return;
    }
    this.agentNamesError.set(null);
    this.adminService.upsertAgentDisplayName(id, name).subscribe({
      next: () => {
        this.newTelegramUserId.set('');
        this.newDisplayName.set('');
        this.loadAgentNames();
        if (this.selectedSession()) this.loadTranscript();
      },
      error: () => {
        this.agentNamesError.set('Could not add the mapping.');
      }
    });
  }

  deleteAgentName(mapping: TelegramAgentDisplayName): void {
    if (!confirm(`Remove the name "${mapping.displayName}"? That person's replies will show as "Team" again.`)) return;
    this.agentNamesError.set(null);
    this.adminService.deleteAgentDisplayName(mapping.telegramUserId).subscribe({
      next: () => {
        this.loadAgentNames();
        if (this.selectedSession()) this.loadTranscript();
      },
      error: () => {
        this.agentNamesError.set('Could not remove the mapping.');
      }
    });
  }

  /** Save is enabled only when the buffer holds a non-empty CHANGE. */
  isNameChanged(mapping: TelegramAgentDisplayName): boolean {
    const edited = (this.nameEdits()[mapping.telegramUserId] || '').trim();
    return edited.length > 0 && edited !== mapping.displayName;
  }

  // ===== Display helpers =====

  identityLabel(session: { userEmail: string | null; guestIdentifier: string | null; guestEmail?: string | null }): string {
    if (session.userEmail) return session.userEmail;
    // Guest who left contact info — keep the "Guest:" prefix so it stays distinct
    // from a registered user's email in the same column.
    if (session.guestEmail) return `Guest: ${session.guestEmail}`;
    if (session.guestIdentifier) return `Guest · ${session.guestIdentifier.substring(0, 12)}`;
    return 'Guest';
  }

  statusLabel(status: ChatSessionStatus): string {
    switch (status) {
      case 'EscalatedToHuman': return 'Escalated';
      case 'Resolved': return 'Resolved';
      default: return 'AI';
    }
  }

  statusClass(status: ChatSessionStatus): string {
    switch (status) {
      case 'EscalatedToHuman': return 'badge--escalated';
      case 'Resolved': return 'badge--resolved';
      default: return 'badge--ai';
    }
  }

  /** Backend DateTime serializes without a UTC marker after the MySQL round-trip —
   * normalize so the date pipe renders correct local time. */
  asLocalDate(raw: string): Date {
    return new Date(/Z|[+-]\d\d:\d\d$/.test(raw) ? raw : raw + 'Z');
  }
}
