import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TwoFactorService, TrustedDevice } from '../../services/two-factor.service';
import { AuthService } from '../../services/auth.service';
import { formatNy } from '../../shared/ny-time.util';

@Component({
  selector: 'app-trusted-devices',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './trusted-devices.component.html',
  styleUrls: ['./trusted-devices.component.scss']
})
export class TrustedDevicesComponent implements OnInit {
  devices: TrustedDevice[] = [];
  loading = false;
  error = '';
  notice = '';

  // Confirm-row state: inline "Are you sure?" instead of a modal.
  pendingRevokeId: number | null = null;
  revoking = false;

  // Only render the section for staff roles — customers don't have 2FA so the list is
  // always empty for them anyway, but we hide it to avoid confusion.
  showSection = false;

  constructor(
    private twoFactor: TwoFactorService,
    private auth: AuthService
  ) {}

  ngOnInit(): void {
    const role = this.auth.currentUserValue?.role;
    this.showSection = role === 'Admin' || role === 'SuperAdmin' || role === 'Moderator';
    if (this.showSection) this.load();
  }

  load(): void {
    this.loading = true;
    this.twoFactor.listTrustedDevices().subscribe({
      next: (rows) => { this.devices = rows; this.loading = false; },
      error: (err) => {
        this.error = err.error?.message || 'Failed to load trusted devices';
        this.loading = false;
      }
    });
  }

  askRevoke(id: number): void {
    this.pendingRevokeId = id;
  }

  cancelRevoke(): void {
    this.pendingRevokeId = null;
  }

  confirmRevoke(): void {
    if (this.pendingRevokeId == null || this.revoking) return;
    const id = this.pendingRevokeId;
    const wasCurrent = !!this.devices.find(d => d.id === id)?.isCurrentDevice;
    this.revoking = true;
    this.twoFactor.revokeTrustedDevice(id).subscribe({
      next: () => {
        this.revoking = false;
        this.pendingRevokeId = null;
        if (wasCurrent) {
          // Revoking the current device means the next login from here requires 2FA again.
          // Clear the local token so it doesn't sit around stale.
          this.twoFactor.clearDeviceToken();
          this.flashNotice('Device revoked. You\'ll need 2FA the next time you sign in here.');
        } else {
          this.flashNotice('Device revoked.');
        }
        this.load();
      },
      error: (err) => {
        this.revoking = false;
        this.error = err.error?.message || 'Failed to revoke device';
      }
    });
  }

  formatDate(iso: string): string {
    // createdAt/lastUsedAt are UTC — display in NY (business) time.
    return formatNy(iso, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  private flashNotice(msg: string): void {
    this.notice = msg;
    setTimeout(() => this.notice = '', 4000);
  }
}
