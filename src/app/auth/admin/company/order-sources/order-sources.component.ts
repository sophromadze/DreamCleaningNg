import {
  Component, OnInit, OnDestroy, ElementRef, PLATFORM_ID, ChangeDetectionStrategy, inject, viewChild, signal, computed
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Chart from 'chart.js/auto';
import { Subject, takeUntil } from 'rxjs';
import { AdminService, OrderSourceKey, OrderSourcesReport } from '../../../../services/admin.service';
import { ThemeService } from '../../../../services/theme.service';
import { NY_TIME_ZONE } from '../../../../shared/ny-time.util';
import { extractApiErrorMessage } from '../../../../utils/http-error.utils';

export type OrderSourcesPreset = 'last30' | 'thisMonth' | 'lastMonth' | 'last90' | 'thisYear' | 'custom';
export type OrderSourcesGrain = 'auto' | 'day' | 'week' | 'month';

/** Today's date in New York as yyyy-MM-dd — service dates are NY wall-clock dates. */
export function nyTodayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: NY_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);
}

function iso(y: number, m: number, d: number): string {
  // Built from parts in UTC so no browser time zone can shift the day.
  return new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
}

/** The from/to (both inclusive, yyyy-MM-dd) a preset covers, relative to NY's today. */
export function presetRange(preset: Exclude<OrderSourcesPreset, 'custom'>, todayIso: string): { from: string; to: string } {
  const [y, m, d] = todayIso.split('-').map(Number);
  const month = m - 1;
  switch (preset) {
    case 'thisMonth': return { from: iso(y, month, 1), to: todayIso };
    case 'lastMonth': return { from: iso(y, month - 1, 1), to: iso(y, month, 0) };
    case 'last90': return { from: iso(y, month, d - 89), to: todayIso };
    case 'thisYear': return { from: iso(y, 0, 1), to: todayIso };
    case 'last30':
    default: return { from: iso(y, month, d - 29), to: todayIso };
  }
}

/** Chart colour token per source. Unknown is the neutral one on purpose: it is an absence. */
const SOURCE_COLOR_TOKENS: Record<OrderSourceKey, string> = {
  paid: '--chart-cat-1',
  organic: '--chart-cat-4',
  direct: '--chart-cat-5',
  referral: '--chart-cat-3',
  social: '--chart-cat-7',
  email: '--chart-cat-8',
  ai: '--chart-cat-2',
  admin: '--chart-cat-6',
  unknown: '--text-muted'
};

/**
 * Company → Order Sources (2026-10): how many completed orders came from paid ads, organic search
 * and the other first-touch sources, the revenue behind each, and the split over time.
 *
 * Every number comes from GET api/admin/order-sources, which buckets by ServiceDate, counts only
 * Done orders that are not hidden, and classifies each order with the backend's
 * OrderSourceClassifier — nothing is re-derived here.
 */
@Component({
  selector: 'app-order-sources',
  imports: [CommonModule, FormsModule],
  templateUrl: './order-sources.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./order-sources.component.scss']
})
export class OrderSourcesComponent implements OnInit, OnDestroy {
  private readonly adminService = inject(AdminService);
  private readonly themeService = inject(ThemeService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly chartCanvas = viewChild<ElementRef<HTMLCanvasElement>>('chartCanvas');

  readonly presets: ReadonlyArray<{ key: OrderSourcesPreset; label: string }> = [
    { key: 'last30', label: 'Last 30 days' },
    { key: 'thisMonth', label: 'This month' },
    { key: 'lastMonth', label: 'Last month' },
    { key: 'last90', label: 'Last 90 days' },
    { key: 'thisYear', label: 'This year' },
    { key: 'custom', label: 'Custom range' }
  ];
  readonly grains: ReadonlyArray<{ key: OrderSourcesGrain; label: string }> = [
    { key: 'auto', label: 'Automatic' },
    { key: 'day', label: 'By day' },
    { key: 'week', label: 'By week' },
    { key: 'month', label: 'By month' }
  ];

  readonly preset = signal<OrderSourcesPreset>('last30');
  readonly grain = signal<OrderSourcesGrain>('auto');
  readonly fromDate = signal('');
  readonly toDate = signal('');
  /** What the chart shows: order counts or revenue per source. */
  readonly chartMetric = signal<'orders' | 'revenue'>('orders');

  readonly report = signal<OrderSourcesReport | null>(null);
  readonly loading = signal(false);
  readonly errorMessage = signal('');

  /** Sources with at least one order, for the legend and the chart (zero rows stay in the table). */
  readonly activeSources = computed(() => (this.report()?.sources ?? []).filter(s => s.orders > 0));

  /** The headline split the tab exists for: paid ads vs organic search. */
  readonly paidRow = computed(() => this.report()?.sources.find(s => s.key === 'paid') ?? null);
  readonly organicRow = computed(() => this.report()?.sources.find(s => s.key === 'organic') ?? null);

  private chart: Chart | null = null;
  private readonly destroy$ = new Subject<void>();

  ngOnInit(): void {
    this.applyPreset('last30');
    this.themeService.theme$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => { if (this.chart) setTimeout(() => this.buildChart(), 0); });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.chart?.destroy();
  }

