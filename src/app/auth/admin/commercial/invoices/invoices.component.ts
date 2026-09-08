import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs/operators';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';

import {
  InvoiceService, InvoiceListItem, InvoiceSummary, InvoiceStatus, InvoicePaymentMethod,
  InvoiceClientOption, invoiceStatusClass
} from '../../../../services/invoice.service';
import { extractApiErrorMessage } from '../../../../utils/http-error.utils';

type DateRangeKey = 'all' | 'this-month' | 'last-month' | 'custom';

/**
 * Commercial Invoices - the list page.
 *
 * The summary cards come from the SERVER over the whole filtered set, not from the rows on screen:
 * a "Total outstanding" that only counted the current page would be quietly, confidently wrong.
 *
 * The row action menu renders from the server's own capability flags (canEdit, canVoid, ...) rather
 * than re-deriving them from the status here. A second copy of the state machine in the browser is
 * exactly how a "Mark as paid" button appears on an already-paid invoice.
 */
@Component({
  selector: 'app-commercial-invoices',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './invoices.component.html',
  styleUrls: ['./invoices.component.scss']
})
export class CommercialInvoicesComponent implements OnInit {
  private invoiceService = inject(InvoiceService);
  private router = inject(Router);

  readonly InvoiceStatus = InvoiceStatus;
  readonly statusClass = invoiceStatusClass;

  invoices: InvoiceListItem[] = [];
  summary: InvoiceSummary = {
    totalOutstanding: 0, paidThisMonth: 0, overdue: 0,
    draftCount: 0, overdueCount: 0, outstandingCount: 0
  };
  clients: InvoiceClientOption[] = [];

  loading = true;
  error = '';

  // Filters
  search = '';
  statusFilter: InvoiceStatus | null = null;
  clientFilter: number | null = null;
  paymentMethodFilter: InvoicePaymentMethod | null = null;
  dateRange: DateRangeKey = 'all';
  customFrom = '';
  customTo = '';

  page = 1;
  pageSize = 25;
  totalCount = 0;

  /** Which row's "..." menu is open. Null when none is. */
  openMenuId: number | null = null;

  private searchChanged = new Subject<string>();

  readonly statusOptions: { value: InvoiceStatus | null; label: string }[] = [
    { value: null, label: 'All statuses' },
    { value: InvoiceStatus.Draft, label: 'Draft' },
    { value: InvoiceStatus.Sent, label: 'Sent' },
    { value: InvoiceStatus.Viewed, label: 'Viewed' },
    { value: InvoiceStatus.PartiallyPaid, label: 'Partially Paid' },
    { value: InvoiceStatus.Paid, label: 'Paid' },
    { value: InvoiceStatus.Overdue, label: 'Overdue' },
    { value: InvoiceStatus.Void, label: 'Void' }
  ];

  readonly paymentMethodOptions: { value: InvoicePaymentMethod | null; label: string }[] = [
    { value: null, label: 'Any payment method' },
    { value: InvoicePaymentMethod.AchBankTransfer, label: 'ACH Bank Transfer' },
    { value: InvoicePaymentMethod.Card, label: 'Card' },
    { value: InvoicePaymentMethod.Other, label: 'Other' }
  ];

  readonly dateOptions: { value: DateRangeKey; label: string }[] = [
    { value: 'all', label: 'All time' },
    { value: 'this-month', label: 'This month' },
    { value: 'last-month', label: 'Last month' },
    { value: 'custom', label: 'Custom range' }
  ];

  ngOnInit(): void {
    // Debounced so typing a client name does not fire a request per keystroke.
    this.searchChanged.pipe(debounceTime(350), distinctUntilChanged())
      .subscribe(() => { this.page = 1; this.load(); });

    this.loadClients();
    this.load();
  }

  onSearchInput(): void {
    this.searchChanged.next(this.search);
  }

