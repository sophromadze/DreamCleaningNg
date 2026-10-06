import { Component, OnInit, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CrmAutomationService, AutomationRule, AutomationAlert } from '../../../../services/crm-automation.service';

@Component({
  selector: 'app-crm-automation',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './crm-automation.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./crm-automation.component.scss']
})
export class CrmAutomationComponent implements OnInit {
  private automationService = inject(CrmAutomationService);

  readonly rules = signal<AutomationRule[]>([], { equal: () => false });
  readonly alerts = signal<AutomationAlert[]>([], { equal: () => false });
  readonly loading = signal(false);
  readonly alertsLoading = signal(false);
  readonly errorMessage = signal('');
  readonly infoMessage = signal('');

  readonly alertStatusFilter = signal<'Open' | 'Snoozed' | 'Done' | 'Dismissed' | 'all'>('Open');
  readonly savingRuleId = signal<number | null>(null);
  readonly runningRuleId = signal<number | null>(null);

  // Snooze ("remind later") inline picker state
  readonly snoozingAlertId = signal<number | null>(null);
  readonly snoozeDate = signal('');
  minSnoozeDate = '';

  ngOnInit(): void {
    // Earliest selectable remind date = tomorrow (the backend requires a future date).
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    this.minSnoozeDate = tomorrow.toISOString().split('T')[0];

    this.loadRules();
    this.loadAlerts();
  }

  loadRules(): void {
    this.loading.set(true);
    this.automationService.getRules().subscribe({
      next: r => { this.rules.set(r); this.loading.set(false); },
      error: () => { this.errorMessage.set('Failed to load rules.'); this.loading.set(false); }
    });
  }

  loadAlerts(): void {
    this.alertsLoading.set(true);
    this.automationService.getAlerts(this.alertStatusFilter()).subscribe({
      next: a => { this.alerts.set(a); this.alertsLoading.set(false); },
      error: () => { this.errorMessage.set('Failed to load alerts.'); this.alertsLoading.set(false); }
    });
  }

  toggleRule(rule: AutomationRule): void {
    this.savingRuleId.set(rule.id);
    this.automationService.updateRule(rule.id, { isEnabled: !rule.isEnabled }).subscribe({
      next: updated => { this.applyRule(updated); this.savingRuleId.set(null); },
      error: () => { this.errorMessage.set('Failed to update rule.'); this.savingRuleId.set(null); }
    });
  }

  saveThresholds(rule: AutomationRule): void {
    this.savingRuleId.set(rule.id);
    this.automationService.updateRule(rule.id, {
      thresholdDays: rule.thresholdDays,
      cooldownDays: rule.cooldownDays
    }).subscribe({
      next: updated => {
        this.applyRule(updated);
        this.savingRuleId.set(null);
        this.flash('Settings saved.');
      },
      error: () => { this.errorMessage.set('Failed to save settings.'); this.savingRuleId.set(null); }
    });
  }

  runNow(rule: AutomationRule): void {
    this.runningRuleId.set(rule.id);
    this.automationService.runRule(rule.id).subscribe({
      next: res => {
        this.runningRuleId.set(null);
        this.flash(res.message);
        this.loadRules();
        this.loadAlerts();
      },
      error: () => { this.errorMessage.set('Failed to run rule.'); this.runningRuleId.set(null); }
    });
  }

  resolveAlert(alert: AutomationAlert, status: 'Done' | 'Dismissed'): void {
    this.automationService.updateAlert(alert.id, status).subscribe({
      next: () => {
        // Drop it from the current view if we're filtering on Open.
        if (this.alertStatusFilter() !== 'all' && this.alertStatusFilter() !== status) {
          this.alerts.set(this.alerts().filter(a => a.id !== alert.id));
        } else {
          alert.status = status;
        }
        this.loadRules();
      },
      error: () => this.errorMessage.set('Failed to update alert.')
    });
  }

  reopenAlert(alert: AutomationAlert): void {
    this.automationService.updateAlert(alert.id, 'Open').subscribe({
      next: () => { this.loadAlerts(); this.loadRules(); },
      error: () => this.errorMessage.set('Failed to reopen alert.')
    });
  }

  /** Customer didn't pick up — log the attempt and keep the alert open to retry. */
  noAnswer(alert: AutomationAlert): void {
    this.automationService.logNoAnswer(alert.id).subscribe({
      next: updated => {
        const idx = this.alerts().findIndex(a => a.id === alert.id);
        if (idx >= 0) {
          // If we were viewing a non-Open filter, it moves back to Open → drop it from this view.
          if (this.alertStatusFilter() !== 'all' && this.alertStatusFilter() !== 'Open') {
            this.alerts().splice(idx, 1);
            this.alerts.set(this.alerts());
          } else {
            this.alerts()[idx] = updated;
            this.alerts.set(this.alerts());
          }
        }
        this.loadRules();
      },
      error: () => this.errorMessage.set('Failed to log the attempt.')
    });
  }

  // ── Snooze ("remind later") ──

  startSnooze(alert: AutomationAlert): void {
    this.snoozingAlertId.set(alert.id);
    this.snoozeDate.set('');
  }

  cancelSnooze(): void {
    this.snoozingAlertId.set(null);
    this.snoozeDate.set('');
  }

  confirmSnooze(alert: AutomationAlert): void {
    if (!this.snoozeDate()) return;
    this.automationService.updateAlert(alert.id, 'Snoozed', this.snoozeDate()).subscribe({
      next: () => {
        this.snoozingAlertId.set(null);
        this.snoozeDate.set('');
        // Remove from the Open view (it's scheduled now); reload counts.
        if (this.alertStatusFilter() !== 'all' && this.alertStatusFilter() !== 'Snoozed') {
          this.alerts.set(this.alerts().filter(a => a.id !== alert.id));
        } else {
          this.loadAlerts();
        }
        this.loadRules();
      },
      error: err => this.errorMessage.set(err?.error?.message || 'Failed to schedule reminder.')
    });
  }

  onStatusFilterChange(): void { this.loadAlerts(); }

  private applyRule(updated: AutomationRule): void {
    const idx = this.rules().findIndex(r => r.id === updated.id);
    if (idx >= 0) { this.rules()[idx] = updated; this.rules.set(this.rules()); }
  }

  private flash(msg: string): void {
    this.infoMessage.set(msg);
    setTimeout(() => this.infoMessage.set(''), 3500);
  }

  daysSince(iso?: string): string {
    if (!iso) return '—';
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    return `${days}d`;
  }

  formatDate(iso?: string): string {
    if (!iso) return 'never';
    return new Date(iso).toLocaleString();
  }

  formatDay(iso?: string): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString();
  }

  trackByRuleId(_: number, r: AutomationRule): number { return r.id; }
  trackByAlertId(_: number, a: AutomationAlert): number { return a.id; }
}
