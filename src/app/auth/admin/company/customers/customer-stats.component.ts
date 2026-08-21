import {
  Component, OnInit, OnDestroy, ViewChild, ElementRef, Inject, PLATFORM_ID, ChangeDetectorRef
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin, from, of, Subject } from 'rxjs';
import { map, mergeMap, takeUntil, toArray } from 'rxjs/operators';
import Chart from 'chart.js/auto';
import {
  CustomerStatsService, CustomerStatistics, CustomerTrendPoint
} from '../../../../services/customer-stats.service';
import { ThemeService } from '../../../../services/theme.service';
import { AuthService } from '../../../../services/auth.service';
import { MobileTooltipManager } from '../../../../shared/booking/extra-service-display.utils';

type QuickFilter = 'today' | 'week' | 'month' | 'lastMonth' | 'year' | 'lastYear' | 'all';
type CompareUnit = 'day' | 'week' | 'month' | 'year';
type MetricFormat = 'count' | 'money' | 'percent';
type ViewMode = 'simple' | 'full';

/**
 * Smallest denominator any derived figure will be reported on. Below it the number is noise that
 * reads as signal — a month with three customers produced a 45% "returning rate" that visually
 * dominated the trend chart. Mirrored by MinReportableSample on the backend, which suppresses the
 * median (the only derived figure the client cannot recompute from the payload).
 */
const MIN_SAMPLE = 10;

/**
 * ONE definition of every number this tab reports, used by EVERY view — the Simple cards, the Full
 * detail tables and the comparison table all read it. Adding a metric here makes it available to
 * all three, which is the point: a figure that exists in one view and not another is how the views
 * drift apart.
 */
interface MetricDef {
  key: string;
  label: string;
  /** Section header it sits under; rows sharing a group render together, header printed once. */
  group: string;
  format: MetricFormat;
  /** Which direction reads as good — decides the delta color and the "best" chip. */
  betterWhen: 'high' | 'low' | 'none';
  get: (s: CustomerStatistics) => number;
  /**
   * What this figure is computed OVER. Present on every rate; absent on counts, which are always
   * reportable. Below MIN_SAMPLE the value renders as a dash instead of a number — see isSuppressed.
   */
  denominator?: (s: CustomerStatistics) => number;
  /** One line of plain English under the label. Every rate needs one; counts mostly don't. */
  hint?: string;
  /** Shown as a large card at the top of the FULL view. Simple has its own fixed card list. */
  headline?: boolean;
  /**
   * Drop the row entirely while it reads zero everywhere on screen. For metrics that are
   * legitimately zero for this business today ("Won back", "On a recurring plan") — a permanent
   * zero row teaches the reader to skip that part of the table. It reappears on its own once
   * there is something to report. Evaluated across every period currently displayed, never a
   * single period, so rows do not flicker as the filter moves.
   */
  hideWhenAllZero?: boolean;
}

/** A metric resolved against the loaded window (plus the previous one, when there is one). */
interface MetricCard {
  def: MetricDef;
  value: number;
  /** value − previous window's value; null when there is nothing to compare, or when suppressed. */
  delta: number | null;
  /** True when the denominator is too thin to report — render a dash, not a number. */
  suppressed: boolean;
  /** The denominator behind the suppression, so the tooltip can name it. */
  sample: number;
}

/**
 * One card of the Simple view. Explicit rather than derived from the metric list, because Simple is
 * a curated four-card answer, not "the first four metrics".
 */
interface SimpleCardDef {
  key: string;
  /** Rendered small under the value — a second metric, not a restatement of the first. */
  sublineKey?: string;
  /**
   * Words after the subline's value, so it reads as a sentence rather than a second labelled
   * statistic ("23.7% of customers served", not "Returning rate: 23.7%").
   */
  sublineLabel?: string;
  /**
   * Simple's label for this metric, used wherever Simple renders it — the card AND the comparison
   * rows. Read it through simpleLabel(), never directly.
   *
   * Used for "Customers who came back": Full labels it "(any time)" to separate it from "Share who
   * had booked in the previous 90 days" sitting nearby, but Simple renders no 90-day figure at all,
   * so the qualifier there would raise a question the view never answers.
   */
  labelOverride?: string;
}

/**
 * One of the two percentages in the split card's legend. These are NOT metric rows — Full has no
 * "first-time rate" line, and the metric set is a closed universe the DTO audit depends on — but
 * they are rates all the same, so they carry everything the suppression path needs and render
 * through the same template as every other number on the page.
 */
interface LegendPercent {
  value: number;
  suppressed: boolean;
  sample: number;
  /** Allocated ABOVE every metric's id, so a legend tooltip can never collide with a row's. */
  tooltipId: number;
  reason: string;
}

/** One section of the Full view's detail tables. */
interface MetricGroup {
  group: string;
  /** Caveat printed above the table, where the numbers would mislead without it. */
  note: string;
  /** Marks the one section carrying a figure that is not in the metric list — the median gap. */
  showMedian: boolean;
  cards: MetricCard[];
}

/** A Simple card with its label and subline already resolved against the loaded window. */
interface SimpleCard {
  card: MetricCard;
  label: string;
  subline: MetricCard | null;
  sublineLabel: string;
}

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
  /**
   * The period runs past today, so its column counts cleanings that are booked but not yet served.
   * That makes it LARGER than the single-period view of the same month, which stops at today — the
   * subtitle says so, or the two views disagree on the same screen with no visible reason.
   */
  unfinished: boolean;
  stats: CustomerStatistics;
}

interface CompareCell {
  value: number;
  suppressed: boolean;
  sample: number;
}

interface CompareRow {
  def: MetricDef;
  /**
   * Resolved when the row is built rather than read off `def` in the template, because Simple
   * renames one metric — see simpleLabel().
   */
  label: string;
  /** True on the first row of a group — the template prints the section header before it. */
  groupStart: boolean;
  cells: CompareCell[];
  /** The value to highlight as best; null when the row ties, is info-only, or has no live cells. */
  bestValue: number | null;
}

interface DateWindow {
  from?: string;
  to?: string;
  prevFrom?: string;
  prevTo?: string;
  compareLabel: string;
}

