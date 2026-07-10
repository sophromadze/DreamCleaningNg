import { Component, ElementRef, HostListener, OnDestroy } from '@angular/core';
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
  styleUrl: './chat-agent-settings.component.scss'
})
export class ChatAgentSettingsComponent implements OnDestroy {
  readonly visibilityOptions: VisibilityOption[] = [
    { mode: 'Disabled', label: 'Disabled', description: 'Hidden from everyone — the chat button does not appear and the chat API is closed.' },
    { mode: 'AdminOnly', label: 'Admin Only', description: 'Visible only to logged-in admins, for testing. Customers never see it.' },
    { mode: 'Public', label: 'Public', description: 'Visible to all website visitors.' }
  ];

  isOpen = false;
  loading = false;
  saving = false;
  settings: ChatAgentSettings | null = null;
  successMessage: string | null = null;
  errorMessage: string | null = null;

  private successTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private adminService: ChatAgentAdminService,
    private host: ElementRef<HTMLElement>
  ) {}

  ngOnDestroy(): void {
    if (this.successTimer) clearTimeout(this.successTimer);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.isOpen && !this.host.nativeElement.contains(event.target as Node)) {
      this.isOpen = false;
    }
  }

  togglePanel(): void {
    this.isOpen = !this.isOpen;
    if (this.isOpen) this.loadSettings(); // fresh values on every open
  }

  get widgetStatusLabel(): string {
    switch (this.settings?.visibilityMode) {
      case 'Public': return 'Public';
      case 'AdminOnly': return 'Admin Only';
      case 'Disabled': return 'Disabled';
      default: return '…';
    }
  }

  /** Backend DateTime serializes without a UTC marker once round-tripped through
   * MySQL — normalize so the date pipe renders correct local time. */
  get updatedAtLocal(): Date | null {
    const raw = this.settings?.updatedAt;
    if (!raw) return null;
    return new Date(/Z|[+-]\d\d:\d\d$/.test(raw) ? raw : raw + 'Z');
  }

  onVisibilitySelected(mode: ChatVisibilityMode): void {
    if (this.saving || !this.settings || this.settings.visibilityMode === mode) return;

    if (mode === 'Public' &&
        !confirm('Are you sure? This will make the chat visible to ALL website visitors.')) {
      return; // radio [checked] binds to settings.visibilityMode, so it stays put
    }

    this.saving = true;
    this.clearMessages();
    this.adminService.setVisibility(mode).subscribe({
      next: updated => {
        this.saving = false;
        this.settings = updated;
        this.showSuccess(`Chat visibility set to ${this.widgetStatusLabel}.`);
      },
      error: () => {
        this.saving = false;
        // settings untouched → radios revert to the real server value
        this.errorMessage = 'Could not save visibility — nothing was changed. Please try again.';
      }
    });
  }

  onToggleEscalationEmail(): void {
    if (this.saving || !this.settings) return;

    this.saving = true;
    this.clearMessages();
    this.adminService.toggleEscalationEmail().subscribe({
      next: updated => {
        this.saving = false;
        this.settings = updated;
        this.showSuccess(`Escalation email ${updated.escalationEmailEnabled ? 'enabled' : 'disabled'}.`);
      },
      error: () => {
        this.saving = false;
        this.errorMessage = 'Could not save the email setting — nothing was changed. Please try again.';
      }
    });
  }

  private loadSettings(): void {
    this.loading = true;
    this.clearMessages();
    this.adminService.getSettings().subscribe({
      next: settings => {
        this.loading = false;
        this.settings = settings;
      },
      error: () => {
        this.loading = false;
        this.errorMessage = 'Could not load chat agent settings.';
      }
    });
  }

  private showSuccess(message: string): void {
    this.successMessage = message;
    if (this.successTimer) clearTimeout(this.successTimer);
    this.successTimer = setTimeout(() => (this.successMessage = null), 3000);
  }

  private clearMessages(): void {
    this.successMessage = null;
    this.errorMessage = null;
  }
}
