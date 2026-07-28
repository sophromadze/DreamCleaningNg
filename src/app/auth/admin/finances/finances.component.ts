import { Component, OnInit, OnDestroy, ViewChild, ElementRef, Inject, PLATFORM_ID, ChangeDetectorRef } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin, from, of, Subject } from 'rxjs';
import { map, mergeMap, takeUntil, toArray } from 'rxjs/operators';
import Chart from 'chart.js/auto';
import { AdminService, OrderStatistics, ExpenseBreakdownItem } from '../../../services/admin.service';
import { ThemeService } from '../../../services/theme.service';

type QuickFilter = 'today' | 'week' | 'month' | 'lastMonth' | 'year' | 'lastYear' | 'all';

/**
 * One money-out row of the receipt. Every row can be checked/unchecked; the profit
 * number recomputes live from whatever is checked. Rows are built from the same
 * /api/admin/statistics response the Statistics page uses, so with everything
 * checked the result always equals the official Net Income.
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
  /**
   * Chart token slot ('--chart-cat-N'), or null to fold into the muted "Other
   * expenses" slice. The four fixed lines always keep slots 1–4; expense
   * categories compete for 5–8 by size (see CATEGORY_CHART_SLOTS).
   */
  colorVar: string | null;
  /** Individual expense entries (only for expense-category rows) — expandable detail. */
  items?: ExpenseBreakdownItem[];
  expanded?: boolean;
}

/** One "per cleaning" tile: a size-independent average for the chosen period. */
interface PerCleaningStat {
  label: string;
  hint: string;
  value: number;
  /** Change vs the previous window with the same rows checked (null when none). */
  delta: number | null;
  /** Costs read better when they fall; revenue and what's left when they rise. */
  betterWhen: 'high' | 'low';
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

/**
 * Donut slots available to expense categories. The categorical palette has 8
 * validated hues (--chart-cat-1..8) and the three fixed cost lines hold 1–3, so
 * five are left. Raising this needs new validated tokens in styles.scss, not
 * generated hues — and a donut past ~9 slices stops being readable anyway.
 */
const CATEGORY_CHART_SLOTS = 5;

/**
 * How many statistics calls the compare run keeps in flight. The number of
 * compared periods is unlimited, and each call is a heavy aggregate over orders
 * + expenses, so they go out a few at a time rather than all at once.
 */
const MAX_PARALLEL_STAT_REQUESTS = 4;

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
  /**
   * Cost key ('taxes' | 'salaries' | 'stripeFees' | 'adminBonuses' | 'cat-<id>')
   * when the row can be checked/unchecked, null for fixed/info rows. Keys are the
   * SAME ones the receipt uses, so unchecking a cost in either view holds in both.
   */
  key: string | null;
  label: string;
  /** Which direction is "best" for this row — costs are best when lowest. */
  betterWhen: 'high' | 'low' | 'none';
  format: 'money' | 'count' | 'percent';
  emphasize?: boolean;
  /**
   * The on-screen-only "what it would be with every cost counted" row. It exists
   * to keep the official figure one glance away while costs are unchecked, and is
   * deliberately kept OUT of the export, which only carries the selection.
   */
  isOfficialTotal?: boolean;
  /** Cost rows only: false when the user unchecked it (left out of money out). */
  included: boolean;
  values: number[];
  /** Each value as a share of that period's money in — the per-cost margin view. */
  sharePercents: number[] | null;
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
  /** Per-period "what's left", recomputed from the CHECKED cost rows only. */
  compareProfits: number[] = [];
  /** Per-period profit margin (what's left ÷ money in), in percent. */
  compareMargins: number[] = [];
  /** Shows each cost as a share of that period's money in, next to the dollar value. */
  showCostShares = false;
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
    totalDiscounts: 0,
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

  /**
   * Money in — company revenue after discounts, before tax, without tips (net of refunds).
   * The same figure the Statistics page shows as "Company Revenue".
   */
  get moneyIn(): number {
    return this.stats?.totalAmount ?? 0;
  }

