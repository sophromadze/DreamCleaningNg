import { Component, OnInit, HostListener, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CrmTrafficService, TrafficDailyRow, TrafficTotals,
  TrafficPeriod, TrafficQuery, TrafficChannelBreakdownRow
} from '../../../../services/crm-traffic.service';

/**
 * Company "Traffic" tab: first-party visits by channel (sessions), independent of ad spend.
 * Classic acquisition matrix (2026-07-25 redesign) — one plain column per channel plus a Total,
 * a range-total footer, and a simple summary table. No chart, no color dots. The channel filter
 * (plain checkboxes) toggles which channel COLUMNS are shown, narrowing the totals to match.
 */
@Component({
  selector: 'app-traffic',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './traffic.component.html',
  styleUrls: ['./traffic.component.scss']
})
export class TrafficComponent implements OnInit {
  rows: TrafficDailyRow[] = [];
  breakdown: TrafficChannelBreakdownRow[] = [];
  totals: TrafficTotals | null = null;
  loading = false;
  exporting = false;
  errorMessage = '';

  period: TrafficPeriod = 'last30';
  dropdownOpen = false;
  fromDate = '';
  toDate = '';

  page = 1;
  pageSize = 20;
  totalCount = 0;
  totalPages = 0;

  readonly presets: { key: TrafficPeriod; label: string }[] = [
    { key: 'last30', label: 'Last 30 days' },
    { key: 'week', label: 'This week' },
    { key: 'month', label: 'This month' },
    { key: 'year', label: 'This year' },
    { key: 'all', label: 'All time' }
  ];

  // Sessions only carry these web channels (never Phone/Unknown or Unattributed). Fixed column
  // order — every channel gets a column by default, even if it's zero across the range.
  readonly legendChannels: string[] = [
    'Organic Search', 'Paid Search', 'AI Assistant', 'Direct', 'Referral', 'Social', 'Email', 'Unassigned'
  ];

  // Short display labels (the stored channel keeps its full name so the filter + export still work).
  private static readonly DISPLAY: Record<string, string> = {
    'Organic Search': 'Organic',
    'Paid Search': 'Paid'
  };

  /** Short label for a channel column/row (falls back to the full name). */
  displayChannel(channel: string): string {
    return TrafficComponent.DISPLAY[channel] ?? channel;
  }

  constructor(private trafficService: CrmTrafficService, private host: ElementRef) {}

  ngOnInit(): void {
    this.load();
  }

  // ── Range ──

  get rangeLabel(): string {
    if (this.period === 'custom') return 'Custom range';
    return this.presets.find(p => p.key === this.period)?.label ?? 'Select range';
  }

  toggleDropdown(): void { this.dropdownOpen = !this.dropdownOpen; }

  selectPreset(p: TrafficPeriod): void {
    this.dropdownOpen = false;
    this.period = p;
    this.page = 1;
    this.load();
  }

