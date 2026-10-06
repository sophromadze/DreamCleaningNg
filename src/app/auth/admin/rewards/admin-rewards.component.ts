import { Component, OnInit, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { BubbleRewardsService, RewardsSettings, RewardsStats } from '../../../services/bubble-rewards.service';
import { AdminService, UserAdmin } from '../../../services/admin.service';
import { AuthService } from '../../../services/auth.service';
import { NyDatePipe } from '../../../shared/ny-time.util';

interface CategoryGroup {
  category: string;
  settings: RewardsSettings[];
  open: boolean;
  pendingChanges: Record<string, string | undefined>;
  saving: boolean;
}

@Component({
  selector: 'app-admin-rewards',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, NyDatePipe],
  templateUrl: './admin-rewards.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './admin-rewards.component.scss'
})
export class AdminRewardsComponent implements OnInit {
  private bubbleRewardsService = inject(BubbleRewardsService);
  private adminService = inject(AdminService);
  private authService = inject(AuthService);

  readonly activeTab = signal<'settings' | 'stats'>('settings');

  // Settings tab
  readonly categoryGroups = signal<CategoryGroup[]>([]);
  readonly settingsLoading = signal(true);
  readonly settingsSaveMessage = signal('');
  readonly masterSwitch = signal(true);

  // Stats tab
  readonly stats = signal<RewardsStats | null>(null);
  readonly statsLoading = signal(false);

  // Reset modal
  readonly showResetModal = signal(false);
  readonly resetTarget = signal<'all' | 'specific'>('all');
  readonly resetUserId = signal<number | null>(null);
  readonly resetUserSearch = signal('');
  userList: UserAdmin[] = [];
  readonly filteredUsers = signal<UserAdmin[]>([]);
  readonly resetLoading = signal(false);
  readonly resetMessage = signal('');
  readonly resetError = signal('');
  readonly undoAvailable = signal(false);
  readonly undoLoading = signal(false);
  readonly undoCreatedAt = signal('');
  readonly undoScope = signal<'all' | 'specific' | ''>('');

  /** Kept as a belt-and-braces check on the controls. Since 2026-09 the Rewards tab is
   *  SuperAdmin-only (hidden in the panel, [Authorize(Roles = "SuperAdmin")] on the reads), so
   *  in practice nobody who gets here is read-only -- but the writes stay gated on it rather
   *  than assuming the surrounding gate. */
  canEdit = false;

  constructor() {
    this.canEdit = this.authService.currentUserValue?.role === 'SuperAdmin';
  }

  ngOnInit(): void {
    this.loadSettings();
  }

  loadSettings(): void {
    this.settingsLoading.set(true);
    this.bubbleRewardsService.getAdminSettings().subscribe({
      next: (settings) => {
        this.buildCategoryGroups(settings);
        this.settingsLoading.set(false);
        const masterSetting = settings.find(s => s.settingKey === 'PointsSystemEnabled');
        if (masterSetting) this.masterSwitch.set(masterSetting.settingValue === 'true');
      },
      error: () => { this.settingsLoading.set(false); }
    });
  }

  buildCategoryGroups(settings: RewardsSettings[]): void {
    const categories = [...new Set(settings.map(s => s.category))];
    this.categoryGroups.set(categories.map(cat => ({
      category: cat,
      settings: settings.filter(s => s.category === cat),
      open: cat === 'Points' || cat === 'Tiers',
      pendingChanges: {},
      saving: false
    })));
  }

  onSettingChange(group: CategoryGroup, key: string, value: string): void {
    group.pendingChanges[key] = value;
  }

  saveCategory(group: CategoryGroup): void {
    const updates = Object.entries(group.pendingChanges)
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([key, value]) => ({ key, value }));
    if (updates.length === 0) return;

