import { Component, OnInit, HostListener, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CrmKeywordsService, KeywordsPeriod, KeywordsQuery,
  OrganicKeywordRow, OrganicTotals, PaidKeywordRow, PaidTotals
} from '../../../../services/crm-keywords.service';

/**
 * Company "Keywords" tab: what people search to find us — organic (Google Search Console) and paid
 * (Google Ads search terms) side by side, so the owner can spot what's working and what needs
 * attention. Shares one range picker; each table paginates independently. Mirrors the Ads/Traffic
 * tabs' toolbar + export patterns (self-contained SCSS copy since component styles are scoped).
 */
@Component({
  selector: 'app-keywords',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './keywords.component.html',
  styleUrls: ['./keywords.component.scss']
})
export class KeywordsComponent implements OnInit {
  // Organic (Search Console)
  organic: OrganicKeywordRow[] = [];
  organicTotals: OrganicTotals | null = null;
  organicPage = 1;
  organicPageSize = 25;
  organicTotalCount = 0;
  organicTotalPages = 0;
  loadingOrganic = false;

  // Paid (Google Ads search terms)
  paid: PaidKeywordRow[] = [];
  paidTotals: PaidTotals | null = null;
  paidPage = 1;
  paidPageSize = 25;
  paidTotalCount = 0;
  paidTotalPages = 0;
  loadingPaid = false;

  exporting = false;
  errorMessage = '';

  period: KeywordsPeriod = 'last30';
  dropdownOpen = false;
  fromDate = '';
  toDate = '';

  readonly presets: { key: KeywordsPeriod; label: string }[] = [
    { key: 'last30', label: 'Last 30 days' },
    { key: 'week', label: 'This week' },
    { key: 'month', label: 'This month' },
    { key: 'year', label: 'This year' },
    { key: 'all', label: 'All time' }
  ];

  constructor(private keywordsService: CrmKeywordsService, private host: ElementRef) {}

  ngOnInit(): void {
    this.loadAll();
  }

  // ── Range ──

  get rangeLabel(): string {
    if (this.period === 'custom') return 'Custom range';
    return this.presets.find(p => p.key === this.period)?.label ?? 'Select range';
  }

  toggleDropdown(): void { this.dropdownOpen = !this.dropdownOpen; }

  selectPreset(p: KeywordsPeriod): void {
    this.dropdownOpen = false;
    this.period = p;
    this.resetPages();
    this.loadAll();
  }

  applyCustom(): void {
    this.period = 'custom';
    this.resetPages();
    this.loadAll();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.dropdownOpen && !this.host.nativeElement.contains(event.target)) {
      this.dropdownOpen = false;
    }
  }

  private resetPages(): void {
    this.organicPage = 1;
    this.paidPage = 1;
  }

  // ── Loading ──

  loadAll(): void {
    this.loadOrganic();
    this.loadPaid();
  }

  loadOrganic(): void {
    this.loadingOrganic = true;
    this.keywordsService.getOrganic(this.buildQuery(this.organicPage, this.organicPageSize)).subscribe({
      next: res => {
        this.organic = res.items;
        this.organicTotals = res.totals;
        this.organicPage = res.page;
        this.organicPageSize = res.pageSize;
        this.organicTotalCount = res.totalCount;
        this.organicTotalPages = res.totalPages;
        // Reflect the resolved range into the date inputs once (organic returns first).
        this.fromDate = (res.from || '').slice(0, 10);
        this.toDate = (res.to || '').slice(0, 10);
        this.loadingOrganic = false;
      },
      error: () => { this.errorMessage = 'Failed to load organic keywords.'; this.loadingOrganic = false; }
    });
  }

  loadPaid(): void {
    this.loadingPaid = true;
    this.keywordsService.getPaid(this.buildQuery(this.paidPage, this.paidPageSize)).subscribe({
      next: res => {
        this.paid = res.items;
        this.paidTotals = res.totals;
        this.paidPage = res.page;
        this.paidPageSize = res.pageSize;
        this.paidTotalCount = res.totalCount;
        this.paidTotalPages = res.totalPages;
        this.loadingPaid = false;
      },
      error: () => { this.errorMessage = 'Failed to load paid keywords.'; this.loadingPaid = false; }
    });
  }

  // ── Paging (independent per table) ──

  organicNext(): void { if (this.organicPage < this.organicTotalPages) { this.organicPage++; this.loadOrganic(); } }
  organicPrev(): void { if (this.organicPage > 1) { this.organicPage--; this.loadOrganic(); } }
  paidNext(): void { if (this.paidPage < this.paidTotalPages) { this.paidPage++; this.loadPaid(); } }
  paidPrev(): void { if (this.paidPage > 1) { this.paidPage--; this.loadPaid(); } }

  // ── Export ──

  downloadExcel(): void {
    this.exporting = true;
    this.keywordsService.exportExcel(this.buildQuery()).subscribe({
      next: blob => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dream-cleaning-keywords_${this.fromDate}_${this.toDate}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        this.exporting = false;
      },
      error: () => { this.errorMessage = 'Failed to export keywords.'; this.exporting = false; }
    });
  }

  trackByQuery(_: number, row: OrganicKeywordRow): string { return row.query; }
  trackByTerm(_: number, row: PaidKeywordRow): string { return row.searchTerm; }

  private buildQuery(page?: number, pageSize?: number): KeywordsQuery {
    const q: KeywordsQuery = this.period === 'custom'
      ? { from: this.fromDate || undefined, to: this.toDate || undefined }
      : { period: this.period };
    if (page != null) { q.page = page; q.pageSize = pageSize; }
    return q;
  }
}
