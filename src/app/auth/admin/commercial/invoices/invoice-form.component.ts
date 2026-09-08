import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs/operators';

import {
  InvoiceService, InvoiceClientOption, InvoiceContractOption, InvoiceLocationOption,
  InvoiceDueTerms, InvoiceTaxType, InvoiceDiscountType, InvoicePaymentMethod,
  SaveInvoice, SaveInvoiceItem, InvoiceDetail,
  previewTotals, resolveDueDate, DUE_TERMS_OPTIONS
} from '../../../../services/invoice.service';
import { AdminService } from '../../../../services/admin.service';
import { ContractClient } from '../../../../services/contract.service';
import { CommercialClientModalComponent } from '../../../../shared/components/commercial-client-modal/commercial-client-modal.component';
import { extractApiErrorMessage } from '../../../../utils/http-error.utils';

/** One editable row. `id` is present only for a line that already exists on a saved invoice. */
interface EditableLine {
  id?: number;
  description: string;
  quantity: number;
  unitPrice: number;
}

/**
 * Create / edit a commercial invoice.
 *
 * THE TOTALS SHOWN HERE ARE A PREVIEW. `previewTotals` mirrors the server calculator step for
 * step so the admin sees a live figure while typing, but nothing derived is ever POSTed - the
 * SaveInvoice payload has no subtotal, tax or total field to put it in. The server recalculates
 * from the line items and its answer is what gets stored.
 *
 * The invoice NUMBER is likewise never sent. It is allocated server-side on create and frozen
 * afterwards, so on the create screen there is simply nothing to show yet, and on edit it is
 * displayed read-only.
 */
