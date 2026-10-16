import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';

import {
  AdminPerformanceList, AdminPerformanceRow, OutgoingPaymentService
} from '../../../services/outgoing-payment.service';
import { extractApiErrorMessage } from '../../../utils/http-error.utils';
import { todayInNewYork } from './unpaid-cleaners.component';

export type AdminPerformancePeriod = 'this-month' | 'last-month' | 'this-year' | 'all-time' | 'custom';

/**
 * The inclusive service-date range a period names, as yyyy-MM-dd, counted from TODAY in New York
 * (the business's own day — the same one every other money screen uses). All time = both null.
 * A custom range is passed through; an incomplete one reads as open-ended on the missing side.
 */
export function periodRange(
  period: AdminPerformancePeriod,
  today: string,
  custom: { from: string; to: string } = { from: '', to: '' }
): { from: string | null; to: string | null } {
  const [y, m] = today.split('-').map(Number);
  const ymd = (year: number, month: number, day: number) =>
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

  switch (period) {
    case 'this-month':
      return { from: ymd(y, m, 1), to: ymd(y, m, lastDay(y, m)) };
    case 'last-month': {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return { from: ymd(py, pm, 1), to: ymd(py, pm, lastDay(py, pm)) };
    }
    case 'this-year':
      return { from: ymd(y, 1, 1), to: ymd(y, 12, 31) };
    case 'all-time':
      return { from: null, to: null };
    case 'custom':
      return { from: custom.from || null, to: custom.to || null };
  }
}

/**
 * Every typed word must appear in the first name, last name or email — so "Ana Beridze" (with the
 * space) finds Ana Beridze, which a single contains() over either field alone never could.
 */
export function matchesAdminSearch(row: Pick<AdminPerformanceRow, 'firstName' | 'lastName' | 'email'>, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = `${row.firstName} ${row.lastName} ${row.email}`.toLowerCase();
  return words.every(w => haystack.includes(w));
}

/**
 * Outgoing Payments → Admins (2026-10, SuperAdmin). Per admin (SuperAdmins are not listed): the
 * completed orders they booked in a period, what those orders came to, and the net the company
 * kept after sales tax, the cleaners' wages and the Stripe fees on them. The staff bonuses on those
 * orders are shown under each net figure and are NOT taken off it (owner's rule, 2026-10-16).
 *
 * Every figure comes from the server; this component only filters rows and adds up the visible
 * ones for the totals line.
 */
@Component({
  selector: 'app-admin-performance',
  imports: [FormsModule, CurrencyPipe],
  templateUrl: './admin-performance.component.html',
  styleUrls: ['./cleaner-payouts.shared.scss', './admin-performance.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AdminPerformanceComponent {
  private service = inject(OutgoingPaymentService);
  private destroyRef = inject(DestroyRef);

  readonly periods: { key: AdminPerformancePeriod; label: string }[] = [
    { key: 'this-month', label: 'This month' },
    { key: 'last-month', label: 'Last month' },
    { key: 'this-year', label: 'This year' },
    { key: 'all-time', label: 'All time' },
    { key: 'custom', label: 'Specific days' }
  ];

  readonly period = signal<AdminPerformancePeriod>('this-month');
  readonly customFrom = signal('');
  readonly customTo = signal('');
  readonly search = signal('');

  readonly data = signal<AdminPerformanceList | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');

  readonly rows = computed(() =>
    (this.data()?.admins ?? []).filter(r => matchesAdminSearch(r, this.search())));

  readonly totals = computed(() => this.rows().reduce(
    (t, r) => ({
      orders: t.orders + r.completedOrders,
      ordersNew: t.ordersNew + r.newCustomerOrders,
      ordersReturning: t.ordersReturning + r.returningCustomerOrders,
      total: t.total + r.ordersTotal,
      totalNew: t.totalNew + r.ordersTotalNew,
      totalReturning: t.totalReturning + r.ordersTotalReturning,
      net: t.net + r.netIncome,
      netNew: t.netNew + r.netIncomeNew,
      netReturning: t.netReturning + r.netIncomeReturning,
      bonuses: t.bonuses + r.staffBonuses,
      bonusesNew: t.bonusesNew + r.staffBonusesNew,
      bonusesReturning: t.bonusesReturning + r.staffBonusesReturning
    }),
    { orders: 0, ordersNew: 0, ordersReturning: 0, total: 0, totalNew: 0, totalReturning: 0,
      net: 0, netNew: 0, netReturning: 0, bonuses: 0, bonusesNew: 0, bonusesReturning: 0 }));

  constructor() {
    this.load();
  }

  setPeriod(p: AdminPerformancePeriod): void {
    if (this.period() === p) return;
    this.period.set(p);
    if (p === 'custom') {
      // Opens on the month so far rather than two blank boxes that load everything.
      if (!this.customFrom() && !this.customTo()) {
        const r = periodRange('this-month', todayInNewYork());
        this.customFrom.set(r.from!);
        this.customTo.set(todayInNewYork());
      }
    }
    this.load();
  }

  onCustomDatesChange(): void {
    if (this.period() !== 'custom') return;
    if (this.customFrom() && this.customTo() && this.customTo() < this.customFrom()) {
      this.error.set('The end date is before the start date.');
      return;
    }
    this.load();
  }

  load(): void {
    const { from, to } = periodRange(this.period(), todayInNewYork(),
      { from: this.customFrom(), to: this.customTo() });
    this.loading.set(true);
    this.error.set('');
    this.service.getAdminPerformance(from, to)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: d => { this.data.set(d); this.loading.set(false); },
        error: err => {
          this.loading.set(false);
          this.error.set(extractApiErrorMessage(err, 'Could not load the admins.'));
        }
      });
  }

  /** The net worked out — checkable by hand. The bonuses are named but not part of the sum. */
  netBreakdown(r: AdminPerformanceRow): string {
    const usd = (n: number) => `$${n.toFixed(2)}`;
    return `Orders total ${usd(r.ordersTotal)} − sales tax ${usd(r.salesTax)} − cleaners' wages ${usd(r.cleanerWages)} − Stripe fees ${usd(r.stripeFees)}`
      + ` (staff bonuses ${usd(r.staffBonuses)} not taken off)`;
  }
}
