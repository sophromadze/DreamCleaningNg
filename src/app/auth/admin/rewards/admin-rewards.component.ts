import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { BubbleRewardsService, RewardsSettings, RewardsStats } from '../../../services/bubble-rewards.service';
import { AdminService, UserAdmin } from '../../../services/admin.service';

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
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './admin-rewards.component.html',
  styleUrl: './admin-rewards.component.scss'
})
export class AdminRewardsComponent implements OnInit {
  activeTab: 'settings' | 'stats' = 'settings';

  // Settings tab
  categoryGroups: CategoryGroup[] = [];
  settingsLoading = true;
  settingsSaveMessage = '';
  masterSwitch = true;

  // Stats tab
  stats: RewardsStats | null = null;
  statsLoading = false;

  // Reset modal
  showResetModal = false;
  resetTarget: 'all' | 'specific' = 'all';
  resetUserId: number | null = null;
  resetUserSearch = '';
  userList: UserAdmin[] = [];
  filteredUsers: UserAdmin[] = [];
  resetLoading = false;
  resetMessage = '';
  resetError = '';
  undoAvailable = false;
  undoLoading = false;
  undoCreatedAt = '';
  undoScope: 'all' | 'specific' | '' = '';

  constructor(
    private bubbleRewardsService: BubbleRewardsService,
    private adminService: AdminService
  ) {}

  ngOnInit(): void {
    this.loadSettings();
  }

  loadSettings(): void {
    this.settingsLoading = true;
    this.bubbleRewardsService.getAdminSettings().subscribe({
      next: (settings) => {
        this.buildCategoryGroups(settings);
        this.settingsLoading = false;
        const masterSetting = settings.find(s => s.settingKey === 'PointsSystemEnabled');
        if (masterSetting) this.masterSwitch = masterSetting.settingValue === 'true';
      },
      error: () => { this.settingsLoading = false; }
    });
  }

  buildCategoryGroups(settings: RewardsSettings[]): void {
    const categories = [...new Set(settings.map(s => s.category))];
    this.categoryGroups = categories.map(cat => ({
      category: cat,
      settings: settings.filter(s => s.category === cat),
      open: cat === 'Points' || cat === 'Tiers',
      pendingChanges: {},
      saving: false
    }));
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
        this.settingsSaveMessage = `Saved ${group.category} settings.`;
        setTimeout(() => this.settingsSaveMessage = '', 3000);
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
        this.masterSwitch = enabled;
        this.settingsSaveMessage = `Rewards system ${enabled ? 'enabled' : 'disabled'}.`;
        setTimeout(() => this.settingsSaveMessage = '', 3000);
      }
    });
  }

  switchTab(tab: 'settings' | 'stats'): void {
    this.activeTab = tab;
    if (tab === 'stats' && !this.stats) this.loadStats();
  }

  loadStats(): void {
    this.statsLoading = true;
    this.bubbleRewardsService.getRewardsStats().subscribe({
      next: (s) => { this.stats = s; this.statsLoading = false; },
      error: () => { this.statsLoading = false; }
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
    this.showResetModal = true;
    this.resetTarget = 'all';
    this.resetUserId = null;
    this.resetUserSearch = '';
    this.filteredUsers = [];
    this.resetMessage = '';
    this.resetError = '';
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
    this.showResetModal = false;
  }

  onUserSearchChange(): void {
    const q = this.resetUserSearch.toLowerCase();
    this.filteredUsers = this.userList.filter(u =>
      `${u.firstName} ${u.lastName} ${u.email}`.toLowerCase().includes(q)
    );
    this.resetUserId = null;
  }

  selectResetUser(user: UserAdmin): void {
    this.resetUserId = user.id;
    this.resetUserSearch = `${user.firstName} ${user.lastName} (${user.email})`;
    this.filteredUsers = [];
  }

  confirmReset(): void {
    if (this.resetTarget === 'specific' && !this.resetUserId) {
      this.resetError = 'Please select a user.';
      return;
    }
    const confirmationMessage = this.resetTarget === 'all'
      ? 'Are you sure you want to clear Bubble Points for ALL clients? This cannot be undone.'
      : 'Are you sure you want to clear Bubble Points for this client? This cannot be undone.';
    const isConfirmed = window.confirm(confirmationMessage);
    if (!isConfirmed) {
      return;
    }
    this.resetLoading = true;
    this.resetMessage = '';
    this.resetError = '';
    const userId = this.resetTarget === 'specific' ? this.resetUserId! : undefined;
    this.bubbleRewardsService.resetBubblePoints(userId).subscribe({
      next: (res: any) => {
        this.resetLoading = false;
        this.resetMessage = res.message ?? 'Done.';
        this.resetError = '';
        this.loadUndoStatus();
      },
      error: (err) => {
        this.resetLoading = false;
        this.resetError = err?.error?.message ?? 'Failed to reset points.';
      }
    });
  }

  loadUndoStatus(): void {
    this.bubbleRewardsService.getResetUndoStatus().subscribe({
      next: (status) => {
        this.undoAvailable = !!status.available;
        this.undoCreatedAt = status.createdAt ?? '';
        this.undoScope = status.scope ?? '';
      },
      error: () => {
        this.undoAvailable = false;
        this.undoCreatedAt = '';
        this.undoScope = '';
      }
    });
  }

  undoLastReset(): void {
    if (this.undoLoading || !this.undoAvailable) return;
    const confirmed = window.confirm('Are you sure you want to undo the latest Bubble Points reset? This will overwrite current Bubble Points data.');
    if (!confirmed) return;

    this.undoLoading = true;
    this.resetError = '';
    this.resetMessage = '';
    this.bubbleRewardsService.undoLastBubbleReset().subscribe({
      next: (res: any) => {
        this.undoLoading = false;
        this.resetMessage = res?.message ?? 'Latest reset has been restored.';
        this.loadUndoStatus();
      },
      error: (err) => {
        this.undoLoading = false;
        this.resetError = err?.error?.message ?? 'Failed to undo reset.';
      }
    });
  }
}
