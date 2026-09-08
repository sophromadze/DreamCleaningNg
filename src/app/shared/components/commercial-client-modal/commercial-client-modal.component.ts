import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs/operators';

import {
  ContractService, ContractClient, ContractContactRole, BusinessCustomer, CreateCommercialClient
} from '../../../services/contract.service';
import { InvoiceClientOption } from '../../../services/invoice.service';
import { extractApiErrorMessage } from '../../../utils/http-error.utils';
import { describeEmailProblem } from '../../../utils/email.utils';
import { normalizePhone10, sanitizePhoneInput } from '../../../utils/phone.utils';

/**
 * The commercial client form — create AND edit, the ONE implementation, used by
 * Commercial → Clients and by the Create Invoice form's client dropdown.
 *
 * ## Why it exists
 *
 * A commercial client and a contract are separate facts: `CommercialInvoice.ContractId` is
 * nullable because plenty of commercial work is billed before an agreement is signed, or without
 * one at all. Until 2026-09 the only reachable way to create a `ContractClients` row was to save a
 * contract draft, so billing a trial clean meant fabricating an agreement nobody intended to sign
 * purely to populate this dropdown. Nothing is generated here — no contract, no DCC number, no
 * document.
 *
 * ## What editing here CANNOT do
 *
 * Rewrite a contract. Every contract version renders from its own frozen snapshot taken at
 * generation time, so an executed agreement keeps the name, address and signatures it was signed
 * with however this row later reads — renaming a client affects FUTURE contracts only. That
 * structural freeze is the protection, not a policy re-implemented here, which is why there is no
 * competing edit rule: `ContractClientEditPolicy` still governs the other direction, a CLIENT
 * editing their own details on the review page, where a legal-name change is a contract
 * modification needing re-approval. When the client has contracts the form says so, so nobody
 * edits believing the documents will follow.
 *
 * ## The link is not editable here
 *
 * `sourceUserId` is sent on create and deliberately NOT on edit. Which customer account a client
 * belongs to is decided by the business flag on that account, because the link is what opens that
 * customer's view of the company's contracts — re-pointing it from a billing form would be a
 * quieter second way to grant that.
 *
 * ## Fields follow the model, not a wish list
 *
 * `ContractClient` has no DBA column, so the trading name is captured where it actually lives —
 * `ContractServiceLocation.BusinessBrand`, the same field and the same "Chick-fil-A" placeholder
 * the contract form uses. Both the billing contact and the service location are optional: a client
 * can be created now and completed later, and the invoice form already warns when a billing email
 * is missing rather than silently failing at send time.
 *
 * ## The host owns two things only
 *
 * Whether the caller may open it — the hosts gate on `canCreate` / `canUpdate` from
 * `GET api/admin/permissions`, the same map `[RequirePermission]` enforces on the endpoints — and
 * what to do with the client afterwards.
 */
@Component({
  selector: 'app-commercial-client-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './commercial-client-modal.component.html',
  styleUrls: ['./commercial-client-modal.component.scss']
})
export class CommercialClientModalComponent implements OnChanges {
  private contracts = inject(ContractService);

  /** Host-controlled visibility. Every false→true transition resets the form. */
  @Input() open = false;

  /**
   * The client being edited, or null to create a new one. Read once per opening — the host does
   * not have to keep it in step while the modal is up.
   */
  @Input() client: InvoiceClientOption | null = null;

  /** Cancel, backdrop, ✕, or a completed save. The host clears its own flag. */
  @Output() closed = new EventEmitter<void>();

  /** Emitted once the client exists on the server, carrying the row the server returned. */
  @Output() created = new EventEmitter<ContractClient>();

  /** Emitted after an edit is saved. The host reloads; the payload is the id that changed. */
  @Output() saved = new EventEmitter<number>();

  form = this.emptyForm();