  /** Sum of the CHECKED money-out rows. */
  get moneyOut(): number {
    return this.costLines.reduce((sum, l) => sum + (l.included ? l.amount : 0), 0);
  }

  /** The headline "Net income": money in minus whatever costs are checked. */
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

  // ── Margin & per-cleaning averages ───────────────────────────────────────
  // Same measures the comparison shows, for the single period. These follow the
  // checkboxes: uncheck a cost and the margin rises, the cost per cleaning drops.
  // Previous-window figures use the SAME checked rows. (Gross margin below is the
  // one deliberate exception — see its own note.)

  /** Net income as a share of money in. */
  get profitMargin(): number {
    return this.moneyIn > 0 ? (this.profit / this.moneyIn) * 100 : 0;
  }

  private get prevMargin(): number | null {
    const prevIn = this.prevStats?.totalAmount ?? null;
    const prevLeft = this.prevProfit;
    if (prevIn === null || prevLeft === null || prevIn <= 0) return null;
    return (prevLeft / prevIn) * 100;
  }

  get hasMarginComparison(): boolean {
    return this.prevMargin !== null;
  }

  /** Margin change in percentage POINTS — a percent-of-a-percent would mislead. */
  get marginDelta(): number {
    const prev = this.prevMargin;
    return prev === null ? 0 : this.profitMargin - prev;
  }

  get marginDeltaAbs(): number {
    return Math.abs(this.marginDelta);
  }

  // ── Gross margin ─────────────────────────────────────────────────────────
  // The one measure on this page that does NOT follow the checkboxes. Gross margin
  // answers "how much does a cleaning leave before overhead", so it always subtracts
  // exactly one cost — the cleaner's wage, the only direct cost of delivering the
  // service. Everything else (card fees, admin bonuses, ads, phone, …) is overhead and
  // shows up only in the net margin; the GAP between the two margins is that overhead.
  // Letting the checkboxes move it would make it read 100% the moment salaries are
  // unchecked, which is not a margin anyone can act on.

  /** Direct cost of delivering the cleanings — the only cost gross margin subtracts. */
  get cleanerSalaries(): number {
    return this.stats?.totalCleanersSalary ?? 0;
  }

  /** Company revenue minus cleaner salaries, before any overhead. */
  get grossProfit(): number {
    return this.moneyIn - this.cleanerSalaries;
  }

  get grossMargin(): number {
    return this.moneyIn > 0 ? (this.grossProfit / this.moneyIn) * 100 : 0;
  }

  private get prevGrossMargin(): number | null {
    const prevIn = this.prevStats?.totalAmount ?? null;
    if (prevIn === null || prevIn <= 0) return null;
    return ((prevIn - this.prevStats!.totalCleanersSalary) / prevIn) * 100;
  }

  get hasGrossMarginComparison(): boolean {
    return this.prevGrossMargin !== null;
  }

  /** Percentage POINTS, like marginDelta — a percent-of-a-percent would mislead. */
  get grossMarginDelta(): number {
    const prev = this.prevGrossMargin;
    return prev === null ? 0 : this.grossMargin - prev;
  }

  get grossMarginDeltaAbs(): number {
    return Math.abs(this.grossMarginDelta);
  }

  get completedCleanings(): number {
    return this.stats?.totalOrders ?? 0;
  }

  get perCleaningStats(): PerCleaningStat[] {
    const orders = this.completedCleanings;
    const prevOrders = this.prevStats?.totalOrders ?? 0;
    const per = (v: number) => (orders > 0 ? v / orders : 0);
    const prevPer = (v: number | null) =>
      v !== null && prevOrders > 0 ? v / prevOrders : null;
    const delta = (current: number, previous: number | null) =>
      previous === null ? null : current - previous;

    const prevIn = this.prevStats?.totalAmount ?? null;
    const prevOut = this.prevStats
      ? this.costLines.reduce((sum, l) => sum + (l.included ? (l.prevAmount ?? 0) : 0), 0)
      : null;

    const moneyIn = per(this.moneyIn);
    const cost = per(this.moneyOut);
    const left = per(this.profit);

    return [
      {
        label: 'Money in per cleaning',
        hint: 'What one cleaning brought in, on average.',
        value: moneyIn,
        delta: delta(moneyIn, prevPer(prevIn)),
        betterWhen: 'high'
      },
      {
        label: 'Cost per cleaning',
        hint: 'The checked costs, split across the cleanings in this period.',
        value: cost,
        delta: delta(cost, prevPer(prevOut)),
        betterWhen: 'low'
      },
      {
        label: 'Net income per cleaning',
        hint: 'What one cleaning left the company after those costs.',
        value: left,
        delta: delta(left, prevPer(this.prevProfit)),
        betterWhen: 'high'
      }
    ];
  }

