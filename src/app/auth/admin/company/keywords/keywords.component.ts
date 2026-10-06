import { Component, OnInit, HostListener, ElementRef, ChangeDetectionStrategy, inject, signal } from '@angular/core';
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./keywords.component.scss']
})
export class KeywordsComponent implements OnInit {
  private keywordsService = inject(CrmKeywordsService);
  private host = inject(ElementRef);

  // Organic (Search Console)
  readonly organic = signal<OrganicKeywordRow[]>([]);
  readonly organicTotals = signal<OrganicTotals | null>(null);
  readonly organicPage = signal(1);
  organicPageSize = 25;
  readonly organicTotalCount = signal(0);
  readonly organicTotalPages = signal(0);
  readonly loadingOrganic = signal(false);

  // Paid (Google Ads search terms)
  readonly paid = signal<PaidKeywordRow[]>([]);
  readonly paidTotals = signal<PaidTotals | null>(null);
  readonly paidPage = signal(1);
  paidPageSize = 25;
  readonly paidTotalCount = signal(0);
  readonly paidTotalPages = signal(0);
  readonly loadingPaid = signal(false);

  readonly exporting = signal(false);
  readonly errorMessage = signal('');

  readonly period = signal<KeywordsPeriod>('last30');
  readonly dropdownOpen = signal(false);
  readonly fromDate = signal('');
  readonly toDate = signal('');

  readonly presets: { key: KeywordsPeriod; label: string }[] = [
    { key: 'last30', label: 'Last 30 days' },
    { key: 'week', label: 'This week' },
    { key: 'month', label: 'This month' },
    { key: 'year', label: 'This year' },
    { key: 'all', label: 'All time' }
  ];

  ngOnInit(): void {
    this.loadAll();
  }

  // ── Range ──

  get rangeLabel(): string {
    if (this.period() === 'custom') return 'Custom range';
    return this.presets.find(p => p.key === this.period())?.label ?? 'Select range';
  }

  toggleDropdown(): void { this.dropdownOpen.set(!this.dropdownOpen()); }

  selectPreset(p: KeywordsPeriod): void {
    this.dropdownOpen.set(false);
    this.period.set(p);
    this.resetPages();
    this.loadAll();
  }

  applyCustom(): void {
    this.period.set('custom');
    this.resetPages();
    this.loadAll();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.dropdownOpen() && !this.host.nativeElement.contains(event.target)) {
      this.dropdownOpen.set(false);
    }
  }

  private resetPages(): void {
    this.organicPage.set(1);
    this.paidPage.set(1);
  }

  // ── Loading ──

  loadAll(): void {
    this.loadOrganic();
    this.loadPaid();
  }

  loadOrganic(): void {
    this.loadingOrganic.set(true);
    this.keywordsService.getOrganic(this.buildQuery(this.organicPage(), this.organicPageSize)).subscribe({
      next: res => {
        this.organic.set(res.items);
        this.organicTotals.set(res.totals);
        this.organicPage.set(res.page);
        this.organicPageSize = res.pageSize;
        this.organicTotalCount.set(res.totalCount);
        this.organicTotalPages.set(res.totalPages);
        // Reflect the resolved range into the date inputs once (organic returns first).
        this.fromDate.set((res.from || '').slice(0, 10));
        this.toDate.set((res.to || '').slice(0, 10));
        this.loadingOrganic.set(false);
      },
      error: () => { this.errorMessage.set('Failed to load organic keywords.'); this.loadingOrganic.set(false); }
    });
  }

  loadPaid(): void {
    this.loadingPaid.set(true);
    this.keywordsService.getPaid(this.buildQuery(this.paidPage(), this.paidPageSize)).subscribe({
      next: res => {
        this.paid.set(res.items);
        this.paidTotals.set(res.totals);
        this.paidPage.set(res.page);
        this.paidPageSize = res.pageSize;
        this.paidTotalCount.set(res.totalCount);
        this.paidTotalPages.set(res.totalPages);
        this.loadingPaid.set(false);
      },
      error: () => { this.errorMessage.set('Failed to load paid keywords.'); this.loadingPaid.set(false); }
    });
  }

  // ── Paging (independent per table) ──

  organicNext(): void { if (this.organicPage() < this.organicTotalPages()) { this.organicPage.update(v => v + 1); this.loadOrganic(); } }
  organicPrev(): void { if (this.organicPage() > 1) { this.organicPage.update(v => v - 1); this.loadOrganic(); } }
  paidNext(): void { if (this.paidPage() < this.paidTotalPages()) { this.paidPage.update(v => v + 1); this.loadPaid(); } }
  paidPrev(): void { if (this.paidPage() > 1) { this.paidPage.update(v => v - 1); this.loadPaid(); } }

  // ── Export ──

  downloadExcel(): void {
    this.exporting.set(true);
    this.keywordsService.exportExcel(this.buildQuery()).subscribe({
      next: blob => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dream-cleaning-keywords_${this.fromDate()}_${this.toDate()}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        this.exporting.set(false);
      },
      error: () => { this.errorMessage.set('Failed to export keywords.'); this.exporting.set(false); }
    });
  }

  trackByQuery(_: number, row: OrganicKeywordRow): string { return row.query; }
  trackByTerm(_: number, row: PaidKeywordRow): string { return row.searchTerm; }

  private buildQuery(page?: number, pageSize?: number): KeywordsQuery {
    const q: KeywordsQuery = this.period() === 'custom'
      ? { from: this.fromDate() || undefined, to: this.toDate() || undefined }
      : { period: this.period() };
    if (page != null) { q.page = page; q.pageSize = pageSize; }
    return q;
  }
}
