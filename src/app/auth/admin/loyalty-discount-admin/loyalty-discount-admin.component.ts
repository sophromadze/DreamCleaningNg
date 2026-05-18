import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AdminService,
  AuditLog,
  LoyaltyDiscountSettingsDto,
  UserPermissions,
} from '../../../services/admin.service';

// Panel A: 7-setting form gated to Admin/SuperAdmin. Panel B: read-only audit feed of
// LoyaltyDiscount changes for the last 30 days. The whole tab is gated upstream by the
// admin layout (View permission required to even reach Discounts → Loyalty); within the
// tab we further gate the Save button on canEdit (Admin/SuperAdmin only — Moderator can
// see the current settings but can't change them).
@Component({
  selector: 'app-loyalty-discount-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './loyalty-discount-admin.component.html',
  styleUrls: ['./loyalty-discount-admin.component.scss'],
})
export class LoyaltyDiscountAdminComponent implements OnInit {
  // ── Panel A: settings ──────────────────────────────────────────────────────────
  settings: LoyaltyDiscountSettingsDto = this.defaultSettings();
  loadingSettings = false;
  savingSettings = false;
  settingsError = '';
  settingsSuccess = '';

  // ── Panel B: recent audit activity ─────────────────────────────────────────────
  // Filtered client-side to entityType === 'UserLoyaltyDiscount'. The backend audit
  // endpoint is already permission-gated (View), so we don't need to re-check here.
  auditLogs: AuditLog[] = [];
  loadingAudit = false;
  auditError = '';

  // Pagination
  currentPage = 1;
  readonly pageSize = 10;

  // ── Permissions ────────────────────────────────────────────────────────────────
  userRole = '';
  // True for Admin + SuperAdmin. Moderator stays false: settings form is read-only,
  // Save button is hidden. Audit panel is visible regardless (read-only by design).
  canEdit = false;

  constructor(private adminService: AdminService) {}

  ngOnInit(): void {
    this.adminService.getUserPermissions().subscribe({
      next: (perms: UserPermissions) => {
        this.userRole = perms.role;
        this.canEdit = perms.role === 'Admin' || perms.role === 'SuperAdmin';
        // Only fetch settings for roles that can actually see Panel A. Moderator only ever
        // sees the audit feed below.
        if (this.canEdit) this.loadSettings();
      },
      error: () => {
        this.userRole = '';
        this.canEdit = false;
      },
    });

    this.loadAudit();
  }

  // ── Settings ────────────────────────────────────────────────────────────────────
  loadSettings(): void {
    this.loadingSettings = true;
    this.settingsError = '';
    this.adminService.getLoyaltyDiscountSettings().subscribe({
      next: (s) => {
        this.settings = s;
        this.loadingSettings = false;
      },
      error: (err) => {
        this.settingsError = err?.error?.message || 'Failed to load settings';
        this.loadingSettings = false;
      },
    });
  }

  saveSettings(): void {
    if (!this.canEdit || this.savingSettings) return;
    this.savingSettings = true;
    this.settingsError = '';
    this.settingsSuccess = '';
    this.adminService.updateLoyaltyDiscountSettings(this.settings).subscribe({
      next: (s) => {
        this.settings = s;
        this.savingSettings = false;
        this.settingsSuccess = 'Settings saved.';
        setTimeout(() => { this.settingsSuccess = ''; }, 4000);
        // Saving may have changed action threshold copy in the audit feed (e.g. percent
        // mentioned in a future Auto* row), but existing rows are immutable — no refresh.
      },
      error: (err) => {
        // Backend 400s for cross-field invariants (day-90 < day-60, days not strictly
        // increasing) come through here with the explicit message.
        this.settingsError = err?.error?.message || 'Failed to save settings.';
        this.savingSettings = false;
      },
    });
  }

  // ── Audit feed ─────────────────────────────────────────────────────────────────
  loadAudit(): void {
    this.loadingAudit = true;
    this.auditError = '';
    this.currentPage = 1;
    this.adminService.getRecentAuditLogs(30).subscribe({
      next: (logs) => {
        this.auditLogs = (logs || [])
          .filter(l => l.entityType === 'UserLoyaltyDiscount')
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        this.loadingAudit = false;
      },
      error: (err) => {
        this.auditError = err?.error?.message || 'Failed to load audit history.';
        this.loadingAudit = false;
      },
    });
  }

  // ── Audit display helpers ──────────────────────────────────────────────────────
  // Action labels exposed in the table. Keep human-readable; the underlying strings are
  // the audit log action codes (LoyaltyAutoActivated etc.) — see LoyaltyDiscountService.
  getActionLabel(action: string): string {
    switch (action) {
      case 'LoyaltyAutoActivated':  return 'Auto-activated';
      case 'LoyaltyAutoUpgraded':   return 'Auto-upgraded';
      case 'LoyaltyManualSet':      return 'Manually set';
      case 'LoyaltyManualCleared':  return 'Cleared';
      case 'LoyaltyUsed':           return 'Used on order';
      case 'LoyaltyReversed':       return 'Restored (order cancelled)';
      default:                      return action;
    }
  }

  // CSS class for the action badge. Palette matches the existing audit-history page:
  // green for activations + sets (positive forward movement), blue for upgrades,
  // gray for cleared (no longer in effect), orange for used (drained), red for reversed.
  getActionClass(action: string): string {
    switch (action) {
      case 'LoyaltyAutoActivated':
      case 'LoyaltyManualSet':       return 'action-create';
      case 'LoyaltyAutoUpgraded':    return 'action-update';
      case 'LoyaltyManualCleared':   return 'action-cleared';
      case 'LoyaltyUsed':            return 'action-used';
      case 'LoyaltyReversed':        return 'action-reversed';
      default:                       return '';
    }
  }

  // Parses the JSON old/new value bundles the backend stores for loyalty audit rows so
  // the table can show "10% → 15%" succinctly without exposing raw JSON.
  getOldPercentage(log: AuditLog): string {
    return this.formatPercentage(this.parseValues(log.oldValues)?.['Percentage']);
  }

  getNewPercentage(log: AuditLog): string {
    return this.formatPercentage(this.parseValues(log.newValues)?.['Percentage']);
  }

  private parseValues(raw: any): Record<string, any> | null {
    if (raw == null) return null;
    if (typeof raw === 'object') return raw as Record<string, any>;
    try { return JSON.parse(raw); } catch { return null; }
  }

  private formatPercentage(v: any): string {
    if (v === null || v === undefined) return '—';
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    return `${n}%`;
  }

  // ── Pagination ─────────────────────────────────────────────────────────────────
  get pagedLogs(): AuditLog[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.auditLogs.slice(start, start + this.pageSize);
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.auditLogs.length / this.pageSize));
  }

  goToPage(p: number): void {
    if (p < 1 || p > this.totalPages) return;
    this.currentPage = p;
  }

  // ── Formatting ─────────────────────────────────────────────────────────────────
  formatWhen(date: any): string {
    if (!date) return '—';
    const d = new Date(date);
    return Number.isNaN(d.getTime()) ? String(date) : d.toLocaleString();
  }

  // ── Internals ──────────────────────────────────────────────────────────────────
  private defaultSettings(): LoyaltyDiscountSettingsDto {
    return {
      loyaltyDiscountEnabled: true,
      loyaltyDay60Percentage: 10,
      loyaltyDay90Percentage: 15,
      daysUntilFirstReminder: 30,
      daysUntilDiscountActivation: 60,
      daysUntilDiscountUpgrade: 90,
      minDaysFromLastUseBeforeReActivation: 30,
    };
  }
}