  onPresetChange(preset: OrderSourcesPreset): void {
    if (preset === 'custom') {
      this.preset.set('custom');
      return;
    }
    this.applyPreset(preset);
  }

  private applyPreset(preset: Exclude<OrderSourcesPreset, 'custom'>): void {
    this.preset.set(preset);
    const range = presetRange(preset, nyTodayIso());
    this.fromDate.set(range.from);
    this.toDate.set(range.to);
    this.load();
  }

  applyCustom(): void {
    if (!this.fromDate() || !this.toDate()) {
      this.errorMessage.set('Choose both a start and an end date.');
      return;
    }
    if (this.fromDate() > this.toDate()) {
      this.errorMessage.set('The start date must be on or before the end date.');
      return;
    }
    this.preset.set('custom');
    this.load();
  }

  onGrainChange(grain: OrderSourcesGrain): void {
    this.grain.set(grain);
    this.load();
  }

  setChartMetric(metric: 'orders' | 'revenue'): void {
    if (this.chartMetric() === metric) return;
    this.chartMetric.set(metric);
    setTimeout(() => this.buildChart(), 0);
  }

  load(): void {
    this.loading.set(true);
    this.errorMessage.set('');
    this.adminService.getOrderSources(this.fromDate(), this.toDate(), this.grain()).subscribe({
      next: (report) => {
        this.report.set(report);
        this.loading.set(false);
        // The canvas is inside an @if that only renders once there is data.
        setTimeout(() => this.buildChart(), 0);
      },
      error: (err) => {
        this.loading.set(false);
        this.report.set(null);
        this.errorMessage.set(extractApiErrorMessage(err, 'Failed to load order sources.'));
      }
    });
  }

  /** "Sep 1", "Week of Sep 1", "Sep 2026" — matches the report's bucket size. */
  periodLabel(periodStart: string): string {
    const [y, m, d] = periodStart.slice(0, 10).split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    const grain = this.report()?.granularity ?? 'day';
    if (grain === 'month') {
      return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    }
    const short = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    return grain === 'week' ? `Week of ${short}` : short;
  }

  colorVar(key: OrderSourceKey): string {
    return `var(${SOURCE_COLOR_TOKENS[key] ?? '--text-muted'})`;
  }

  /** One sentence describing the chart for screen readers — the table below carries the data. */
  chartSummary(): string {
    const r = this.report();
    if (!r) return '';
    const paid = this.paidRow();
    const organic = this.organicRow();
    return `Completed orders by source over time: ${r.totalOrders} in total, `
      + `${paid?.orders ?? 0} from paid ads and ${organic?.orders ?? 0} from organic search. `
      + 'The table below lists every source.';
  }

  private buildChart(): void {
    const canvas = this.chartCanvas();
    const report = this.report();
    if (!this.isBrowser || !canvas?.nativeElement || !report || report.totalOrders === 0) {
      this.chart?.destroy();
      this.chart = null;
      return;
    }

    this.chart?.destroy();
    this.chart = null;

    const css = getComputedStyle(document.documentElement);
    const token = (name: string) => css.getPropertyValue(name).trim();
    const grid = token('--border-color');
    const muted = token('--text-muted');
    const metric = this.chartMetric();
    const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

    const config: any = {
      type: 'bar',
      data: {
        labels: report.periods.map(p => this.periodLabel(p.periodStart)),
        datasets: this.activeSources().map(s => ({
          label: s.label,
          data: report.periods.map(p => (metric === 'orders' ? p.orders : p.revenue)[s.key] ?? 0),
          backgroundColor: token(SOURCE_COLOR_TOKENS[s.key] ?? '--text-muted'),
          stack: 'sources',
          borderRadius: 2
        }))
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false }, // the HTML legend beside the chart names the colours
          tooltip: {
            filter: (item: any) => Number(item.parsed.y) > 0,
            callbacks: {
              label: (ctx: any) => metric === 'orders'
                ? ` ${ctx.dataset.label}: ${ctx.parsed.y}`
                : ` ${ctx.dataset.label}: ${money.format(ctx.parsed.y)}`
            }
          }
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { color: muted, font: { size: 11 }, maxRotation: 0, autoSkip: true } },
          y: {
            stacked: true, beginAtZero: true,
            grid: { color: grid },
            ticks: {
              color: muted, font: { size: 11 }, precision: 0,
              callback: (v: any) => metric === 'orders' ? v : money.format(v)
            }
          }
        }
      }
    };

    this.chart = new Chart(canvas.nativeElement, config);
  }
}
