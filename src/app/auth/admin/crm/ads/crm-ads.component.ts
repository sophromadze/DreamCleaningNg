import { Component, OnInit, HostListener, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CrmAdsService, AdsDailyRow, AdsTotals, AdsPeriod, AdsQuery } from '../../../../services/crm-ads.service';

@Component({
  selector: 'app-crm-ads',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './crm-ads.component.html',
  styleUrls: ['./crm-ads.component.scss']
})
export class CrmAdsComponent implements OnInit {
  rows: AdsDailyRow[] = [];
  totals: AdsTotals | null = null;
  loading = false;
  exporting = false;
  errorMessage = '';

  // Active preset. 'custom' means the from/to inputs drive the range.
  period: AdsPeriod = 'last30';

  // Range preset dropdown open state.
  dropdownOpen = false;

  // Date inputs are yyyy-MM-dd (account timezone / Eastern, same as the ad data).
  fromDate = '';
  toDate = '';

  // Paging
  page = 1;
  pageSize = 20;
  totalCount = 0;
  totalPages = 0;

  readonly presets: { key: AdsPeriod; label: string }[] = [
    { key: 'last30', label: 'Last 30 days' },
    { key: 'week', label: 'This week' },
    { key: 'month', label: 'This month' },
    { key: 'year', label: 'This year' },
    { key: 'all', label: 'All time' }
  ];

  constructor(private adsService: CrmAdsService, private host: ElementRef) {}

  ngOnInit(): void {
    this.load(); // defaults to "Last 30 days"
  }

  // ── Range selection ──

  /** Label shown on the dropdown trigger for the current range. */
  get rangeLabel(): string {
    if (this.period === 'custom') return 'Custom range';
    return this.presets.find(p => p.key === this.period)?.label ?? 'Select range';
  }

  toggleDropdown(): void {
    this.dropdownOpen = !this.dropdownOpen;
  }

  selectPreset(p: AdsPeriod): void {
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

  // Close the dropdown when clicking anywhere outside this component.
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
    this.adsService.getDaily(this.buildQuery(true)).subscribe({
      next: res => {
        this.rows = res.items;
        this.totals = res.totals;
        this.page = res.page;
        this.pageSize = res.pageSize;
        this.totalCount = res.totalCount;
        this.totalPages = res.totalPages;
        // Reflect the resolved range back into the date inputs (esp. for presets / "all time").
        this.fromDate = (res.from || '').slice(0, 10);
        this.toDate = (res.to || '').slice(0, 10);
        this.loading = false;
      },
      error: () => { this.errorMessage = 'Failed to load ads data.'; this.loading = false; }
    });
  }

  // ── Paging ──

  nextPage(): void {
    if (this.page < this.totalPages) { this.page++; this.load(); }
  }

  prevPage(): void {
    if (this.page > 1) { this.page--; this.load(); }
  }

  // ── Export ──

  downloadExcel(): void {
    this.exporting = true;
    this.adsService.exportExcel(this.buildQuery(false)).subscribe({
      next: blob => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dream-cleaning-ads_${this.fromDate}_${this.toDate}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        this.exporting = false;
      },
      error: () => { this.errorMessage = 'Failed to export ads data.'; this.exporting = false; }
    });
  }

  trackByDate(_: number, row: AdsDailyRow): string { return row.date; }

  /** Build the query for the current range. `paged` false = export (whole range, no page). */
  private buildQuery(paged: boolean): AdsQuery {
    const q: AdsQuery = this.period === 'custom'
      ? { from: this.fromDate || undefined, to: this.toDate || undefined }
      : { period: this.period };
    if (paged) { q.page = this.page; q.pageSize = this.pageSize; }
    return q;
  }
}