  onFilterChange(): void {
    this.page = 1;
    // A custom range with only one end filled in is still being typed - waiting avoids a
    // pointless round trip and a confusing empty table halfway through.
    if (this.dateRange === 'custom' && !(this.customFrom && this.customTo)) return;
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = '';

    const { from, to } = this.resolveDateRange();

    this.invoiceService.list({
      search: this.search.trim() || undefined,
      status: this.statusFilter,
      clientId: this.clientFilter,
      paymentMethod: this.paymentMethodFilter,
      fromDate: from,
      toDate: to,
      page: this.page,
      pageSize: this.pageSize
    })
      .pipe(finalize(() => this.loading = false))
      .subscribe({
        next: res => {
          this.invoices = res.invoices;
          this.summary = res.summary;
          this.totalCount = res.totalCount;
        },
        error: err => this.error = extractApiErrorMessage(err, 'Could not load invoices.')
      });
  }

  private loadClients(): void {
    this.invoiceService.clients().subscribe({
      next: list => this.clients = list,
      // A failed client list only costs the filter dropdown; the table is still usable.
      error: () => this.clients = []
    });
  }

  /** Turns the chosen preset into the two dates the API takes. */
  private resolveDateRange(): { from: string | null; to: string | null } {
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const now = new Date();

    switch (this.dateRange) {
      case 'this-month': {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        return { from: iso(start), to: iso(end) };
      }
      case 'last-month': {
        const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const end = new Date(now.getFullYear(), now.getMonth(), 0);
        return { from: iso(start), to: iso(end) };
      }
      case 'custom':
        return { from: this.customFrom || null, to: this.customTo || null };
      default:
        return { from: null, to: null };
    }
  }

  // ── Row actions ──

  toggleMenu(invoiceId: number, event: Event): void {
    event.stopPropagation();
    this.openMenuId = this.openMenuId === invoiceId ? null : invoiceId;
  }

  closeMenu(): void {
    this.openMenuId = null;
  }

  view(invoice: InvoiceListItem): void {
    this.router.navigate(['/admin/commercial/invoices', invoice.id]);
  }

  edit(invoice: InvoiceListItem, event: Event): void {
    event.stopPropagation();
    this.closeMenu();
    this.router.navigate(['/admin/commercial/invoices', invoice.id, 'edit']);
  }

  duplicate(invoice: InvoiceListItem, event: Event): void {
    event.stopPropagation();
    this.closeMenu();

    this.invoiceService.duplicate(invoice.id).subscribe({
      next: created => this.router.navigate(
        ['/admin/commercial/invoices', created.id, 'edit']),
      error: err => this.error = extractApiErrorMessage(err, 'Could not duplicate the invoice.')
    });
  }

  downloadPdf(invoice: InvoiceListItem, event: Event): void {
    event.stopPropagation();
    this.closeMenu();

    this.invoiceService.downloadPdf(invoice.id).subscribe({
      next: blob => this.saveBlob(blob, `Dream-Cleaning-Invoice-${invoice.invoiceNumber}.pdf`),
      error: err => this.error = extractApiErrorMessage(err, 'Could not download the invoice PDF.')
    });
  }

  /**
   * Copies the client-facing link. The list DTO deliberately does not carry the public token, so
   * the link is fetched from the detail endpoint at the moment it is asked for - the token stays
   * out of a payload that renders twenty-five rows at a time.
   */
  copyLink(invoice: InvoiceListItem, event: Event): void {
    event.stopPropagation();
    this.closeMenu();

    this.invoiceService.get(invoice.id).subscribe({
      next: detail => {
        navigator.clipboard?.writeText(detail.publicUrl).then(
          () => this.flash(`Invoice link for ${invoice.invoiceNumber} copied.`),
          () => this.error = 'Could not copy the link to the clipboard.');
      },
      error: err => this.error = extractApiErrorMessage(err, 'Could not build the invoice link.')
    });
  }

  notice = '';
  private flash(message: string): void {
    this.notice = message;
    setTimeout(() => this.notice = '', 4000);
  }

  private saveBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  // ── Paging ──

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.totalCount / this.pageSize));
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages) return;
    this.page = page;
    this.load();
  }

  /** Overdue rows get a tint; the badge alone is easy to miss when scanning a long table. */
  isOverdue(invoice: InvoiceListItem): boolean {
    return invoice.status === InvoiceStatus.Overdue;
  }

  /** Short label for the Payment column — the full names are too wide for a table cell. */
  paymentMethodLabel(method: InvoicePaymentMethod): string {
    switch (method) {
      case InvoicePaymentMethod.AchBankTransfer: return 'ACH';
      case InvoicePaymentMethod.Card: return 'Card';
      default: return 'Other';
    }
  }
}
