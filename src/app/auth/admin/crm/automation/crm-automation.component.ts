import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CrmAutomationService, AutomationRule, AutomationAlert } from '../../../../services/crm-automation.service';

@Component({
  selector: 'app-crm-automation',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './crm-automation.component.html',
  styleUrls: ['./crm-automation.component.scss']
})
export class CrmAutomationComponent implements OnInit {
  rules: AutomationRule[] = [];
  alerts: AutomationAlert[] = [];
  loading = false;
  alertsLoading = false;
  errorMessage = '';
  infoMessage = '';

  alertStatusFilter: 'Open' | 'Snoozed' | 'Done' | 'Dismissed' | 'all' = 'Open';
  savingRuleId: number | null = null;
  runningRuleId: number | null = null;

  // Snooze ("remind later") inline picker state
  snoozingAlertId: number | null = null;
  snoozeDate = '';
  minSnoozeDate = '';

  constructor(private automationService: CrmAutomationService) {}

  ngOnInit(): void {
    // Earliest selectable remind date = tomorrow (the backend requires a future date).
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    this.minSnoozeDate = tomorrow.toISOString().split('T')[0];

    this.loadRules();
    this.loadAlerts();
  }

  loadRules(): void {
    this.loading = true;
    this.automationService.getRules().subscribe({
      next: r => { this.rules = r; this.loading = false; },
      error: () => { this.errorMessage = 'Failed to load rules.'; this.loading = false; }
    });
  }

  loadAlerts(): void {
    this.alertsLoading = true;
    this.automationService.getAlerts(this.alertStatusFilter).subscribe({
      next: a => { this.alerts = a; this.alertsLoading = false; },
      error: () => { this.errorMessage = 'Failed to load alerts.'; this.alertsLoading = false; }
    });
  }

  toggleRule(rule: AutomationRule): void {
    this.savingRuleId = rule.id;
    this.automationService.updateRule(rule.id, { isEnabled: !rule.isEnabled }).subscribe({
      next: updated => { this.applyRule(updated); this.savingRuleId = null; },
      error: () => { this.errorMessage = 'Failed to update rule.'; this.savingRuleId = null; }
    });
  }

  saveThresholds(rule: AutomationRule): void {
    this.savingRuleId = rule.id;
    this.automationService.updateRule(rule.id, {
      thresholdDays: rule.thresholdDays,
      cooldownDays: rule.cooldownDays
    }).subscribe({
      next: updated => {
        this.applyRule(updated);
        this.savingRuleId = null;
        this.flash('Settings saved.');
      },
      error: () => { this.errorMessage = 'Failed to save settings.'; this.savingRuleId = null; }
    });
  }

  runNow(rule: AutomationRule): void {
    this.runningRuleId = rule.id;
    this.automationService.runRule(rule.id).subscribe({
      next: res => {
        this.runningRuleId = null;
        this.flash(res.message);
        this.loadRules();
        this.loadAlerts();
      },
      error: () => { this.errorMessage = 'Failed to run rule.'; this.runningRuleId = null; }
    });
  }

  resolveAlert(alert: AutomationAlert, status: 'Done' | 'Dismissed'): void {
    this.automationService.updateAlert(alert.id, status).subscribe({
      next: () => {
        // Drop it from the current view if we're filtering on Open.
        if (this.alertStatusFilter !== 'all' && this.alertStatusFilter !== status) {
          this.alerts = this.alerts.filter(a => a.id !== alert.id);
        } else {
          alert.status = status;
        }
        this.loadRules();
      },
      error: () => this.errorMessage = 'Failed to update alert.'
    });
  }

  reopenAlert(alert: AutomationAlert): void {
    this.automationService.updateAlert(alert.id, 'Open').subscribe({
      next: () => { this.loadAlerts(); this.loadRules(); },
      error: () => this.errorMessage = 'Failed to reopen alert.'
    });
  }

  /** Customer didn't pick up — log the attempt and keep the alert open to retry. */
  noAnswer(alert: AutomationAlert): void {
    this.automationService.logNoAnswer(alert.id).subscribe({
      next: updated => {
        const idx = this.alerts.findIndex(a => a.id === alert.id);
        if (idx >= 0) {
          // If we were viewing a non-Open filter, it moves back to Open → drop it from this view.
          if (this.alertStatusFilter !== 'all' && this.alertStatusFilter !== 'Open') {
            this.alerts.splice(idx, 1);
          } else {
            this.alerts[idx] = updated;
          }
        }
        this.loadRules();
      },
      error: () => this.errorMessage = 'Failed to log the attempt.'
    });
  }

  // ── Snooze ("remind later") ──

  startSnooze(alert: AutomationAlert): void {
    this.snoozingAlertId = alert.id;
    this.snoozeDate = '';
  }

  cancelSnooze(): void {
    this.snoozingAlertId = null;
    this.snoozeDate = '';
  }

  confirmSnooze(alert: AutomationAlert): void {
    if (!this.snoozeDate) return;
    this.automationService.updateAlert(alert.id, 'Snoozed', this.snoozeDate).subscribe({
      next: () => {
        this.snoozingAlertId = null;
        this.snoozeDate = '';
        // Remove from the Open view (it's scheduled now); reload counts.
        if (this.alertStatusFilter !== 'all' && this.alertStatusFilter !== 'Snoozed') {
          this.alerts = this.alerts.filter(a => a.id !== alert.id);
        } else {
          this.loadAlerts();
        }
        this.loadRules();
      },
      error: err => this.errorMessage = err?.error?.message || 'Failed to schedule reminder.'
    });
  }

  onStatusFilterChange(): void { this.loadAlerts(); }

  private applyRule(updated: AutomationRule): void {
    const idx = this.rules.findIndex(r => r.id === updated.id);
    if (idx >= 0) this.rules[idx] = updated;
  }

  private flash(msg: string): void {
    this.infoMessage = msg;
    setTimeout(() => this.infoMessage = '', 3500);
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
