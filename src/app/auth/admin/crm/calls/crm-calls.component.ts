import { Component, EventEmitter, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CrmCallService, CallRecord, CallSummary } from '../../../../services/crm-call.service';

@Component({
  selector: 'app-crm-calls',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './crm-calls.component.html',
  styleUrls: ['./crm-calls.component.scss']
})
export class CrmCallsComponent implements OnInit {
  /** Emits a leadId when a linked lead is clicked, so the parent can open it in the Leads tab. */
  @Output() openLead = new EventEmitter<number>();

  calls: CallRecord[] = [];
  summary: CallSummary | null = null;
  loading = false;
  exporting = false;
  errorMessage = '';

  // Filters (date inputs are yyyy-MM-dd)
  fromDate = '';
  toDate = '';
  directionFilter = '';
  categoryFilter = '';            // '' = All
  hideNonCustomer = true;         // "Hide cleaners & spam" — default ON
  adOnly = false;                 // "Ad calls only" — independent of the filters above

  reclassifying = false;

  // Paging
  page = 1;
  pageSize = 20;
  totalCount = 0;
  totalPages = 0;

  constructor(private callService: CrmCallService) {}

  ngOnInit(): void {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    this.fromDate = this.toInputDate(first);
    this.toDate = this.toInputDate(now);
    this.load();
  }

  // ── Loading ──

  load(): void {
    this.loadCalls();
    this.loadSummary();
  }

  loadCalls(): void {
    this.loading = true;
    this.errorMessage = '';
    // A specific category selection overrides the hide toggle (no contradiction).
    const hasCategory = !!this.categoryFilter;
    this.callService.getCalls({
      from: this.fromIso(),
      to: this.toIso(),
      direction: this.directionFilter || undefined,
      category: this.categoryFilter || undefined,
      excludeNonCustomer: !hasCategory && this.hideNonCustomer,
      adOnly: this.adOnly,
      page: this.page,
      pageSize: this.pageSize
    }).subscribe({
      next: res => {
        this.calls = res.items;
        this.totalCount = res.totalCount;
        this.totalPages = res.totalPages;
        this.loading = false;
      },
      error: () => { this.errorMessage = 'Failed to load calls.'; this.loading = false; }
    });
  }

  loadSummary(): void {
    // Summary is scoped to date + direction so the breakdown always shows the full picture.
    this.callService.getSummary({
      from: this.fromIso(),
      to: this.toIso(),
      direction: this.directionFilter || undefined
    }).subscribe({
      next: s => this.summary = s,
      error: () => { /* summary is non-critical */ }
    });
  }

  applyFilters(): void {
    this.page = 1;
    this.load();
  }

  onHideToggle(): void {
    this.page = 1;
    this.loadCalls();
  }

  /** "Ad calls only" toggle — composes with the category/hide filters. */
  onAdOnlyToggle(): void {
    this.page = 1;
    this.loadCalls();
  }

  /** Calls hidden by the "hide cleaners & spam" toggle (from the full-scope summary). */
  get hiddenCount(): number {
    if (!this.summary) return 0;
    return this.summary.cleaner + this.summary.spam;
  }

  // ── Paging ──

  nextPage(): void {
    if (this.page < this.totalPages) { this.page++; this.loadCalls(); }
  }

  prevPage(): void {
    if (this.page > 1) { this.page--; this.loadCalls(); }
  }

  // ── Export ──

  downloadExcel(): void {
    this.exporting = true;
    const hasCategory = !!this.categoryFilter;
    this.callService.exportExcel({
      from: this.fromIso(),
      to: this.toIso(),
      direction: this.directionFilter || undefined,
      category: this.categoryFilter || undefined,
      excludeNonCustomer: !hasCategory && this.hideNonCustomer,
      adOnly: this.adOnly
    }).subscribe({
      next: blob => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dream-cleaning-calls_${this.fromDate}_${this.toDate}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        this.exporting = false;
      },
      error: () => { this.errorMessage = 'Failed to export calls.'; this.exporting = false; }
    });
  }

  // ── Reclassify backfill ──

  reclassify(): void {
    if (this.reclassifying) return;
    this.reclassifying = true;
    this.errorMessage = '';
    this.callService.reclassify().subscribe({
      next: () => { this.reclassifying = false; this.load(); },
      error: () => { this.errorMessage = 'Failed to reclassify calls.'; this.reclassifying = false; }
    });
  }

  // ── Lead link ──

  goToLead(leadId: number, event: Event): void {
    event.preventDefault();
    this.openLead.emit(leadId);
  }

  // ── Display helpers ──

  formatDuration(seconds: number): string {
    if (!seconds || seconds < 0) seconds = 0;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  resultClass(result: string): string {
    const r = (result || '').toLowerCase();
    if (r === 'accepted') return 'result-accepted';
    if (r === 'missed') return 'result-missed';
    if (r === 'voicemail') return 'result-voicemail';
    return 'result-other';
  }

  categoryClass(category: string): string {
    return 'cat-' + (category || 'unknown').toLowerCase();
  }

  trackByCallId(_: number, call: CallRecord): number { return call.id; }

  // ── Date helpers ──

  private toInputDate(d: Date): string {
    const y = d.getFullYear();
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /** Start of the from-day in UTC. */
  private fromIso(): string | undefined {
    return this.fromDate ? `${this.fromDate}T00:00:00Z` : undefined;
  }

  /** End of the to-day in UTC. */
  private toIso(): string | undefined {
    return this.toDate ? `${this.toDate}T23:59:59Z` : undefined;
  }
}
