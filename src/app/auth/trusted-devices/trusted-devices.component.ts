import { Component, OnInit, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { TwoFactorService, TrustedDevice } from '../../services/two-factor.service';
import { AuthService } from '../../services/auth.service';
import { formatNy } from '../../shared/ny-time.util';

@Component({
  selector: 'app-trusted-devices',
  standalone: true,
  imports: [],
  templateUrl: './trusted-devices.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./trusted-devices.component.scss']
})
export class TrustedDevicesComponent implements OnInit {
  private twoFactor = inject(TwoFactorService);
  private auth = inject(AuthService);

  readonly devices = signal<TrustedDevice[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly notice = signal('');

  // Confirm-row state: inline "Are you sure?" instead of a modal.
  readonly pendingRevokeId = signal<number | null>(null);
  readonly revoking = signal(false);

  // "Sign out all other devices" — also reaches devices that were never trusted, which is why
  // it exists beside the per-device Remove.
  readonly confirmingSignOutOthers = signal(false);
  readonly signingOutOthers = signal(false);

  // Only render the section for staff roles — customers don't have 2FA so the list is
  // always empty for them anyway, but we hide it to avoid confusion.
  showSection = false;

  ngOnInit(): void {
    const role = this.auth.currentUserValue?.role;
    this.showSection = role === 'Admin' || role === 'SuperAdmin' || role === 'Moderator';
    if (this.showSection) this.load();
  }

  load(): void {
    this.loading.set(true);
    this.twoFactor.listTrustedDevices().subscribe({
      next: (rows) => { this.devices.set(rows); this.loading.set(false); },
      error: (err) => {
        this.error.set(err.error?.message || 'Failed to load trusted devices');
        this.loading.set(false);
      }
    });
  }

  askRevoke(id: number): void {
    this.pendingRevokeId.set(id);
  }

  cancelRevoke(): void {
    this.pendingRevokeId.set(null);
  }

  confirmRevoke(): void {
    const id = this.pendingRevokeId();
    if (id == null || this.revoking()) return;
    const wasCurrent = !!this.devices().find(d => d.id === id)?.isCurrentDevice;
    this.revoking.set(true);
    this.auth.trackSessionReissue(this.twoFactor.revokeTrustedDevice(id)).subscribe({
      next: (res) => {
        this.revoking.set(false);
        this.pendingRevokeId.set(null);
        if (wasCurrent) {
          // Revoking the current device means the next login from here requires 2FA again.
          // The server-side revocation is authoritative; the now-inert local token is left
          // in place because the storage is shared with other staff users of this browser.
          this.flashNotice('Device revoked. You\'ll need 2FA the next time you sign in here.');
        } else if (res?.sessionsEnded) {
          this.flashNotice('Device removed and signed out. Your other devices will need to sign in again.');
        } else {
          this.flashNotice('Device revoked.');
        }
        this.load();
      },
      error: (err) => {
        this.revoking.set(false);
        this.error.set(err.error?.message || 'Failed to revoke device');
      }
    });
  }

  askSignOutOthers(): void {
    this.confirmingSignOutOthers.set(true);
  }

  cancelSignOutOthers(): void {
    this.confirmingSignOutOthers.set(false);
  }

  confirmSignOutOthers(): void {
    if (this.signingOutOthers()) return;
    this.signingOutOthers.set(true);
    this.error.set('');
    this.auth.trackSessionReissue(this.twoFactor.signOutOtherSessions()).subscribe({
      next: () => {
        this.signingOutOthers.set(false);
        this.confirmingSignOutOthers.set(false);
        this.flashNotice('Signed out of every other device.');
        this.load();
      },
      error: (err) => {
        this.signingOutOthers.set(false);
        this.error.set(err.error?.message || 'Failed to sign out other devices');
      }
    });
  }

  formatDate(iso: string): string {
    // createdAt/lastUsedAt are UTC — display in NY (business) time.
    return formatNy(iso, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  private flashNotice(msg: string): void {
    this.notice.set(msg);
    setTimeout(() => this.notice.set(''), 4000);
  }
}
