import { Component, OnInit, HostListener, ElementRef, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CrmAdsService, AdsDailyRow, AdsTotals, AdsPeriod, AdsQuery } from '../../../../services/crm-ads.service';

@Component({
  selector: 'app-crm-ads',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './crm-ads.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./crm-ads.component.scss']
})
export class CrmAdsComponent implements OnInit {
  private adsService = inject(CrmAdsService);
  private host = inject(ElementRef);

  readonly rows = signal<AdsDailyRow[]>([]);
  readonly totals = signal<AdsTotals | null>(null);
  readonly loading = signal(false);
  readonly exporting = signal(false);
  readonly errorMessage = signal('');

  // Active preset. 'custom' means the from/to inputs drive the range.
  readonly period = signal<AdsPeriod>('last30');

  // Range preset dropdown open state.
  readonly dropdownOpen = signal(false);

  // Date inputs are yyyy-MM-dd (account timezone / Eastern, same as the ad data).
  readonly fromDate = signal('');
  readonly toDate = signal('');

  // Paging
  readonly page = signal(1);
  pageSize = 10;
  readonly totalCount = signal(0);
  readonly totalPages = signal(0);

  readonly presets: { key: AdsPeriod; label: string }[] = [
    { key: 'last30', label: 'Last 30 days' },
    { key: 'week', label: 'This week' },
    { key: 'month', label: 'This month' },
    { key: 'year', label: 'This year' },
    { key: 'all', label: 'All time' }
  ];

  ngOnInit(): void {
    this.load(); // defaults to "Last 30 days"
  }

  // ── Range selection ──

  /** Label shown on the dropdown trigger for the current range. */
  get rangeLabel(): string {
    if (this.period() === 'custom') return 'Custom range';
    return this.presets.find(p => p.key === this.period())?.label ?? 'Select range';
  }

  toggleDropdown(): void {
    this.dropdownOpen.set(!this.dropdownOpen());
  }

  selectPreset(p: AdsPeriod): void {
    this.dropdownOpen.set(false);
    this.period.set(p);
    this.page.set(1);
    this.load();
  }

  applyCustom(): void {
    this.period.set('custom');
    this.page.set(1);
    this.load();
  }

  // Close the dropdown when clicking anywhere outside this component.
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.dropdownOpen() && !this.host.nativeElement.contains(event.target)) {
      this.dropdownOpen.set(false);
    }
  }

  // ── Loading ──

  load(): void {
    this.loading.set(true);
    this.errorMessage.set('');
    this.adsService.getDaily(this.buildQuery(true)).subscribe({
      next: res => {
        this.rows.set(res.items);
        this.totals.set(res.totals);
        this.page.set(res.page);
        this.pageSize = res.pageSize;
        this.totalCount.set(res.totalCount);
        this.totalPages.set(res.totalPages);
        // Reflect the resolved range back into the date inputs (esp. for presets / "all time").
        this.fromDate.set((res.from || '').slice(0, 10));
        this.toDate.set((res.to || '').slice(0, 10));
        this.loading.set(false);
      },
      error: () => { this.errorMessage.set('Failed to load ads data.'); this.loading.set(false); }
    });
  }

  // ── Paging ──

  nextPage(): void {
    if (this.page() < this.totalPages()) { this.page.update(v => v + 1); this.load(); }
  }

  prevPage(): void {
    if (this.page() > 1) { this.page.update(v => v - 1); this.load(); }
  }

  // ── Export ──

  downloadExcel(): void {
    this.exporting.set(true);
    this.adsService.exportExcel(this.buildQuery(false)).subscribe({
      next: blob => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dream-cleaning-ads_${this.fromDate()}_${this.toDate()}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        this.exporting.set(false);
      },
      error: () => { this.errorMessage.set('Failed to export ads data.'); this.exporting.set(false); }
    });
  }

  trackByDate(_: number, row: AdsDailyRow): string { return row.date; }

  // ── Ad-efficiency KPIs (derived from the range totals) ──

  /** Ad spend ÷ clicks. */
  get costPerClick(): number {
    if (!this.totals() || this.totals()!.clicks <= 0) return 0;
    return this.totals()!.adSpend / this.totals()!.clicks;
  }

  /** Ad spend ÷ Google-reported conversions. */
  get costPerConversion(): number {
    if (!this.totals() || this.totals()!.googleConversions <= 0) return 0;
    return this.totals()!.adSpend / this.totals()!.googleConversions;
  }

  /** Ad spend ÷ booked orders (all sources — the real jobs the spend ran alongside). */
  get costPerBooked(): number {
    if (!this.totals() || this.totals()!.bookedOrders <= 0) return 0;
    return this.totals()!.adSpend / this.totals()!.bookedOrders;
  }

  /** Build the query for the current range. `paged` false = export (whole range, no page). */
  private buildQuery(paged: boolean): AdsQuery {
    const q: AdsQuery = this.period() === 'custom'
      ? { from: this.fromDate() || undefined, to: this.toDate() || undefined }
      : { period: this.period() };
    if (paged) { q.page = this.page(); q.pageSize = this.pageSize; }
    return q;
  }
}
