import { ChangeDetectionStrategy, Component, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { describeEmailProblem } from '../../../../utils/email.utils';

/** Matches InvoiceRecipientList.MaxRecipients on the server. */
export const MAX_INVOICE_RECIPIENTS = 20;

/**
 * The editable list of addresses a commercial invoice is emailed to (2026-10).
 *
 * ONE implementation for every place the list is edited — the invoice form, the detail page's
 * Recipients dialog, and the Send / Reminder dialogs — so an address is accepted or refused the
 * same way everywhere. Each address is checked with `describeEmailProblem`, the mirror of the
 * server's validator, so the admin reads the same sentence before saving that the server would
 * answer with. The server validates again; this is the convenience, that is the control.
 *
 * Two-way bound through `recipients` (a `model()`), so the host owns the list.
 */
@Component({
  selector: 'app-invoice-recipients-editor',
  imports: [FormsModule],
  templateUrl: './invoice-recipients-editor.component.html',
  styleUrl: './invoice-recipients-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class InvoiceRecipientsEditorComponent {
  readonly recipients = model<string[]>([]);

  /** Visible label for the group. */
  readonly label = input('Send this invoice to');

  /** Unique per page, so the input's label and error can be referenced by id. */
  readonly inputId = input('invoiceRecipient');

  readonly newRecipient = signal('');
  readonly error = signal('');

  add(): void {
    const email = this.newRecipient().trim();
    if (!email) return;

    const problem = describeEmailProblem(email);
    if (problem) {
      this.error.set(problem);
      return;
    }
    if (this.recipients().some(r => r.toLowerCase() === email.toLowerCase())) {
      this.error.set(`${email} is already on the list.`);
      return;
    }
    if (this.recipients().length >= MAX_INVOICE_RECIPIENTS) {
      this.error.set(`An invoice can be sent to at most ${MAX_INVOICE_RECIPIENTS} addresses.`);
      return;
    }

    this.recipients.set([...this.recipients(), email]);
    this.newRecipient.set('');
    this.error.set('');
  }

  remove(email: string): void {
    this.recipients.set(this.recipients().filter(r => r !== email));
  }

  onInput(value: string): void {
    this.newRecipient.set(value);
    if (this.error()) this.error.set('');
  }
}