  /** Which mode this opening is in. Fixed at open time, never mid-edit. */
  editingId: number | null = null;
  linkedAccountName = '';
  linkedAccountEmail = '';
  contractCount = 0;

  get isEdit(): boolean { return this.editingId !== null; }
  get isLinked(): boolean { return !!this.linkedAccountName; }

  /** Business-flagged accounts, for the optional link. Loaded on first open. */
  businessCustomers: BusinessCustomer[] = [];
  loadingCustomers = false;

  errorMessage = '';
  saving = false;

  ngOnChanges(changes: SimpleChanges): void {
    const opened = changes['open'];
    if (!opened || !opened.currentValue || opened.previousValue) return;

    this.errorMessage = '';
    this.saving = false;
    this.form = this.emptyForm();
    this.editingId = null;
    this.linkedAccountName = '';
    this.linkedAccountEmail = '';
    this.contractCount = 0;

    if (this.client) {
      this.fillFrom(this.client);
    } else {
      // The account picker is only ever offered on CREATE — an existing client's link is owned by
      // the business flag on that account, not by this form.
      this.loadBusinessCustomers();
    }
  }

  /** Copies a saved client into the form. Nothing here is derived; every value round-trips. */
  private fillFrom(client: InvoiceClientOption): void {
    this.editingId = client.id;
    this.linkedAccountName = client.linkedAccountName ?? '';
    this.linkedAccountEmail = client.linkedAccountEmail ?? '';
    this.contractCount = client.contracts?.length ?? 0;

    const location = client.primaryLocation;
    const hasContact = !!client.billingContactFirstName;

    this.form = {
      ...this.emptyForm(),
      legalEntityName: client.legalEntityName ?? '',
      entityType: client.entityType ?? '',
      formationState: client.formationState ?? '',
      principalAddress: client.principalAddress ?? '',
      city: client.city ?? '',
      state: client.state ?? '',
      zip: client.zip ?? '',
      noticeEmail: client.noticeEmail ?? '',
      phone: client.billingPhone ?? '',

      // billingEmail/Phone fall back to the client's own when there is no contact, so they are
      // only treated as the contact's when a contact actually exists.
      contactFirstName: client.billingContactFirstName ?? '',
      contactLastName: client.billingContactLastName ?? '',
      contactTitle: client.billingContactTitle ?? '',
      contactEmail: hasContact ? (client.billingEmail ?? '') : '',
      contactPhone: hasContact ? (client.billingPhone ?? '') : '',

      // The saved location, field by field. "Same as company" is a create-time shortcut and stays
      // OFF here — turning it on would silently overwrite a service address that is deliberately
      // different from where the company is registered.
      addLocation: !!location,
      sameAsCompany: false,
      businessBrand: location?.businessBrand ?? '',
      locationName: location?.locationName ?? '',
      locationAddress: location?.address ?? '',
      locationCity: location?.city ?? '',
      locationState: location?.state ?? '',
      locationZip: location?.zip ?? ''
    };
  }

  private emptyForm() {
    return {
      // Company. The two defaults match the contract form's own empty client, so an admin who
      // uses both surfaces is not asked to answer the same question two different ways.
      legalEntityName: '',
      entityType: 'a limited liability company',
      formationState: '',
      principalAddress: '',
      city: '',
      state: 'NY',
      zip: '',
      noticeEmail: '',
      phone: '',
      sourceUserId: null as number | null,

      // Primary billing contact (optional).
      contactFirstName: '',
      contactLastName: '',
      contactTitle: '',
      contactEmail: '',
      contactPhone: '',

      // One service location (optional). `sameAsCompany` is a convenience only - it copies the
      // company address into the location fields, it does not make them the same record.
      addLocation: false,
      sameAsCompany: true,
      businessBrand: '',
      locationName: '',
      locationAddress: '',
      locationCity: '',
      locationState: 'NY',
      locationZip: ''
    };
  }

