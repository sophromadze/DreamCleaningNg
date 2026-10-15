import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, PLATFORM_ID, computed, effect, inject, input,
  signal, viewChild
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import Chart from 'chart.js/auto';
import { Subscription } from 'rxjs';
import { ThemeService } from '../../../services/theme.service';
import { AgentChartPart } from './analytics-agent.service';
import { formatAgentValue } from './agent-format';

/**
 * The palette slots a chart may use, in FIXED order: series 1 is always slot 1, so a colour
 * follows the series, never its rank. Six, because --chart-cat-1..6 pass the colour-vision and
 * normal-vision separation checks in both themes and slots 7-8 do not (the backend refuses a
 * seventh series for the same reason).
 */
export const AGENT_CHART_TOKENS = ['--chart-cat-1', '--chart-cat-2', '--chart-cat-3', '--chart-cat-4', '--chart-cat-5', '--chart-cat-6'];

/**
 * One chart of an analytics-agent answer, drawn with the chart.js the admin panel already uses.
 * Two of the palette's hues sit under 3:1 against the surface, so identity never rests on colour
 * alone: a legend whenever there are two or more series, 2px surface gaps between marks, and a
 * "Show as table" view of the same numbers.
 */
@Component({
  selector: 'app-agent-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <figure class="agent-chart">
      @if (part().title) { <figcaption class="agent-chart-title">{{ part().title }}</figcaption> }
      <div class="agent-chart-canvas" [class.is-pie]="part().chart_type === 'pie'">
        <canvas #canvas role="img" [attr.aria-label]="summary()"></canvas>
      </div>
      <button type="button" class="agent-chart-toggle" (click)="showTable.set(!showTable())"
              [attr.aria-expanded]="showTable()">
        {{ showTable() ? 'Hide table' : 'Show as table' }}
      </button>
      @if (showTable()) {
        <div class="agent-table-wrap">
          <table class="agent-table">
            <thead>
              <tr>
                <th scope="col">{{ part().x_label || (part().chart_type === 'pie' ? 'Slice' : 'Label') }}</th>
                @for (s of part().series; track $index) { <th scope="col" class="num">{{ s.name }}</th> }
              </tr>
            </thead>
            <tbody>
              @for (label of part().labels; track $index; let i = $index) {
                <tr>
                  <th scope="row">{{ label }}</th>
                  @for (s of part().series; track $index) { <td class="num">{{ format(s.data[i]) }}</td> }
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </figure>
  `,
  styleUrls: ['./analytics-agent.component.scss']
})
export class AgentChartComponent implements AfterViewInit, OnDestroy {
  readonly part = input.required<AgentChartPart>();
  readonly showTable = signal(false);

  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly themeService = inject(ThemeService);
  private chart: Chart | null = null;
  private themeSub?: Subscription;
  private viewReady = false;

  readonly summary = computed(() => {
    const p = this.part();
    const series = p.series.map(s => s.name).join(', ');
    return `${p.title || 'Chart'}: ${p.chart_type.replace('_', ' ')} chart of ${series} over ${p.labels.length} `
      + `${p.labels.length === 1 ? 'label' : 'labels'}. Use "Show as table" for the values.`;
  });

  constructor() {
    // Redraw when the part changes after the first render.
    effect(() => {
      this.part();
      if (this.viewReady) this.draw();
    });
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.draw();
    // Colours are read from theme tokens, so a day/night switch needs a redraw.
    this.themeSub = this.themeService.theme$.subscribe(() => { if (this.chart) setTimeout(() => this.draw(), 0); });
  }

  ngOnDestroy(): void {
    this.themeSub?.unsubscribe();
    this.chart?.destroy();
    this.chart = null;
  }

  format(value: number | null | undefined): string {
    return formatAgentValue(value, this.part().format);
  }

  private draw(): void {
    const el = this.canvas()?.nativeElement;
    if (!this.isBrowser || !el) return;
    this.chart?.destroy();
    this.chart = null;

    const p = this.part();
    const css = getComputedStyle(document.documentElement);
    const token = (name: string) => css.getPropertyValue(name).trim();
    const colors = AGENT_CHART_TOKENS.map(token);
    const surface = token('--surface');
    const grid = token('--border-color');
    const muted = token('--text-muted');
    const text = token('--text-secondary');
    const fmt = (v: unknown, short = false) => formatAgentValue(v, p.format, short);
    const isPie = p.chart_type === 'pie';
    const stacked = p.chart_type === 'stacked_bar';
    const isLine = p.chart_type === 'line';

    const datasets = isPie
      ? [{
          label: p.series[0]?.name ?? '',
          data: p.series[0]?.data ?? [],
          backgroundColor: p.labels.map((_, i) => colors[i % colors.length]),
          borderColor: surface,
          borderWidth: 2
        }]
      : p.series.map((s, i) => isLine
          ? {
              label: s.name, data: s.data, borderColor: colors[i], backgroundColor: colors[i],
              borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, pointBorderColor: surface, pointBorderWidth: 2,
              tension: 0, spanGaps: false
            }
          : {
              label: s.name, data: s.data, backgroundColor: colors[i],
              // 2px surface gap between neighbouring bars and stacked segments; rounded data end,
              // square base on the axis.
              borderColor: surface, borderWidth: stacked ? { top: 2 } : 0, borderRadius: stacked ? 0 : 4,
              borderSkipped: 'start', maxBarThickness: 48,
              ...(stacked ? { stack: 'all' } : {})
            });

    const showLegend = isPie || p.series.length >= 2;
    const config: any = {
      type: isPie ? 'pie' : isLine ? 'line' : 'bar',
      data: { labels: p.labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: isPie ? undefined : { mode: 'index', intersect: false },
        plugins: {
          legend: { display: showLegend, position: 'bottom', labels: { color: text, boxWidth: 12, boxHeight: 12, usePointStyle: false } },
          tooltip: {
            callbacks: {
              label: (ctx: any) => {
                const v = isPie ? ctx.parsed : ctx.parsed.y;
                const name = isPie ? ctx.label : ctx.dataset.label;
                return ` ${name}: ${fmt(v)}`;
              }
            }
          }
        },
        scales: isPie ? undefined : {
          x: {
            stacked, grid: { display: false },
            title: { display: !!p.x_label, text: p.x_label ?? '', color: muted },
            ticks: { color: muted, font: { size: 11 }, maxRotation: 0, autoSkip: true }
          },
          y: {
            stacked, beginAtZero: true, grid: { color: grid },
            title: { display: !!p.y_label, text: p.y_label ?? '', color: muted },
            ticks: { color: muted, font: { size: 11 }, callback: (v: any) => fmt(v, true) }
          }
        }
      }
    };

    this.chart = new Chart(el, config);
  }
}
