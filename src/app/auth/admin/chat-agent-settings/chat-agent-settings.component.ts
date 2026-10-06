import { Component, ElementRef, HostListener, OnDestroy, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ChatAgentAdminService,
  ChatAgentSettings,
  ChatVisibilityMode
} from '../../../services/chat-agent-admin.service';

interface VisibilityOption {
  mode: ChatVisibilityMode;
  label: string;
  description: string;
}

/**
 * Admin-header popover controlling the AI chat agent's runtime settings —
 * widget visibility (Disabled / AdminOnly / Public, enforced server-side on the
 * chat API too) and the escalation email toggle. Lives next to the Maintenance
 * button, where the old live-chat toggle used to be. The host gates rendering
 * to Admin/SuperAdmin (matching the backend authorization).
 */
@Component({
  selector: 'app-chat-agent-settings',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './chat-agent-settings.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './chat-agent-settings.component.scss'
})
export class ChatAgentSettingsComponent implements OnDestroy {
  private adminService = inject(ChatAgentAdminService);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly visibilityOptions: VisibilityOption[] = [
    { mode: 'Disabled', label: 'Disabled', description: 'Hidden from everyone — the chat button does not appear and the chat API is closed.' },
    { mode: 'AdminOnly', label: 'Admin Only', description: 'Visible only to logged-in admins, for testing. Customers never see it.' },
    { mode: 'Public', label: 'Public', description: 'Visible to all website visitors.' }
  ];

  readonly isOpen = signal(false);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly settings = signal<ChatAgentSettings | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly errorMessage = signal<string | null>(null);

  private successTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnDestroy(): void {
    if (this.successTimer) clearTimeout(this.successTimer);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.isOpen() && !this.host.nativeElement.contains(event.target as Node)) {
      this.isOpen.set(false);
    }
  }

  togglePanel(): void {
    this.isOpen.set(!this.isOpen());
    if (this.isOpen()) this.loadSettings(); // fresh values on every open
  }

  get widgetStatusLabel(): string {
    switch (this.settings()?.visibilityMode) {
      case 'Public': return 'Public';
      case 'AdminOnly': return 'Admin Only';
      case 'Disabled': return 'Disabled';
      default: return '…';
    }
  }

  /** Backend DateTime serializes without a UTC marker once round-tripped through
   * MySQL — normalize so the date pipe renders correct local time. */
  get updatedAtLocal(): Date | null {
    const raw = this.settings()?.updatedAt;
    if (!raw) return null;
    return new Date(/Z|[+-]\d\d:\d\d$/.test(raw) ? raw : raw + 'Z');
  }

  onVisibilitySelected(mode: ChatVisibilityMode): void {
    if (this.saving() || !this.settings() || this.settings()!.visibilityMode === mode) return;

    if (mode === 'Public' &&
        !confirm('Are you sure? This will make the chat visible to ALL website visitors.')) {
      return; // radio [checked] binds to settings.visibilityMode, so it stays put
    }

    this.saving.set(true);
    this.clearMessages();
    this.adminService.setVisibility(mode).subscribe({
      next: updated => {
        this.saving.set(false);
        this.settings.set(updated);
        this.showSuccess(`Chat visibility set to ${this.widgetStatusLabel}.`);
      },
      error: () => {
        this.saving.set(false);
        // settings untouched → radios revert to the real server value
        this.errorMessage.set('Could not save visibility — nothing was changed. Please try again.');
      }
    });
  }

  onToggleEscalationEmail(): void {
    if (this.saving() || !this.settings()) return;

    this.saving.set(true);
    this.clearMessages();
    this.adminService.toggleEscalationEmail().subscribe({
      next: updated => {
        this.saving.set(false);
        this.settings.set(updated);
        this.showSuccess(`Escalation email ${updated.escalationEmailEnabled ? 'enabled' : 'disabled'}.`);
      },
      error: () => {
        this.saving.set(false);
        this.errorMessage.set('Could not save the email setting — nothing was changed. Please try again.');
      }
    });
  }

  private loadSettings(): void {
    this.loading.set(true);
    this.clearMessages();
    this.adminService.getSettings().subscribe({
      next: settings => {
        this.loading.set(false);
        this.settings.set(settings);
      },
      error: () => {
        this.loading.set(false);
        this.errorMessage.set('Could not load chat agent settings.');
      }
    });
  }

  private showSuccess(message: string): void {
    this.successMessage.set(message);
    if (this.successTimer) clearTimeout(this.successTimer);
    this.successTimer = setTimeout(() => (this.successMessage.set(null)), 3000);
  }

  private clearMessages(): void {
    this.successMessage.set(null);
    this.errorMessage.set(null);
  }
}