  /**
   * The link is an ACCESS GRANT — it is what opens My Contracts for that account — so only
   * business-flagged customers are offered, and the server re-checks the one that comes back.
   * A failure here is not fatal: the link is optional and the client saves fine without it.
   */
  private loadBusinessCustomers(): void {
    if (this.businessCustomers.length) return;

    this.loadingCustomers = true;
    this.contracts.getBusinessCustomers()
      .pipe(finalize(() => this.loadingCustomers = false))
      .subscribe({
        next: rows => this.businessCustomers = rows || [],
        error: () => this.businessCustomers = []
      });
  }

  /**
   * Fills BLANK company fields from the linked account, exactly as the contract form does.
   *
   * Never the legal entity name: a business is not its owner, and guessing "Jane Smith LLC" from a
   * person's name is worse than leaving it empty. Never overwrites something already typed either
   * — that is the admin saying something the account does not know.
   */
  onSourceUserSelected(): void {
    const customer = this.businessCustomers.find(c => c.userId === this.form.sourceUserId);
    if (!customer) return;

    if (!this.form.principalAddress.trim()) this.form.principalAddress = customer.address ?? '';
    if (!this.form.city.trim()) this.form.city = customer.city ?? '';
    if (!this.form.state.trim() || this.form.state === 'NY') {
      this.form.state = customer.state || this.form.state;
    }
    if (!this.form.zip.trim()) this.form.zip = customer.zip ?? '';
    if (!this.form.noticeEmail.trim()) this.form.noticeEmail = customer.email ?? '';

    if (!this.form.contactFirstName.trim()) this.form.contactFirstName = customer.firstName ?? '';
    if (!this.form.contactLastName.trim()) this.form.contactLastName = customer.lastName ?? '';
    if (!this.form.contactEmail.trim()) this.form.contactEmail = customer.email ?? '';
    if (!this.form.contactPhone.trim()) this.form.contactPhone = customer.phone ?? '';
  }

  onPhoneInput(event: Event, field: 'phone' | 'contactPhone'): void {
    const input = event.target as HTMLInputElement;
    const cleaned = sanitizePhoneInput(input.value);
    input.value = cleaned;
    this.form[field] = cleaned;
  }

  onFieldInput(): void {
    if (this.errorMessage) this.errorMessage = '';
  }

  close(): void {
    if (this.saving) return;
    this.errorMessage = '';
    this.closed.emit();
  }

  /** True once every required company field carries something. Drives the submit button. */
  get canSubmit(): boolean {
    return !this.saving
      && !!this.form.legalEntityName.trim()
      && !!this.form.entityType.trim()
      && !!this.form.principalAddress.trim()
      && !!this.form.city.trim()
      && !!this.form.state.trim()
      && !!this.form.zip.trim();
  }

  submit(): void {
    if (this.saving) return;

    const problem = this.validate();
    if (problem) {
      this.errorMessage = problem;
      return;
    }

    this.saving = true;
    this.errorMessage = '';

    const payload = this.buildPayload();
    const request = this.isEdit
      ? this.contracts.updateClient(this.editingId!, payload)
      : this.contracts.createClient(payload);

    request
      // finalize, not complete: an HTTP error never reaches complete, and releasing the button
      // there is how a failed save leaves the form stuck on "Saving…".
      .pipe(finalize(() => this.saving = false))
      .subscribe({
        next: client => {
          if (this.isEdit) this.saved.emit(this.editingId!);
          else this.created.emit(client);
          this.closed.emit();
        },
        error: err => {
          this.errorMessage = extractApiErrorMessage(
            err, this.isEdit ? 'Could not save the client.' : 'Could not create the client.');
        }
      });
  }

