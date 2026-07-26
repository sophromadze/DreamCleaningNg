import {
  Component, ElementRef, Input, OnChanges, OnDestroy, PLATFORM_ID, ViewChild, inject
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import Chart from 'chart.js/auto';

/** One plotted series (a channel), tied to a design-token CSS variable for its color. */
export interface TrendSeries {
  label: string;
  data: number[];
  /** CSS custom property that resolves to this series' color, e.g. '--fresh-green'. */
  colorVar: string;
  /** Render as a dashed line (used to separate the two "unknown" catch-alls). */
  dashed?: boolean;
}

/**
 * Channel name → the design-token CSS variable used for its line/area color. Mirrors the `.ch-*`
 * chip classes in the Traffic/Ads stylesheets so the chart and the chips read as one palette.
 * Keep this in sync with `channelClass()` in those components.
 */
export const CHANNEL_COLOR_VARS: Record<string, string> = {
  'Organic Search': '--fresh-green',
  'Paid Search':    '--primary-color',
  'AI Assistant':   '--btn-quote',
  'Direct':         '--text-muted',
  'Referral':       '--star-color',
  'Unassigned':     '--soft-lavender',
  'Unattributed':   '--border-color',
  'Before tracking':'--text-muted',   // dashed line distinguishes it from Direct
  'Phone/Unknown':  '--warning-orange'
};

export function channelColorVar(channel: string): string {
  return CHANNEL_COLOR_VARS[channel] ?? '--text-muted';
}

/**
 * GA4-style "metric by channel over time" trend chart. A thin, theme-aware wrapper over chart.js:
 * one line/area per channel, colored from design tokens (resolved via getComputedStyle so canvas —
 * which can't read CSS vars — still flips with the day/night theme). SSR-safe (renders only in the
 * browser) and rebuilds when the theme toggles. Purely presentational: the parent shapes the data.
 */
@Component({
  selector: 'app-channel-trend-chart',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './channel-trend-chart.component.html',
  styleUrls: ['./channel-trend-chart.component.scss']
})
export class ChannelTrendChartComponent implements OnChanges, OnDestroy {
  /** X-axis labels (already-formatted dates), aligned index-for-index with each series' data. */
  @Input() labels: string[] = [];
  /** One entry per channel. */
  @Input() series: TrendSeries[] = [];
  /** Stacked area (channels sum to the total) vs. overlaid lines. */
  @Input() stacked = true;
  /** Prefix for tooltip/axis values, e.g. '$'. */
  @Input() valuePrefix = '';

  @ViewChild('canvas') canvasRef?: ElementRef<HTMLCanvasElement>;

  private readonly platformId = inject(PLATFORM_ID);
  private readonly host = inject(ElementRef);
  private chart: Chart | null = null;
  private themeObserver?: MutationObserver;

  get isBrowser(): boolean { return isPlatformBrowser(this.platformId); }

  get hasData(): boolean {
    return this.labels.length > 0 && this.series.some(s => s.data.some(v => v > 0));
  }

  ngOnChanges(): void {
    if (!this.isBrowser) return;
    // Canvas may not exist yet on the first change (view not initialized); defer a tick.
    setTimeout(() => this.rebuild(), 0);
    this.ensureThemeObserver();
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
    this.chart = null;
    this.themeObserver?.disconnect();
  }

  /** Rebuild the whole chart on theme flips — the token colors resolve differently in dark mode. */
  private ensureThemeObserver(): void {
    if (this.themeObserver || typeof document === 'undefined') return;
    this.themeObserver = new MutationObserver(() => this.rebuild());
    this.themeObserver.observe(document.documentElement, {
      attributes: true, attributeFilter: ['data-theme']
    });
  }

  private cssVar(name: string, fallback: string): string {
    if (typeof getComputedStyle === 'undefined') return fallback;
    const v = getComputedStyle(this.host.nativeElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  /** Overlay an alpha onto a resolved color; handles hex and falls back to color-mix for the rest. */
  private withAlpha(color: string, alpha: number): string {
    const hex = color.match(/^#([0-9a-f]{6})$/i);
    if (hex) {
      const n = parseInt(hex[1], 16);
      return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
    }
    return `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)`;
  }

  private rebuild(): void {
    if (!this.isBrowser || !this.canvasRef) return;
    this.chart?.destroy();
    if (!this.hasData) { this.chart = null; return; }

    const gridColor = this.cssVar('--border-color', 'rgba(148,163,184,0.2)');
    const tickColor = this.cssVar('--text-muted', '#64748b');
    const surface = this.cssVar('--surface-elevated', '#1e293b');
    const textPrimary = this.cssVar('--text-primary', '#0f172a');

    const datasets = this.series.map(s => {
      const color = this.cssVar(s.colorVar, '#64748b');
      return {
        label: s.label,
        data: s.data,
        borderColor: color,
        backgroundColor: this.stacked ? this.withAlpha(color, 0.35) : this.withAlpha(color, 0.12),
        borderWidth: 2,
        borderDash: s.dashed ? [5, 4] : [],
        tension: 0.3,
        fill: this.stacked,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointBackgroundColor: color
      };
    });

    const prefix = this.valuePrefix;
    this.chart = new Chart(this.canvasRef.nativeElement, {
      type: 'line',
      data: { labels: this.labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: textPrimary, usePointStyle: true, pointStyle: 'line', boxWidth: 24, padding: 14 }
          },
          tooltip: {
            backgroundColor: surface,
            titleColor: textPrimary,
            bodyColor: textPrimary,
            borderColor: gridColor,
            borderWidth: 1,
            padding: 10,
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${prefix}${(ctx.parsed.y ?? 0).toLocaleString()}`
            }
          }
        },
        scales: {
          x: {
            stacked: this.stacked,
            grid: { display: false },
            ticks: { color: tickColor, font: { size: 11 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }
          },
          y: {
            stacked: this.stacked,
            beginAtZero: true,
            grid: { color: gridColor },
            ticks: {
              color: tickColor,
              font: { size: 11 },
              precision: 0,
              callback: (val: any) => prefix + Number(val).toLocaleString()
            }
          }
        }
      }
    });
  }
}
