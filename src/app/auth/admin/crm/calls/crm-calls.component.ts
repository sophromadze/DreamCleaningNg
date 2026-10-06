import { Component, OnInit, ChangeDetectionStrategy, inject, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CrmCallService, CallRecord, CallSummary } from '../../../../services/crm-call.service';

@Component({
  selector: 'app-crm-calls',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './crm-calls.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./crm-calls.component.scss']
})
export class CrmCallsComponent implements OnInit {
  private callService = inject(CrmCallService);

  /** Emits a leadId when a linked lead is clicked, so the parent can open it in the Leads tab. */
  readonly openLead = output<number>();

  readonly calls = signal<CallRecord[]>([]);
  readonly summary = signal<CallSummary | null>(null);
  readonly loading = signal(false);
  readonly exporting = signal(false);
  readonly errorMessage = signal('');

  // Filters (date inputs are yyyy-MM-dd)
  readonly fromDate = signal('');
  readonly toDate = signal('');
  readonly directionFilter = signal('');
  readonly categoryFilter = signal('');            // '' = All
  readonly hideNonCustomer = signal(true);         // "Hide cleaners & spam" — default ON

  readonly reclassifying = signal(false);

  // Paging
  readonly page = signal(1);
  pageSize = 20;
  readonly totalCount = signal(0);
  readonly totalPages = signal(0);

  ngOnInit(): void {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    this.fromDate.set(this.toInputDate(first));
    this.toDate.set(this.toInputDate(now));
    this.load();
  }

  // ── Loading ──

  load(): void {
    this.loadCalls();
    this.loadSummary();
  }

  loadCalls(): void {
    this.loading.set(true);
    this.errorMessage.set('');
    // A specific category selection overrides the hide toggle (no contradiction).
    const hasCategory = !!this.categoryFilter();
    this.callService.getCalls({
      from: this.fromIso(),
      to: this.toIso(),
      direction: this.directionFilter() || undefined,
      category: this.categoryFilter() || undefined,
      excludeNonCustomer: !hasCategory && this.hideNonCustomer(),
      page: this.page(),
      pageSize: this.pageSize
    }).subscribe({
      next: res => {
        this.calls.set(res.items);
        this.totalCount.set(res.totalCount);
        this.totalPages.set(res.totalPages);
        this.loading.set(false);
      },
      error: () => { this.errorMessage.set('Failed to load calls.'); this.loading.set(false); }
    });
  }

  loadSummary(): void {
    // Summary is scoped to date + direction so the breakdown always shows the full picture.
    this.callService.getSummary({
      from: this.fromIso(),
      to: this.toIso(),
      direction: this.directionFilter() || undefined
    }).subscribe({
      next: s => this.summary.set(s),
      error: () => { /* summary is non-critical */ }
    });
  }

  applyFilters(): void {
    this.page.set(1);
    this.load();
  }

  onHideToggle(): void {
    this.page.set(1);
    this.loadCalls();
  }

  /** Calls hidden by the "hide cleaners & spam" toggle (from the full-scope summary). */
  get hiddenCount(): number {
    if (!this.summary()) return 0;
    return this.summary()!.cleaner + this.summary()!.spam;
  }

  // ── Paging ──

  nextPage(): void {
    if (this.page() < this.totalPages()) { this.page.update(v => v + 1); this.loadCalls(); }
  }

  prevPage(): void {
    if (this.page() > 1) { this.page.update(v => v - 1); this.loadCalls(); }
  }

  // ── Export ──

  downloadExcel(): void {
    this.exporting.set(true);
    const hasCategory = !!this.categoryFilter();
    this.callService.exportExcel({
      from: this.fromIso(),
      to: this.toIso(),
      direction: this.directionFilter() || undefined,
      category: this.categoryFilter() || undefined,
      excludeNonCustomer: !hasCategory && this.hideNonCustomer()
    }).subscribe({
      next: blob => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dream-cleaning-calls_${this.fromDate()}_${this.toDate()}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        this.exporting.set(false);
      },
      error: () => { this.errorMessage.set('Failed to export calls.'); this.exporting.set(false); }
    });
  }

  // ── Reclassify backfill ──

  reclassify(): void {
    if (this.reclassifying()) return;
    this.reclassifying.set(true);
    this.errorMessage.set('');
    this.callService.reclassify().subscribe({
      next: () => { this.reclassifying.set(false); this.load(); },
      error: () => { this.errorMessage.set('Failed to reclassify calls.'); this.reclassifying.set(false); }
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
    return this.fromDate() ? `${this.fromDate()}T00:00:00Z` : undefined;
  }

  /** End of the to-day in UTC. */
  private toIso(): string | undefined {
    return this.toDate() ? `${this.toDate()}T23:59:59Z` : undefined;
  }
}
