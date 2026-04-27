import { Component, OnInit, OnDestroy, ViewChild, ElementRef, Inject, PLATFORM_ID, ChangeDetectorRef } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService, OrderStatistics, DailyStatistics } from '../../services/admin.service';
import { forkJoin } from 'rxjs';
import Chart from 'chart.js/auto';

type QuickFilter = 'all' | 'today' | 'week' | 'month' | 'year';
type ChartGrouping = 'days' | 'weeks' | 'months';

interface ChartDataPoint {
  label: string;
  orders: number;
  amount: number;
  taxes: number;
  tips: number;
  cleanersSalary: number;
  companyRevenue: number;
}

@Component({
  selector: 'app-statistics',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './statistics.component.html',
  styleUrls: ['./statistics.component.scss']
})
export class StatisticsComponent implements OnInit, OnDestroy {
  @ViewChild('ordersChart') ordersCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('revenueChart') revenueCanvas!: ElementRef<HTMLCanvasElement>;

  stats: OrderStatistics | null = null;
  dailyData: DailyStatistics[] = [];
  chartData: ChartDataPoint[] = [];
  isLoading = false;
  error = '';
  ordersChart: Chart | null = null;
  revenueChart: Chart | null = null;
  isBrowser: boolean;

  activeQuickFilter: QuickFilter = 'year';
  customFrom = '';
  customTo = '';
  chartGrouping: ChartGrouping = 'months';

  constructor(
    private adminService: AdminService,
    private cdr: ChangeDetectorRef,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  ngOnInit(): void {
    this.loadData();
  }

  ngOnDestroy(): void {
    this.ordersChart?.destroy();
    this.revenueChart?.destroy();
  }

  onQuickFilterChange(filter: QuickFilter): void {
    this.activeQuickFilter = filter;
    this.customFrom = '';
    this.customTo = '';
    // Pick a sensible default grouping for the new range so the chart isn't pegged to "days"
    // when looking at a year (which makes the bars unreadable).
    if (filter === 'year' || filter === 'all') {
      this.chartGrouping = 'months';
    } else if (filter === 'month') {
      this.chartGrouping = 'weeks';
    } else {
      this.chartGrouping = 'days';
    }
    this.loadData();
  }

  applyCustomRange(): void {
    if (this.customFrom && this.customTo) {
      this.loadData(this.customFrom, this.customTo);
    }
  }

  clearCustomRange(): void {
    this.customFrom = '';
    this.customTo = '';
    this.activeQuickFilter = 'year';
    this.chartGrouping = 'months';
    this.loadData();
  }

  setGrouping(grouping: ChartGrouping): void {
    this.chartGrouping = grouping;
    this.processChartData();
    this.buildCharts();
  }

  private loadData(fromOverride?: string, toOverride?: string): void {
    this.isLoading = true;
    this.error = '';

    const { from, to } = this.getDateRange(fromOverride, toOverride);

    forkJoin({
      stats: this.adminService.getOrderStatistics(from, to),
      daily: this.adminService.getDailyStatistics(from, to)
    }).subscribe({
      next: ({ stats, daily }) => {
        this.stats = stats;
        this.dailyData = daily;
        this.isLoading = false;
        this.cdr.detectChanges();
        this.processChartData();
        setTimeout(() => this.buildCharts(), 0);
      },
      error: (err) => {
        this.error = err?.error?.message || 'Failed to load statistics.';
        this.isLoading = false;
      }
    });
  }

  private getDateRange(fromOverride?: string, toOverride?: string): { from?: string; to?: string } {
    if (fromOverride && toOverride) {
      return { from: fromOverride, to: toOverride };
    }

    const now = new Date();
    switch (this.activeQuickFilter) {
      case 'today':
        return { from: this.formatDate(now), to: this.formatDate(now) };
      case 'week': {
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay());
        return { from: this.formatDate(startOfWeek), to: this.formatDate(now) };
      }
      case 'month': {
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        return { from: this.formatDate(startOfMonth), to: this.formatDate(now) };
      }
      case 'year': {
        const startOfYear = new Date(now.getFullYear(), 0, 1);
        return { from: this.formatDate(startOfYear), to: this.formatDate(now) };
      }
      case 'all':
      default:
        return { from: undefined, to: undefined };
    }
  }

  private processChartData(): void {
    const dataMap = new Map<string, DailyStatistics>();
    for (const d of this.dailyData) {
      dataMap.set(d.date, d);
    }

    const { from, to } = this.getDateRange(
      this.customFrom || undefined,
      this.customTo || undefined
    );

    let startDate: Date;
    let endDate: Date;

    if (from) {
      startDate = new Date(from + 'T00:00:00');
    } else if (this.dailyData.length > 0) {
      startDate = new Date(this.dailyData[0].date + 'T00:00:00');
    } else {
      this.chartData = [];
      return;
    }

    if (to) {
      endDate = new Date(to + 'T00:00:00');
    } else if (this.dailyData.length > 0) {
      endDate = new Date(this.dailyData[this.dailyData.length - 1].date + 'T00:00:00');
    } else {
      this.chartData = [];
      return;
    }

    const allDays: ChartDataPoint[] = [];
    const current = new Date(startDate);
    while (current <= endDate) {
      const key = this.formatDate(current);
      const d = dataMap.get(key);
      allDays.push({
        label: key,
        orders: d?.orders ?? 0,
        amount: d?.amount ?? 0,
        taxes: d?.taxes ?? 0,
        tips: d?.tips ?? 0,
        cleanersSalary: d?.cleanersSalary ?? 0,
        companyRevenue: d?.companyRevenue ?? 0
      });
      current.setDate(current.getDate() + 1);
    }

    if (this.chartGrouping === 'days') {
      this.chartData = allDays.map(d => ({
        ...d,
        label: this.formatLabel(d.label, 'days')
      }));
    } else if (this.chartGrouping === 'weeks') {
      this.chartData = this.groupByWeek(allDays);
    } else {
      this.chartData = this.groupByMonth(allDays);
    }
  }