  /**
   * Says what is actually wrong, in the order a person reads the form.
   *
   * Email problems are DESCRIBED rather than detected — a missing `@` says so — because an error
   * an admin cannot act on is a bug. See `utils/email.utils.ts`.
   */
  private validate(): string | null {
    if (!this.form.legalEntityName.trim()) return 'Enter the legal entity name of the client.';
    if (!this.form.entityType.trim()) return 'Enter the entity type, e.g. "a limited liability company".';
    if (!this.form.principalAddress.trim()) return 'Enter the principal business address.';
    if (!this.form.city.trim()) return 'Enter the city.';
    if (!this.form.state.trim()) return 'Enter the state.';
    if (!this.form.zip.trim()) return 'Enter the ZIP code.';

    const billingEmail = this.form.noticeEmail.trim();
    if (billingEmail) {
      const problem = describeEmailProblem(billingEmail);
      if (problem) return `Billing email: ${problem}`;
    }

    const contactEmail = this.form.contactEmail.trim();
    if (contactEmail) {
      const problem = describeEmailProblem(contactEmail);
      if (problem) return `Billing contact email: ${problem}`;
    }

    // A half-entered contact is a mistake worth naming: a first name with no last name reaches
    // the server as a [Required] violation nobody can read.
    const hasContactName = !!this.form.contactFirstName.trim() || !!this.form.contactLastName.trim();
    if (hasContactName
      && (!this.form.contactFirstName.trim() || !this.form.contactLastName.trim())) {
      return 'Enter both a first and last name for the billing contact, or leave both blank.';
    }

    if (this.form.addLocation) {
      const location = this.resolvedLocation();
      if (!location.address) return 'Enter the service location address, or turn the location off.';
      if (!location.city) return 'Enter the service location city.';
      if (!location.state) return 'Enter the service location state.';
      if (!location.zip) return 'Enter the service location ZIP code.';
    }

    return null;
  }

  /** The location fields with "same as company" applied. */
  private resolvedLocation() {
    const same = this.form.sameAsCompany;
    return {
      address: (same ? this.form.principalAddress : this.form.locationAddress).trim(),
      city: (same ? this.form.city : this.form.locationCity).trim(),
      state: (same ? this.form.state : this.form.locationState).trim(),
      zip: (same ? this.form.zip : this.form.locationZip).trim()
    };
  }

  private buildPayload(): CreateCommercialClient {
    const hasContact = !!this.form.contactFirstName.trim() && !!this.form.contactLastName.trim();
    const location = this.resolvedLocation();

    return {
      legalEntityName: this.form.legalEntityName.trim(),
      entityType: this.form.entityType.trim(),
      formationState: this.form.formationState.trim() || undefined,
      principalAddress: this.form.principalAddress.trim(),
      city: this.form.city.trim(),
      state: this.form.state.trim(),
      zip: this.form.zip.trim(),
      noticeEmail: this.form.noticeEmail.trim() || undefined,
      phone: normalizePhone10(this.form.phone) || undefined,

      // Create only, and only ever what was explicitly chosen: the server refuses an account that
      // is not business-flagged, and never infers one from a matching email address. On EDIT it is
      // omitted entirely — an existing client's link is owned by the business flag on the account,
      // and the server does not read this field there either.
      sourceUserId: this.isEdit ? undefined : (this.form.sourceUserId ?? null),

      billingContact: hasContact
        ? {
            firstName: this.form.contactFirstName.trim(),
            lastName: this.form.contactLastName.trim(),
            title: this.form.contactTitle.trim() || undefined,
            email: this.form.contactEmail.trim() || undefined,
            phone: normalizePhone10(this.form.contactPhone) || undefined,
            // The invoice form reads the client's first contact, preferring the signer; using the
            // same role keeps a standalone client's contact indistinguishable from a contract's.
            role: ContractContactRole.ClientSigner
          }
        : null,

      serviceLocation: this.form.addLocation
        ? {
            businessBrand: this.form.businessBrand.trim() || undefined,
            locationName: this.form.locationName.trim() || undefined,
            address: location.address,
            city: location.city,
            state: location.state,
            zip: location.zip
          }
        : null
    };
  }
}
