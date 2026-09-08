import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs/operators';

import {
  InvoiceService, BillingSettings, InvoiceTaxType, InvoiceDueTerms, DUE_TERMS_OPTIONS
} from '../../../../services/invoice.service';
import { extractApiErrorMessage } from '../../../../utils/http-error.utils';

/**
 * The company's billing identity and the bank account commercial invoices are paid into.
 *
 * SuperAdmin-only, matching the endpoint: changing the destination account silently redirects
 * every payment the business receives from then on. Every save is audit-logged server-side.
 *
 * THE ACCOUNT NUMBER IS NEVER PREFILLED INTO THE INPUT. The GET returns it, but this form starts
 * that one box empty with the stored value shown beside it as a masked hint, and sends `null` when
 * it is left untouched - which the server reads as "keep what you have". Two reasons: a full
 * account number sitting in an input is a full account number sitting in the browser's form
 * autofill and session restore, and starting it blank makes replacing it a deliberate act rather
 * than an edit somebody might make by accident.
 */
@Component({
  selector: 'app-billing-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './billing-settings.component.html',
  styleUrls: ['./billing-settings.component.scss']
})
export class BillingSettingsComponent implements OnInit {
  private invoiceService = inject(InvoiceService);

  readonly InvoiceTaxType = InvoiceTaxType;
  readonly dueTermsOptions = DUE_TERMS_OPTIONS;

  settings?: BillingSettings;
  loading = true;
  saving = false;
  error = '';
  notice = '';

  /** Typed only when the admin is actually replacing the account number. */
  newAccountNumber = '';

  form: Partial<BillingSettings> = {};

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.invoiceService.getBillingSettings()
      .pipe(finalize(() => this.loading = false))
      .subscribe({
        next: s => {
          this.settings = s;
          this.form = { ...s };
          // Deliberately not seeded from the response — see the class comment.
          this.newAccountNumber = '';
        },
        error: err => this.error = extractApiErrorMessage(err, 'Could not load billing settings.')
      });
  }

  get canEdit(): boolean { return !!this.settings?.canEdit; }

  save(): void {
    if (!this.canEdit || !this.form.companyLegalName?.trim()) return;

    this.saving = true;
    this.error = '';
    this.notice = '';

    this.invoiceService.saveBillingSettings({
      ...this.form,
      // null keeps the stored number; a typed value replaces it.
      bankAccountNumber: this.newAccountNumber.trim() || null as any
    })
      .pipe(finalize(() => this.saving = false))
      .subscribe({
        next: saved => {
          this.settings = saved;
          this.form = { ...saved };
          this.newAccountNumber = '';
          this.notice = 'Billing settings saved. The change has been recorded in the audit log.';
          setTimeout(() => this.notice = '', 5000);
        },
        error: err => this.error = extractApiErrorMessage(err, 'Could not save billing settings.')
      });
  }
}