  /** Green when the change went the way this measure wants (costs: down is good). */
  isDeltaGood(stat: PerCleaningStat): boolean {
    const d = stat.delta ?? 0;
    return stat.betterWhen === 'high' ? d >= 0 : d <= 0;
  }

  deltaArrow(stat: PerCleaningStat): string {
    return (stat.delta ?? 0) >= 0 ? '▲' : '▼';
  }

  deltaAbs(stat: PerCleaningStat): number {
    return Math.abs(stat.delta ?? 0);
  }

  toggleLine(line: CostLine): void {
    this.setIncluded(line.key, !line.included);
    this.afterInclusionChange();
  }

  includeEverything(): void {
    this.excludedKeys.clear();
    this.costLines.forEach(l => (l.included = true));
    this.afterInclusionChange();
  }

  /** Single place that flips a cost on/off, so the receipt and the comparison agree. */
  private setIncluded(key: string, included: boolean): void {
    if (included) {
      this.excludedKeys.delete(key);
    } else {
      this.excludedKeys.add(key);
    }
    const line = this.costLines.find(l => l.key === key);
    if (line) line.included = included;
  }

  private afterInclusionChange(): void {
    if (this.compareMode) {
      // The comparison recomputes from the already-loaded stats — no refetch.
      this.buildCompareView();
    } else {
      this.refreshDonut();
    }
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
    // Fixed rows take chart slots 1–3; expense categories take 4+ in ascending
    // categoryId (creation) order so a category keeps its color across periods.
    // Sales tax is deliberately NOT a cost row. Money in is the price BEFORE tax, and the
    // tax the customer pays on top never entered it — deducting it here subtracted money
    // that was never counted as income. It now sits in "Good to know" as a pass-through.
    const lines: CostLine[] = [
      {
        key: 'salaries',
        label: 'Cleaner salaries',
        explanation: 'What we pay the cleaners for the orders in this period.',
        amount: stats.totalCleanersSalary,
        prevAmount: prev ? prev.totalCleanersSalary : null,
        included: !this.excludedKeys.has('salaries'),
        colorVar: '--chart-cat-1'
      },
      {
        key: 'stripeFees',
        label: 'Card processing fees',
        explanation: 'Stripe keeps 2.9% + $0.30 of every card payment before the money reaches us.',
        amount: stats.stripeFees,
        prevAmount: prev ? prev.stripeFees : null,
        included: !this.excludedKeys.has('stripeFees'),
        colorVar: '--chart-cat-2'
      },
      {
        key: 'adminBonuses',
        label: 'Admin bonuses',
        explanation: `Per-order bonuses for admins, paid in GEL (₾${this.formatNumber(stats.adminBonusesGel)}) and converted at each month's locked rate.`,
        amount: stats.adminBonusesUsd,
        prevAmount: prev ? prev.adminBonusesUsd : null,
        included: !this.excludedKeys.has('adminBonuses'),
        colorVar: '--chart-cat-3'
      }
    ];

    const categories = [...(stats.expensesBreakdown?.byCategory ?? [])]
      .sort((a, b) => a.categoryId - b.categoryId);
    const prevCategories = new Map(
      (prev?.expensesBreakdown?.byCategory ?? []).map(c => [c.categoryId, c.total]));

    // The three fixed lines above hold chart slots 1–3, so only slots 4–8 are left
    // for expense categories — the rest fold into the muted "Other expenses"
    // slice. Which ones get a slot is decided by how much they cost in this
    // period, NOT by category id: the old rule handed slots to the lowest-id
    // categories, so big spends that happen to sort late (Salaries is id 4,
    // Google Ads is created on first sync and lands higher still) were
    // permanently buried in "Other expenses" no matter how large they were.
    // Ranking also stops a $0 category from holding a slot it can't use.
    const slotByCategoryId = new Map<number, string>(
      [...categories]
        .sort((a, b) => b.total - a.total)
        .slice(0, CATEGORY_CHART_SLOTS)
        .map((cat, i) => [cat.categoryId, `--chart-cat-${4 + i}`] as const)
    );

    categories.forEach(cat => {
      const key = `cat-${cat.categoryId}`;
      lines.push({
        key,
        label: cat.categoryName,
        explanation: `Company spending on “${cat.categoryName}” during this period. Click the row to see each expense.`,
        amount: cat.total,
        prevAmount: prev ? (prevCategories.get(cat.categoryId) ?? 0) : null,
        included: !this.excludedKeys.has(key),
        colorVar: slotByCategoryId.get(cat.categoryId) ?? null,
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
    // The next period back from the last one, so adding is one click per period
    // instead of hunting through the dropdowns.
    const last = this.comparePicks[this.comparePicks.length - 1];
    this.comparePicks.push(last ? this.stepBack(last) : this.mkPick(new Date()));
  }

  removePick(index: number): void {
    if (this.comparePicks.length > 2) {
      this.comparePicks.splice(index, 1);
    }
  }

  /** One whole unit earlier than the given pick. */
  private stepBack(pick: ComparePick): ComparePick {
    switch (this.compareUnit) {
      case 'day':
        return this.mkPick(this.addDays(new Date(pick.date + 'T00:00:00'), -1));
      case 'week':
        return this.mkPick(this.addDays(new Date(pick.date + 'T00:00:00'), -7));
      case 'month':
        return this.mkPick(new Date(pick.year, pick.month - 1, 1));
      case 'year':
      default:
        return this.mkPick(new Date(pick.year - 1, 0, 1));
    }
  }

  /** Quick-fill sizes offered for the active unit (years are capped by the dropdown). */
  get quickFillCounts(): number[] {
    return this.compareUnit === 'year' ? [3, 5] : [6, 12];
  }

  /** Fills the list with the last N whole units, oldest first. */
  quickFill(count: number): void {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const picks: ComparePick[] = [];
    for (let back = count - 1; back >= 0; back--) {
      switch (this.compareUnit) {
        case 'day':
          picks.push(this.mkPick(this.addDays(today, -back)));
          break;
        case 'week':
          picks.push(this.mkPick(this.addDays(today, -back * 7)));
          break;
        case 'month':
          picks.push(this.mkPick(new Date(today.getFullYear(), today.getMonth() - back, 1)));
          break;
        case 'year':
        default:
          picks.push(this.mkPick(new Date(today.getFullYear() - back, 0, 1)));
          break;
      }
    }
    this.comparePicks = picks;
    this.compareError = '';
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

    // The period count is unlimited, so the statistics calls are throttled instead
    // of fired all at once — each one is a heavy multi-query aggregate. Results
    // carry their index because mergeMap completes out of order.
    from(resolved.map((r, i) => ({ r, i }))).pipe(
      mergeMap(({ r, i }) => this.adminService.getOrderStatistics(r.from, r.to)
        .pipe(map(stats => ({ i, stats }))), MAX_PARALLEL_STAT_REQUESTS),
      toArray()
    ).subscribe({
      next: (loaded) => {
        const statsList: OrderStatistics[] = [];
        loaded.forEach(({ i, stats }) => (statsList[i] = stats));
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

  /** Bar width for the "what's left" side-by-side bars (negatives render as empty). */
  compareBarWidth(index: number): number {
    const max = Math.max(...this.compareProfits);
    if (max <= 0) return 0;
    return (Math.max(0, this.compareProfits[index]) / max) * 100;
  }

  isBest(row: CompareRow, index: number): boolean {
    return row.bestValue !== null && row.values[index] === row.bestValue;
  }

  /** Cost rows the user unchecked — they stay visible but sit outside the math. */
  get compareExcludedCount(): number {
    return this.compareRows.filter(r => r.key !== null && !r.included).length;
  }

  /** Official "what's left" per period (every cost counted), for the unchecked-costs note. */
  get compareOfficialProfits(): number[] {
    return this.compareResults.map(r => r.stats.totalCompanyRevenue);
  }

  toggleCompareRow(row: CompareRow): void {
    if (!row.key) return;
    this.setIncluded(row.key, !row.included);
    this.buildCompareView();
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

  /**
   * Builds the comparison table from the already-loaded per-period stats. Called
   * again (without refetching) whenever a cost row is checked or unchecked, so
   * "what's left" and the margins always reflect the CHECKED rows only.
   */
  private buildCompareView(): void {
    const results = this.compareResults;
    const vals = (f: (s: OrderStatistics) => number) => results.map(r => f(r.stats));
    const moneyIn = vals(s => s.totalAmount);

    const row = (
      label: string,
      betterWhen: 'high' | 'low' | 'none',
      values: number[],
      opts: {
        key?: string;
        format?: 'money' | 'count' | 'percent';
        emphasize?: boolean;
        withShare?: boolean;
        officialTotal?: boolean;
      } = {}
    ): CompareRow => {
      let bestValue: number | null = null;
      if (betterWhen !== 'none' && !values.every(v => v === values[0])) {
        bestValue = betterWhen === 'high' ? Math.max(...values) : Math.min(...values);
      }
      return {
        key: opts.key ?? null,
        label,
        betterWhen,
        format: opts.format ?? 'money',
        emphasize: opts.emphasize ?? false,
        isOfficialTotal: opts.officialTotal ?? false,
        included: opts.key ? !this.excludedKeys.has(opts.key) : true,
        values,
        sharePercents: opts.withShare ? values.map((v, i) => this.share(v, moneyIn[i])) : null,
        bestValue
      };
    };

    // Every expense category gets its own named row (Google Ads, Salaries, …) —
    // union across the compared periods, 0 where a period had no such spending.
    const categoryNames = new Map<number, string>();
    results.forEach(r => (r.stats.expensesBreakdown?.byCategory ?? []).forEach(c => {
      if (!categoryNames.has(c.categoryId)) categoryNames.set(c.categoryId, c.categoryName);
    }));

    // Cost rows carry the receipt's keys so a row unchecked on one screen stays
    // unchecked on the other, and each one can be left out of the math here too.
    const costRows: CompareRow[] = [
      row('Cleaner salaries', 'none', vals(s => s.totalCleanersSalary), { key: 'salaries', withShare: true }),
      row('Card processing fees', 'none', vals(s => s.stripeFees), { key: 'stripeFees', withShare: true }),
      row('Admin bonuses', 'none', vals(s => s.adminBonusesUsd), { key: 'adminBonuses', withShare: true }),
      ...[...categoryNames.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([id, name]) => row(name, 'none',
          vals(s => (s.expensesBreakdown?.byCategory ?? []).find(c => c.categoryId === id)?.total ?? 0),
          { key: `cat-${id}`, withShare: true }))
    ];

    // Only the checked cost rows count toward money out — same rule as the receipt.
    const moneyOut = results.map((_, i) =>
      costRows.reduce((sum, r) => sum + (r.included ? r.values[i] : 0), 0));
    this.compareProfits = moneyIn.map((v, i) => v - moneyOut[i]);
    this.compareMargins = this.compareProfits.map((p, i) => this.share(p, moneyIn[i]));

    // Gross margin ignores the checkboxes entirely (see the getters above): it always
    // subtracts exactly the cleaner salaries, so periods stay comparable on the one
    // measure that is about the service itself rather than that period's overhead.
    const grossMargins = results.map((r, i) =>
      this.share(moneyIn[i] - r.stats.totalCleanersSalary, moneyIn[i]));

    // Per-cleaning averages — the size-independent view: how much a single
    // cleaning brought in, what it cost us, and what it left behind.
    const orders = vals(s => s.totalOrders);
    const perOrder = (values: number[]) =>
      values.map((v, i) => (orders[i] > 0 ? v / orders[i] : 0));
    // A period with no cleanings averages 0 everywhere; letting that win "lowest
    // cost per cleaning" would be nonsense, so no period is marked best then.
    const rank = (dir: 'high' | 'low'): 'high' | 'low' | 'none' =>
      orders.every(o => o > 0) ? dir : 'none';

    // Green "best" marks only where the direction is genuinely better for the
    // business. Total-cost rows carry no judgment (a bigger month costs more);
    // per-cleaning cost does, because it is size-independent.
    this.compareRows = [
      row('Money in (company revenue)', 'high', moneyIn),
      ...costRows,
      row('Money out (checked costs)', 'none', moneyOut, { withShare: true }),
      row('Net income', 'high', this.compareProfits, { emphasize: true }),
      row('Gross margin (after cleaner salaries only)', 'high', grossMargins,
        { format: 'percent' }),
      row('Net margin (net income ÷ money in)', 'high', this.compareMargins,
        { format: 'percent', emphasize: true }),
      // Only while something is unchecked: the official figure stays one glance
      // away instead of being buried in a note that grows with the period count.
      ...(costRows.some(r => !r.included)
        ? [row('… if every cost were counted', 'none', this.compareOfficialProfits,
          { officialTotal: true })]
        : []),
      row('Average money in per cleaning', rank('high'), perOrder(moneyIn)),
      row('Average cost per cleaning (checked costs)', rank('low'), perOrder(moneyOut)),
      row('Average net income per cleaning', rank('high'), perOrder(this.compareProfits),
        { emphasize: true }),
      // Pass-throughs and give-aways: never part of money in or money out, but they
      // explain why one period's revenue moved against another's.
      row('Sales tax collected (goes to the state)', 'none', vals(s => s.totalTaxes)),
      // 'none': a bigger discount bill is not automatically worse — discounts buy bookings.
      row('Discounts given to customers', 'none', vals(s => s.totalDiscounts)),
      row('Tips (pass-through, not profit)', 'none', vals(s => s.totalTips)),
      row('Completed cleanings', 'high', orders, { format: 'count' })
    ];

    this.buildWinnerLine();
  }

  /** Percent of money in — 0 when the period took no money (no meaningful share). */
  private share(value: number, moneyIn: number): number {
    return moneyIn > 0 ? (value / moneyIn) * 100 : 0;
  }

  private buildWinnerLine(): void {
    const results = this.compareResults;
    const profits = this.compareProfits;
    const max = Math.max(...profits);
    // Margin decides ties and colors the sentence: on unequal-sized periods the
    // bigger dollar figure can still be the worse-run period.
    const marginOf = (i: number) => `${this.compareMargins[i].toFixed(1)}% margin`;

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
      this.winnerLine = `${winner.label} ties for the best result — the company kept `
        + `${this.usd(max)} (${marginOf(this.winnerIndex)}).`;
      return;
    }
    const runnerIdx = profits.findIndex((p, i) => i !== this.winnerIndex && p === sortedDesc[1]);
    this.winnerLine = `${winner.label} comes out on top — the company kept ${this.usd(max)} `
      + `(${marginOf(this.winnerIndex)}), ${this.usd(diff)} more than ${results[runnerIdx].label} `
      + `(${marginOf(runnerIdx)}).`;
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

  /** Margin cells are stored as plain numbers (34.2), so the % is part of the format. */
  private static readonly PERCENT_FMT = '0.0"%"';

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
      // Naming every period is only readable for a handful of them; past that the
      // filename would run to hundreds of characters.
      if (this.compareResults.length > 4) {
        const first = this.compareResults[0];
        const last = this.compareResults[this.compareResults.length - 1];
        return `finances_compare_${this.compareResults.length}_periods_`
          + `${first.from}_to_${last.to}.xlsx`;
      }
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

    // The export is a document of the CURRENT selection: unchecked costs are not
    // written at all — no greyed row, no "counted?" column — so every number in
    // the file adds up to the totals at the bottom.
    const includedLines = this.costLines.filter(l => l.included);

    const rows: (string | number)[][] = [
      ['Dream Cleaning — Finances export', period],
      [],
      ['Section', 'Item', 'Amount (USD)'],
      ['Money in', 'Company revenue (after discounts, before tax, without tips)', this.moneyIn],
      ...includedLines.map(l => ['Money out', l.label, l.amount] as (string | number)[]),
      // Pass-throughs: charged on top of the price, so they were never in money in
      // and must not appear under money out.
      ['Info', 'Sales tax collected (owed to the state)', stats.totalTaxes],
      ['Info', 'Discounts given to customers', stats.totalDiscounts],
      // Tips follow their own checkbox in the "Good to know" section.
      ...(this.showTips
        ? [['Info', 'Tips (pass-through, not company money)', stats.totalTips] as (string | number)[]]
        : []),
      ['Info', 'Completed paid orders', stats.totalOrders],
      [],
      ['Totals', 'Money out', this.moneyOut],
      ['Totals', 'Net income (money in − money out)', this.profit],
      // Gross margin subtracts ONLY the cleaner salaries and ignores the checkbox
      // selection, so it exports the same value whatever the on-screen selection is.
      ['Totals', 'Gross margin (after cleaner salaries only)', this.grossMargin],
      ['Totals', 'Net margin', this.profitMargin],
      // The size-independent view — also computed from the selected costs only.
      ...(this.completedCleanings > 0
        ? this.perCleaningStats.map(s => ['Per cleaning', s.label, s.value] as (string | number)[])
        : [])
    ];

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 12 }, { wch: 48 }, { wch: 16 }];
    // Everything in the amount column is money except the order count and the margins.
    const countRow = rows.findIndex(r => r[1] === 'Completed paid orders');
    const marginRows = [
      rows.findIndex(r => r[1] === 'Gross margin (after cleaner salaries only)'),
      rows.findIndex(r => r[1] === 'Net margin')
    ];
    this.formatMoneyColumn(XLSX, ws, 2, new Set([countRow, ...marginRows]));
    for (const marginRow of marginRows) {
      const marginCell = ws[XLSX.utils.encode_cell({ r: marginRow, c: 2 })];
      if (marginCell && marginCell.t === 'n') marginCell.z = FinancesComponent.PERCENT_FMT;
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Receipt');

    // Per-expense detail so an accountant can verify every category total —
    // again only for the categories that made it into the sheet above.
    const detailLines = includedLines.filter(l => l.items?.length);
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
    // Same rule as the receipt sheet: only the selected rows are written. An
    // unchecked cost leaves no trace, and the on-screen "if every cost were
    // counted" reference row is not part of the selection either.
    const exportRows = this.compareRows.filter(row =>
      (row.key === null || row.included) && !row.isOfficialTotal);

    const rows: (string | number)[][] = [
      ['Dream Cleaning — Side-by-side comparison'],
      [],
      ['Metric', ...results.map(r => r.label)],
      ['Period', ...results.map(r => r.rangeLabel || `${r.from} to ${r.to}`)],
      ...exportRows.map(row => [row.label, ...row.values] as (string | number)[])
    ];
    if (this.winnerLine) {
      rows.push([]);
      rows.push([this.winnerLine]);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 36 }, ...results.map(() => ({ wch: 18 }))];

    // Each metric row carries its own number format: money, percent, or a plain
    // count (completed cleanings), so Excel shows what the screen shows.
    const compareRowsStart = 4;
    exportRows.forEach((row, i) => {
      const fmt = row.format === 'money' ? FinancesComponent.MONEY_FMT
        : row.format === 'percent' ? FinancesComponent.PERCENT_FMT
          : null;
      if (!fmt) return;
      for (let c = 1; c <= results.length; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r: compareRowsStart + i, c })];
        if (cell && cell.t === 'n') cell.z = fmt;
      }
    });

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

  /** perCleaningStats rebuilds each cycle by design — keyed so the DOM is reused. */
  trackByStatLabel(_: number, stat: PerCleaningStat): string {
    return stat.label;
  }
}
