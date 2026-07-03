import { Component, OnInit, OnDestroy, ViewChild, ElementRef, Inject, PLATFORM_ID, ChangeDetectorRef } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin, of, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import Chart from 'chart.js/auto';
import { AdminService, OrderStatistics, ExpenseBreakdownItem } from '../../../services/admin.service';
import { ThemeService } from '../../../services/theme.service';

type QuickFilter = 'today' | 'week' | 'month' | 'lastMonth' | 'year' | 'lastYear' | 'all';

/**
 * One money-out row of the receipt. Every row can be checked/unchecked; the profit
 * number recomputes live from whatever is checked. Rows are built from the same
 * /api/admin/statistics response the Statistics page uses, so with everything
 * checked the result always equals the official Company Revenue.
 */
interface CostLine {
  /** Stable key: 'taxes' | 'salaries' | 'stripeFees' | 'adminBonuses' | 'cat-<categoryId>' */
  key: string;
  label: string;
  /** Plain-language explanation shown under the label. */
  explanation: string;
  amount: number;
  /** Same line in the previous period (null when there is no comparison window). */
  prevAmount: number | null;
  included: boolean;
  /** Chart token slot ('--chart-cat-N'). Assigned by entity in fixed order, never re-shuffled. */
  colorVar: string | null;
  /** Individual expense entries (only for expense-category rows) — expandable detail. */
  items?: ExpenseBreakdownItem[];
  expanded?: boolean;
}

interface DonutSlice {
  label: string;
  amount: number;
  percent: number;
  colorVar: string | null; // null → the muted "Other" slice
}

interface DateWindow {
  from?: string;
  to?: string;
  prevFrom?: string;
  prevTo?: string;
  compareLabel: string;
}

type CompareUnit = 'day' | 'week' | 'month' | 'year';

/** One period chosen in the compare modal. Only the fields for the active unit matter. */
interface ComparePick {
  /** yyyy-MM-dd — used by 'day' and 'week' (week snaps to the whole Sun–Sat week around it). */
  date: string;
  /** 0–11 — used by 'month'. */
  month: number;
  /** Used by 'month' and 'year'. */
  year: number;
}

interface ComparePeriod {
  label: string;
  /** Full from–to range shown under the label ('' when the label already is the range). */
  rangeLabel: string;
  from: string;
  to: string;
  stats: OrderStatistics;
}

interface CompareRow {
  label: string;
  /** Which direction is "best" for this row — costs are best when lowest. */
  betterWhen: 'high' | 'low' | 'none';
  isMoney: boolean;
  emphasize?: boolean;
  values: number[];
  /** The value to highlight as best (null when the row ties everywhere or is info-only). */
  bestValue: number | null;
}

@Component({
  selector: 'app-finances',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './finances.component.html',
  styleUrls: ['./finances.component.scss']
})
export class FinancesComponent implements OnInit, OnDestroy {
  @ViewChild('donutCanvas') donutCanvas!: ElementRef<HTMLCanvasElement>;

  stats: OrderStatistics | null = null;
  prevStats: OrderStatistics | null = null;
  costLines: CostLine[] = [];
  donutLegend: DonutSlice[] = [];
  isLoading = false;
  error = '';
  isBrowser: boolean;

  activeQuickFilter: QuickFilter = 'month';
  customFrom = '';
  customTo = '';
  compareLabel = '';

  /** Info-row visibility (never part of the math). */
  showTips = true;

  // ── Compare mode state ─────────────────────────────────────────────────────
  showCompareModal = false;
  compareMode = false;
  isComparing = false;
  compareError = '';
  compareUnit: CompareUnit = 'month';
  comparePicks: ComparePick[] = [];
  compareResults: ComparePeriod[] = [];
  compareRows: CompareRow[] = [];
  /** Index of the period that kept the most money (-1 when every period ties). */
  winnerIndex = -1;
  winnerLine = '';

  readonly compareUnits: { key: CompareUnit; label: string }[] = [
    { key: 'day', label: 'Days' },
    { key: 'week', label: 'Weeks' },
    { key: 'month', label: 'Months' },
    { key: 'year', label: 'Years' }
  ];
  readonly monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  readonly yearOptions: number[];