  applyCustom(): void {
    this.period = 'custom';
    this.page = 1;
    this.load();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.dropdownOpen && !this.host.nativeElement.contains(event.target)) {
      this.dropdownOpen = false;
    }
  }

  // ── Loading ──

  load(): void {
    this.loading = true;
    this.errorMessage = '';
    this.trafficService.getDaily(this.buildQuery(true)).subscribe({
      next: res => {
        this.rows = res.items;
        this.breakdown = res.channelBreakdown || [];
        this.totals = res.totals;
        this.page = res.page;
        this.pageSize = res.pageSize;
        this.totalCount = res.totalCount;
        this.totalPages = res.totalPages;
        this.fromDate = (res.from || '').slice(0, 10);
        this.toDate = (res.to || '').slice(0, 10);
        this.loading = false;
      },
      error: () => { this.errorMessage = 'Failed to load traffic data.'; this.loading = false; }
    });
  }

  nextPage(): void { if (this.page < this.totalPages) { this.page++; this.load(); } }
  prevPage(): void { if (this.page > 1) { this.page--; this.load(); } }

  // ── Export ──

  downloadExcel(): void {
    this.exporting = true;
    const query = this.buildQuery(false);
    if (!this.allChannelsSelected) {
      query.channels = this.legendChannels.filter(c => this.selectedChannels.has(c)).join(',');
    }
    this.trafficService.exportExcel(query).subscribe({
      next: blob => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dream-cleaning-traffic_${this.fromDate}_${this.toDate}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        this.exporting = false;
      },
      error: () => { this.errorMessage = 'Failed to export traffic data.'; this.exporting = false; }
    });
  }

  trackByDate(_: number, row: TrafficDailyRow): string { return row.date; }
  trackByChannel(_: number, row: TrafficChannelBreakdownRow): string { return row.channel; }
  trackByChannelName(_: number, channel: string): string { return channel; }

  // ── Channel filter (plain checkboxes) — toggles which channel COLUMNS are shown ──
  // All getters here are PURE (no state writes) to avoid NG0100.

  selectedChannels = new Set<string>(this.legendChannels);

  isChannelSelected(channel: string): boolean { return this.selectedChannels.has(channel); }

  toggleChannel(channel: string): void {
    if (this.selectedChannels.has(channel)) this.selectedChannels.delete(channel);
    else this.selectedChannels.add(channel);
  }

  get allChannelsSelected(): boolean {
    return this.selectedChannels.size >= this.legendChannels.length;
  }

  selectAllChannels(): void {
    this.selectedChannels = new Set<string>(this.legendChannels);
  }

  /** Ordered channel columns currently shown (canonical order, filtered by the checkboxes). */
  get visibleColumns(): string[] {
    return this.legendChannels.filter(ch => this.selectedChannels.has(ch));
  }

  // ── Cell / row / footer values ──

  /** Sessions for one day in one channel (0 if that channel had none). */
  sessionsFor(row: TrafficDailyRow, channel: string): number {
    return row.channels.find(c => c.channel === channel)?.count ?? 0;
  }

  /** A day's total across the currently-shown channels. */
  filteredSessions(row: TrafficDailyRow): number {
    if (this.allChannelsSelected) return row.sessions;
    return row.channels.reduce((sum, c) => this.selectedChannels.has(c.channel) ? sum + c.count : sum, 0);
  }

  /** Range total for one channel (from the aggregate breakdown) — feeds the footer row. */
  channelRangeTotal(channel: string): number {
    return this.breakdown.find(c => c.channel === channel)?.sessions ?? 0;
  }

  /** Range total across the currently-shown channels (footer grand total + hero card). */
  get filteredSessionsTotal(): number {
    if (!this.totals) return 0;
    if (this.allChannelsSelected) return this.totals.sessions;
    return this.breakdown.reduce((sum, c) => this.selectedChannels.has(c.channel) ? sum + c.sessions : sum, 0);
  }

  // ── Summary table (Sessions by channel) ──

  get visibleBreakdown(): TrafficChannelBreakdownRow[] {
    if (this.allChannelsSelected) return this.breakdown;
    return this.breakdown.filter(c => this.selectedChannels.has(c.channel));
  }

  channelPercent(row: TrafficChannelBreakdownRow): number {
    if (this.allChannelsSelected) return row.percentOfTotal;
    const total = this.filteredSessionsTotal;
    return total > 0 ? Math.round(row.sessions / total * 1000) / 10 : 0;
  }

  /** True when the range includes recent days still on raw first-party counts (drives the footnote). */
  get hasProvisional(): boolean {
    return this.rows.some(r => r.provisional);
  }

  private buildQuery(paged: boolean): TrafficQuery {
    const q: TrafficQuery = this.period === 'custom'
      ? { from: this.fromDate || undefined, to: this.toDate || undefined }
      : { period: this.period };
    if (paged) { q.page = this.page; q.pageSize = this.pageSize; }
    return q;
  }
}