/** How the current window reads in a sentence. Built once per load by describePeriod(). */
interface PeriodPhrasing {
  /** Sentence opener, e.g. "So far in August", "In July", "Today", "All time". */
  opener: string;
  /** Tail of the nobody-booked sentence, e.g. "yet in August", "in July". */
  zeroPhrase: string;
  /**
   * Names the comparison window WITH its preposition, e.g. "over the same days in July",
   * "yesterday", "in June". Null when there is no prior period to compare against.
   */
  comparison: string | null;
}

/**
 * How many statistics calls the compare run keeps in flight. The number of compared periods is
 * unlimited and each call is a multi-query aggregate, so they go out a few at a time.
 */
const MAX_PARALLEL_REQUESTS = 4;

/** Months of history the trend chart asks for. The backend caps at 36. */
const TREND_MONTHS = 12;

/** Per-user, per-browser view preference. Same shape as ThemeService's key. */
const VIEW_STORAGE_PREFIX = 'dreamcleaning-customers-view';

/**
 * Company → Customers tab: who booked, how many of them had booked before, and how the money splits
 * between newcomers and regulars.
 *
 * TWO VIEWS, ONE DATA SET. Simple (the default) answers the only question the page was asked for —
 * are customers coming back, is it getting better or worse, are follow-ups doing anything — in a
 * sentence, four cards and two charts. Full is the whole instrument panel. Both read the same
 * payload from the same endpoints; the toggle is purely a rendering choice.
 *
 * Four words carry the page, and they are NOT synonyms (the backend controller defines them
 * identically — keep the two in step):
 *   • **Active**    — booked at least once inside the window.
 *   • **New**       — their first-ever booking falls inside the window.
 *   • **Returning** — they had already booked before the window opened. "How many came back."
 *   • **Repeat**    — 2+ bookings INSIDE the window.
 *
 * The period picker and the compare modal are deliberately the same shape as the Finances page's,
 * because the owner moves between the two and a second dialect of "pick a month" would be friction
 * for nothing.
 */
@Component({
  selector: 'app-customer-stats',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './customer-stats.component.html',
  styleUrls: ['./customer-stats.component.scss']
})
export class CustomerStatsComponent implements OnInit, OnDestroy {
  @ViewChild('trendCanvas') trendCanvas!: ElementRef<HTMLCanvasElement>;

  stats: CustomerStatistics | null = null;
  prevStats: CustomerStatistics | null = null;
  trend: CustomerTrendPoint[] = [];
  isLoading = false;
  error = '';
  isBrowser: boolean;

  viewMode: ViewMode = 'simple';
  activeQuickFilter: QuickFilter = 'month';
  customFrom = '';
  customTo = '';
  compareLabel = '';
  /** The plain-English answer, rebuilt on every load. Empty while loading or in compare mode. */
  summary = '';

  /** Touch-friendly explanation of a suppressed value; hover alone would be unreadable on a phone. */
  readonly tooltips = new MobileTooltipManager(() => this.isCurrentlyMobile(), 5000);

  // ── Compare mode state ─────────────────────────────────────────────────────
  showCompareModal = false;
  compareMode = false;
  isComparing = false;
  compareError = '';
  compareUnit: CompareUnit = 'month';
  comparePicks: ComparePick[] = [];
  compareResults: ComparePeriod[] = [];
  compareRows: CompareRow[] = [];

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

