import { Component, OnInit, inject, ChangeDetectionStrategy, signal } from '@angular/core';
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./billing-settings.component.scss']
})
export class BillingSettingsComponent implements OnInit {
  private invoiceService = inject(InvoiceService);

  readonly InvoiceTaxType = InvoiceTaxType;
  readonly dueTermsOptions = DUE_TERMS_OPTIONS;

  readonly settings = signal<BillingSettings | undefined>(undefined);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly notice = signal('');

  /** Typed only when the admin is actually replacing the account number. */
  readonly newAccountNumber = signal('');

  readonly form = signal<Partial<BillingSettings>>({});

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.invoiceService.getBillingSettings()
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: s => {
          this.settings.set(s);
          this.form.set({ ...s });
          // Deliberately not seeded from the response — see the class comment.
          this.newAccountNumber.set('');
        },
        error: err => this.error.set(extractApiErrorMessage(err, 'Could not load billing settings.'))
      });
  }

  get canEdit(): boolean { return !!this.settings()?.canEdit; }

  save(): void {
    if (!this.canEdit || !this.form().companyLegalName?.trim()) return;

    this.saving.set(true);
    this.error.set('');
    this.notice.set('');

    this.invoiceService.saveBillingSettings({
      ...this.form(),
      // null keeps the stored number; a typed value replaces it.
      bankAccountNumber: this.newAccountNumber().trim() || null as any
    })
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: saved => {
          this.settings.set(saved);
          this.form.set({ ...saved });
          this.newAccountNumber.set('');
          this.notice.set('Billing settings saved. The change has been recorded in the audit log.');
          setTimeout(() => this.notice.set(''), 5000);
        },
        error: err => this.error.set(extractApiErrorMessage(err, 'Could not save billing settings.'))
      });
  }
}
