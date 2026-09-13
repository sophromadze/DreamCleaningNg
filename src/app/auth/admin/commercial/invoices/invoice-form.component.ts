import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs/operators';

import {
  InvoiceService, InvoiceClientOption, InvoiceContractOption, InvoiceLocationOption,
  InvoiceDueTerms, InvoiceTaxType, InvoiceDiscountType, InvoicePaymentMethod, InvoiceStatus,
  SaveInvoice, SaveInvoiceItem, InvoiceDetail,
  InvoiceEligibleOrder, InvoiceOrderAllocation,
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
  driftChoices: string[] = [];

  driftKind(warning: string): 'Price' | 'Tax' | null {
    return warning.startsWith('Current contract pricing') ? 'Price'
      : warning.startsWith('Current contract tax') ? 'Tax' : null;
  }

  chooseDrift(warning: string, useCurrent: boolean): void {
    const kind = this.driftKind(warning);
    const invoice = this.existing;
    if (!kind || !invoice || this.monetaryLocked) return;
    if (useCurrent && kind === 'Price') {
      if (invoice.currentContractUnitPrice == null) return;
      this.discountType = InvoiceDiscountType.None;
      this.discountValue = null;
      this.lines = this.lines.map(line => ({ ...line, unitPrice: invoice.currentContractUnitPrice! }));

    }
    if (useCurrent && kind === 'Tax') {
      if (invoice.currentContractTaxType == null) return;
      this.taxType = invoice.currentContractTaxType;
      this.taxRate = invoice.currentContractTaxRate ?? 0;
    }
    this.driftChoices = this.driftChoices.filter(c => !c.endsWith(kind));
    this.driftChoices.push((useCurrent ? 'Current' : 'Keep') + kind);
    if (this.selectedOrderIds.length && this.driftChoices.includes('CurrentPrice')) {
      this.negotiatedGroupTotal = previewTotals(
        [{ quantity: this.selectedOrderIds.length, unitPrice: invoice.currentContractUnitPrice! }],
        this.discountType, this.discountValue, this.taxType, this.taxRate).total;
      this.negotiatingTotal = true;
    }
    invoice.draftWarnings = invoice.draftWarnings.filter(w => this.driftKind(w) !== kind);
    if (this.selectedOrderIds.length) this.previewAllocation();
  }
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

  /**
   * The individual visits this invoice covers - "October 7, 14, 21, 28".
   *
   * Generated by "Create next invoice" from the contract's schedule and EDITABLE here, which is
   * the whole point of producing a draft first. An empty list is legitimate and falls back to the
   * period bounds above; what is never legitimate is a range nobody's schedule supports.
   */
  serviceDates: string[] = [];
  newServiceDate = '';

  serviceAddress = '';
  poNumber = '';
  clientReference = '';

  discountType: InvoiceDiscountType = InvoiceDiscountType.None;
  discountValue: number | null = null;

  taxType: InvoiceTaxType = InvoiceTaxType.Exempt;
  taxRate: number | null = null;

  /**
   * The tax rate is shown LOCKED with an Edit control, matching the contract form.
   *
   * It is the same rate on every commercial document, so the common case is confirming it rather
   * than typing it, and an always-editable number invites a stray keystroke on the field that
   * decides what a client is charged.
   */
  taxRateUnlocked = false;

  /** Ticked while unlocked: persist this rate as the default for future documents. */
  saveTaxRateAsDefault = false;

  paymentMethod: InvoicePaymentMethod = InvoicePaymentMethod.AchBankTransfer;

  customerNote = '';
  internalNote = '';

  lines: EditableLine[] = [{ description: '', quantity: 1, unitPrice: 0 }];

  /** Set when contract prefill would overwrite something the admin already typed. */
  prefillWarning = '';

  // ── The cleanings this invoice covers ─────────────────────────────────────────────────────
  //
  // WHEN CLEANINGS ARE SELECTED THEY OWN THE LINE ITEMS. The server rebuilds one line per visit
  // from the selection — "Commercial Cleaning — Oct 4 … $875.00" four times — so a client
  // checking the bill can see the visits they received. The hand-typed line editor is therefore
  // hidden while a selection exists, rather than sitting there offering an edit that the next
  // save would silently discard.

  eligibleOrders: InvoiceEligibleOrder[] = [];
  loadingEligible = false;
  eligibleError = '';

  /** Order ids the admin has ticked. Order is irrelevant — the server sorts by service date. */
  selectedOrderIds: number[] = [];
  private allocationRequest = 0;
  private selectionTouched = false;
  private standaloneDraft?: { lines: EditableLine[]; dates: string[]; from: string; to: string;
    discountType: InvoiceDiscountType; discountValue: number | null };
  get linkedDraftEditable(): boolean { return !this.existing || this.existing.status === InvoiceStatus.Draft; }

  private rememberStandalone(): void {
    if (!this.selectedOrderIds.length) this.standaloneDraft = {
      lines: this.lines.map(l => ({ ...l })), dates: [...this.serviceDates], from: this.serviceStartDate, to: this.serviceEndDate,
      discountType: this.discountType, discountValue: this.discountValue
    };
    this.selectionTouched = true;
  }

  /**
   * The agreed group total, when one has been negotiated. Null means "bill what the cleanings
   * cost", which is the default and the common case.
   */
  negotiatedGroupTotal: number | null = null;
  negotiatingTotal = false;

  /** The last allocation the server computed, for the preview table. */
  allocations: InvoiceOrderAllocation[] = [];
  allocationWarnings: string[] = [];
  savingOrders = false;

  /** Committed allocations, loaded on edit — proof of what a SENT invoice actually did. */
  get hasCommittedAllocation(): boolean {
    return this.allocations.some(a => !a.isProposal);
  }

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

    // The Orders panel sends the cleaning it wants billed along with the client, so "put this job
    // on an invoice" lands on a form that already has that job ticked. Stashed rather than applied
    // here: the picker has not been fetched yet, and a tick on a row that turns out to be blocked
    // (already invoiced, already paid) must not survive.
    const rawOrder = this.route.snapshot.queryParamMap.get('orderId');
    const orderId = rawOrder ? Number(rawOrder) : NaN;
    this.preselectOrderId = orderId > 0 ? orderId : null;

    this.clientId = clientId;
    this.onClientChange();
  }

  /** The cleaning `?orderId=` asked for, until the picker has loaded and can honour it. */
  private preselectOrderId: number | null = null;

  /**
   * Seeds tax mode, rate and terms from the ONE saved source of commercial billing defaults —
   * the same row the contract form reads, which is what stops a contract quoting tax-inclusive
   * while its invoices add 8.875% on top.
   *
   * The narrower `defaults` endpoint rather than the full settings read: this form needs five
   * values and never displays the company's bank account, so it is not handed one. The customer
   * note still comes from the full settings read below, which only runs when it is needed.
   */
  private applyBillingDefaults(): void {
    this.invoiceService.getBillingDefaults().subscribe({
      next: d => {
        this.taxType = d.defaultTaxType;
        this.taxRate = d.defaultTaxRate ?? null;
        this.dueTerms = d.defaultDueTerms;
      },
      // Defaults are a convenience; the form is perfectly usable without them.
      error: () => {}
    });

    this.invoiceService.getBillingSettings().subscribe({
      next: s => { if (!this.customerNote) this.customerNote = s.defaultCustomerNote ?? ''; },
      error: () => {}
    });
  }

  unlockTaxRate(): void {
    this.taxRateUnlocked = true;
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
          this.serviceDates = (inv.serviceDates ?? []).map(d => d.slice(0, 10));
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

          // A negotiated figure round-trips, so re-opening a draft shows the agreed total rather
          // than four $875 lines with no explanation of where they came from.
          this.negotiatedGroupTotal = inv.negotiatedOrderGroupTotal ?? null;
          this.negotiatingTotal = this.negotiatedGroupTotal != null;

          this.loadEligibleOrders();
          this.loadAllocations();
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
    ++this.allocationRequest;
    this.savingOrders = false;
    this.selectionTouched = false;
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

    // A selection belongs to ONE client. Carrying it across would offer to bill somebody else's
    // cleanings — which the server refuses, but the form should not have offered.
    this.selectedOrderIds = [];
    this.allocations = [];
    this.allocationWarnings = [];
    this.negotiatedGroupTotal = null;
    this.negotiatingTotal = false;

    this.loadEligibleOrders();
  }

  // ── The cleanings this invoice covers ─────────────────────────────────────────────────────

  loadEligibleOrders(): void {
    this.eligibleOrders = [];
    this.eligibleError = '';
    if (!this.clientId) return;

    this.loadingEligible = true;
    this.invoiceService.eligibleOrders(this.clientId, { invoiceId: this.invoiceId })
      .pipe(finalize(() => { this.loadingEligible = false; }))
      .subscribe({
        next: res => {
          this.eligibleOrders = res.orders;
          // Rows already on THIS invoice come back ticked, so re-opening a draft shows the
          // selection it was saved with rather than an empty picker beside four line items.
          const already = res.orders.filter(o => o.isOnThisInvoice).map(o => o.orderId);
          if (!this.selectionTouched && already.length && this.selectedOrderIds.length === 0) this.selectedOrderIds = already;

          // Honour ?orderId= now that we know whether that cleaning is actually selectable.
          // Once only — a later reload of the picker must not re-tick a row the admin unticked.
          if (this.preselectOrderId != null) {
            const wanted = res.orders.find(
              o => o.orderId === this.preselectOrderId && o.canSelect);
            this.preselectOrderId = null;
            if (wanted && !this.selectedOrderIds.includes(wanted.orderId)) {
              this.selectedOrderIds = [...this.selectedOrderIds, wanted.orderId];
              this.selectionTouched = true;
            }
          }
          if (this.selectedOrderIds.length && this.linkedDraftEditable) this.previewAllocation();
        },
        error: err => {
          // Never fatal: an invoice can perfectly well be raised without linking any cleaning.
          this.eligibleError = extractApiErrorMessage(
            err, 'Could not load this client\'s cleanings.');
        }
      });
  }

  private loadAllocations(): void {
    if (!this.invoiceId) return;
    this.invoiceService.orders(this.invoiceId).subscribe({
      next: rows => {
        if (this.selectionTouched) return;
        this.allocations = rows;
        if (!this.selectionTouched && rows.length && this.selectedOrderIds.length === 0) {
          this.selectedOrderIds = rows.map(r => r.orderId);
          if (this.eligibleOrders.length && this.linkedDraftEditable) this.previewAllocation();
        }
      },
      error: () => { /* the picker below still works; the preview simply stays empty */ }
    });
  }

  isOrderSelected(order: InvoiceEligibleOrder): boolean {
    return this.selectedOrderIds.includes(order.orderId);
  }

  toggleOrder(order: InvoiceEligibleOrder): void {
    if (!order.canSelect || this.monetaryLocked || !this.linkedDraftEditable) return;
    this.rememberStandalone();

    const index = this.selectedOrderIds.indexOf(order.orderId);
    if (index >= 0) this.selectedOrderIds.splice(index, 1);
    else this.selectedOrderIds.push(order.orderId);

    // The negotiated figure was agreed for a SPECIFIC set of visits. Changing the set makes it
    // meaningless — four visits at $3,500 is not three visits at $3,500 — so it is dropped rather
    // than silently re-divided across a different number of cleanings.
    if (this.negotiatingTotal) {
      this.negotiatedGroupTotal = null;
      this.negotiatingTotal = false;
    }

    this.previewAllocation();
  }

  selectAllEligible(): void {
    if (this.monetaryLocked || !this.linkedDraftEditable) return;
    this.rememberStandalone();
    this.selectedOrderIds = this.eligibleOrders.filter(o => o.canSelect).map(o => o.orderId);
    this.negotiatedGroupTotal = null;
    this.negotiatingTotal = false;
    this.previewAllocation();
  }

  clearOrderSelection(): void {
    if (this.monetaryLocked || !this.linkedDraftEditable) return;
    this.selectionTouched = true;
    this.selectedOrderIds = [];
    this.negotiatedGroupTotal = null;
    this.negotiatingTotal = false;
    this.allocations = [];
    this.allocationWarnings = [];
    this.previewAllocation();
  }

  get selectedOrders(): InvoiceEligibleOrder[] {
    return this.eligibleOrders.filter(o => this.selectedOrderIds.includes(o.orderId));
  }

  /** What the selected cleanings cost today, before any negotiation. */
  get selectedOrdersDefaultTotal(): number {
    return Math.round(this.selectedOrders.reduce((sum, o) => sum + o.total, 0) * 100) / 100;
  }

  startNegotiatingTotal(): void {
    this.negotiatingTotal = true;
    if (this.negotiatedGroupTotal == null) {
      this.negotiatedGroupTotal = this.selectedOrdersDefaultTotal;
    }
    this.previewAllocation();
  }

  cancelNegotiatedTotal(): void {
    this.negotiatingTotal = false;
    this.negotiatedGroupTotal = null;
    this.previewAllocation();
  }

  /**
   * Shows what the split WOULD be, computed by the server.
   *
   * Deliberately a round trip rather than arithmetic in the browser: the equal-shares split, the
   * integer-cent remainder and the tax-mode solve are one rule. This read-only preview works
   * before the invoice exists too; saving persists the selection together with the invoice.
   */
  previewAllocation(): void {
    if (!this.linkedDraftEditable) return;
    const version = ++this.allocationRequest;
    this.eligibleError = '';
    if (this.selectedOrderIds.length === 0) {
      this.allocations = [];
      this.allocationWarnings = [];
      this.savingOrders = false;
      if (this.selectionTouched) {
        this.lines = this.standaloneDraft?.lines.map(l => ({ ...l })) ?? [{ description: '', quantity: 1, unitPrice: 0 }];
        this.serviceDates = [...(this.standaloneDraft?.dates ?? [])];
        this.serviceStartDate = this.standaloneDraft?.from ?? '';
        this.serviceEndDate = this.standaloneDraft?.to ?? '';
        this.discountType = this.standaloneDraft?.discountType ?? InvoiceDiscountType.None;
        this.discountValue = this.standaloneDraft?.discountValue ?? null;
      }
      return;
    }

    const selected = [...this.selectedOrders].sort((a, b) => a.serviceDate.localeCompare(b.serviceDate) || a.orderId - b.orderId);
    this.discountType = InvoiceDiscountType.None;
    this.discountValue = null;
    this.serviceDates = [...new Set(selected.map(o => o.serviceDate.slice(0, 10)))];
    this.serviceStartDate = this.serviceDates[0] ?? '';
    this.serviceEndDate = this.serviceDates[this.serviceDates.length - 1] ?? '';
    this.lines = selected.map(o => ({ description: `${o.serviceTypeName} — ${o.serviceDate.slice(0, 10)} (#${o.orderId})`, quantity: 1, unitPrice: o.total }));

    this.savingOrders = true;
    this.invoiceService.previewOrders(this.buildPayload(), this.invoiceId)
      .pipe(finalize(() => { if (version === this.allocationRequest) this.savingOrders = false; }))
      .subscribe({
        next: res => {
          if (version !== this.allocationRequest) return;
          this.allocations = res.allocations;
          this.allocationWarnings = res.warnings;
          this.eligibleError = '';
          // The server rebuilt the line items from the selection; mirror them so the totals
          // preview and the saved invoice agree.
          this.lines = res.items.map(i => ({ description: i.description, quantity: i.quantity, unitPrice: i.unitPrice }));
          this.serviceDates = res.serviceDates.map(d => d.slice(0, 10));
          this.serviceStartDate = this.serviceDates[0] ?? '';
          this.serviceEndDate = this.serviceDates[this.serviceDates.length - 1] ?? '';
        },
        error: err => {
          if (version !== this.allocationRequest) return;
          this.eligibleError = extractApiErrorMessage(
            err, 'Could not work out the split for these cleanings.');
        }
      });
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

  // ── Service dates ──
  //
  // What cleanings this invoice covers. A GENERATED draft arrives with them filled in from the
  // contract's schedule; an ad-hoc invoice may legitimately have none. Editing them here before
  // sending is what "the admin reviews the generated dates" means.

  addServiceDate(): void {
    const date = this.newServiceDate;
    if (!date || this.serviceDates.includes(date)) return;

    this.serviceDates = [...this.serviceDates, date].sort();
    this.newServiceDate = '';
    this.syncServicePeriodToDates();
  }

  removeServiceDate(date: string): void {
    this.serviceDates = this.serviceDates.filter(d => d !== date);
    this.syncServicePeriodToDates();
  }

  /**
   * Keeps the period bounds in step with the listed dates.
   *
   * The two are stored together and the list says strictly more, so leaving the bounds behind
   * would make the invoice describe two different periods depending on which field a surface
   * happened to read. Clearing every date leaves the bounds ALONE - an admin who deletes the list
   * may still want the range they typed.
   */
  private syncServicePeriodToDates(): void {
    if (this.serviceDates.length === 0) return;
    this.serviceStartDate = this.serviceDates[0];
    this.serviceEndDate = this.serviceDates[this.serviceDates.length - 1];
  }

  /**
   * Whether this invoice can be sent without a service date.
   *
   * An invoice billed against a CONTRACT has to say which cleanings it covers - a recurring bill
   * with no service date is unanswerable for the client. The server refuses the send too; this is
   * the version the admin sees before pressing the button. Ad-hoc invoices are unaffected.
   */
  get needsServiceDates(): boolean {
    return !!this.contractId
      && this.serviceDates.length === 0
      && !this.serviceStartDate
      && !this.serviceEndDate;
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
      && !this.saving && !this.savingOrders && (!this.selectedOrderIds.length || !this.eligibleError);
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
      orderIds: this.linkedDraftEditable ? [...this.selectedOrderIds] : undefined,
      negotiatedGroupTotal: this.negotiatingTotal ? this.negotiatedGroupTotal : null,
      contractClientId: this.clientId!,
      draftDriftChoices: this.driftChoices,
      contractId: this.contractId,
      contractServiceLocationId: this.locationId,
      invoiceDate: this.invoiceDate,
      dueTerms: this.dueTerms,
      customDueDate: this.dueTerms === InvoiceDueTerms.Custom ? this.customDueDate : null,
      serviceStartDate: this.serviceStartDate || null,
      serviceEndDate: this.serviceEndDate || null,
      serviceDates: this.serviceDates,
      serviceAddress: this.serviceAddress.trim() || null,
      poNumber: this.poNumber.trim() || null,
      clientReference: this.clientReference.trim() || null,
      discountType: this.discountType,
      discountValue: this.discountType === InvoiceDiscountType.None ? null : this.discountValue,
      taxType: this.taxType,
      taxRate: this.taxType === InvoiceTaxType.Exempt ? null : this.taxRate,
      // Only ever true while the rate is unlocked - a locked field cannot have been edited, so
      // it must not silently rewrite the company's default on every save.
      saveTaxRateAsDefault: this.taxRateUnlocked && this.saveTaxRateAsDefault,
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
        // Invoice fields and the linked-order selection are saved together by the backend.
        if (!thenSend) {
          this.saving = false;
          this.router.navigate(['/admin/commercial/invoices', saved.id]);
          return;
        }
        this.sendAfterSave(saved.id);
      },
      error: err => {
        this.saving = false;
        this.error = extractApiErrorMessage(err, 'Could not save the invoice.');
      }
    });
  }

  /**
   * Sends a saved invoice.
   *
   * SENDING IS WHAT COMMITS THE AGREED PRICES onto the cleanings — the server does that first, in
   * one transaction, before the mail goes out. A failed send therefore leaves an invoice that is
   * correct and simply has not been emailed yet, which is the recoverable half of the pair.
   */
  private sendAfterSave(savedId: number): void {
    this.invoiceService.send(savedId, { attachPdf: true })
      .pipe(finalize(() => this.saving = false))
      .subscribe({
        next: () => this.router.navigate(['/admin/commercial/invoices', savedId]),
        error: err => {
          // The invoice IS saved - only the mail failed. Go to the detail page and say so
          // there, rather than stranding the admin on a form whose work is already stored.
          this.router.navigate(['/admin/commercial/invoices', savedId], {
            queryParams: { sendError: extractApiErrorMessage(err, 'The invoice could not be emailed.') }
          });
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