  readonly quickFilters: { key: QuickFilter; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'week', label: 'This Week' },
    { key: 'month', label: 'This Month' },
    { key: 'lastMonth', label: 'Last Month' },
    { key: 'year', label: 'This Year' },
    { key: 'lastYear', label: 'Last Year' },
    { key: 'all', label: 'All Time' }
  ];

  /**
   * Every metric on the tab, in reading order. Group order here IS the order the Full view prints.
   *
   * "Came back" is split into deliberately different questions, because collapsing them is the
   * mistake this page exists to prevent:
   *   Returning       — ever booked before (loyalty of the base)
   *   Repeat          — booked twice THIS period (intensity)
   *   Recently active — booked within the last 90 days (cadence) ← the retention headline
   *   Period-over-period retention — kept, but never the headline; see the Retention group.
   */
  readonly metrics: MetricDef[] = [
    {
      key: 'returningCustomers', label: 'Customers who came back (any time)', group: 'Customers',
      format: 'count', betterWhen: 'high', headline: true,
      get: s => s.returningCustomers,
      hint: 'Booked with us before this period and booked again in it, however long ago that was.'
    },
    {
      key: 'activeCustomers', label: 'Customers served', group: 'Customers',
      format: 'count', betterWhen: 'high', headline: true,
      get: s => s.activeCustomers,
      hint: 'Distinct customers with at least one cleaning in this period.'
    },
    {
      key: 'newCustomers', label: 'First-time customers', group: 'Customers',
      format: 'count', betterWhen: 'high', headline: true,
      get: s => s.newCustomers,
      hint: 'Their very first cleaning with us happened in this period.'
    },
    {
      key: 'returningRate', label: 'Returning rate', group: 'Customers',
      format: 'percent', betterWhen: 'high', headline: true,
      get: s => s.returningRate, denominator: s => s.activeCustomers,
      hint: 'Share of the period\'s customers who were not new.'
    },
    {
      key: 'repeatCustomers', label: 'Booked more than once', group: 'Customers',
      format: 'count', betterWhen: 'high',
      get: s => s.repeatCustomers,
      hint: 'Two or more cleanings inside this period alone.'
    },
    {
      key: 'repeatRate', label: 'Booked-again rate', group: 'Customers',
      format: 'percent', betterWhen: 'high',
      get: s => s.repeatRate, denominator: s => s.activeCustomers,
      hint: 'Share of the period\'s customers who booked twice or more in it.'
    },
    {
      key: 'reactivatedCustomers', label: 'Won back', group: 'Customers',
      format: 'count', betterWhen: 'high', hideWhenAllZero: true,
      get: s => s.reactivatedCustomers,
      hint: 'Returning customers who had been away for more than 6 months.'
    },
    {
      key: 'recurringPlanCustomers', label: 'On a recurring plan', group: 'Customers',
      format: 'count', betterWhen: 'high', hideWhenAllZero: true,
      get: s => s.recurringPlanCustomers,
      hint: 'Booked on a weekly, bi-weekly or monthly plan rather than as a one-off.'
    },

    {
      // Both labels say "the previous 90 days" so the pair reads as one idea, and neither can be
      // taken as forward-looking — this measures who had ALREADY booked, not who will.
      key: 'recentlyActiveRate', label: 'Share who had booked in the previous 90 days',
      group: 'Retention', format: 'percent', betterWhen: 'high', headline: true,
      get: s => s.recentlyActiveRate, denominator: s => s.activeCustomers,
      hint: 'Narrower than "Customers who came back (any time)", which counts anyone who had ever '
        + 'booked, however long ago.'
    },
    {
      key: 'recentlyActiveCustomers', label: 'Customers who also booked in the previous 90 days',
      group: 'Retention', format: 'count', betterWhen: 'high',
      get: s => s.recentlyActiveCustomers,
      hint: 'The count behind the share above.'
    },
    {
      key: 'previousActiveCustomers', label: 'Period-over-period: customers in the period before',
      group: 'Retention', format: 'count', betterWhen: 'none',
      get: s => s.previousActiveCustomers,
      hint: 'The group the period-over-period rate below is measured against.'
    },
    {
      key: 'retainedCustomers', label: 'Period-over-period: kept from that group',
      group: 'Retention', format: 'count', betterWhen: 'high',
      get: s => s.retainedCustomers
    },
    {
      key: 'lapsedCustomers', label: 'Period-over-period: did not come back',
      group: 'Retention', format: 'count', betterWhen: 'low',
      get: s => s.lapsedCustomers
    },
    {
      key: 'retentionRate', label: 'Period-over-period retention rate', group: 'Retention',
      format: 'percent', betterWhen: 'high',
      get: s => s.retentionRate, denominator: s => s.previousActiveCustomers,
      hint: 'Booked in this period AND the one immediately before. Runs low for this business by '
        + 'nature — a deep clean or a move-out is not meant to repeat next month — so read the '
        + '90-day figure above as the retention number, not this one.'
    },
    {
      key: 'churnRate', label: 'Period-over-period churn rate', group: 'Retention',
      format: 'percent', betterWhen: 'low',
      get: s => s.churnRate, denominator: s => s.previousActiveCustomers,
      hint: 'The other side of the period-over-period rate above, and misleading for the same '
        + 'reason — a customer who booked a move-out clean has not churned by failing to book '
        + 'another one next month.'
    },

    {
      key: 'totalOrders', label: 'Cleanings booked', group: 'Orders & money',
      format: 'count', betterWhen: 'high',
      get: s => s.totalOrders
    },
    {
      key: 'ordersPerCustomer', label: 'Cleanings per customer', group: 'Orders & money',
      format: 'count', betterWhen: 'high',
      get: s => s.ordersPerCustomer
    },
    {
      key: 'returningCustomerOrders', label: 'Cleanings from returning customers',
      group: 'Orders & money', format: 'count', betterWhen: 'high',
      get: s => s.returningCustomerOrders
    },
    {
      key: 'repeatOrderShare', label: 'Share of cleanings from returning customers',
      group: 'Orders & money', format: 'percent', betterWhen: 'high',
      get: s => s.repeatOrderShare, denominator: s => s.totalOrders,
      hint: 'How much of the work came from people we had served before.'
    },
    {
      key: 'totalSpend', label: 'Customer spend', group: 'Orders & money',
      format: 'money', betterWhen: 'high',
      get: s => s.totalSpend,
      hint: 'What customers paid, net of refunds — tax and tips included, unlike the Finances page.'
    },
    {
      key: 'returningCustomerSpend', label: 'Spend from returning customers',
      group: 'Orders & money', format: 'money', betterWhen: 'high',
      get: s => s.returningCustomerSpend
    },
    {
      key: 'newCustomerSpend', label: 'Spend from first-time customers',
      group: 'Orders & money', format: 'money', betterWhen: 'none',
      get: s => s.newCustomerSpend
    },
    {
      key: 'spendPerCustomer', label: 'Spend per customer', group: 'Orders & money',
      format: 'money', betterWhen: 'high',
      get: s => s.spendPerCustomer
    },
    {
      key: 'averageOrderValue', label: 'Average cleaning value', group: 'Orders & money',
      format: 'money', betterWhen: 'high',
      get: s => s.averageOrderValue
    },
    {
      key: 'returningCustomerAov', label: 'Average cleaning — returning customers',
      group: 'Orders & money', format: 'money', betterWhen: 'high',
      get: s => s.returningCustomerAov
    },
    {
      key: 'newCustomerAov', label: 'Average cleaning — first-time customers',
      group: 'Orders & money', format: 'money', betterWhen: 'none',
      get: s => s.newCustomerAov,
      hint: 'Usually lower than the returning figure — first-timers get the new-customer discount.'
    },

    {
      key: 'returningAfterFollowUp', label: 'Came back after a follow-up', group: 'Follow-ups (CRM)',
      format: 'count', betterWhen: 'high', headline: true,
      get: s => s.returningAfterFollowUp,
      hint: 'Returning customers we had called, emailed or texted through the CRM in the 90 days before they booked.'
    },
    {
      key: 'returningWithoutFollowUp', label: 'Came back on their own', group: 'Follow-ups (CRM)',
      format: 'count', betterWhen: 'none',
      get: s => s.returningWithoutFollowUp,
      hint: 'The rest of the returning customers — no logged outreach behind the booking.'
    },
    {
      key: 'followUpAssistedRate', label: 'Follow-up assisted share', group: 'Follow-ups (CRM)',
      format: 'percent', betterWhen: 'high',
      get: s => s.followUpAssistedRate, denominator: s => s.returningCustomers,
      hint: 'How much of our repeat business we are actively touching, not a conversion rate.'
    },
    {
      key: 'followedUpCustomers', label: 'All customers reached first', group: 'Follow-ups (CRM)',
      format: 'count', betterWhen: 'high',
      get: s => s.followedUpCustomers,
      hint: 'Includes first-time customers whose booking a follow-up preceded.'
    },
    {
      key: 'followUpAssistedSpend', label: 'Spend from followed-up customers',
      group: 'Follow-ups (CRM)', format: 'money', betterWhen: 'high',
      get: s => s.followUpAssistedSpend
    },
    {
      key: 'leadsFollowedUp', label: 'People chased this period', group: 'Follow-ups (CRM)',
      format: 'count', betterWhen: 'none',
      get: s => s.leadsFollowedUp,
      hint: 'Distinct CRM leads that received outreach — effort, whether or not it landed.'
    },
    {
      key: 'followUpsLogged', label: 'Follow-ups logged', group: 'Follow-ups (CRM)',
      format: 'count', betterWhen: 'none',
      get: s => s.followUpsLogged,
      hint: 'Individual calls, emails and texts logged on leads during this period.'
    },

    {
      key: 'signups', label: 'New accounts registered', group: 'Sign-ups',
      format: 'count', betterWhen: 'high',
      get: s => s.signups,
      hint: 'A different group from the customers above — registering is not booking.'
    },
    {
      key: 'signupsWhoBooked', label: 'Registrations that booked', group: 'Sign-ups',
      format: 'count', betterWhen: 'high',
      get: s => s.signupsWhoBooked,
      hint: 'Of the accounts registered in this period, how many have ever booked.'
    },
    {
      key: 'activationRate', label: 'Activation rate', group: 'Sign-ups',
      format: 'percent', betterWhen: 'high',
      get: s => s.activationRate, denominator: s => s.signups
    }
  ];

  /** The four cards of the Simple view, in order. */
  readonly simpleCardDefs: SimpleCardDef[] = [
    { key: 'activeCustomers' },
    { key: 'newCustomers' },
    {
      key: 'returningCustomers', labelOverride: 'Customers who came back',
      sublineKey: 'returningRate', sublineLabel: 'of the customers we served'
    },
    {
      key: 'totalSpend',
      sublineKey: 'returningCustomerSpend', sublineLabel: 'of it from returning customers'
    }
  ];

  /** The three follow-up rows Simple keeps. The other four are Full-only. */
  readonly simpleFollowUpKeys = ['returningAfterFollowUp', 'leadsFollowedUp', 'followUpsLogged'];

  /**
   * Rows the comparison table shows in Simple mode: the four cards, both sublines, and the three
   * follow-up rows. One list, one compare component — Full simply uses every metric instead.
   */
  readonly simpleCompareKeys = [
    'activeCustomers', 'newCustomers', 'returningCustomers', 'returningRate',
    'totalSpend', 'returningCustomerSpend',
    ...this.simpleFollowUpKeys
  ];

  /**
   * Caveats printed above a section, where reading the numbers without them would mislead. Simple
   * gets the one-line version; Full gets the full explanation.
   */
  private readonly groupNotes: Record<string, string> = {
    'Follow-ups (CRM)':
      'Counts only outreach LOGGED in the CRM against a lead matching the customer, in the 90 days ' +
      'before they booked. A call made from someone\'s own phone and never written down is invisible ' +
      'here, so treat this as a floor. And a follow-up before a booking is evidence, not proof, that ' +
      'it caused the booking.'
  };

  readonly simpleFollowUpNote =
    'Only counts outreach logged in the CRM, so treat it as a floor.';

  private trendChart: Chart | null = null;
  private destroy$ = new Subject<void>();
  /** Stable tooltip id per metric, so the same row owns the same id in every view. */
  private readonly tooltipIds = new Map<string, number>();

  constructor(
    private customerStats: CustomerStatsService,
    private themeService: ThemeService,
    private authService: AuthService,
    private cdr: ChangeDetectorRef,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
    const thisYear = new Date().getFullYear();
    this.yearOptions = Array.from({ length: 6 }, (_, i) => thisYear - i);
    this.metrics.forEach((m, i) => this.tooltipIds.set(m.key, i));
    this.viewMode = this.readStoredView();
  }

  ngOnInit(): void {
    this.loadData();
    this.loadTrend();
    // Re-paint the chart with the other theme's tokens when day/night flips.
    this.themeService.theme$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        if (this.trendChart) setTimeout(() => this.buildTrendChart(), 0);
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.trendChart?.destroy();
    this.tooltips.clearAll();
  }

  // ── View toggle ──────────────────────────────────────────────────────────

  setViewMode(mode: ViewMode): void {
    if (this.viewMode === mode) return;
    this.viewMode = mode;
    this.storeView(mode);
    if (this.compareMode) {
      // The comparison table shows a different row set per view; no refetch, the payload is one
      // and the same. Simple and Full differ only in what they render.
      this.buildCompareView();
    } else {
      // The trend canvas is shared by both views but is destroyed and recreated by the *ngIf
      // swap, so the chart has to be rebuilt against the new element.
      setTimeout(() => this.buildTrendChart(), 0);
    }
  }

  /** Per-user so two admins sharing a browser profile do not overwrite each other's choice. */
  private get viewStorageKey(): string {
    const userId = this.authService.currentUserValue?.id ?? 'anon';
    return `${VIEW_STORAGE_PREFIX}:${userId}`;
  }

  private readStoredView(): ViewMode {
    if (!this.isBrowser) return 'simple';
    return localStorage.getItem(this.viewStorageKey) === 'full' ? 'full' : 'simple';
  }

  private storeView(mode: ViewMode): void {
    if (!this.isBrowser) return;
    localStorage.setItem(this.viewStorageKey, mode);
  }

  // ── Filters ──────────────────────────────────────────────────────────────

  onQuickFilterChange(filter: QuickFilter): void {
    this.activeQuickFilter = filter;
    this.customFrom = '';
    this.customTo = '';
    this.exitCompare();
    this.loadData();
  }

  applyCustomRange(): void {
    if (this.customFrom && this.customTo) {
      this.exitCompare();
      this.loadData();
    }
  }

  clearCustomRange(): void {
    this.customFrom = '';
    this.customTo = '';
    this.activeQuickFilter = 'month';
    this.exitCompare();
    this.loadData();
  }

  // ── Resolved metrics ─────────────────────────────────────────────────────

  /**
   * The resolved metrics, rebuilt once per load rather than derived in a template-called getter —
   * a getter would hand *ngFor a brand-new array on every change-detection pass and re-render the
   * whole page each time.
   */
  headlineCards: MetricCard[] = [];
  /** The Full view's detail sections, in metric declaration order. */
  groupedCards: MetricGroup[] = [];
  /** The Simple view's four cards, each with its optional subline resolved. */
  simpleCards: SimpleCard[] = [];
  /** The Simple view's three follow-up rows. */
  simpleFollowUpCards: MetricCard[] = [];
  /**
   * The two percentages beside the split bars. They are the number the reader actually uses —
   * counts alone leave him doing the division — so they are worth carrying, but they obey the
   * same suppression rule as every other rate rather than printing regardless.
   */
  splitLegend: { returning: LegendPercent; first: LegendPercent } | null = null;

  private cardByKey = new Map<string, MetricCard>();

  private buildCards(): void {
    const s = this.stats;
    if (!s) {
      this.headlineCards = [];
      this.groupedCards = [];
      this.simpleCards = [];
      this.simpleFollowUpCards = [];
      this.splitLegend = null;
      this.cardByKey.clear();
      return;
    }
    this.buildSplitLegend(s);
    const prev = this.prevStats;
    const cards: MetricCard[] = this.metrics.map(def => this.resolveCard(def, s, prev));
    this.cardByKey = new Map(cards.map(c => [c.def.key, c]));

    // Hidden only when the metric is zero in EVERY period on screen — here, the current window and
    // the one it is compared against. A row that vanished on the strength of one period alone
    // would blink in and out as the filter moved.
    const visible = cards.filter(c => !c.def.hideWhenAllZero
      || c.value !== 0
      || (prev !== null && c.def.get(prev) !== 0));

    this.headlineCards = visible.filter(c => c.def.headline);
    this.groupedCards = visible.reduce<MetricGroup[]>(
      (acc, card) => {
        const bucket = acc.find(g => g.group === card.def.group);
        if (bucket) bucket.cards.push(card);
        else acc.push({
          group: card.def.group,
          note: this.groupNotes[card.def.group] ?? '',
          showMedian: card.def.group === 'Retention',
          cards: [card]
        });
        return acc;
      }, []);

    this.simpleCards = this.simpleCardDefs
      .map(def => {
        const card = this.cardByKey.get(def.key);
        if (!card) return null;
        const subline = def.sublineKey ? this.cardByKey.get(def.sublineKey) ?? null : null;
        return {
          card,
          label: this.simpleLabel(card.def),
          // A suppressed subline is dropped entirely rather than printed as a dash — a dash under
          // a perfectly good headline number reads as an error in the headline number.
          subline: subline && !subline.suppressed ? subline : null,
          sublineLabel: def.sublineLabel ?? ''
        };
      })
      .filter((c): c is SimpleCard => c !== null);

    this.simpleFollowUpCards = this.simpleFollowUpKeys
      .map(key => this.cardByKey.get(key))
      .filter((c): c is MetricCard => !!c);
  }

  private resolveCard(
    def: MetricDef, s: CustomerStatistics, prev: CustomerStatistics | null): MetricCard {
    const sample = def.denominator ? def.denominator(s) : Number.MAX_SAFE_INTEGER;
    const suppressed = this.isSuppressed(def, s);
    // A delta between two numbers, one of which we refuse to print, is not printable either — and
    // a green arrow beside a dash is worse than either alone.
    const prevSuppressed = prev !== null && this.isSuppressed(def, prev);
    return {
      def,
      value: def.get(s),
      delta: prev !== null && !suppressed && !prevSuppressed ? def.get(s) - def.get(prev) : null,
      suppressed,
      sample: sample === Number.MAX_SAFE_INTEGER ? 0 : sample
    };
  }

  private isSuppressed(def: MetricDef, s: CustomerStatistics): boolean {
    return def.denominator ? def.denominator(s) < MIN_SAMPLE : false;
  }

  /**
   * SIMPLE'S LABEL FOR A METRIC — used wherever Simple renders it, the cards and the comparison
   * rows alike. `labelOverride` lives on SimpleCardDef because that is where Simple's curation
   * lives, but it is not a property of the card: reading it only there is what left
   * "Customers who came back (any time)" in the Simple comparison table, where the 90-day metric
   * it disambiguates from is not on screen to disambiguate from.
   */
  simpleLabel(def: MetricDef): string {
    return this.simpleCardDefs.find(c => c.key === def.key)?.labelOverride ?? def.label;
  }

  /**
   * Both legend percentages share one denominator — the customers served — which is the same one
   * the returning rate is suppressed on, and the same one that greys the bars. All three move
   * together by construction rather than by three thresholds agreeing.
   */
  private buildSplitLegend(s: CustomerStatistics): void {
    const sample = s.activeCustomers;
    const suppressed = sample < MIN_SAMPLE;
    const reason = `Only ${sample} customer${sample === 1 ? '' : 's'} in this period `
      + '— too few for a reliable percentage.';
    // Ids start above the last metric's, so the legend can never share a tooltip with a row.
    const base = this.metrics.length;

    this.splitLegend = {
      returning: { value: s.returningRate, suppressed, sample, tooltipId: base, reason },
      first: { value: s.newRate, suppressed, sample, tooltipId: base + 1, reason }
    };
  }

  /** Plain-English reason a value is a dash, naming the actual denominator. */
  suppressionReason(card: MetricCard | CompareCell, def: MetricDef): string {
    const noun = def.key === 'activationRate' ? 'sign-ups'
      : def.key === 'followUpAssistedRate' ? 'customers came back'
      : def.key === 'repeatOrderShare' ? 'cleanings'
      : def.key === 'retentionRate' ? 'customers in the previous period'
      : 'customers';
    return `Only ${card.sample} ${noun} in this period — too few for a reliable percentage.`;
  }

  // ── Tooltips ─────────────────────────────────────────────────────────────

  tooltipId(def: MetricDef): number {
    return this.tooltipIds.get(def.key) ?? 0;
  }

  /**
   * Keyed by id rather than by metric, because the split-card legend needs the same behaviour
   * without being a metric. One tooltip at a time — on a phone two open bubbles overlap.
   */
  toggleTooltipById(id: number, event: Event): void {
    event.stopPropagation();
    if (this.tooltips.isVisible(id)) {
      this.tooltips.clear(id);
      return;
    }
    this.tooltips.clearAll();
    this.tooltips.show(id);
  }

  isTooltipVisibleById(id: number): boolean {
    return this.tooltips.isVisible(id);
  }

  isCurrentlyMobile(): boolean {
    return this.isBrowser ? window.innerWidth <= 768 : false;
  }

  // ── Deltas ───────────────────────────────────────────────────────────────

  /**
   * The delta accessors exist because `delta` is nullable and strictTemplates will not let a
   * template compare it to 0 directly, even under an *ngIf that has already excluded null.
   */
  hasDelta(card: MetricCard): boolean {
    return card.delta !== null && card.delta !== 0;
  }

  deltaValue(card: MetricCard): number {
    return card.delta ?? 0;
  }

  deltaArrow(card: MetricCard): string {
    return this.deltaValue(card) > 0 ? '▲' : '▼';
  }

  /** Leading '+' on a rise; a fall already carries its own minus sign. */
  deltaSign(card: MetricCard): string {
    return this.deltaValue(card) > 0 ? '+' : '';
  }

  isGoodDelta(card: MetricCard): boolean {
    if (card.delta === null || card.delta === 0 || card.def.betterWhen === 'none') return false;
    return card.def.betterWhen === 'high' ? card.delta > 0 : card.delta < 0;
  }

  isBadDelta(card: MetricCard): boolean {
    if (card.delta === null || card.delta === 0 || card.def.betterWhen === 'none') return false;
    return card.def.betterWhen === 'high' ? card.delta < 0 : card.delta > 0;
  }

  // ── Visualisations ───────────────────────────────────────────────────────

  /** Width of the new-vs-returning split bar, as a percentage of the whole. */
  splitWidth(part: number, whole: number): number {
    return whole > 0 ? (part / whole) * 100 : 0;
  }

  /**
   * True when the split bars are drawn on too few people to mean anything, in which case they are
   * greyed out. Same threshold and same denominator as the suppression rule — a bar IS a
   * percentage, just drawn instead of printed, and a confident-looking bar sitting beside a
   * suppressed dash on the same screen is the inconsistency this closes.
   *
   * The spend split greys on the CUSTOMER count too, not on the money: it is the same handful of
   * people either way, and a two-customer spend split is no more meaningful for being large.
   */
  get splitSampleTooThin(): boolean {
    return (this.stats?.activeCustomers ?? 0) < MIN_SAMPLE;
  }

  /** Frequency bar width, scaled to the busiest bucket rather than to the total. */
  frequencyWidth(customers: number): number {
    const max = Math.max(1, ...(this.stats?.frequency ?? []).map(f => f.customers));
    return (customers / max) * 100;
  }

  /** "12 months to Aug 2026" — states the anchoring so a historical view is not misread as today's. */
  get medianWindowLabel(): string {
    const to = this.stats?.medianWindowTo;
    if (!to) return '12 months';
    const d = new Date(to);
    return `12 months to ${d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`;
  }

  // ── The plain-English answer ─────────────────────────────────────────────

  /**
   * One sentence, generated from the loaded numbers, that answers the page's question before any
   * card is read. Counts only — never a rate — so it can never contradict a suppressed percentage
   * sitting underneath it.
   */
  private buildSummary(): void {
    const s = this.stats;
    if (!s) { this.summary = ''; return; }

    const p = this.describePeriod();

    if (s.activeCustomers === 0) {
      this.summary = `Nobody has booked a cleaning ${p.zeroPhrase}.`;
      return;
    }

    const customers = `${this.plural(s.activeCustomers, 'customer')}`;
    const cleanings = `${this.plural(s.totalOrders, 'cleaning')}`;
    const first = `${p.opener}, ${customers} booked ${cleanings}.`;

    const returned = s.returningCustomers === 0
      ? 'None of them had booked with us before'
      : `${s.returningCustomers} of them had booked with us before`;

    // The comparison clause is dropped whole when there is no prior period (All Time), rather than
    // trailing an empty phrase.
    let clause = '';
    if (this.prevStats !== null && p.comparison !== null) {
      const prevValue = this.prevStats.returningCustomers;
      const diff = s.returningCustomers - prevValue;
      // Both forms carry the previous COUNT before the comparison phrase. Without it the
      // no-change case reads "unchanged from in June", because the phrase already owns its
      // preposition so that "up from 5 in June" works.
      clause = diff === 0
        ? ` — the same as ${prevValue} ${p.comparison}`
        : ` — ${diff > 0 ? 'up' : 'down'} from ${prevValue} ${p.comparison}`;
    }

    this.summary = `${first} ${returned}${clause}.`;
  }

  private plural(n: number, noun: string): string {
    return `${n.toLocaleString('en-US')} ${noun}${n === 1 ? '' : 's'}`;
  }

  /**
   * How the selected window reads in a sentence. Every filter shape gets real English rather than a
   * slot-filled template — and a running period says so ("So far in August", "over the same days in
   * July"), because the window really is Aug 1–20 against Jul 1–20 and implying a whole month would
   * be a lie.
   */
  private describePeriod(): PeriodPhrasing {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthName = (d: Date) => this.monthNames[d.getMonth()];

    if (this.customFrom && this.customTo) {
      const a = new Date(this.customFrom + 'T00:00:00');
      const b = new Date(this.customTo + 'T00:00:00');
      const days = Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
      return {
        opener: `Between ${this.shortDate(a)} and ${this.shortDateYear(b)}`,
        zeroPhrase: 'in that range',
        comparison: `in the ${days} days before`
      };
    }

    switch (this.activeQuickFilter) {
      case 'today':
        return { opener: 'Today', zeroPhrase: 'today', comparison: 'yesterday' };
      case 'week':
        return {
          opener: 'So far this week', zeroPhrase: 'yet this week',
          comparison: 'over the same days last week'
        };
      case 'month': {
        const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        return {
          opener: `So far in ${monthName(today)}`,
          zeroPhrase: `yet in ${monthName(today)}`,
          comparison: `over the same days in ${monthName(prev)}`
        };
      }
      case 'lastMonth': {
        const last = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const before = new Date(today.getFullYear(), today.getMonth() - 2, 1);
        return {
          opener: `In ${monthName(last)}`,
          zeroPhrase: `in ${monthName(last)}`,
          comparison: `in ${monthName(before)}`
        };
      }
      case 'year':
        return {
          opener: `So far in ${today.getFullYear()}`,
          zeroPhrase: `yet in ${today.getFullYear()}`,
          comparison: `over the same period in ${today.getFullYear() - 1}`
        };
      case 'lastYear':
        return {
          opener: `In ${today.getFullYear() - 1}`,
          zeroPhrase: `in ${today.getFullYear() - 1}`,
          comparison: `in ${today.getFullYear() - 2}`
        };
      case 'all':
      default:
        return { opener: 'All time', zeroPhrase: 'at all yet', comparison: null };
    }
  }

  // ── Data loading ─────────────────────────────────────────────────────────

  private loadData(): void {
    this.isLoading = true;
    this.error = '';

    const win = this.getDateWindow();
    this.compareLabel = win.compareLabel;

    forkJoin({
      current: this.customerStats.getStatistics(win.from, win.to),
      previous: win.prevFrom && win.prevTo
        ? this.customerStats.getStatistics(win.prevFrom, win.prevTo)
        : of(null as CustomerStatistics | null)
    }).subscribe({
      next: ({ current, previous }) => {
        this.stats = current;
        this.prevStats = previous;
        this.buildCards();
        this.buildSummary();
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.error = err?.error?.message || 'Failed to load the customer numbers. Please try again.';
        this.isLoading = false;
      }
    });
  }

  /**
   * The 12-month trend is independent of the period filter — it is the long view the filter
   * cannot show — so it loads once and is never refetched when the filter moves.
   */
  private loadTrend(): void {
    this.customerStats.getTrend(TREND_MONTHS).subscribe({
      next: points => {
        this.trend = points;
        this.cdr.detectChanges();
        this.buildTrendChart();
      },
      error: () => { /* the chart simply stays empty; the numbers above still load */ }
    });
  }

  private buildTrendChart(): void {
    if (!this.isBrowser || !this.trendCanvas?.nativeElement || this.trend.length === 0) return;

    this.trendChart?.destroy();
    this.trendChart = null;

    const css = getComputedStyle(document.documentElement);
    const token = (name: string) => css.getPropertyValue(name).trim();
    const grid = token('--border-color');
    const muted = token('--text-muted');

    // Mixed bar+line: chart.js supports a per-dataset `type` override, but its typings only
    // describe a single-type config, so the object is assembled untyped and handed over as-is.
    const config: any = {
      type: 'bar',
      data: {
        labels: this.trend.map(p => p.label),
        datasets: [
          {
            label: 'Returning',
            data: this.trend.map(p => p.returningCustomers),
            backgroundColor: token('--chart-cat-1'),
            stack: 'customers',
            borderRadius: 3,
            order: 2
          },
          {
            label: 'First-time',
            data: this.trend.map(p => p.newCustomers),
            backgroundColor: token('--chart-cat-2'),
            stack: 'customers',
            borderRadius: 3,
            order: 2
          },
          {
            type: 'line',
            label: 'Returning rate',
            // null BREAKS the line for months too thin to report (spanGaps defaults to false).
            // A three-customer month used to spike the line to 45% and dominate the chart with
            // what was arithmetically one customer. The bars stay — counts are always valid.
            data: this.trend.map(p =>
              p.activeCustomers >= MIN_SAMPLE ? p.returningRate : null),
            borderColor: token('--chart-cat-8'),
            backgroundColor: token('--chart-cat-8'),
            borderWidth: 2,
            tension: 0.3,
            pointRadius: 2,
            pointHoverRadius: 5,
            yAxisID: 'y1',
            order: 1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false }, // identity lives in the HTML legend next to the chart
          tooltip: {
            callbacks: {
              label: (ctx: any) => {
                if (ctx.dataset.label !== 'Returning rate') {
                  return ` ${ctx.dataset.label}: ${ctx.parsed.y}`;
                }
                const point = this.trend[ctx.dataIndex];
                return point && point.activeCustomers >= MIN_SAMPLE
                  ? ` Returning rate: ${Number(ctx.parsed.y).toFixed(1)}%`
                  : ` Returning rate: too few customers to report`;
              }
            }
          }
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { color: muted, font: { size: 11 } } },
          y: {
            stacked: true, beginAtZero: true,
            grid: { color: grid },
            ticks: { color: muted, font: { size: 11 }, precision: 0 }
          },
          y1: {
            position: 'right', beginAtZero: true, max: 100,
            grid: { display: false },
            ticks: { color: muted, font: { size: 11 }, callback: (v: any) => `${v}%` }
          }
        }
      }
    };

    this.trendChart = new Chart(this.trendCanvas.nativeElement, config);
  }

  // ── Date windows ─────────────────────────────────────────────────────────

  /**
   * Current window for the selected filter plus the matching previous window used for the
   * "vs before" deltas. Previous windows are the same length, immediately before the current
   * one, so the comparison is honest.
   *
   * Running filters (This Week / Month / Year) stop at TODAY and compare against the same
   * elapsed days of the previous period — comparing a half-finished month against a whole one
   * would report a collapse every month. describePeriod() words the sentence to match.
   *
   * Same shape as the Finances page's window logic, minus its projection branch: this tab has no
   * projection toggle, because a customer who has booked but not yet been served is already
   * counted (OrderBookedFilter keeps Active/Pending paid orders).
   */
  private getDateWindow(): DateWindow {
    const fmt = (d: Date) => this.formatDate(d);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (this.customFrom && this.customTo) {
      const from = new Date(this.customFrom + 'T00:00:00');
      const to = new Date(this.customTo + 'T00:00:00');
      const lengthDays = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
      return {
        from: this.customFrom, to: this.customTo,
        prevFrom: fmt(this.addDays(from, -lengthDays)), prevTo: fmt(this.addDays(from, -1)),
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
        const prevMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
        // Same day-of-month last month, clamped to its last day (Mar 31 → Feb 28).
        const prevSameDay = new Date(today.getFullYear(), today.getMonth() - 1,
          Math.min(today.getDate(), prevMonthEnd.getDate()));
        return {
          from: fmt(start), to: fmt(today),
          prevFrom: fmt(prevStart), prevTo: fmt(prevSameDay),
          compareLabel: 'vs the same days last month'
        };
      }
      case 'lastMonth': {
        const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const end = new Date(today.getFullYear(), today.getMonth(), 0);
        return {
          from: fmt(start), to: fmt(end),
          prevFrom: fmt(new Date(today.getFullYear(), today.getMonth() - 2, 1)),
          prevTo: fmt(new Date(today.getFullYear(), today.getMonth() - 1, 0)),
          compareLabel: 'vs the month before'
        };
      }
      case 'year': {
        const start = new Date(today.getFullYear(), 0, 1);
        return {
          from: fmt(start), to: fmt(today),
          prevFrom: fmt(new Date(today.getFullYear() - 1, 0, 1)),
          prevTo: fmt(new Date(today.getFullYear() - 1, today.getMonth(), today.getDate())),
          compareLabel: 'vs the same period last year'
        };
      }
      case 'lastYear': {
        return {
          from: fmt(new Date(today.getFullYear() - 1, 0, 1)),
          to: fmt(new Date(today.getFullYear() - 1, 11, 31)),
          prevFrom: fmt(new Date(today.getFullYear() - 2, 0, 1)),
          prevTo: fmt(new Date(today.getFullYear() - 2, 11, 31)),
          compareLabel: 'vs the year before'
        };
      }
      case 'all':
      default:
        return { compareLabel: '' };
    }
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
    // The next period back from the last one, so adding is one click per period.
    const last = this.comparePicks[this.comparePicks.length - 1];
    this.comparePicks.push(last ? this.stepBack(last) : this.mkPick(new Date()));
  }

  removePick(index: number): void {
    if (this.comparePicks.length > 2) {
      this.comparePicks.splice(index, 1);
    }
  }

  /** Quick-fill sizes offered for the active unit. */
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
        case 'day': picks.push(this.mkPick(this.addDays(today, -back))); break;
        case 'week': picks.push(this.mkPick(this.addDays(today, -back * 7))); break;
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
    return this.compareUnit;
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
    return `${this.shortDate(start)} – ${this.shortDateYear(this.addDays(start, 6))}`;
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
    from(resolved.map((r, i) => ({ r, i })))
      .pipe(
        mergeMap(({ r, i }) => this.customerStats.getStatistics(r.from, r.to)
          .pipe(map(stats => ({ i, stats }))), MAX_PARALLEL_REQUESTS),
        toArray()
      )
      .subscribe({
        next: (loaded) => {
          // mergeMap completes out of order, so results carry their index home.
          const statsList: CustomerStatistics[] = [];
          loaded.forEach(({ i, stats }) => (statsList[i] = stats));
          this.compareResults = resolved.map((r, i) => ({ ...r, stats: statsList[i] }));
          this.buildCompareView();
          this.isComparing = false;
          this.showCompareModal = false;
          this.compareMode = true;
          this.cdr.detectChanges();
        },
        error: (err) => {
          this.isComparing = false;
          this.compareError = err?.error?.message
            || 'Could not load the numbers for those periods. Please try again.';
        }
      });
  }

  exitCompare(): void {
    if (!this.compareMode) return;
    this.compareMode = false;
    // The trend canvas leaves the DOM while comparing, taking the chart's element with it —
    // rebuild once Angular has put it back.
    setTimeout(() => this.buildTrendChart(), 0);
  }

  isBest(row: CompareRow, index: number): boolean {
    return row.bestValue !== null
      && !row.cells[index].suppressed
      && row.cells[index].value === row.bestValue;
  }

  /**
   * Builds the comparison table from the already-loaded per-period stats. ONE table for both views:
   * Simple narrows the row list, Full takes every metric. There is no second compare component.
   */
  private buildCompareView(): void {
    const defs = this.viewMode === 'simple'
      // Ordered by the Simple key list, not by metric declaration order, so the compare table reads
      // top-to-bottom in the same order as the Simple cards above it.
      ? this.simpleCompareKeys
        .map(key => this.metrics.find(m => m.key === key))
        .filter((d): d is MetricDef => !!d)
      : this.metrics;

    const visible = defs.filter(def => !def.hideWhenAllZero
      || this.compareResults.some(r => def.get(r.stats) !== 0));

    let lastGroup = '';
    this.compareRows = visible.map(def => {
      const cells: CompareCell[] = this.compareResults.map(r => {
        const sample = def.denominator ? def.denominator(r.stats) : Number.MAX_SAFE_INTEGER;
        return {
          value: def.get(r.stats),
          suppressed: this.isSuppressed(def, r.stats),
          sample: sample === Number.MAX_SAFE_INTEGER ? 0 : sample
        };
      });

      // "Best" is decided among the cells we are willing to print. A suppressed 45% from a
      // three-customer month must never win the row it would otherwise dominate.
      const live = cells.filter(c => !c.suppressed).map(c => c.value);
      const bestValue = def.betterWhen === 'none' || live.length === 0
        || live.every(v => v === live[0])
        ? null
        : (def.betterWhen === 'high' ? Math.max(...live) : Math.min(...live));

      // Simple's row list is curated, so its section headers would be noise on a nine-row table.
      const groupStart = this.viewMode === 'full' && def.group !== lastGroup;
      lastGroup = def.group;
      const label = this.viewMode === 'simple' ? this.simpleLabel(def) : def.label;
      return { def, label, groupStart, cells, bestValue };
    });
  }

  private mkPick(d: Date): ComparePick {
    return { date: this.formatDate(d), month: d.getMonth(), year: d.getFullYear() };
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

  /** Two sensible starting picks per unit: the previous period first, the current one second. */
  private defaultPicks(unit: CompareUnit): ComparePick[] {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    switch (unit) {
      case 'day':
        return [this.mkPick(this.addDays(today, -1)), this.mkPick(today)];
      case 'week':
        return [this.mkPick(this.addDays(today, -7)), this.mkPick(today)];
      case 'month':
        return [this.mkPick(new Date(today.getFullYear(), today.getMonth() - 1, 1)), this.mkPick(today)];
      case 'year':
      default:
        return [this.mkPick(new Date(today.getFullYear() - 1, 0, 1)), this.mkPick(today)];
    }
  }

  /**
   * Turn a pick into the complete calendar period it means (whole week/month/year), and mark it
   * when that period runs past today — see ComparePeriod.unfinished.
   */
  private resolvePick(pick: ComparePick): Omit<ComparePeriod, 'stats'> {
    const period = this.resolvePickRange(pick);
    return { ...period, unfinished: this.endsInFuture(period.to) };
  }

  private resolvePickRange(pick: ComparePick): Omit<ComparePeriod, 'stats' | 'unfinished'> {
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
        return {
          from: this.formatDate(new Date(pick.year, 0, 1)),
          to: this.formatDate(new Date(pick.year, 11, 31)),
          label: String(pick.year),
          rangeLabel: `Jan 1 – Dec 31, ${pick.year}`
        };
      }
    }
  }

  /**
   * Does this period run past today? Deliberately a test on the END DATE rather than on the unit,
   * so the current week, the current year and a custom range ending later today are all caught by
   * the same rule as the current month.
   *
   * Note such a period is NOT "so far": this tab counts paid Active/Pending orders, so the column
   * already holds cleanings booked for days that have not happened. It is the period AS BOOKED
   * TODAY, which is why it reads larger than the single-period view of the same month rather than
   * smaller.
   */
  private endsInFuture(isoDate: string): boolean {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return new Date(isoDate + 'T00:00:00').getTime() > today.getTime();
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

  private shortDate(d: Date): string {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  private shortDateYear(d: Date): string {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
}
