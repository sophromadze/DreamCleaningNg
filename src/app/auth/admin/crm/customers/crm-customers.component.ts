import { Component, Input, OnChanges, OnInit, SimpleChanges } from '@angular/core';
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
  styleUrls: ['./crm-customers.component.scss']
})
export class CrmCustomersComponent implements OnInit, OnChanges {
  /** Set by the CRM shell when a segment card is clicked. Empty = all customers. */
  @Input() segmentFilter = '';

  customers: CrmCustomer[] = [];
  total = 0;
  page = 1;
  pageSize = 10;
  loading = false;
  errorMessage = '';

  searchTerm = '';
  sort: CustomerListFilters['sort'] = 'recent';
  private searchDebounce: any;

  // Detail panel
  selected: CrmCustomerDetail | null = null;
  panelLoading = false;

  // Tags
  newTagLabel = '';
  tagSuggestions: string[] = [];
  addingTag = false;

  constructor(private customerService: CrmCustomerService) {}

  ngOnInit(): void {
    this.load();
    this.customerService.getTagSuggestions().subscribe({
      next: s => this.tagSuggestions = s,
      error: () => { /* non-critical */ }
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['segmentFilter'] && !changes['segmentFilter'].firstChange) {
      this.page = 1;
      this.load();
    }
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.total / this.pageSize));
  }

  load(): void {
    this.loading = true;
    this.errorMessage = '';
    this.customerService.getCustomers({
      search: this.searchTerm.trim() || undefined,
      segment: this.segmentFilter || undefined,
      sort: this.sort,
      page: this.page,
      pageSize: this.pageSize
    }).subscribe({
      next: res => {
        this.customers = res.items;
        this.total = res.total;
        this.loading = false;
      },
      error: () => { this.errorMessage = 'Failed to load customers.'; this.loading = false; }
    });
  }

  onSearchChange(): void {
    clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => { this.page = 1; this.load(); }, 300);
  }

  onSortChange(): void { this.page = 1; this.load(); }

  clearSegmentFilter(): void {
    this.segmentFilter = '';
    this.page = 1;
    this.load();
  }

  goToPage(p: number): void {
    if (p < 1 || p > this.totalPages || p === this.page) return;
    this.page = p;
    this.load();
  }

  /** Middle page numbers (excluding first/last) — mirrors the admin Users tab pagination. */
  getVisiblePages(): number[] {
    const pages: number[] = [];
    const maxVisiblePages = 3;

    if (this.totalPages <= 5) {
      for (let i = 2; i < this.totalPages; i++) pages.push(i);
    } else {
      let start = Math.max(2, this.page - 1);
      let end = Math.min(this.totalPages - 1, start + maxVisiblePages - 1);
      if (end === this.totalPages - 1) start = Math.max(2, end - maxVisiblePages + 1);
      for (let i = start; i <= end; i++) pages.push(i);
    }

    return pages;
  }

  // ── Detail panel ──

  openCustomer(c: CrmCustomer): void {
    this.panelLoading = true;
    this.selected = { ...(c as CrmCustomerDetail), recentOrders: [] };
    this.newTagLabel = '';
    this.customerService.getCustomer(c.id).subscribe({
      next: detail => { this.selected = detail; this.panelLoading = false; },
      error: () => { this.errorMessage = 'Failed to load customer.'; this.panelLoading = false; }
    });
  }

  closePanel(): void { this.selected = null; }

  // ── Tags ──

  addTag(): void {
    if (!this.selected || !this.newTagLabel.trim()) return;
    this.addingTag = true;
    const id = this.selected.id;
    this.customerService.addTag(id, this.newTagLabel.trim()).subscribe({
      next: tag => {
        if (this.selected?.id === id) this.selected.tags = [...this.selected.tags, tag];
        if (!this.tagSuggestions.includes(tag.label)) this.tagSuggestions = [...this.tagSuggestions, tag.label].sort();
        this.newTagLabel = '';
        this.addingTag = false;
        this.syncTagsToList(id);
      },
      error: err => {
        this.errorMessage = err?.error?.message || 'Failed to add tag.';
        this.addingTag = false;
      }
    });
  }

  removeTag(tagId: number): void {
    if (!this.selected) return;
    const id = this.selected.id;
    this.customerService.deleteTag(tagId).subscribe({
      next: () => {
        if (this.selected?.id === id) this.selected.tags = this.selected.tags.filter(t => t.id !== tagId);
        this.syncTagsToList(id);
      },
      error: () => this.errorMessage = 'Failed to remove tag.'
    });
  }

  /** Keep the row in the list in sync with tag edits made in the panel. */
  private syncTagsToList(customerId: number): void {
    if (!this.selected) return;
    const row = this.customers.find(c => c.id === customerId);
    if (row) row.tags = [...this.selected.tags];
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