@Component({
  selector: 'app-invoice-form',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, CommercialClientModalComponent],
  templateUrl: './invoice-form.component.html',
  styleUrls: ['./invoice-form.component.scss']
})
export class InvoiceFormComponent implements OnInit {
  private invoiceService = inject(InvoiceService);
  private adminService = inject(AdminService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  readonly InvoiceTaxType = InvoiceTaxType;
  readonly InvoiceDiscountType = InvoiceDiscountType;
  readonly InvoiceDueTerms = InvoiceDueTerms;
  readonly InvoicePaymentMethod = InvoicePaymentMethod;
  readonly dueTermsOptions = DUE_TERMS_OPTIONS;

  invoiceId?: number;
  get isEdit(): boolean { return !!this.invoiceId; }

  existing?: InvoiceDetail;
  clients: InvoiceClientOption[] = [];

  loading = true;
  saving = false;
  error = '';

  /** Shown once the client already has their copy - see EditRequiresWarning on the server. */
  sentWarning = false;
  monetaryLocked = false;

  /**
   * Whether to offer "+ New client" beside the dropdown. From the permission map, not a role test
   * - the same map `[RequirePermission(Permission.Create)]` enforces on the create endpoint.
   */
  canCreateClient = false;
  showClientModal = false;

  // ── Form state ──
  clientId: number | null = null;
  contractId: number | null = null;
  locationId: number | null = null;

  invoiceDate = this.today();
  dueTerms: InvoiceDueTerms = InvoiceDueTerms.Net15;
  customDueDate = '';

  serviceStartDate = '';
  serviceEndDate = '';
  serviceAddress = '';
  poNumber = '';
  clientReference = '';

  discountType: InvoiceDiscountType = InvoiceDiscountType.None;
  discountValue: number | null = null;

  taxType: InvoiceTaxType = InvoiceTaxType.Exempt;
  taxRate: number | null = null;

  paymentMethod: InvoicePaymentMethod = InvoicePaymentMethod.AchBankTransfer;

  customerNote = '';
  internalNote = '';

  lines: EditableLine[] = [{ description: '', quantity: 1, unitPrice: 0 }];

  /** Set when contract prefill would overwrite something the admin already typed. */
  prefillWarning = '';

  ngOnInit(): void {
    const idParam = this.route.snapshot.paramMap.get('id');
    this.invoiceId = idParam ? Number(idParam) : undefined;

    this.adminService.getUserPermissions().subscribe({
      next: p => { this.canCreateClient = !!p?.permissions?.canCreate; },
      error: () => { this.canCreateClient = false; }
    });

    this.invoiceService.clients()
      .pipe(finalize(() => { if (!this.isEdit) this.loading = false; }))
      .subscribe({
        next: list => {
          this.clients = list;
          if (this.isEdit) {
            this.loadExisting();
          } else {
            this.applyBillingDefaults();
            this.preselectFromQuery();
          }
        },
        error: err => {
          this.error = extractApiErrorMessage(err, 'Could not load commercial clients.');
          this.loading = false;
        }
      });
  }

  /**
   * "Create invoice" from Commercial → Clients arrives with ?clientId=. Applied only when that
   * client is actually in the roster we just loaded — an id for a client that has since been
   * removed selects nothing rather than putting the form in a state the dropdown cannot show.
   */
  private preselectFromQuery(): void {
    const raw = this.route.snapshot.queryParamMap.get('clientId');
    const clientId = raw ? Number(raw) : NaN;
    if (!clientId || !this.clients.some(c => c.id === clientId)) return;

    this.clientId = clientId;
    this.onClientChange();
  }

  /** Seeds tax mode, terms and the customer note from the company's billing settings. */
  private applyBillingDefaults(): void {
    this.invoiceService.getBillingSettings().subscribe({
      next: s => {
        this.taxType = s.defaultTaxType;
        this.taxRate = s.defaultTaxRate ?? null;
        this.dueTerms = s.defaultDueTerms;
        if (!this.customerNote) this.customerNote = s.defaultCustomerNote ?? '';
      },
      // Defaults are a convenience; the form is perfectly usable without them.
      error: () => {}
    });
  }

  private loadExisting(): void {
    this.invoiceService.get(this.invoiceId!)
      .pipe(finalize(() => this.loading = false))
      .subscribe({
        next: inv => {
          this.existing = inv;
          this.sentWarning = inv.editRequiresWarning;
          this.monetaryLocked = !inv.canEditMonetaryValues;

          this.clientId = inv.contractClientId;
          this.contractId = inv.contractId ?? null;
          this.locationId = inv.contractServiceLocationId ?? null;

          this.invoiceDate = inv.invoiceDate.slice(0, 10);
          this.dueTerms = inv.dueTerms;
          this.customDueDate = inv.dueDate.slice(0, 10);

          this.serviceStartDate = inv.serviceStartDate?.slice(0, 10) ?? '';
          this.serviceEndDate = inv.serviceEndDate?.slice(0, 10) ?? '';
          this.serviceAddress = inv.serviceAddress ?? '';
          this.poNumber = inv.poNumber ?? '';
          this.clientReference = inv.clientReference ?? '';

          this.discountType = inv.discountType;
          this.discountValue = inv.discountValue ?? null;
          this.taxType = inv.taxType;
          this.taxRate = inv.taxRate ?? null;
          this.paymentMethod = inv.paymentMethod;

          this.customerNote = inv.customerNote ?? '';
          this.internalNote = inv.internalNote ?? '';

          this.lines = inv.items.length
            ? inv.items.map(i => ({
                id: i.id, description: i.description, quantity: i.quantity, unitPrice: i.unitPrice
              }))
            : [{ description: '', quantity: 1, unitPrice: 0 }];
        },
        error: err => this.error = extractApiErrorMessage(err, 'Could not load the invoice.')
      });
  }

  // ── Derived views of the selected client ──

  get selectedClient(): InvoiceClientOption | undefined {
    return this.clients.find(c => c.id === this.clientId);
  }

  get availableLocations(): InvoiceLocationOption[] {
    return this.selectedClient?.locations ?? [];
  }

  get availableContracts(): InvoiceContractOption[] {
    return this.selectedClient?.contracts ?? [];
  }

  get selectedContract(): InvoiceContractOption | undefined {
    return this.availableContracts.find(c => c.id === this.contractId);
  }

  /**
   * Changing client clears the contract and location: both belong to the previous client, and the
   * server refuses a contract that belongs to somebody else anyway.
   */
  onClientChange(): void {
    this.contractId = null;
    this.locationId = null;
    this.prefillWarning = '';

    const client = this.selectedClient;
    if (client?.locations.length === 1) {
      this.locationId = client.locations[0].id;
      this.serviceAddress = client.locations[0].address;
    } else {
      this.serviceAddress = '';
    }
  }

  onLocationChange(): void {
    const location = this.availableLocations.find(l => l.id === this.locationId);
    if (location) this.serviceAddress = location.address;
  }

  openClientModal(): void {
    if (!this.canCreateClient || this.monetaryLocked) return;
    this.showClientModal = true;
  }

  /**
   * A client created from this page must be usable WITHOUT reloading it — a reload would throw
   * away every line item and date already typed, which is the whole reason the shortcut exists.
   *
   * So the roster is refetched (the create call returns a `ContractClient`, not the invoice
   * endpoint's joined `InvoiceClientOption` this form renders), the new id is selected, and
   * `onClientChange` runs so the billing details, the single service location and the empty
   * contract list all settle exactly as they would have on a manual pick. Related Contract stays
   * "No contract" — a brand new client has none, and an invoice does not need one.
   *
   * The selection is applied even if the refetch fails: losing the client the admin just created
   * is worse than a dropdown that is one entry short until the next load.
   */
  onClientCreated(client: ContractClient): void {
    this.invoiceService.clients().subscribe({
      next: list => {
        this.clients = list;
        this.selectClient(client.id);
      },
      error: () => this.selectClient(client.id)
    });
  }

  private selectClient(clientId: number): void {
    this.clientId = clientId;
    this.onClientChange();
  }

  /**
   * Prefills from the selected contract - service location, description, agreed amount, tax
   * treatment.
   *
   * IT NEVER SILENTLY OVERWRITES TYPED WORK. If the admin has already entered a described line or
   * changed the tax settings, those are LEFT ALONE and a warning names what was kept, so the
   * prefill cannot quietly undo something they meant.
   */
  onContractChange(): void {
    this.prefillWarning = '';
    const contract = this.selectedContract;
    if (!contract) return;

    const kept: string[] = [];

    if (contract.serviceLocationId && !this.locationId) {
      this.locationId = contract.serviceLocationId;
    }
    if (contract.serviceAddress && !this.serviceAddress) {
      this.serviceAddress = contract.serviceAddress;
    }

    const hasTypedLines = this.lines.some(l => l.description.trim() || l.unitPrice > 0);
    if (hasTypedLines) {
      kept.push('the line items you have already entered');
    } else if (contract.agreedAmount) {
      this.lines = [{
        description: contract.serviceDescription || 'Commercial cleaning services',
        quantity: 1,
        unitPrice: contract.agreedAmount
      }];
    }

    // Only a still-default (Exempt, no rate) tax setting is replaced by the contract's.
    const taxUntouched = this.taxType === InvoiceTaxType.Exempt && !this.taxRate;
    if (contract.taxType !== undefined && contract.taxType !== null) {
      if (taxUntouched) {
        this.taxType = contract.taxType;
        this.taxRate = contract.taxRate ?? null;
      } else {
        kept.push('your tax settings');
      }
    }

    if (kept.length) {
      this.prefillWarning =
        `Filled in what was empty from ${contract.contractNumber}, and kept ${kept.join(' and ')}.`;
    }
  }

  // ── Line items ──

  addLine(): void {
    this.lines.push({ description: '', quantity: 1, unitPrice: 0 });
  }

  removeLine(index: number): void {
    this.lines.splice(index, 1);
    if (!this.lines.length) this.addLine();
  }

  lineAmount(line: EditableLine): number {
    return Math.round(((line.quantity || 0) * (line.unitPrice || 0) + Number.EPSILON) * 100) / 100;
  }

  // ── Totals preview ──

  get totals() {
    return previewTotals(
      this.lines.map(l => ({ quantity: l.quantity || 0, unitPrice: l.unitPrice || 0 })),
      this.discountType, this.discountValue, this.taxType, this.taxRate);
  }

  get amountPaid(): number { return this.existing?.amountPaid ?? 0; }

  get balanceDue(): number { return Math.max(0, this.totals.total - this.amountPaid); }

  /** What the Due Date box shows, resolved the same way the server will resolve it. */
  get resolvedDueDate(): string {
    return resolveDueDate(this.invoiceDate, this.dueTerms, this.customDueDate);
  }

  onDueTermsChange(): void {
    if (this.dueTerms !== InvoiceDueTerms.Custom) {
      this.customDueDate = this.resolvedDueDate;
    }
  }

  // ── Save ──

  get canSave(): boolean {
    return !!this.clientId
      && this.lines.some(l => l.description.trim())
      && !this.saving;
  }

  private buildPayload(): SaveInvoice {
    const items: SaveInvoiceItem[] = this.lines
      .filter(l => l.description.trim())
      .map((l, index) => ({
        id: l.id,
        description: l.description.trim(),
        quantity: l.quantity || 0,
        unitPrice: l.unitPrice || 0,
        sortOrder: index
      }));

    return {
      contractClientId: this.clientId!,
      contractId: this.contractId,
      contractServiceLocationId: this.locationId,
      invoiceDate: this.invoiceDate,
      dueTerms: this.dueTerms,
      customDueDate: this.dueTerms === InvoiceDueTerms.Custom ? this.customDueDate : null,
      serviceStartDate: this.serviceStartDate || null,
      serviceEndDate: this.serviceEndDate || null,
      serviceAddress: this.serviceAddress.trim() || null,
      poNumber: this.poNumber.trim() || null,
      clientReference: this.clientReference.trim() || null,
      discountType: this.discountType,
      discountValue: this.discountType === InvoiceDiscountType.None ? null : this.discountValue,
      taxType: this.taxType,
      taxRate: this.taxType === InvoiceTaxType.Exempt ? null : this.taxRate,
      paymentMethod: this.paymentMethod,
      customerNote: this.customerNote.trim() || null,
      internalNote: this.internalNote.trim() || null,
      items
    };
  }

  /** Save Draft: creates or updates, and emails nobody. */
  saveDraft(): void {
    this.persist(false);
  }

  /** Save & Send: saves, then sends to the billing contact in one action. */
  saveAndSend(): void {
    this.persist(true);
  }

  private persist(thenSend: boolean): void {
    if (!this.canSave) return;

    this.saving = true;
    this.error = '';

    const payload = this.buildPayload();
    const request$ = this.isEdit
      ? this.invoiceService.update(this.invoiceId!, payload)
      : this.invoiceService.create(payload);

    request$.subscribe({
      next: saved => {
        if (!thenSend) {
          // finalize() would release the button before the navigate; releasing here keeps the
          // disabled state until the page actually changes.
          this.saving = false;
          this.router.navigate(['/admin/commercial/invoices', saved.id]);
          return;
        }

        this.invoiceService.send(saved.id, { attachPdf: true })
          .pipe(finalize(() => this.saving = false))
          .subscribe({
            next: () => this.router.navigate(['/admin/commercial/invoices', saved.id]),
            error: err => {
              // The invoice IS saved - only the mail failed. Go to the detail page and say so
              // there, rather than stranding the admin on a form whose work is already stored.
              this.router.navigate(['/admin/commercial/invoices', saved.id], {
                queryParams: { sendError: extractApiErrorMessage(err, 'The invoice could not be emailed.') }
              });
            }
          });
      },
      error: err => {
        this.saving = false;
        this.error = extractApiErrorMessage(err, 'Could not save the invoice.');
      }
    });
  }

  cancel(): void {
    if (this.isEdit) this.router.navigate(['/admin/commercial/invoices', this.invoiceId]);
    else this.router.navigate(['/admin/commercial/invoices']);
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