    group.saving = true;
    this.bubbleRewardsService.bulkUpdateSettings(updates).subscribe({
      next: () => {
        group.saving = false;
        group.pendingChanges = {};
        this.settingsSaveMessage.set(`Saved ${group.category} settings.`);
        setTimeout(() => this.settingsSaveMessage.set(''), 3000);
        // Update local settings values
        updates.forEach(u => {
          const s = group.settings.find(s => s.settingKey === u.key);
          if (s) s.settingValue = u.value;
        });
      },
      error: () => { group.saving = false; }
    });
  }

  toggleMasterSwitch(enabled: boolean): void {
    const val = enabled ? 'true' : 'false';
    this.bubbleRewardsService.updateAdminSetting('PointsSystemEnabled', val).subscribe({
      next: () => {
        this.masterSwitch.set(enabled);
        this.settingsSaveMessage.set(`Rewards system ${enabled ? 'enabled' : 'disabled'}.`);
        setTimeout(() => this.settingsSaveMessage.set(''), 3000);
      }
    });
  }

  switchTab(tab: 'settings' | 'stats'): void {
    this.activeTab.set(tab);
    if (tab === 'stats' && !this.stats()) this.loadStats();
  }

  loadStats(): void {
    this.statsLoading.set(true);
    this.bubbleRewardsService.getRewardsStats().subscribe({
      next: (s) => { this.stats.set(s); this.statsLoading.set(false); },
      error: () => { this.statsLoading.set(false); }
    });
  }

  isBooleanSetting(key: string): boolean {
    return key.toLowerCase().includes('enabled');
  }

  getDisplayLabel(key: string): string {
    const overrides: Record<string, string> = {
      Redemption200Points: 'Tier 1 Dollar Credit ($)',
      Redemption500Points: 'Tier 2 Dollar Credit ($)',
      Redemption1000Points: 'Tier 3 Dollar Credit ($)',
      RedemptionTier1Points: 'Tier 1 Points Required',
      RedemptionTier2Points: 'Tier 2 Points Required',
      RedemptionTier3Points: 'Tier 3 Points Required',
    };
    if (overrides[key]) return overrides[key];
    return key
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, s => s.toUpperCase())
      .trim();
  }

  hasPendingChanges(group: CategoryGroup): boolean {
    return Object.values(group.pendingChanges).some(v => v !== undefined);
  }

  openResetModal(): void {
    this.showResetModal.set(true);
    this.resetTarget.set('all');
    this.resetUserId.set(null);
    this.resetUserSearch.set('');
    this.filteredUsers.set([]);
    this.resetMessage.set('');
    this.resetError.set('');
    if (this.userList.length === 0) {
      this.adminService.getUsers().subscribe({
        next: (res) => {
          this.userList = Array.isArray(res) ? res : (res as any).users ?? [];
        }
      });
    }
    this.loadUndoStatus();
  }

  closeResetModal(): void {
    this.showResetModal.set(false);
  }

  onUserSearchChange(): void {
    const q = this.resetUserSearch().toLowerCase();
    this.filteredUsers.set(this.userList.filter(u =>
      `${u.firstName} ${u.lastName} ${u.email}`.toLowerCase().includes(q)
    ));
    this.resetUserId.set(null);
  }

  selectResetUser(user: UserAdmin): void {
    this.resetUserId.set(user.id);
    this.resetUserSearch.set(`${user.firstName} ${user.lastName} (${user.email})`);
    this.filteredUsers.set([]);
  }

  confirmReset(): void {
    if (this.resetTarget() === 'specific' && !this.resetUserId()) {
      this.resetError.set('Please select a user.');
      return;
    }
    const confirmationMessage = this.resetTarget() === 'all'
      ? 'Are you sure you want to clear Bubble Points for ALL clients? This cannot be undone.'
      : 'Are you sure you want to clear Bubble Points for this client? This cannot be undone.';
    const isConfirmed = window.confirm(confirmationMessage);
    if (!isConfirmed) {
      return;
    }
    this.resetLoading.set(true);
    this.resetMessage.set('');
    this.resetError.set('');
    const userId = this.resetTarget() === 'specific' ? this.resetUserId()! : undefined;
    this.bubbleRewardsService.resetBubblePoints(userId).subscribe({
      next: (res: any) => {
        this.resetLoading.set(false);
        this.resetMessage.set(res.message ?? 'Done.');
        this.resetError.set('');
        this.loadUndoStatus();
      },
      error: (err) => {
        this.resetLoading.set(false);
        this.resetError.set(err?.error?.message ?? 'Failed to reset points.');
      }
    });
  }

  loadUndoStatus(): void {
    this.bubbleRewardsService.getResetUndoStatus().subscribe({
      next: (status) => {
        this.undoAvailable.set(!!status.available);
        this.undoCreatedAt.set(status.createdAt ?? '');
        this.undoScope.set(status.scope ?? '');
      },
      error: () => {
        this.undoAvailable.set(false);
        this.undoCreatedAt.set('');
        this.undoScope.set('');
      }
    });
  }

  undoLastReset(): void {
    if (this.undoLoading() || !this.undoAvailable()) return;
    const confirmed = window.confirm('Are you sure you want to undo the latest Bubble Points reset? This will overwrite current Bubble Points data.');
    if (!confirmed) return;

    this.undoLoading.set(true);
    this.resetError.set('');
    this.resetMessage.set('');
    this.bubbleRewardsService.undoLastBubbleReset().subscribe({
      next: (res: any) => {
        this.undoLoading.set(false);
        this.resetMessage.set(res?.message ?? 'Latest reset has been restored.');
        this.loadUndoStatus();
      },
      error: (err) => {
        this.undoLoading.set(false);
        this.resetError.set(err?.error?.message ?? 'Failed to undo reset.');
      }
    });
  }
}
