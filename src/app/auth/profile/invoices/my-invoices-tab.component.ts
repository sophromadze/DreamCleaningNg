import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { finalize } from 'rxjs';
import {
  CUSTOMER_INVOICE_STATUS_LABELS,
  CustomerInvoiceService,
  MyCustomerInvoice
} from '../../../services/customer-invoice.service';
import { extractApiErrorMessage } from '../../../utils/http-error.utils';

/**
 * Profile → Invoices (2026-09): the signed-in customer's OWN invoices, paid and unpaid. The
 * server scopes the list to the caller's account, so there is nothing here to filter; each row
 * opens the invoice's own page, where it can be paid or downloaded as a PDF.
 */
@Component({
  selector: 'app-my-invoices-tab',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './my-invoices-tab.component.html',
  styleUrls: ['./my-invoices-tab.component.scss']
})
export class MyInvoicesTabComponent implements OnInit {
  invoices: MyCustomerInvoice[] = [];
  loading = true;
  error = '';

  readonly statusLabels = CUSTOMER_INVOICE_STATUS_LABELS;

  constructor(private invoiceService: CustomerInvoiceService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = '';
    this.invoiceService.listMine()
      .pipe(finalize(() => this.loading = false))
      .subscribe({
        next: list => this.invoices = list,
        error: err => this.error = extractApiErrorMessage(err, 'Your invoices could not be loaded.')
      });
  }

  get unpaid(): MyCustomerInvoice[] {
    return this.invoices.filter(i => i.status === 'Sent' || i.status === 'NotSent');
  }

  get unpaidTotal(): number {
    return Math.round(this.unpaid.reduce((sum, i) => sum + i.amountDue, 0) * 100) / 100;
  }

  isPayable(invoice: MyCustomerInvoice): boolean {
    return (invoice.status === 'Sent' || invoice.status === 'NotSent') && invoice.amountDue > 0;
  }

  kindLabel(invoice: MyCustomerInvoice): string | null {
    if (invoice.kind === 'Split') return 'Part of your order';
    if (invoice.kind === 'Additional') return 'Added after your order was updated';
    return null;
  }
}
