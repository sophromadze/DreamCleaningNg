import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  InvoiceService, InvoiceStatus, MyInvoiceListItem
} from '../../services/invoice.service';
import { extractApiErrorMessage } from '../../utils/http-error.utils';

/**
 * "My Invoices" for business customers: every invoice issued against their own commercial client,
 * alongside My Contracts in the account area.
 *
 * ══ SCOPE ══
 *
 * Ownership is enforced entirely SERVER-SIDE, through
 * `ContractClient.SourceUserId == the signed-in user`. This page asks for "my invoices" and never
 * for an invoice by id, so there is nothing here to iterate or guess.
 *
 * EVERY issued invoice is listed, not only the paid ones — open, processing, paid, overdue and
 * void. Seeing what is outstanding is the point of the page, and hiding an unpaid invoice from the
 * person who owes it would be perverse. A DRAFT is never returned: it has not been issued, its
 * figures may still be wrong, and nobody has decided to bill it.
 *
 * ══ WHY OPENING ONE LEAVES THIS PAGE ══
 *
 * Viewing and paying an invoice already exist, complete, on the token-addressed public page: the
 * totals, the tax breakdown, the ACH fee quote before authorization, Stripe checkout, the manual
 * bank block and the PDF. This list hands the customer their own invoices' tokens and sends them
 * there. Rebuilding a second detail-and-payment surface would be a second place for the payment
 * rules to drift, which matters more than a tidier URL.
 */
@Component({
  selector: 'app-my-invoices',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './my-invoices.component.html',
  // The contract review sheet is the single source for the client-facing chrome, exactly as
  // My Contracts does it; this component's own sheet adds only the list.
  styleUrls: [
    '../../contract/contract-review/contract-review.component.scss',
    './my-invoices.component.scss'
  ]
})
export class MyInvoicesComponent implements OnInit {
  private invoices = inject(InvoiceService);
  private router = inject(Router);

  readonly InvoiceStatus = InvoiceStatus;

  rows: MyInvoiceListItem[] = [];
  loading = true;
  errorMessage = '';

  ngOnInit(): void {
    this.invoices.myInvoices().subscribe({
      next: rows => { this.rows = rows; this.loading = false; },
      error: err => {
        this.errorMessage = extractApiErrorMessage(err, 'We could not load your invoices.');
        this.loading = false;
      }
    });
  }

  /** Opens the invoice on its own page — the same address the emailed link uses. */
  open(row: MyInvoiceListItem): void {
    this.router.navigate(['/invoice', row.publicToken]);
  }

  /**
   * What the customer is actually being asked for, summed across everything unsettled.
   *
   * Excludes anything already authorized and settling: for those few days the customer HAS paid as
   * far as they are concerned, and putting the amount back into an "outstanding" headline would
   * read as a demand for money already sent.
   */
  get totalOutstanding(): number {
    return this.rows
      .filter(r => r.balanceDue > 0 && !r.paymentInProgress && r.status !== InvoiceStatus.Void)
      .reduce((sum, r) => sum + r.balanceDue, 0);
  }

  get overdueCount(): number {
    return this.rows.filter(r => r.status === InvoiceStatus.Overdue && !r.paymentInProgress).length;
  }

  /**
   * The badge text.
   *
   * "Processing" OUTRANKS the stored status, and that is the important case: an ACH debit takes
   * days to settle, during which the invoice legitimately still reads Sent or Overdue. Showing a
   * customer "Overdue" on an invoice they authorized on Monday is the most annoying thing this
   * page could do.
   */
  statusLabel(row: MyInvoiceListItem): string {
    return row.paymentInProgress ? 'Processing' : row.statusLabel;
  }

  statusClass(row: MyInvoiceListItem): string {
    if (row.paymentInProgress) return 'processing';

    switch (row.status) {
      case InvoiceStatus.Paid: return 'paid';
      case InvoiceStatus.Overdue: return 'overdue';
      case InvoiceStatus.Void: return 'void';
      case InvoiceStatus.PartiallyPaid: return 'partial';
      default: return 'open';
    }
  }
}
