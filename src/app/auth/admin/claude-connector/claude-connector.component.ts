import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { finalize } from 'rxjs';
import { ClaudeConnectorService, ConnectorSession } from '../../../services/claude-connector.service';
import { parseUtcDate } from '../../../shared/ny-time.util';
import { extractApiErrorMessage } from '../../../utils/http-error.utils';

/**
 * Admin → Claude Connector (2026-10, SuperAdmin only). Shows the connector URL to paste into
 * Claude, how to add it, and every live connector session (who, which client, created, last
 * used, tool calls) with a Revoke button. The server's AdminAgentSuperAdmin policy is the
 * boundary; the admin panel only hides the tab.
 */
@Component({
  selector: 'app-claude-connector',
  templateUrl: './claude-connector.component.html',
  styleUrls: ['./claude-connector.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ClaudeConnectorComponent implements OnInit {
  private readonly api = inject(ClaudeConnectorService);

  readonly loading = signal(true);
  readonly serverUrl = signal('');
  readonly sessions = signal<ConnectorSession[]>([]);
  readonly errorMessage = signal('');
  readonly copied = signal(false);
  readonly confirmingId = signal<number | null>(null);
  readonly revokingId = signal<number | null>(null);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api.sessions()
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: data => {
          this.serverUrl.set(data.serverUrl);
          this.sessions.set(data.sessions);
        },
        error: err => this.errorMessage.set(extractApiErrorMessage(err, 'Could not load the connector sessions.'))
      });
  }

  copyUrl(): void {
    const url = this.serverUrl();
    if (!url) return;
    navigator.clipboard?.writeText(url).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    });
  }

  askRevoke(id: number): void {
    this.confirmingId.set(id);
  }

  cancelRevoke(): void {
    this.confirmingId.set(null);
  }

  revoke(id: number): void {
    this.revokingId.set(id);
    this.errorMessage.set('');
    this.api.revoke(id)
      .pipe(finalize(() => this.revokingId.set(null)))
      .subscribe({
        next: () => {
          this.confirmingId.set(null);
          this.sessions.update(list => list.filter(s => s.id !== id));
        },
        error: err => this.errorMessage.set(extractApiErrorMessage(err, 'Could not revoke that session.'))
      });
  }

  /** The server sends UTC without a zone; shown in the admin's own time. */
  formatWhen(value: string | null | undefined): string {
    const date = parseUtcDate(value ?? null);
    return date
      ? date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
      : '—';
  }
}
