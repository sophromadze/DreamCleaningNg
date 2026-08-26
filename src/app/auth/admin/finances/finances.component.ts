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
  /** Stable key: 'salesTax' | 'salaries' | 'stripeFees' | 'adminBonuses' | 'cat-<categoryId>' */
  key: string;
  label: string;
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

/**
 * One rendered line of the profit-and-loss chain in the main card. The chain runs
 * top to bottom exactly as it reads:
 *
 *   Total Revenue − Sales tax = Net Revenue Baseline
 *   Net Revenue Baseline − Cleaner salaries = Gross margin
 *   Gross margin − Operating expenses − Additional deductions = Net Company Income
 *
 * 'deduction' rows are the checkable CostLines. 'subtotal' / 'base' / 'result' rows
 * are computed from them and carry no checkbox — unchecking a deduction is the only
 * way to move them.
 */
interface PnlRow {
  kind: 'base' | 'deduction' | 'subtotal' | 'result';
  /** CostLine key for 'deduction' rows; null for every computed row. */
  key: string | null;
  label: string;
  amount: number;
  /** Share of the Net Revenue Baseline — shown on every row while "Show %" is on. */
  percent: number;
  included: boolean;
  /** Deduction rows that sit under a subtotal header (expenses, additional deductions). */
  indent: boolean;
  /** Expandable per-expense detail (expense-category rows only). */
  items?: ExpenseBreakdownItem[];
  expanded?: boolean;
  /** The CostLine behind a 'deduction' row, so the template can toggle it directly. */
  line?: CostLine;
}

/**
 * A row of the second card: the totals and averages that sit outside the P&L chain
 * (money out, per-cleaning averages, and the pass-throughs).
 */
interface SummaryRow {
  key: string;
  label: string;
  value: number;
  format: 'money' | 'count';
  /** Change vs the previous window with the same rows checked (null when none). */
  delta: number | null;
  /** Costs read better when they fall; revenue and what's left when they rise. */
  betterWhen: 'high' | 'low' | 'none';
  /** Share of the Net Revenue Baseline, or null where a share carries no meaning (averages, counts). */
  percent: number | null;
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
  /**
   * The period's real end, ignoring the "stop at today" clamp the running filters apply to
   * the money window. Unfinished cleanings all sit after today, so counting them needs this.
   */
  fullTo?: string;
  prevFrom?: string;
  prevTo?: string;
  compareLabel: string;
}

/**
 * Donut slots available to expense categories. The categorical palette has 8
 * validated hues (--chart-cat-1..8) and the four fixed cost lines hold 1–4, so
 * four are left. Raising this needs new validated tokens in styles.scss, not
 * generated hues — and a donut past ~9 slices stops being readable anyway.
 */