  private groupByWeek(days: ChartDataPoint[]): ChartDataPoint[] {
    const weeks = new Map<string, ChartDataPoint>();
    for (const d of days) {
      const date = new Date(d.label + 'T00:00:00');
      const day = date.getDay();
      const diff = date.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(date);
      monday.setDate(diff);
      const weekKey = this.formatDate(monday);

      if (!weeks.has(weekKey)) {
        weeks.set(weekKey, {
          label: this.formatLabel(weekKey, 'weeks'),
          orders: 0, amount: 0, taxes: 0, tips: 0, cleanersSalary: 0, companyRevenue: 0
        });
      }
      const w = weeks.get(weekKey)!;
      w.orders += d.orders;
      w.amount += d.amount;
      w.taxes += d.taxes;
      w.tips += d.tips;
      w.cleanersSalary += d.cleanersSalary;
      w.companyRevenue += d.companyRevenue;
    }
    return Array.from(weeks.values());
  }

  private groupByMonth(days: ChartDataPoint[]): ChartDataPoint[] {
    const months = new Map<string, ChartDataPoint>();
    for (const d of days) {
      const date = new Date(d.label + 'T00:00:00');
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

      if (!months.has(monthKey)) {
        months.set(monthKey, {
          label: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
          orders: 0, amount: 0, taxes: 0, tips: 0, cleanersSalary: 0, companyRevenue: 0
        });
      }
      const m = months.get(monthKey)!;
      m.orders += d.orders;
      m.amount += d.amount;
      m.taxes += d.taxes;
      m.tips += d.tips;
      m.cleanersSalary += d.cleanersSalary;
      m.companyRevenue += d.companyRevenue;
    }
    return Array.from(months.values());
  }

  private formatLabel(dateStr: string, grouping: ChartGrouping): string {
    const date = new Date(dateStr + 'T00:00:00');
    if (grouping === 'weeks') {
      return 'Week of ' + date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  private buildCharts(): void {
    if (!this.isBrowser) return;

    this.buildOrdersChart();
    this.buildRevenueChart();
  }

  private buildOrdersChart(): void {
    if (!this.ordersCanvas) return;
    this.ordersChart?.destroy();

    const labels = this.chartData.map(d => d.label);

    this.ordersChart = new Chart(this.ordersCanvas.nativeElement, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Orders',
          data: this.chartData.map(d => d.orders),
          borderColor: '#4285f4',
          backgroundColor: 'rgba(66, 133, 244, 0.15)',
          borderWidth: 2,
          tension: 0.3,
          fill: true,
          pointRadius: 1.5,
          pointHoverRadius: 4,
          pointBackgroundColor: '#a0c4ff',
          pointBorderColor: '#a0c4ff',
          pointBorderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(30, 30, 30, 0.95)',
            titleColor: '#fff',
            bodyColor: '#ccc',
            borderColor: 'rgba(255,255,255,0.1)',
            borderWidth: 1,
            padding: 12
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(255,255,255,0.06)' },
            ticks: { color: '#888', font: { size: 11 }, maxRotation: 45 }
          },
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(255,255,255,0.06)' },
            ticks: { color: '#4285f4', font: { size: 11 }, stepSize: 1 }
          }
        }
      }
    });
  }

  private buildRevenueChart(): void {
    if (!this.revenueCanvas) return;
    this.revenueChart?.destroy();

    const labels = this.chartData.map(d => d.label);

    this.revenueChart = new Chart(this.revenueCanvas.nativeElement, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Revenue',
          data: this.chartData.map(d => d.companyRevenue),
          borderColor: '#20c997',
          backgroundColor: 'rgba(32, 201, 151, 0.15)',
          borderWidth: 2,
          tension: 0.3,
          fill: true,
          pointRadius: 1.5,
          pointHoverRadius: 4,
          pointBackgroundColor: '#7ff5d4',
          pointBorderColor: '#7ff5d4',
          pointBorderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(30, 30, 30, 0.95)',
            titleColor: '#fff',
            bodyColor: '#ccc',
            borderColor: 'rgba(255,255,255,0.1)',
            borderWidth: 1,
            padding: 12,
            callbacks: {
              label: (ctx) => {
                const val = ctx.parsed.y;
                return `Revenue: $${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(255,255,255,0.06)' },
            ticks: { color: '#888', font: { size: 11 }, maxRotation: 45 }
          },
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(255,255,255,0.06)' },
            ticks: {
              color: '#20c997',
              font: { size: 11 },
              callback: (val: any) => '$' + val.toLocaleString()
            }
          }
        }
      }
    });
  }

  private formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}
