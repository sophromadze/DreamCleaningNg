import { Component, OnChanges, OnInit, SimpleChanges, ChangeDetectionStrategy, inject, signal, computed, model } from '@angular/core';
import { readableLabelColor } from '../../../../shared/admin/readable-label-color';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  CrmCustomerService, CrmCustomer, CrmCustomerDetail, CustomerListFilters
} from '../../../../services/crm-customer.service';

@Component({
  selector: 'app-crm-customers',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './crm-customers.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./crm-customers.component.scss']
})
export class CrmCustomersComponent implements OnInit, OnChanges {
  private customerService = inject(CrmCustomerService);

  /** Colours here are chosen by admins/users and shown as stored; the text on them adapts (AA, 2026-10). */
  readonly labelColor = readableLabelColor;
  /** Set by the CRM shell when a segment card is clicked. Empty = all customers. */
  readonly segmentFilter = model('');

  readonly customers = signal<CrmCustomer[]>([], { equal: () => false });
  readonly total = signal(0);
  readonly page = signal(1);
  pageSize = 10;
  readonly loading = signal(false);
  readonly errorMessage = signal('');

  readonly searchTerm = signal('');
  readonly sort = signal<CustomerListFilters['sort']>('recent');
  private searchDebounce: any;

  // Detail panel
  readonly selected = signal<CrmCustomerDetail | null>(null, { equal: () => false });
  readonly panelLoading = signal(false);

  // Tags
  readonly newTagLabel = signal('');
  readonly tagSuggestions = signal<string[]>([]);
  readonly addingTag = signal(false);

  ngOnInit(): void {
    this.load();
    this.customerService.getTagSuggestions().subscribe({
      next: s => this.tagSuggestions.set(s),
      error: () => { /* non-critical */ }
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['segmentFilter'] && !changes['segmentFilter'].firstChange) {
      this.page.set(1);
      this.load();
    }
  }

  readonly totalPages = computed<number>(() => Math.max(1, Math.ceil(this.total() / this.pageSize)));

  load(): void {
    this.loading.set(true);
    this.errorMessage.set('');
    this.customerService.getCustomers({
      search: this.searchTerm().trim() || undefined,
      segment: this.segmentFilter() || undefined,
      sort: this.sort(),
      page: this.page(),
      pageSize: this.pageSize
    }).subscribe({
      next: res => {
        this.customers.set(res.items);
        this.total.set(res.total);
        this.loading.set(false);
      },
      error: () => { this.errorMessage.set('Failed to load customers.'); this.loading.set(false); }
    });
  }

  onSearchChange(): void {
    clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => { this.page.set(1); this.load(); }, 300);
  }

  onSortChange(): void { this.page.set(1); this.load(); }

  clearSegmentFilter(): void {
    this.segmentFilter.set('');
    this.page.set(1);
    this.load();
  }

  goToPage(p: number): void {
    if (p < 1 || p > this.totalPages() || p === this.page()) return;
    this.page.set(p);
    this.load();
  }

  /** Middle page numbers (excluding first/last) — mirrors the admin Users tab pagination. */
  getVisiblePages(): number[] {
    const pages: number[] = [];
    const maxVisiblePages = 3;

    if (this.totalPages() <= 5) {
      for (let i = 2; i < this.totalPages(); i++) pages.push(i);
    } else {
      let start = Math.max(2, this.page() - 1);
      let end = Math.min(this.totalPages() - 1, start + maxVisiblePages - 1);
      if (end === this.totalPages() - 1) start = Math.max(2, end - maxVisiblePages + 1);
      for (let i = start; i <= end; i++) pages.push(i);
    }

    return pages;
  }

  // ── Detail panel ──

  openCustomer(c: CrmCustomer): void {
    this.panelLoading.set(true);
    this.selected.set({ ...(c as CrmCustomerDetail), recentOrders: [] });
    this.newTagLabel.set('');
    this.customerService.getCustomer(c.id).subscribe({
      next: detail => { this.selected.set(detail); this.panelLoading.set(false); },
      error: () => { this.errorMessage.set('Failed to load customer.'); this.panelLoading.set(false); }
    });
  }

  closePanel(): void { this.selected.set(null); }

  // ── Tags ──

  addTag(): void {
    if (!this.selected() || !this.newTagLabel().trim()) return;
    this.addingTag.set(true);
    const id = this.selected()!.id;
    this.customerService.addTag(id, this.newTagLabel().trim()).subscribe({
      next: tag => {
        if (this.selected()?.id === id) { this.selected()!.tags = [...this.selected()!.tags, tag]; this.selected.set(this.selected()); }
        if (!this.tagSuggestions().includes(tag.label)) this.tagSuggestions.set([...this.tagSuggestions(), tag.label].sort());
        this.newTagLabel.set('');
        this.addingTag.set(false);
        this.syncTagsToList(id);
      },
      error: err => {
        this.errorMessage.set(err?.error?.message || 'Failed to add tag.');
        this.addingTag.set(false);
      }
    });
  }

  removeTag(tagId: number): void {
    if (!this.selected()) return;
    const id = this.selected()!.id;
    this.customerService.deleteTag(tagId).subscribe({
      next: () => {
        if (this.selected()?.id === id) { this.selected()!.tags = this.selected()!.tags.filter(t => t.id !== tagId); this.selected.set(this.selected()); }
        this.syncTagsToList(id);
      },
      error: () => this.errorMessage.set('Failed to remove tag.')
    });
  }

  /** Keep the row in the list in sync with tag edits made in the panel. */
  private syncTagsToList(customerId: number): void {
    if (!this.selected()) return;
    const row = this.customers().find(c => c.id === customerId);
    if (row) { row.tags = [...this.selected()!.tags]; this.customers.set(this.customers()); }
  }

  // ── Display helpers ──

  lifecycleClass(stage: string): string {
    return 'lc-' + stage.toLowerCase();
  }

  segmentLabel(key: string): string {
    switch (key) {
      case 'new': return 'New';
      case 'active': return 'Active';
      case 'recurring': return 'Recurring';
      case 'vip': return 'VIP';
      case 'one_time': return 'One-time';
      case 'at_risk': return 'At-risk';
      case 'churned': return 'Churned';
      case 'prospect': return 'Prospect';
      default: return key;
    }
  }

  formatDate(iso?: string): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString();
  }

  trackById(_: number, c: CrmCustomer): number { return c.id; }
}