const CATEGORY_CHART_SLOTS = 4;

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
   * Cost key ('salesTax' | 'salaries' | 'stripeFees' | 'adminBonuses' | 'cat-<id>')
   * when the row can be checked/unchecked, null for computed/info rows. Keys are the
   * SAME ones the receipt uses, so unchecking a cost in either view holds in both.
   */
  key: string | null;
  label: string;
  /** Which direction is "best" for this row — costs are best when lowest. */
  betterWhen: 'high' | 'low' | 'none';
  format: 'money' | 'count' | 'percent';
  emphasize?: boolean;
  /** Computed subtotal of the P&L chain — styled as a rule-off, never checkable. */
  subtotal?: boolean;
  /** Deduction sitting under a subtotal header (expense categories, stripe/bonuses). */
  indent?: boolean;
  /**
   * The on-screen-only "what it would be with every cost counted" row. It exists
   * to keep the official figure one glance away while costs are unchecked, and is
   * deliberately kept OUT of the export, which only carries the selection.
   */
  isOfficialTotal?: boolean;
  /** Cost rows only: false when the user unchecked it (left out of money out). */
  included: boolean;
  values: number[];
  /** Each value as a share of that period's Net Revenue Baseline — the per-row margin view. */
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

  /**
   * Folds the period's booked-but-unfinished cleanings into every number, turning
   * the page into a projection of the period once everything on the books is done.
   * Needs a refetch (the backend decides which orders count), unlike the cost
   * checkboxes which are pure client-side math.
   */
  includeUpcoming = false;

  /** Percentages are part of the reading, not an extra — on unless deliberately hidden. */
  showPercents = true;

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
  /** The P&L chain, one column per period — the first comparison card. */
  compareChainRows: CompareRow[] = [];
  /** Totals, averages and pass-throughs — the second comparison card. */
  compareSummaryRows: CompareRow[] = [];
  /** Both tables in one list, for the export and the unchecked-costs count. */
  compareRows: CompareRow[] = [];
  /** Per-period "what's left", recomputed from the CHECKED cost rows only. */
  compareProfits: number[] = [];
  /** Per-period net income margin (what's left ÷ total revenue), in percent. */
  compareMargins: number[] = [];
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
    totalTaxRetained: 0,
    totalTips: 0,
    totalDiscounts: 0,
    totalCleanersSalary: 0,
    totalExpenses: 0,
    totalCompanyRevenueGross: 0,
    totalCompanyRevenue: 0,
    expensesBreakdown: null,
    stripeFees: 0,
    adminBonusesUsd: 0,
    adminBonusesGel: 0,
    upcomingOrders: 0,
    includesUpcoming: false,
    googleAdsSpend: 0,
    googleAdsCoveredDays: 0,
    googleAdsDailyAverage: 0,
    googleAdsProjectedDays: 0,
    googleAdsProjectedSpend: 0
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

  /**
   * The one toggle on this page that changes WHICH ORDERS COUNT rather than which
   * costs are subtracted, so it has to go back to the server — including the
   * comparison, whose periods are re-fetched with the new setting.
   */
  onIncludeUpcomingChange(): void {
    if (this.compareMode) {
      this.reloadCompare();
    } else {
      this.loadData();
    }
  }

  // ── The P&L chain ────────────────────────────────────────────────────────
  // Every figure below is derived from the CHECKED cost lines, so the whole chain
  // moves together when a cost is unchecked. With everything checked the bottom
  // line is exactly the official Net Income.

  /**
   * What customers actually paid for cleanings — the discounted price plus the sales
   * tax charged on top of it, net of refunds. Tips are excluded: they belong to the
   * cleaners, not the company, and are reported separately below.
   *
   * `totalAmount` already carries the tax kept on non-card payments and `totalTaxes` carries
   * only the remitted part (see OrderRevenueMath), so this sum is the whole charged amount
   * either way — the split below is what changes, not this figure.
   */
  get totalRevenue(): number {
    return (this.stats?.totalAmount ?? 0) + (this.stats?.totalTaxes ?? 0);
  }

  /** The sales tax line as it currently counts (0 while unchecked). */
  get salesTaxDeducted(): number {
    return this.amountOf('salesTax');
  }

  /**
   * Sales tax charged on cash / Zelle / check orders. Never remitted, so it is NOT a
   * deduction — it is already inside the Net Revenue Baseline and flows to Net Company
   * Income. Reported here purely so the receipt can name it.
   */
  get retainedTax(): number {
    return this.stats?.totalTaxRetained ?? 0;
  }

  /** True once any non-card payment in the window carried tax — drives the extra labelling. */
  get hasRetainedTax(): boolean {
    return this.compareMode
      ? this.compareResults.some(r => r.stats.totalTaxRetained > 0)
      : this.retainedTax > 0;
  }

  /**
   * Total Revenue with the state's cut removed. This is the figure the rest of the
   * page is built on and the one the Statistics page calls "Company Revenue".
   */
  get netRevenueBaseline(): number {
    return this.totalRevenue - this.salesTaxDeducted;
  }

  /** Direct cost of delivering the cleanings, as it currently counts. */
  get cleanerSalaries(): number {
    return this.amountOf('salaries');
  }

  /** Net Revenue Baseline minus the cleaner wages — what a cleaning leaves before overhead. */
  get grossMarginAmount(): number {
    return this.netRevenueBaseline - this.cleanerSalaries;
  }

  /** Every checked expense-table category, summed. */
  get operatingExpenses(): number {
    return this.costLines
      .filter(l => l.key.startsWith('cat-') && l.included)
      .reduce((sum, l) => sum + l.amount, 0);
  }

  /** Card fees and admin bonuses — real costs that are not expense-table entries. */
  get additionalDeductions(): number {
    return this.amountOf('stripeFees') + this.amountOf('adminBonuses');
  }

  /** The bottom line: what the company actually kept. */
  get netCompanyIncome(): number {
    return this.grossMarginAmount - this.operatingExpenses - this.additionalDeductions;
  }

  /** Kept as an alias so the deltas, bars and per-cleaning math read naturally. */
  get profit(): number {
    return this.netCompanyIncome;
  }

  /** Sum of the CHECKED money-out rows. Always Total Revenue − Net Company Income. */
  get moneyOut(): number {
    return this.costLines.reduce((sum, l) => sum + (l.included ? l.amount : 0), 0);
  }

  /**
   * Share of the NET REVENUE BASELINE — the denominator every percentage on this page uses.
   *
   * The baseline, not Total Revenue, because the sales tax was never the company's money: a
   * margin measured against a figure that includes the state's cut understates every margin by
   * the tax rate. So the baseline reads 100%, Total Revenue reads 100% + the tax rate (≈108.9%),
   * and every cost below is a share of what the company actually earned. Unchecking sales tax
   * collapses the baseline onto Total Revenue and both simply read 100%.
   */
  percentOfRevenue(value: number): number {
    const base = this.netRevenueBaseline;
    return base > 0 ? (value / base) * 100 : 0;
  }

  /** Net income as a share of the Net Revenue Baseline. */
  get profitMargin(): number {
    return this.percentOfRevenue(this.netCompanyIncome);
  }

  get grossMarginPercent(): number {
    return this.percentOfRevenue(this.grossMarginAmount);
  }

  /** A checked cost's amount, or 0 while it is unchecked. */
  private amountOf(key: string): number {
    const line = this.costLines.find(l => l.key === key);
    return line && line.included ? line.amount : 0;
  }

  /**
   * The rendered chain. Rebuilt on every change-detection pass so it always mirrors
   * the checkboxes; the template keys it by label so the DOM is reused.
   */
  get pnlRows(): PnlRow[] {
    const rows: PnlRow[] = [];
    const push = (
      kind: PnlRow['kind'],
      label: string,
      amount: number,
      opts: { key?: string; indent?: boolean; line?: CostLine } = {}
    ) => rows.push({
      kind,
      key: opts.key ?? null,
      label,
      amount,
      percent: this.percentOfRevenue(amount),
      included: opts.line ? opts.line.included : true,
      indent: opts.indent ?? false,
      items: opts.line?.items,
      expanded: opts.line?.expanded,
      line: opts.line
    });

    const lineFor = (key: string) => this.costLines.find(l => l.key === key);
    const deduction = (key: string, indent = false) => {
      const line = lineFor(key);
      if (line) push('deduction', line.label, line.amount, { key, indent, line });
    };

    push('base', 'Total Revenue', this.totalRevenue);
    deduction('salesTax');
    push('subtotal', 'Net Revenue Baseline', this.netRevenueBaseline);
    deduction('salaries');
    push('subtotal', 'Gross margin', this.grossMarginAmount);
    push('subtotal', 'Operating expenses', this.operatingExpenses);

    this.costLines
      .filter(l => l.key.startsWith('cat-'))
      .forEach(l => deduction(l.key, true));

    push('subtotal', 'Additional deductions', this.additionalDeductions);
    deduction('stripeFees', true);
    deduction('adminBonuses', true);
    push('result', 'Net Company Income', this.netCompanyIncome);

    return rows;
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

  /**
   * Forecast ad spend the backend added for the period's remaining days (0 unless the
   * projection is on). Already inside the Google Ads cost line — surfaced only so the banner
   * can name it.
   */
  get projectedAdSpend(): number {
    return this.stats?.googleAdsProjectedSpend ?? 0;
  }

  get projectedAdDays(): number {
    return this.stats?.googleAdsProjectedDays ?? 0;
  }

  /** How many booked cleanings in this window have not happened yet. */
  get upcomingCount(): number {
    return this.compareMode
      ? this.compareResults.reduce((sum, r) => sum + (r.stats?.upcomingOrders ?? 0), 0)
      : (this.stats?.upcomingOrders ?? 0);
  }

  /** True when a comparison window exists (every filter except All Time). */
  get hasComparison(): boolean {
    return this.prevStats !== null;
  }

  /** Previous-window Total Revenue on the same tax-inclusive basis. */
  private get prevTotalRevenue(): number | null {
    return this.prevStats ? this.prevStats.totalAmount + this.prevStats.totalTaxes : null;
  }

  /** Previous-period profit with the SAME rows checked, so the comparison is apples-to-apples. */
  private get prevProfit(): number | null {
    const prevIn = this.prevTotalRevenue;
    if (prevIn === null) return null;
    const prevOut = this.costLines.reduce(
      (sum, l) => sum + (l.included ? (l.prevAmount ?? 0) : 0), 0);
    return prevIn - prevOut;
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

  // ── Margins vs the previous window ───────────────────────────────────────

  /** The previous window's baseline — same denominator rule as percentOfRevenue. */
  private get prevNetRevenueBaseline(): number | null {
    if (!this.prevStats) return null;
    const taxLine = this.costLines.find(l => l.key === 'salesTax');
    const prevTax = taxLine?.included ? (taxLine.prevAmount ?? 0) : 0;
    return this.prevStats.totalAmount + this.prevStats.totalTaxes - prevTax;
  }

  private get prevMargin(): number | null {
    const prevIn = this.prevNetRevenueBaseline;
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

  get completedCleanings(): number {
    return this.stats?.totalOrders ?? 0;
  }

  // ── The second card: totals, averages and pass-throughs ──────────────────

  get summaryRows(): SummaryRow[] {
    const orders = this.completedCleanings;
    const prevOrders = this.prevStats?.totalOrders ?? 0;
    const per = (v: number) => (orders > 0 ? v / orders : 0);
    const prevPer = (v: number | null) =>
      v !== null && prevOrders > 0 ? v / prevOrders : null;
    const delta = (current: number, previous: number | null) =>
      previous === null ? null : current - previous;

    const prevIn = this.prevTotalRevenue;
    const prevOut = this.prevStats
      ? this.costLines.reduce((sum, l) => sum + (l.included ? (l.prevAmount ?? 0) : 0), 0)
      : null;

    const revenuePer = per(this.totalRevenue);
    const costPer = per(this.moneyOut);
    const leftPer = per(this.profit);

    return [
      {
        key: 'moneyOut',
        label: 'Money out (checked costs)',
        value: this.moneyOut,
        format: 'money',
        delta: delta(this.moneyOut, prevOut),
        betterWhen: 'low',
        percent: this.percentOfRevenue(this.moneyOut)
      },
      {
        key: 'revenuePerCleaning',
        label: 'Average money in per cleaning',
        value: revenuePer,
        format: 'money',
        delta: delta(revenuePer, prevPer(prevIn)),
        betterWhen: 'high',
        percent: null
      },
      {
        key: 'costPerCleaning',
        label: 'Average cost per cleaning (checked costs)',
        value: costPer,
        format: 'money',
        delta: delta(costPer, prevPer(prevOut)),
        betterWhen: 'low',
        percent: null
      },
      {
        key: 'incomePerCleaning',
        label: 'Average net income per cleaning',
        value: leftPer,
        format: 'money',
        delta: delta(leftPer, prevPer(this.prevProfit)),
        betterWhen: 'high',
        percent: null
      },
      {
        key: 'googleAdsPerDay',
        // Ad spend is the one expense with a real per-day rate (one synced row per day), and
        // it is what the projection extrapolates the remaining days from.
        label: 'Average Google Ads cost per day',
        value: this.stats?.googleAdsDailyAverage ?? 0,
        format: 'money',
        delta: this.prevStats
          ? (this.stats?.googleAdsDailyAverage ?? 0) - this.prevStats.googleAdsDailyAverage
          : null,
        betterWhen: 'none',
        percent: null
      },
      {
        key: 'discounts',
        label: 'Discounts given to customers',
        value: this.stats?.totalDiscounts ?? 0,
        format: 'money',
        // A bigger discount bill is not automatically worse — discounts buy bookings.
        delta: this.prevStats ? (this.stats?.totalDiscounts ?? 0) - this.prevStats.totalDiscounts : null,
        betterWhen: 'none',
        percent: this.percentOfRevenue(this.stats?.totalDiscounts ?? 0)
      },
      // Not a deduction and not a pass-through: it is revenue that happens to have arrived as
      // sales tax. Listed so the receipt can account for the gap between the tax the customers
      // were charged and the smaller "Sales tax" line deducted above.
      ...(this.retainedTax > 0 || (this.prevStats?.totalTaxRetained ?? 0) > 0
        ? [{
          key: 'retainedTax',
          label: 'Tax kept on cash / Zelle / check (counted as revenue)',
          value: this.retainedTax,
          format: 'money' as const,
          delta: this.prevStats ? this.retainedTax - this.prevStats.totalTaxRetained : null,
          betterWhen: 'none' as const,
          percent: this.percentOfRevenue(this.retainedTax)
        }]
        : []),
      {
        key: 'tips',
        label: 'Tips (pass-through, not profit)',
        value: this.stats?.totalTips ?? 0,
        format: 'money',
        delta: this.prevStats ? (this.stats?.totalTips ?? 0) - this.prevStats.totalTips : null,
        betterWhen: 'none',
        percent: this.percentOfRevenue(this.stats?.totalTips ?? 0)
      },
      {
        key: 'cleanings',
        label: this.includeUpcoming ? 'Cleanings (finished + still booked)' : 'Completed cleanings',
        value: orders,
        format: 'count',
        delta: this.prevStats ? orders - this.prevStats.totalOrders : null,
        betterWhen: 'high',
        percent: null
      }
    ];
  }

  /** Green when the change went the way this measure wants (costs: down is good). */
  isDeltaGood(row: SummaryRow): boolean {
    const d = row.delta ?? 0;
    return row.betterWhen === 'high' ? d >= 0 : d <= 0;
  }

  deltaArrow(row: SummaryRow): string {
    return (row.delta ?? 0) >= 0 ? '▲' : '▼';
  }

  deltaAbs(row: SummaryRow): number {
    return Math.abs(row.delta ?? 0);
  }

  toggleLine(line: CostLine | undefined): void {
    if (!line) return;
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

  toggleExpand(row: PnlRow): void {
    if (row.line?.items?.length) {
      row.line.expanded = !row.line.expanded;
    }
  }

  // ── Data loading ─────────────────────────────────────────────────────────

  private loadData(): void {
    this.isLoading = true;
    this.error = '';

    const win = this.getDateWindow();
    this.compareLabel = win.compareLabel;

    forkJoin({
      current: this.adminService.getOrderStatistics(
        win.from, win.to, this.includeUpcoming, win.fullTo),
      previous: win.prevFrom && win.prevTo
        ? this.adminService.getOrderStatistics(win.prevFrom, win.prevTo, this.includeUpcoming)
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
    // Order here IS the order of the P&L chain: sales tax, then the cleaner wages,
    // then the expense categories, then the two computed deductions. Chart slots 1–4
    // belong to the four fixed rows; expense categories take 5–8.
    //
    // Sales tax is a deduction here because Total Revenue above is the TAX-INCLUSIVE
    // figure — what the customer actually paid. Taking the tax back off lands exactly
    // on the taxable revenue the backend reports as TotalAmount, so the chain stays
    // arithmetically honest and the bottom line still matches the official Net Income.
    //
    // stats.totalTaxes is the REMITTED tax only: tax charged on a cash/Zelle/check order is
    // never handed to the state, so the backend leaves it inside totalAmount and it simply
    // never appears as a deduction here. That is what makes it land in Net Company Income.
    // The label stays plain "Sales tax" either way — the hint under the receipt is where the
    // smaller-than-8.875% line gets explained.
    const lines: CostLine[] = [
      {
        key: 'salesTax',
        label: 'Sales tax',
        amount: stats.totalTaxes,
        prevAmount: prev ? prev.totalTaxes : null,
        included: !this.excludedKeys.has('salesTax'),
        colorVar: '--chart-cat-1'
      },
      {
        key: 'salaries',
        label: 'Cleaner salaries',
        amount: stats.totalCleanersSalary,
        prevAmount: prev ? prev.totalCleanersSalary : null,
        included: !this.excludedKeys.has('salaries'),
        colorVar: '--chart-cat-2'
      }
    ];

    const categories = [...(stats.expensesBreakdown?.byCategory ?? [])]
      .sort((a, b) => a.categoryId - b.categoryId);
    const prevCategories = new Map(
      (prev?.expensesBreakdown?.byCategory ?? []).map(c => [c.categoryId, c.total]));

    // Only four donut slots are left for expense categories — the rest fold into the
    // muted "Other expenses" slice. Which ones get a slot is decided by how much they
    // cost in this period, NOT by category id: the old rule handed slots to the
    // lowest-id categories, so big spends that happen to sort late (Salaries is id 4,
    // Google Ads is created on first sync and lands higher still) were permanently
    // buried in "Other expenses" no matter how large they were. Ranking also stops a
    // $0 category from holding a slot it can't use.
    const slotByCategoryId = new Map<number, string>(
      [...categories]
        .sort((a, b) => b.total - a.total)
        .slice(0, CATEGORY_CHART_SLOTS)
        .map((cat, i) => [cat.categoryId, `--chart-cat-${5 + i}`] as const)
    );

    categories.forEach(cat => {
      const key = `cat-${cat.categoryId}`;
      lines.push({
        key,
        label: cat.categoryName,
        amount: cat.total,
        prevAmount: prev ? (prevCategories.get(cat.categoryId) ?? 0) : null,
        included: !this.excludedKeys.has(key),
        colorVar: slotByCategoryId.get(cat.categoryId) ?? null,
        items: cat.items,
        expanded: false
      });
    });

    lines.push(
      {
        key: 'stripeFees',
        label: 'Card processing fees',
        amount: stats.stripeFees,
        prevAmount: prev ? prev.stripeFees : null,
        included: !this.excludedKeys.has('stripeFees'),
        colorVar: '--chart-cat-3'
      },
      {
        key: 'adminBonuses',
        label: 'Admin bonuses',
        amount: stats.adminBonusesUsd,
        prevAmount: prev ? prev.adminBonusesUsd : null,
        included: !this.excludedKeys.has('adminBonuses'),
        colorVar: '--chart-cat-4'
      }
    );

    return lines;
  }

  // ── Date windows ─────────────────────────────────────────────────────────

  /**
   * Current window for the selected filter plus the matching previous window used
   * for the "vs before" comparison. Previous windows are the same length,
   * immediately before the current one, so the comparison is honest.
   *
   * The running filters (This Week / This Month / This Year) normally stop at TODAY —
   * counting a month's revenue against days that haven't happened is meaningless. But a
   * projection is exactly the opposite request: it asks about the cleanings still to
   * come, and those all sit AFTER today. Cutting the window at today would silently
   * filter every one of them out, which is what made this view disagree with the
   * whole-period comparison. So while includeUpcoming is on, these three filters run to
   * the end of their period — and their comparison window becomes the WHOLE previous
   * period, so the two sides stay the same length.
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
        const end = this.addDays(start, 6);
        const prevStart = this.addDays(start, -7);
        return {
          from: fmt(start),
          to: fmt(this.includeUpcoming ? end : today),
          fullTo: fmt(end),
          prevFrom: fmt(prevStart),
          prevTo: fmt(this.includeUpcoming ? this.addDays(prevStart, 6) : this.addDays(today, -7)),
          compareLabel: this.includeUpcoming ? 'vs the whole week before' : 'vs the same days last week'
        };
      }
      case 'month': {
        const start = new Date(today.getFullYear(), today.getMonth(), 1);
        const prevStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        // Last day of this month / of the previous one (day 0 of the next month).
        const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        const prevMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
        // Same day-of-month in the previous month, clamped to its last day.
        const prevSameDay = new Date(today.getFullYear(), today.getMonth() - 1,
          Math.min(today.getDate(), prevMonthEnd.getDate()));
        return {
          from: fmt(start),
          to: fmt(this.includeUpcoming ? monthEnd : today),
          fullTo: fmt(monthEnd),
          prevFrom: fmt(prevStart),
          prevTo: fmt(this.includeUpcoming ? prevMonthEnd : prevSameDay),
          compareLabel: this.includeUpcoming ? 'vs the whole month before' : 'vs the same days last month'
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
        const yearEnd = new Date(today.getFullYear(), 11, 31);
        const prevStart = new Date(today.getFullYear() - 1, 0, 1);
        const prevSameDay = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
        return {
          from: fmt(start),
          to: fmt(this.includeUpcoming ? yearEnd : today),
          fullTo: fmt(yearEnd),
          prevFrom: fmt(prevStart),
          prevTo: fmt(this.includeUpcoming ? new Date(today.getFullYear() - 1, 11, 31) : prevSameDay),
          compareLabel: this.includeUpcoming ? 'vs the whole year before' : 'vs the same period last year'
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
    return Math.max(this.totalRevenue, this.moneyOut, 1);
  }

  get moneyInBarWidth(): number {
    return (this.totalRevenue / this.barMax) * 100;
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
    this.fetchComparePeriods(resolved, () => {
      this.showCompareModal = false;
      this.compareMode = true;
      // The single-period donut canvas leaves the DOM while comparing.
      this.donut?.destroy();
      this.donut = null;
    });
  }

  /** Re-runs the already-chosen periods — used when the projection toggle flips. */
  private reloadCompare(): void {
    if (this.compareResults.length === 0) return;
    this.fetchComparePeriods(
      this.compareResults.map(({ label, rangeLabel, from, to }) => ({ label, rangeLabel, from, to })));
  }

  /**
   * Loads one statistics call per period and rebuilds the table. The period count is
   * unlimited, so the calls are throttled instead of fired all at once — each one is a
   * heavy multi-query aggregate. Results carry their index because mergeMap completes
   * out of order.
   */
  private fetchComparePeriods(
    periods: Omit<ComparePeriod, 'stats'>[],
    onDone?: () => void
  ): void {
    this.isComparing = true;
    from(periods.map((r, i) => ({ r, i }))).pipe(
      mergeMap(({ r, i }) => this.adminService.getOrderStatistics(r.from, r.to, this.includeUpcoming)
        .pipe(map(stats => ({ i, stats }))), MAX_PARALLEL_STAT_REQUESTS),
      toArray()
    ).subscribe({
      next: (loaded) => {
        const statsList: OrderStatistics[] = [];
        loaded.forEach(({ i, stats }) => (statsList[i] = stats));
        this.compareResults = periods.map((r, i) => ({ ...r, stats: statsList[i] }));
        this.buildCompareView();
        this.isComparing = false;
        onDone?.();
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
   * every figure always reflects the CHECKED rows only.
   *
   * The row order mirrors the single-period card exactly — the P&L chain first, then
   * the totals-and-averages block — so the two views read the same way.
   */
  private buildCompareView(): void {
    const results = this.compareResults;
    const vals = (f: (s: OrderStatistics) => number) => results.map(r => f(r.stats));
    // Same tax-inclusive basis as the single-period card.
    const totalRevenue = results.map(r => r.stats.totalAmount + r.stats.totalTaxes);
    // Percentages are shares of the NET REVENUE BASELINE, not of Total Revenue — see
    // percentOfRevenue. Filled in below, once the sales-tax checkbox has been applied.
    const percentBase: number[] = [];

    const row = (
      label: string,
      betterWhen: 'high' | 'low' | 'none',
      values: number[],
      opts: {
        key?: string;
        format?: 'money' | 'count' | 'percent';
        emphasize?: boolean;
        subtotal?: boolean;
        indent?: boolean;
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
        subtotal: opts.subtotal ?? false,
        indent: opts.indent ?? false,
        isOfficialTotal: opts.officialTotal ?? false,
        included: opts.key ? !this.excludedKeys.has(opts.key) : true,
        values,
        sharePercents: opts.withShare !== false
          ? values.map((v, i) => this.share(v, percentBase[i]))
          : null,
        bestValue
      };
    };

    /** A cost's per-period values, zeroed out while it is unchecked. */
    const counted = (key: string, values: number[]) =>
      this.excludedKeys.has(key) ? values.map(() => 0) : values;

    // Every expense category gets its own named row (Google Ads, Salaries, …) —
    // union across the compared periods, 0 where a period had no such spending.
    const categoryNames = new Map<number, string>();
    results.forEach(r => (r.stats.expensesBreakdown?.byCategory ?? []).forEach(c => {
      if (!categoryNames.has(c.categoryId)) categoryNames.set(c.categoryId, c.categoryName);
    }));
    const categoryIds = [...categoryNames.keys()].sort((a, b) => a - b);
    const categoryValues = new Map<number, number[]>(categoryIds.map(id => [id,
      vals(s => (s.expensesBreakdown?.byCategory ?? []).find(c => c.categoryId === id)?.total ?? 0)]));

    const salesTax = vals(s => s.totalTaxes);
    // Tax collected outside Stripe: already inside each period's totalAmount, so it is never
    // a deduction here — only a row that explains why the sales-tax line is below 8.875%.
    const retainedTax = vals(s => s.totalTaxRetained);
    const anyRetainedTax = retainedTax.some(v => v > 0);
    const salaries = vals(s => s.totalCleanersSalary);
    const stripeFees = vals(s => s.stripeFees);
    const adminBonuses = vals(s => s.adminBonusesUsd);

    // The chain, computed per period from the CHECKED rows only.
    const netBaseline = totalRevenue.map((v, i) => v - counted('salesTax', salesTax)[i]);
    // Every percentage in the table hangs off the baseline, so it has to exist before the
    // first row() call — row() reads percentBase when it builds sharePercents.
    percentBase.push(...netBaseline);
    const grossMargin = netBaseline.map((v, i) => v - counted('salaries', salaries)[i]);
    const operatingExpenses = totalRevenue.map((_, i) => categoryIds.reduce(
      (sum, id) => sum + counted(`cat-${id}`, categoryValues.get(id)!)[i], 0));
    const additional = totalRevenue.map((_, i) =>
      counted('stripeFees', stripeFees)[i] + counted('adminBonuses', adminBonuses)[i]);

    this.compareProfits = grossMargin.map((v, i) => v - operatingExpenses[i] - additional[i]);
    // Margin against the baseline, matching profitMargin on the single-period card.
    this.compareMargins = this.compareProfits.map((p, i) => this.share(p, netBaseline[i]));

    // Money out is the mirror image of the chain: Total Revenue − Net Company Income.
    const moneyOut = totalRevenue.map((v, i) => v - this.compareProfits[i]);

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
    // Card 1 — the same chain, in the same order, as the single-period view.
    this.compareChainRows = [
      row('Total Revenue', 'high', totalRevenue),
      row('Sales tax', 'none', salesTax, { key: 'salesTax' }),
      row('Net Revenue Baseline', 'high', netBaseline, { subtotal: true }),
      row('Cleaner salaries', 'none', salaries, { key: 'salaries' }),
      row('Gross margin', 'high', grossMargin, { subtotal: true }),
      row('Operating expenses', 'none', operatingExpenses, { subtotal: true }),
      ...categoryIds.map(id =>
        row(categoryNames.get(id)!, 'none', categoryValues.get(id)!, { key: `cat-${id}`, indent: true })),
      row('Additional deductions', 'none', additional, { subtotal: true }),
      row('Card processing fees', 'none', stripeFees, { key: 'stripeFees', indent: true }),
      row('Admin bonuses', 'none', adminBonuses, { key: 'adminBonuses', indent: true }),
      row('Net Company Income', 'high', this.compareProfits, { emphasize: true }),
      // Only while something is unchecked: the official figure stays one glance
      // away instead of being buried in a note that grows with the period count.
      ...(this.excludedKeys.size > 0
        ? [row('… if every cost were counted', 'none', this.compareOfficialProfits,
          { officialTotal: true })]
        : [])
    ];

    // Card 2 — the totals and averages, matching the single-period second card.
    this.compareSummaryRows = [
      row('Money out (checked costs)', 'none', moneyOut),
      row('Average money in per cleaning', rank('high'), perOrder(totalRevenue), { withShare: false }),
      row('Average cost per cleaning (checked costs)', rank('low'), perOrder(moneyOut), { withShare: false }),
      row('Average net income per cleaning', rank('high'), perOrder(this.compareProfits),
        { emphasize: true, withShare: false }),
      row('Average Google Ads cost per day', 'none', vals(s => s.googleAdsDailyAverage),
        { withShare: false }),
      // 'none': a bigger discount bill is not automatically worse — discounts buy bookings.
      row('Discounts given to customers', 'none', vals(s => s.totalDiscounts)),
      ...(anyRetainedTax
        ? [row('Tax kept on cash / Zelle / check (counted as revenue)', 'none', retainedTax)]
        : []),
      row('Tips (pass-through, not profit)', 'none', vals(s => s.totalTips)),
      row('Completed cleanings', 'high', orders, { format: 'count', withShare: false })
    ];

    this.compareRows = [...this.compareChainRows, ...this.compareSummaryRows];

    this.buildWinnerLine();
  }

  /** Percent of the Net Revenue Baseline — 0 when the period took no money. */
  private share(value: number, baseline: number): number {
    return baseline > 0 ? (value / baseline) * 100 : 0;
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
    // A projection is a different document from the confirmed report — the filename
    // says so, otherwise two exports of the same month look identical on disk.
    const suffix = this.includeUpcoming ? '_projected' : '';
    if (this.compareMode) {
      // Naming every period is only readable for a handful of them; past that the
      // filename would run to hundreds of characters.
      if (this.compareResults.length > 4) {
        const first = this.compareResults[0];
        const last = this.compareResults[this.compareResults.length - 1];
        return `finances_compare_${this.compareResults.length}_periods_`
          + `${first.from}_to_${last.to}${suffix}.xlsx`;
      }
      const labels = this.compareResults
        .map(r => r.label.replace(/[^\w]+/g, '-'))
        .join('_vs_');
      return `finances_compare_${labels}${suffix}.xlsx`;
    }
    const win = this.getDateWindow();
    return win.from && win.to
      ? `finances_${win.from}_to_${win.to}${suffix}.xlsx`
      : `finances_all-time${suffix}.xlsx`;
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
    const win = this.getDateWindow();
    const period = win.from && win.to ? `${win.from} to ${win.to}` : 'All time';

    // The export is a document of the CURRENT selection: unchecked costs are not
    // written at all — no greyed row, no "counted?" column — so every number in
    // the file adds up to the totals at the bottom.
    const chain = this.pnlRows.filter(r => r.kind !== 'deduction' || r.included);
    const summary = this.summaryRows.filter(r => r.key !== 'tips' || this.showTips);

    const rows: (string | number)[][] = [
      ['Dream Cleaning — Finances export', period],
      ...(this.includeUpcoming
        ? [['PROJECTION — includes cleanings that have not happened yet']]
        : []),
      [],
      ['Item', 'Amount (USD)', '% of Net Revenue Baseline'],
      ...chain.map(r => [
        r.indent ? `    ${r.label}` : r.label,
        r.kind === 'deduction' ? -r.amount : r.amount,
        r.percent
      ] as (string | number)[]),
      [],
      ...summary.map(r => [r.label, r.value, r.percent ?? ''] as (string | number)[])
    ];

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 44 }, { wch: 16 }, { wch: 18 }];

    // Column B is money everywhere except the cleanings count; column C is always a percent.
    const countLabels = new Set(summary.filter(s => s.format === 'count').map(s => s.label));
    const countRows = new Set(
      rows.map((r, i) => (countLabels.has(String(r[0])) ? i : -1)).filter(i => i >= 0));
    this.formatMoneyColumn(XLSX, ws, 1, countRows);
    const range = XLSX.utils.decode_range(ws['!ref']!);
    for (let r = range.s.r; r <= range.e.r; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: 2 })];
      if (cell && cell.t === 'n') cell.z = FinancesComponent.PERCENT_FMT;
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Receipt');

    // Per-expense detail so an accountant can verify every category total —
    // again only for the categories that made it into the sheet above.
    const detailLines = this.costLines.filter(l => l.included && l.items?.length);
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
      ...(this.includeUpcoming
        ? [['PROJECTION — includes cleanings that have not happened yet']]
        : []),
      [],
      ['Metric', ...results.map(r => r.label)],
      ['Period', ...results.map(r => r.rangeLabel || `${r.from} to ${r.to}`)],
      ...exportRows.map(row =>
        [row.indent ? `    ${row.label}` : row.label, ...row.values] as (string | number)[])
    ];
    if (this.winnerLine) {
      rows.push([]);
      rows.push([this.winnerLine]);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 40 }, ...results.map(() => ({ wch: 18 }))];

    // Each metric row carries its own number format: money, percent, or a plain
    // count (completed cleanings), so Excel shows what the screen shows.
    const compareRowsStart = rows.length - exportRows.length - (this.winnerLine ? 2 : 0);
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

  /** pnlRows/summaryRows rebuild each cycle by design — keyed so the DOM is reused. */
  trackByLabel(_: number, row: { label: string }): string {
    return row.label;
  }

  trackByRowKey(_: number, row: { key: string }): string {
    return row.key;
  }
}