  /** Keys the user unchecked — remembered across filter changes so his view is stable. */
  private excludedKeys = new Set<string>();
  private donut: Chart | null = null;
  private destroy$ = new Subject<void>();

  readonly quickFilters: { key: QuickFilter; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'week', label: 'This Week' },
    { key: 'month', label: 'This Month' },
    { key: 'lastMonth', label: 'Last Month' },
    { key: 'year', label: 'This Year' },
    { key: 'lastYear', label: 'Last Year' },
    { key: 'all', label: 'All Time' }
  ];

  constructor(
    private adminService: AdminService,
    private themeService: ThemeService,
    private cdr: ChangeDetectorRef,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
    // Skeleton rows so the receipt structure is visible (labels + shimmer values)
    // while the first load resolves — per the "shimmer the value, not the label" rule.
    this.costLines = this.buildCostLines(FinancesComponent.EMPTY_STATS, null);
    const thisYear = new Date().getFullYear();
    this.yearOptions = Array.from({ length: 6 }, (_, i) => thisYear - i);
  }

  private static readonly EMPTY_STATS: OrderStatistics = {
    totalOrders: 0,
    totalAmount: 0,
    totalTaxes: 0,
    totalTips: 0,
    totalCleanersSalary: 0,
    totalExpenses: 0,
    totalCompanyRevenueGross: 0,
    totalCompanyRevenue: 0,
    expensesBreakdown: null,
    stripeFees: 0,
    adminBonusesUsd: 0,
    adminBonusesGel: 0
  };

  ngOnInit(): void {
    this.loadData();
    // Re-paint the donut with the other theme's chart tokens when day/night flips.
    this.themeService.theme$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        if (this.donut) {
          setTimeout(() => this.buildDonut(), 0);
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.donut?.destroy();
  }

  // ── Filters ──────────────────────────────────────────────────────────────

  onQuickFilterChange(filter: QuickFilter): void {
    this.activeQuickFilter = filter;
    this.customFrom = '';
    this.customTo = '';
    this.compareMode = false;
    this.loadData();
  }

  applyCustomRange(): void {
    if (this.customFrom && this.customTo) {
      this.compareMode = false;
      this.loadData();
    }
  }

  clearCustomRange(): void {
    this.customFrom = '';
    this.customTo = '';
    this.activeQuickFilter = 'month';
    this.compareMode = false;
    this.loadData();
  }

  // ── Receipt math (all client-side, recomputed on every toggle) ───────────

  /** Money in — order subtotals, same base the Statistics page uses. */
  get moneyIn(): number {
    return this.stats?.totalAmount ?? 0;
  }

  /** Sum of the CHECKED money-out rows. */
  get moneyOut(): number {
    return this.costLines.reduce((sum, l) => sum + (l.included ? l.amount : 0), 0);
  }

  /** The headline: money in minus whatever costs are checked. */
  get profit(): number {
    return this.moneyIn - this.moneyOut;
  }

  get excludedCount(): number {
    return this.costLines.filter(l => !l.included).length;
  }

  /** With everything checked this equals the official number (same formula, same data). */
  get matchesOfficial(): boolean {
    return this.excludedCount === 0;
  }

  get officialRevenue(): number {
    return this.stats?.totalCompanyRevenue ?? 0;
  }

  /** True when a comparison window exists (every filter except All Time). */
  get hasComparison(): boolean {
    return this.prevStats !== null;
  }

  /** Previous-period profit with the SAME rows checked, so the comparison is apples-to-apples. */
  private get prevProfit(): number | null {
    if (!this.prevStats) return null;
    const prevOut = this.costLines.reduce(
      (sum, l) => sum + (l.included ? (l.prevAmount ?? 0) : 0), 0);
    return this.prevStats.totalAmount - prevOut;
  }

  /** Profit change vs the previous window (0 when there is no comparison). */
  get profitDelta(): number {
    const prev = this.prevProfit;
    return prev === null ? 0 : this.profit - prev;
  }

  /** A percent only makes sense when the previous window had a non-zero profit. */
  get hasDeltaPercent(): boolean {
    const prev = this.prevProfit;
    return prev !== null && prev !== 0;
  }

  get profitDeltaPercent(): number {
    const prev = this.prevProfit;
    if (prev === null || prev === 0) return 0;
    return ((this.profit - prev) / Math.abs(prev)) * 100;
  }

  toggleLine(line: CostLine): void {
    line.included = !line.included;
    if (line.included) {
      this.excludedKeys.delete(line.key);
    } else {
      this.excludedKeys.add(line.key);
    }
    this.refreshDonut();
  }

  includeEverything(): void {
    this.excludedKeys.clear();
    this.costLines.forEach(l => (l.included = true));
    this.refreshDonut();
  }

  toggleExpand(line: CostLine): void {
    if (line.items?.length) {
      line.expanded = !line.expanded;
    }
  }

  // ── Data loading ─────────────────────────────────────────────────────────

  private loadData(): void {
    this.isLoading = true;
    this.error = '';

    const win = this.getDateWindow();
    this.compareLabel = win.compareLabel;

    forkJoin({
      current: this.adminService.getOrderStatistics(win.from, win.to),
      previous: win.prevFrom && win.prevTo
        ? this.adminService.getOrderStatistics(win.prevFrom, win.prevTo)
        : of(null as OrderStatistics | null)
    }).subscribe({
      next: ({ current, previous }) => {
        this.stats = current;
        this.prevStats = previous;
        this.costLines = this.buildCostLines(current, previous);
        this.isLoading = false;
        this.cdr.detectChanges();
        this.refreshDonut();
      },
      error: (err) => {
        this.error = err?.error?.message || 'Failed to load the numbers. Please try again.';
        this.isLoading = false;
      }
    });
  }

  private buildCostLines(stats: OrderStatistics, prev: OrderStatistics | null): CostLine[] {
    // Fixed rows take chart slots 1–4; expense categories take 5+ in ascending
    // categoryId (creation) order so a category keeps its color across periods.
    const lines: CostLine[] = [
      {
        key: 'taxes',
        label: 'Sales tax',
        explanation: 'Collected from customers on top of the price. This money goes to the state — it was never ours.',
        amount: stats.totalTaxes,
        prevAmount: prev ? prev.totalTaxes : null,
        included: !this.excludedKeys.has('taxes'),
        colorVar: '--chart-cat-1'
      },
      {
        key: 'salaries',
        label: 'Cleaner salaries',
        explanation: 'What we pay the cleaners for the orders in this period.',
        amount: stats.totalCleanersSalary,
        prevAmount: prev ? prev.totalCleanersSalary : null,
        included: !this.excludedKeys.has('salaries'),
        colorVar: '--chart-cat-2'
      },
      {
        key: 'stripeFees',
        label: 'Card processing fees',
        explanation: 'Stripe keeps 2.9% + $0.30 of every card payment before the money reaches us.',
        amount: stats.stripeFees,
        prevAmount: prev ? prev.stripeFees : null,
        included: !this.excludedKeys.has('stripeFees'),
        colorVar: '--chart-cat-3'
      },
      {
        key: 'adminBonuses',
        label: 'Admin bonuses',
        explanation: `Per-order bonuses for admins, paid in GEL (₾${this.formatNumber(stats.adminBonusesGel)}) and converted at each month's locked rate.`,
        amount: stats.adminBonusesUsd,
        prevAmount: prev ? prev.adminBonusesUsd : null,
        included: !this.excludedKeys.has('adminBonuses'),
        colorVar: '--chart-cat-4'
      }
    ];

    const categories = [...(stats.expensesBreakdown?.byCategory ?? [])]
      .sort((a, b) => a.categoryId - b.categoryId);
    const prevCategories = new Map(
      (prev?.expensesBreakdown?.byCategory ?? []).map(c => [c.categoryId, c.total]));

    categories.forEach((cat, i) => {
      const key = `cat-${cat.categoryId}`;
      lines.push({
        key,
        label: cat.categoryName,
        explanation: `Company spending on “${cat.categoryName}” during this period. Click the row to see each expense.`,
        amount: cat.total,
        prevAmount: prev ? (prevCategories.get(cat.categoryId) ?? 0) : null,
        included: !this.excludedKeys.has(key),
        // Only 8 chart slots exist; entities beyond slot 8 render as the muted
        // "Other" slice in the donut (their receipt rows are unaffected).
        colorVar: i < 4 ? `--chart-cat-${5 + i}` : null,
        items: cat.items,
        expanded: false
      });
    });

    return lines;
  }

  // ── Date windows ─────────────────────────────────────────────────────────

  /**
   * Current window for the selected filter plus the matching previous window used
   * for the "vs before" comparison. Previous windows are the same length,
   * immediately before the current one, so the comparison is honest.
   */
  private getDateWindow(): DateWindow {
    const fmt = (d: Date) => this.formatDate(d);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (this.customFrom && this.customTo) {
      const from = new Date(this.customFrom + 'T00:00:00');
      const to = new Date(this.customTo + 'T00:00:00');
      const lengthDays = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
      const prevTo = this.addDays(from, -1);
      const prevFrom = this.addDays(from, -lengthDays);
      return {
        from: this.customFrom, to: this.customTo,
        prevFrom: fmt(prevFrom), prevTo: fmt(prevTo),
        compareLabel: `vs the ${lengthDays} days before`
      };
    }

    switch (this.activeQuickFilter) {
      case 'today': {
        const yesterday = this.addDays(today, -1);
        return {
          from: fmt(today), to: fmt(today),
          prevFrom: fmt(yesterday), prevTo: fmt(yesterday),
          compareLabel: 'vs yesterday'
        };
      }
      case 'week': {
        const start = this.addDays(today, -today.getDay());
        return {
          from: fmt(start), to: fmt(today),
          prevFrom: fmt(this.addDays(start, -7)), prevTo: fmt(this.addDays(today, -7)),
          compareLabel: 'vs the same days last week'
        };
      }
      case 'month': {
        const start = new Date(today.getFullYear(), today.getMonth(), 1);
        const prevStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        // Same day-of-month in the previous month, clamped to its last day.
        const prevMonthDays = new Date(today.getFullYear(), today.getMonth(), 0).getDate();
        const prevEnd = new Date(today.getFullYear(), today.getMonth() - 1,
          Math.min(today.getDate(), prevMonthDays));
        return {
          from: fmt(start), to: fmt(today),
          prevFrom: fmt(prevStart), prevTo: fmt(prevEnd),
          compareLabel: 'vs the same days last month'
        };
      }
      case 'lastMonth': {
        const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const end = new Date(today.getFullYear(), today.getMonth(), 0);
        const prevStart = new Date(today.getFullYear(), today.getMonth() - 2, 1);
        const prevEnd = new Date(today.getFullYear(), today.getMonth() - 1, 0);
        return {
          from: fmt(start), to: fmt(end),
          prevFrom: fmt(prevStart), prevTo: fmt(prevEnd),
          compareLabel: 'vs the month before'
        };
      }
      case 'year': {
        const start = new Date(today.getFullYear(), 0, 1);
        const prevStart = new Date(today.getFullYear() - 1, 0, 1);
        const prevEnd = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
        return {
          from: fmt(start), to: fmt(today),
          prevFrom: fmt(prevStart), prevTo: fmt(prevEnd),
          compareLabel: 'vs the same period last year'
        };
      }
      case 'lastYear': {
        const start = new Date(today.getFullYear() - 1, 0, 1);
        const end = new Date(today.getFullYear() - 1, 11, 31);
        const prevStart = new Date(today.getFullYear() - 2, 0, 1);
        const prevEnd = new Date(today.getFullYear() - 2, 11, 31);
        return {
          from: fmt(start), to: fmt(end),
          prevFrom: fmt(prevStart), prevTo: fmt(prevEnd),
          compareLabel: 'vs the year before'
        };
      }
      case 'all':
      default:
        return { compareLabel: '' };
    }
  }

  private addDays(d: Date, days: number): Date {
    const copy = new Date(d);
    copy.setDate(copy.getDate() + days);
    return copy;
  }

  private formatDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // ── Money in vs money out bars (pure HTML/CSS, widths computed here) ─────

  get barMax(): number {
    return Math.max(this.moneyIn, this.moneyOut, 1);
  }

  get moneyInBarWidth(): number {
    return (this.moneyIn / this.barMax) * 100;
  }

  get moneyOutBarWidth(): number {
    return (this.moneyOut / this.barMax) * 100;
  }

  // ── Donut (where the checked money-out goes) ─────────────────────────────

  private donutSlices(): DonutSlice[] {
    const included = this.costLines.filter(l => l.included && l.amount > 0);
    const total = included.reduce((s, l) => s + l.amount, 0);
    if (total <= 0) return [];

    const named = included.filter(l => l.colorVar !== null);
    const otherTotal = included.filter(l => l.colorVar === null)
      .reduce((s, l) => s + l.amount, 0);

    const slices: DonutSlice[] = named.map(l => ({
      label: l.label,
      amount: l.amount,
      percent: (l.amount / total) * 100,
      colorVar: l.colorVar
    }));
    if (otherTotal > 0) {
      slices.push({
        label: 'Other expenses',
        amount: otherTotal,
        percent: (otherTotal / total) * 100,
        colorVar: null
      });
    }
    return slices.sort((a, b) => b.amount - a.amount);
  }

  private refreshDonut(): void {
    this.donutLegend = this.donutSlices();
    if (this.isBrowser) {
      setTimeout(() => this.buildDonut(), 0);
    }
  }

  private buildDonut(): void {
    if (!this.isBrowser || !this.donutCanvas?.nativeElement) return;

    this.donut?.destroy();
    this.donut = null;
    if (this.donutLegend.length === 0) return;

    const css = getComputedStyle(document.documentElement);
    const resolve = (v: string | null) =>
      v ? css.getPropertyValue(v).trim() : css.getPropertyValue('--text-muted').trim();
    const surface = css.getPropertyValue('--surface').trim();

    this.donut = new Chart(this.donutCanvas.nativeElement, {
      type: 'doughnut',
      data: {
        labels: this.donutLegend.map(s => s.label),
        datasets: [{
          data: this.donutLegend.map(s => s.amount),
          backgroundColor: this.donutLegend.map(s => resolve(s.colorVar)),
          // 2px surface-colored gap between slices so adjacent fills never touch.
          borderColor: surface,
          borderWidth: 2,
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: {
          legend: { display: false }, // identity lives in the HTML legend next to the chart
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const slice = this.donutLegend[ctx.dataIndex];
                return ` ${slice.label}: $${this.formatNumber(slice.amount)} (${slice.percent.toFixed(1)}%)`;
              }
            }
          }
        }
      }
    });
  }

  // ── Compare mode (side-by-side whole days / weeks / months / years) ──────

  openCompareModal(): void {
    if (this.comparePicks.length === 0) {
      this.comparePicks = this.defaultPicks(this.compareUnit);
    }
    this.compareError = '';
    this.showCompareModal = true;
  }

  closeCompareModal(): void {
    this.showCompareModal = false;
  }

  setCompareUnit(unit: CompareUnit): void {
    if (this.compareUnit === unit) return;
    this.compareUnit = unit;
    this.comparePicks = this.defaultPicks(unit);
    this.compareError = '';
  }

  addPick(): void {
    if (this.comparePicks.length < 4) {
      this.comparePicks.push(this.mkPick(new Date()));
    }
  }

  removePick(index: number): void {
    if (this.comparePicks.length > 2) {
      this.comparePicks.splice(index, 1);
    }
  }

  get unitNoun(): string {
    switch (this.compareUnit) {
      case 'day': return 'day';
      case 'week': return 'week';
      case 'month': return 'month';
      case 'year':
      default: return 'year';
    }
  }

  get picksValid(): boolean {
    if (this.comparePicks.length < 2) return false;
    if (this.compareUnit === 'day' || this.compareUnit === 'week') {
      return this.comparePicks.every(p => !!p.date);
    }
    return true;
  }

  /** Live preview under a week pick — the whole Sun–Sat week the chosen date falls in. */
  weekPreview(date: string): string {
    const d = new Date(date + 'T00:00:00');
    const start = this.addDays(d, -d.getDay());
    const end = this.addDays(start, 6);
    return `${this.shortDate(start)} – ${this.shortDateYear(end)}`;
  }

  runCompare(): void {
    if (!this.picksValid || this.isComparing) return;

    const resolved = this.comparePicks.map(p => this.resolvePick(p));
    const seen = new Set<string>();
    for (const r of resolved) {
      const key = `${r.from}|${r.to}`;
      if (seen.has(key)) {
        this.compareError = `You picked the same ${this.unitNoun} twice (${r.label}). Change one of them.`;
        return;
      }
      seen.add(key);
    }

    this.compareError = '';
    this.isComparing = true;

    forkJoin(resolved.map(r => this.adminService.getOrderStatistics(r.from, r.to))).subscribe({
      next: (statsList) => {
        this.compareResults = resolved.map((r, i) => ({ ...r, stats: statsList[i] }));
        this.buildCompareView();
        this.isComparing = false;
        this.showCompareModal = false;
        this.compareMode = true;
        // The single-period donut canvas leaves the DOM while comparing.
        this.donut?.destroy();
        this.donut = null;
      },
      error: (err) => {
        this.isComparing = false;
        this.compareError = err?.error?.message || 'Could not load the numbers for those periods. Please try again.';
      }
    });
  }

  exitCompare(): void {
    this.compareMode = false;
    // Rebuild the donut once the single-period canvas is back in the DOM.
    this.refreshDonut();
  }

  profitOf(period: ComparePeriod): number {
    return period.stats.totalCompanyRevenue;
  }

  /** Bar width for the "what's left" side-by-side bars (negatives render as empty). */
  compareBarWidth(period: ComparePeriod): number {
    const max = Math.max(...this.compareResults.map(r => r.stats.totalCompanyRevenue));
    if (max <= 0) return 0;
    return (Math.max(0, period.stats.totalCompanyRevenue) / max) * 100;
  }

  isBest(row: CompareRow, index: number): boolean {
    return row.bestValue !== null && row.values[index] === row.bestValue;
  }

  private mkPick(d: Date): ComparePick {
    return { date: this.formatDate(d), month: d.getMonth(), year: d.getFullYear() };
  }

  /** Two sensible starting picks per unit: the previous period first, the current one second. */
  private defaultPicks(unit: CompareUnit): ComparePick[] {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    switch (unit) {
      case 'day':
        return [this.mkPick(this.addDays(today, -1)), this.mkPick(today)];
      case 'week':
        return [this.mkPick(this.addDays(today, -7)), this.mkPick(today)];
      case 'month': {
        const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        return [this.mkPick(prev), this.mkPick(today)];
      }
      case 'year':
      default: {
        const prev = new Date(today.getFullYear() - 1, 0, 1);
        return [this.mkPick(prev), this.mkPick(today)];
      }
    }
  }

  /** Turn a pick into the complete calendar period it means (whole week/month/year). */
  private resolvePick(pick: ComparePick): Omit<ComparePeriod, 'stats'> {
    switch (this.compareUnit) {
      case 'day': {
        const d = new Date(pick.date + 'T00:00:00');
        return { from: pick.date, to: pick.date, label: this.shortDateYear(d), rangeLabel: '' };
      }
      case 'week': {
        const d = new Date(pick.date + 'T00:00:00');
        const start = this.addDays(d, -d.getDay());
        const end = this.addDays(start, 6);
        return {
          from: this.formatDate(start), to: this.formatDate(end),
          label: `Week of ${this.shortDate(start)}`,
          rangeLabel: `${this.shortDate(start)} – ${this.shortDateYear(end)}`
        };
      }
      case 'month': {
        const start = new Date(pick.year, pick.month, 1);
        const end = new Date(pick.year, pick.month + 1, 0);
        return {
          from: this.formatDate(start), to: this.formatDate(end),
          label: `${this.monthNames[pick.month]} ${pick.year}`,
          rangeLabel: `${this.shortDate(start)} – ${this.shortDateYear(end)}`
        };
      }
      case 'year':
      default: {
        const start = new Date(pick.year, 0, 1);
        const end = new Date(pick.year, 11, 31);
        return {
          from: this.formatDate(start), to: this.formatDate(end),
          label: String(pick.year),
          rangeLabel: `Jan 1 – Dec 31, ${pick.year}`
        };
      }
    }
  }

  private buildCompareView(): void {
    const results = this.compareResults;
    const vals = (f: (s: OrderStatistics) => number) => results.map(r => f(r.stats));
    const row = (
      label: string,
      betterWhen: 'high' | 'low' | 'none',
      values: number[],
      isMoney = true,
      emphasize = false
    ): CompareRow => {
      let bestValue: number | null = null;
      if (betterWhen !== 'none' && !values.every(v => v === values[0])) {
        bestValue = betterWhen === 'high' ? Math.max(...values) : Math.min(...values);
      }
      return { label, betterWhen, values, isMoney, emphasize, bestValue };
    };

    // Every expense category gets its own named row (Google Ads, Salaries, …) —
    // union across the compared periods, 0 where a period had no such spending.
    const categoryNames = new Map<number, string>();
    results.forEach(r => (r.stats.expensesBreakdown?.byCategory ?? []).forEach(c => {
      if (!categoryNames.has(c.categoryId)) categoryNames.set(c.categoryId, c.categoryName);
    }));
    const categoryRows = [...categoryNames.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([id, name]) => row(name, 'none',
        vals(s => (s.expensesBreakdown?.byCategory ?? []).find(c => c.categoryId === id)?.total ?? 0)));

    // Green "best" marks only where more = better for the business: revenue,
    // profit, and completed cleanings. Cost rows carry no judgment.
    this.compareRows = [
      row('Money in (cleaning revenue)', 'high', vals(s => s.totalAmount)),
      row('Sales tax', 'none', vals(s => s.totalTaxes)),
      row('Cleaner salaries', 'none', vals(s => s.totalCleanersSalary)),
      row('Card processing fees', 'none', vals(s => s.stripeFees)),
      row('Admin bonuses', 'none', vals(s => s.adminBonusesUsd)),
      ...categoryRows,
      row('Money out (all costs together)', 'none', vals(s => s.totalAmount - s.totalCompanyRevenue)),
      row('What’s left for the company', 'high', vals(s => s.totalCompanyRevenue), true, true),
      row('Tips (pass-through, not profit)', 'none', vals(s => s.totalTips)),
      row('Completed cleanings', 'high', vals(s => s.totalOrders), false)
    ];

    // Plain-language winner line, based on the official "what's left" number.
    const profits = results.map(r => r.stats.totalCompanyRevenue);
    const max = Math.max(...profits);
    if (profits.every(p => p === profits[0])) {
      this.winnerIndex = -1;
      this.winnerLine = `It’s a tie — every period left the company ${this.usd(max)}.`;
      return;
    }
    this.winnerIndex = profits.indexOf(max);
    const sortedDesc = [...profits].sort((a, b) => b - a);
    const diff = sortedDesc[0] - sortedDesc[1];
    const winner = results[this.winnerIndex];
    if (diff === 0) {
      this.winnerLine = `${winner.label} ties for the best result — the company kept ${this.usd(max)}.`;
    } else {
      const runnerIdx = profits.findIndex((p, i) => i !== this.winnerIndex && p === sortedDesc[1]);
      this.winnerLine = `${winner.label} comes out on top — the company kept ${this.usd(max)}, `
        + `${this.usd(diff)} more than ${results[runnerIdx].label}.`;
    }
  }

  private usd(v: number): string {
    return (v < 0 ? '−$' : '$') + this.formatNumber(Math.abs(v));
  }

  private shortDate(d: Date): string {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  private shortDateYear(d: Date): string {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ── Excel export (.xlsx via SheetJS, loaded on demand on first click) ───

  isExporting = false;

  /** Money cells get a real Excel number format so sums/filters work out of the box. */
  private static readonly MONEY_FMT = '$#,##0.00';

  /** The header button exports whatever is on screen: the receipt or the comparison. */
  get canExport(): boolean {
    return this.compareMode ? this.compareResults.length > 0 : this.stats !== null;
  }

  async exportExcel(): Promise<void> {
    if (!this.isBrowser || !this.canExport || this.isExporting) return;
    this.isExporting = true;
    try {
      const XLSX = await import('xlsx');
      const wb = this.compareMode
        ? this.buildCompareWorkbook(XLSX)
        : this.buildReceiptWorkbook(XLSX);
      XLSX.writeFile(wb, this.exportFileName());
    } finally {
      this.isExporting = false;
    }
  }

  private exportFileName(): string {
    if (this.compareMode) {
      const labels = this.compareResults
        .map(r => r.label.replace(/[^\w]+/g, '-'))
        .join('_vs_');
      return `finances_compare_${labels}.xlsx`;
    }
    const win = this.getDateWindow();
    return win.from && win.to
      ? `finances_${win.from}_to_${win.to}.xlsx`
      : 'finances_all-time.xlsx';
  }

  /** Applies the money format to every numeric cell of a sheet column (0-based). */
  private formatMoneyColumn(
    XLSX: typeof import('xlsx'),
    ws: import('xlsx').WorkSheet,
    col: number,
    skipRows: Set<number> = new Set()
  ): void {
    const range = XLSX.utils.decode_range(ws['!ref']!);
    for (let r = range.s.r; r <= range.e.r; r++) {
      if (skipRows.has(r)) continue;
      const cell = ws[XLSX.utils.encode_cell({ r, c: col })];
      if (cell && cell.t === 'n') cell.z = FinancesComponent.MONEY_FMT;
    }
  }

  private buildReceiptWorkbook(XLSX: typeof import('xlsx')): import('xlsx').WorkBook {
    const stats = this.stats!;
    const win = this.getDateWindow();
    const period = win.from && win.to ? `${win.from} to ${win.to}` : 'All time';

    const rows: (string | number)[][] = [
      ['Dream Cleaning — Finances export', period],
      [],
      ['Section', 'Item', 'Amount (USD)', 'Counted in profit'],
      ['Money in', 'Cleaning revenue (order subtotals)', this.moneyIn, 'Yes'],
      ...this.costLines.map(l =>
        ['Money out', l.label, l.amount, l.included ? 'Yes' : 'No'] as (string | number)[]),
      ['Info', 'Tips (pass-through, not company money)', stats.totalTips, 'No'],
      ['Info', 'Completed paid orders', stats.totalOrders, ''],
      [],
      ['Totals', 'Money out (checked items)', this.moneyOut, ''],
      ['Totals', 'Profit (money in − checked money out)', this.profit, ''],
      ['Totals', 'Official company revenue (everything counted)', this.officialRevenue, '']
    ];

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 12 }, { wch: 48 }, { wch: 16 }, { wch: 18 }];
    // Everything in the amount column is money except the order count.
    const countRow = rows.findIndex(r => r[1] === 'Completed paid orders');
    this.formatMoneyColumn(XLSX, ws, 2, new Set([countRow]));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Receipt');

    // Per-expense detail so an accountant can verify every category total.
    const detailLines = this.costLines.filter(l => l.items?.length);
    if (detailLines.length > 0) {
      const detailRows: (string | number)[][] = [
        ['Category', 'Expense', 'Date', 'Amount (USD)'],
        ...detailLines.flatMap(line => line.items!.map(item =>
          [line.label, item.name, item.date?.substring(0, 10) ?? '', item.amount] as (string | number)[]))
      ];
      const detailWs = XLSX.utils.aoa_to_sheet(detailRows);
      detailWs['!cols'] = [{ wch: 24 }, { wch: 40 }, { wch: 12 }, { wch: 16 }];
      this.formatMoneyColumn(XLSX, detailWs, 3);
      XLSX.utils.book_append_sheet(wb, detailWs, 'Expense detail');
    }

    return wb;
  }

  /** Mirrors the on-screen "Everything, side by side" table, one column per period. */
  private buildCompareWorkbook(XLSX: typeof import('xlsx')): import('xlsx').WorkBook {
    const results = this.compareResults;
    const rows: (string | number)[][] = [
      ['Dream Cleaning — Side-by-side comparison'],
      [],
      ['Metric', ...results.map(r => r.label)],
      ['Period', ...results.map(r => r.rangeLabel || `${r.from} to ${r.to}`)],
      ...this.compareRows.map(row => [row.label, ...row.values] as (string | number)[])
    ];
    if (this.winnerLine) {
      rows.push([]);
      rows.push([this.winnerLine]);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 36 }, ...results.map(() => ({ wch: 18 }))];
    // Non-money rows (e.g. completed cleanings) keep their plain number format.
    const compareRowsStart = 4;
    const skip = new Set(this.compareRows
      .map((row, i) => (row.isMoney ? -1 : compareRowsStart + i))
      .filter(i => i >= 0));
    for (let c = 1; c <= results.length; c++) {
      this.formatMoneyColumn(XLSX, ws, c, skip);
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Comparison');
    return wb;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  formatNumber(v: number): string {
    return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  trackByKey(_: number, line: CostLine): string {
    return line.key;
  }
}
