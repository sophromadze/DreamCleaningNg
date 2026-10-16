import { ChangeDetectionStrategy, Component, DOCUMENT, OnInit, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { finalize } from 'rxjs';
import { ClaudeConnectorService, ConnectorAuthorizeCheck } from '../services/claude-connector.service';
import { extractApiErrorMessage } from '../utils/http-error.utils';

type ConsentState = 'loading' | 'consent' | 'refused' | 'invalid';

/**
 * /connect/authorize — the consent step of the Claude connector's OAuth flow (2026-10).
 *
 * Claude opens `api/oauth/authorize`, which checks the client and redirect URI and sends the
 * browser here with the same query string. The route is behind the site's normal sign-in
 * (email/password, Google, Apple — and 2FA for staff), so by the time this renders somebody is
 * signed in. The page shows who is asking and WHERE the answer goes, and only a SuperAdmin gets an
 * Allow button; everyone else is told why and can only send Claude a refusal. The server decides
 * all of it again on the decision call.
 */
@Component({
  selector: 'app-connect-authorize',
  templateUrl: './connect-authorize.component.html',
  styleUrls: ['./connect-authorize.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ConnectAuthorizeComponent implements OnInit {
  private readonly api = inject(ClaudeConnectorService);
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly state = signal<ConsentState>('loading');
  readonly details = signal<ConnectorAuthorizeCheck | null>(null);
  readonly errorMessage = signal('');
  readonly busy = signal(false);

  /** The query exactly as received — the server validates the same string it issued. */
  private query = '';

  ngOnInit(): void {
    if (!this.isBrowser) return;
    this.query = (this.document.location?.search ?? '').replace(/^\?/, '');
    this.api.check(this.query).subscribe({
      next: details => {
        this.details.set(details);
        this.state.set(details.canApprove ? 'consent' : 'refused');
      },
      error: err => {
        this.errorMessage.set(extractApiErrorMessage(err, 'This connection request is not valid. Start again from Claude.'));
        this.state.set('invalid');
      }
    });
  }

  allow(): void {
    this.decide(true);
  }

  deny(): void {
    this.decide(false);
  }

  private decide(approve: boolean): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.errorMessage.set('');
    this.api.decide(this.query, approve)
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: ({ redirectUrl }) => this.navigate(redirectUrl),
        error: err => this.errorMessage.set(extractApiErrorMessage(err, 'Could not complete the connection. Try again from Claude.'))
      });
  }

  /** Leaves the SPA for Claude's callback. Separate so the spec can observe it. */
  navigate(url: string): void {
    this.document.location.href = url;
  }
}
