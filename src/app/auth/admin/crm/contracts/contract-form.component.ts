import { Component, EventEmitter, Input, OnInit, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, forkJoin } from 'rxjs';
import {
  AdvancedTermsSnapshot, BusinessCustomer, ContractClient, ContractContact, ContractContactRole, ContractDetail,
  ContractPricingInput, ContractPricingPreview, ContractPriceMode, ContractService,
  ContractServiceLocation, ContractSnapshot, ContractTemplate, ContractorProfile,
  SaveContract, ScheduleSnapshot, ScopeStructure, ScopeTemplate, TermSnapshot
} from '../../../../services/contract.service';
import { extractApiErrorMessage } from '../../../../utils/http-error.utils';

/**
 * Which collapsible panel is open. Several may be open at once.
 *
 * There is no separate 'clientSigner' key: the client and the person signing for them are one
 * card, because from the admin's side they are one act of data entry — you are recording who the
 * counterparty is. They remain two ENTITIES underneath (ContractClient and ContractContact),
 * which is what lets the same person sign for a second location later.
 */
type PanelKey =
  | 'template' | 'contractor' | 'contractorSigner' | 'client'
  | 'location' | 'schedule' | 'term' | 'pricing' | 'scope' | 'advanced';

/**
 * The Create / Edit Contract form: one page of collapsible sections in the order the spec lays
 * out, ending in "Generate Contract Preview".
 *
 * Two rules this form exists to enforce visually:
 *
 *  - The service location is its own section, never inherited from the client's address. A
 *    commercial client is frequently registered at one address and served at another, and the
 *    reference contract is exactly that case.
 *  - The admin types THREE pricing numbers (mode, amount, tax rate). Pre-tax, tax, total, the
 *    cancellation charge, the remaining balance and the lockout fee are all echoed back from the
 *    server; this form never computes a contract figure itself, so what is shown is what will be
 *    written into Exhibit B.
 */
@Component({
  selector: 'app-contract-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './contract-form.component.html',
  styleUrls: ['./contract-form.component.scss']
})
export class ContractFormComponent implements OnInit {
  /** Null creates a new contract; otherwise the draft of this contract is loaded for editing. */
  @Input() contractId: number | null = null;

  @Output() generated = new EventEmitter<ContractDetail>();
  @Output() cancelled = new EventEmitter<void>();

  private contracts = inject(ContractService);

  loading = true;
  saving = false;
  errorMessage = '';

  contractNumber = '';

  // Reference data
  templates: ContractTemplate[] = [];
  scopeTemplates: ScopeTemplate[] = [];
  contractorProfiles: ContractorProfile[] = [];
  clients: ContractClient[] = [];
  locations: ContractServiceLocation[] = [];
  clientSigners: ContractContact[] = [];
  /** Business-flagged accounts a client can be linked to; the link opens My Contracts. */
  businessCustomers: BusinessCustomer[] = [];
  contractorSigners: ContractContact[] = [];

  // Selection state. `null` in a picker means "a new one, typed below".
  selectedClientId: number | null = null;
  selectedLocationId: number | null = null;
  selectedClientSignerId: number | null = null;

  effectiveDate = '';
  premisesType = '';

  model: SaveContract = this.emptyModel();
  pricingPreview: ContractPricingPreview | null = null;

  openPanels = new Set<PanelKey>(['template', 'client', 'location', 'schedule', 'pricing']);

  readonly ContractPriceMode = ContractPriceMode;
  readonly weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  readonly frequencyUnits = ['calendar week', 'calendar month', 'two calendar weeks'];

  private pricingChanged$ = new Subject<void>();

  ngOnInit(): void {
    // Debounced so typing a price doesn't fire a request per keystroke, but the derived figures
    // still settle without the admin having to leave the field.
    this.pricingChanged$.pipe(debounceTime(350)).subscribe(() => this.refreshPricingPreview());
    this.loadReferenceData();
  }

  // ── loading ────────────────────────────────────────────────────────────────

  private loadReferenceData(): void {
    this.loading = true;
    // forkJoin, not Promise.all: it keeps the load on the RxJS path the rest of the app uses and
    // settles synchronously with the response, so the defaults are applied in the same turn the
    // data arrives rather than a microtask later.
    forkJoin({
      templates: this.contracts.getContractTemplates(),
      scopes: this.contracts.getScopeTemplates(),
      profiles: this.contracts.getContractorProfiles(),
      clients: this.contracts.getClients(),
      contractorSigners: this.contracts.getContacts(ContractContactRole.ContractorSigner),
      businessCustomers: this.contracts.getBusinessCustomers()
    }).subscribe({
      next: result => {
        this.templates = result.templates ?? [];
        this.scopeTemplates = result.scopes ?? [];
        this.contractorProfiles = result.profiles ?? [];
        this.clients = result.clients ?? [];
        this.contractorSigners = result.contractorSigners ?? [];
        this.businessCustomers = result.businessCustomers ?? [];

        if (this.contractId) {
          this.loadExisting(this.contractId);
        } else {
          this.applyDefaults();
          this.loading = false;
        }
      },
      error: err => {
        this.errorMessage = extractApiErrorMessage(err, 'Could not load the contract reference data.');
        this.loading = false;
      }
    });
  }

  private applyDefaults(): void {
    this.model = this.emptyModel();
    this.model.contractTemplateId = this.templates[0]?.id ?? 0;
    this.model.contractorProfileId =
      (this.contractorProfiles.find(p => p.isDefault) ?? this.contractorProfiles[0])?.id ?? 0;

    const restaurant = this.scopeTemplates.find(t => t.name === 'Restaurant') ?? this.scopeTemplates[0];
    if (restaurant) this.applyScopeTemplate(restaurant.id);

    this.model.contractorSignerEmail = this.contractorSigners[0]?.email ?? '';
    this.model.contractorSignerContactId = this.contractorSigners[0]?.id ?? null;
    this.refreshPricingPreview();
  }

  private loadExisting(id: number): void {
    this.contracts.getContract(id).subscribe({
      next: detail => {
        this.contractNumber = detail.contractNumber;
        this.hydrateFrom(detail.draft);
        this.loading = false;
      },
      error: err => {
        this.errorMessage = extractApiErrorMessage(err, 'Could not load this contract.');
        this.loading = false;
      }
    });
  }

  /** Re-opens a saved draft into the form. Reads from the snapshot, never from the live rows. */
  private hydrateFrom(snapshot: ContractSnapshot): void {
    this.model = {
      contractTemplateId: snapshot.contractTemplateId,
      scopeTemplateId: snapshot.scopeTemplateId ?? undefined,
      contractorProfileId: snapshot.contractor.id,
      effectiveDate: snapshot.effectiveDate ?? null,
      contractClientId: snapshot.client.id || null,
      newClient: {
        legalEntityName: snapshot.client.legalEntityName,
        entityType: snapshot.client.entityType,
        formationState: snapshot.client.formationState,
        principalAddress: snapshot.client.principalAddress,
        city: snapshot.client.city,
        state: snapshot.client.state,
        zip: snapshot.client.zip,
        noticeEmail: snapshot.client.noticeEmail,
        phone: snapshot.client.phone,
        sourceUserId: snapshot.client.sourceUserId ?? null
      },
      contractServiceLocationId: snapshot.serviceLocation.id || null,
      newServiceLocation: {
        contractClientId: snapshot.client.id,
        businessBrand: snapshot.serviceLocation.businessBrand,
        locationName: snapshot.serviceLocation.locationName,
        address: snapshot.serviceLocation.address,
        city: snapshot.serviceLocation.city,
        state: snapshot.serviceLocation.state,
        zip: snapshot.serviceLocation.zip
      },
      contractorSignerContactId: snapshot.contractorSigner.contactId ?? null,
      contractorSignerEmail: snapshot.contractorSigner.email,
      clientSignerContactId: snapshot.clientSigner.contactId ?? null,
      newClientSigner: {
        firstName: snapshot.clientSigner.firstName,
        lastName: snapshot.clientSigner.lastName,
        title: snapshot.clientSigner.title,
        email: snapshot.clientSigner.email,
        phone: snapshot.clientSigner.phone,
        role: ContractContactRole.ClientSigner,
        contractClientId: snapshot.client.id
      },
      premisesType: snapshot.premisesType,
      schedule: { ...snapshot.schedule },
      term: { ...snapshot.term },
      pricing: {
        priceMode: snapshot.pricing.priceMode,
        priceInput: snapshot.pricing.priceInput,
        salesTaxRatePercent: snapshot.pricing.salesTaxRatePercent,
        cancellationPercent: snapshot.pricing.cancellationPercent,
        invoiceTiming: snapshot.pricing.invoiceTiming,
        paymentDeadlineHours: snapshot.pricing.paymentDeadlineHours,
        paymentMethod: snapshot.pricing.paymentMethod,
        lateChargePercent: snapshot.pricing.lateChargePercent,
        returnedPaymentFee: snapshot.pricing.returnedPaymentFee
      },
      advanced: { ...snapshot.advanced },
      scope: JSON.parse(JSON.stringify(snapshot.scope ?? { groups: [] }))
    };

    // Inferred rather than stored: the checkbox is a data-entry convenience, not contract data.
    // If the saved notice contact already equals the signer's, reopening the form shows it ticked,
    // which is what the admin left it as.
    const noticeEmail = (snapshot.client.noticeEmail ?? '').trim().toLowerCase();
    const signerEmail = (snapshot.clientSigner.email ?? '').trim().toLowerCase();
    const noticePhone = (snapshot.client.phone ?? '').trim();
    const signerPhone = (snapshot.clientSigner.phone ?? '').trim();
    this.useSignerContactForNotices = noticeEmail === signerEmail && noticePhone === signerPhone;

    this.selectedClientId = snapshot.client.id || null;
    this.selectedLocationId = snapshot.serviceLocation.id || null;
    this.selectedClientSignerId = snapshot.clientSigner.contactId ?? null;
    this.premisesType = snapshot.premisesType;
    this.effectiveDate = snapshot.effectiveDate ? snapshot.effectiveDate.substring(0, 10) : '';

    if (this.selectedClientId) this.loadClientChildren(this.selectedClientId);
    this.refreshPricingPreview();
  }

  // ── panels ─────────────────────────────────────────────────────────────────

  isOpen(panel: PanelKey): boolean { return this.openPanels.has(panel); }

  togglePanel(panel: PanelKey): void {
    if (this.openPanels.has(panel)) this.openPanels.delete(panel);
    else this.openPanels.add(panel);
  }

  // ── pickers ────────────────────────────────────────────────────────────────

  onClientSelected(): void {
    if (!this.selectedClientId) {
      // "New client": clear the fields rather than leaving the previous client's details behind.
      this.model.contractClientId = null;
      this.model.newClient = this.emptyClient();
      this.locations = [];
      this.clientSigners = [];
      this.selectedLocationId = null;
      this.selectedClientSignerId = null;
      return;
    }

    const client = this.clients.find(c => c.id === this.selectedClientId);
    if (!client) return;

    this.model.contractClientId = client.id;
    // Copied into the editable fields: the form stays fully editable for an existing client, and
    // the server applies whatever comes back.
    this.model.newClient = {
      legalEntityName: client.legalEntityName,
      entityType: client.entityType,
      formationState: client.formationState,
      principalAddress: client.principalAddress,
      city: client.city,
      state: client.state,
      zip: client.zip,
      noticeEmail: client.noticeEmail,
      phone: client.phone
    };
    this.loadClientChildren(client.id);
  }

  private loadClientChildren(clientId: number): void {
    this.contracts.getLocations(clientId).subscribe({
      next: rows => this.locations = rows,
      error: () => this.locations = []
    });
    this.contracts.getContacts(ContractContactRole.ClientSigner, clientId).subscribe({
      next: rows => this.clientSigners = rows,
      error: () => this.clientSigners = []
    });
  }

  onLocationSelected(): void {
    if (!this.selectedLocationId) {
      this.model.contractServiceLocationId = null;
      this.model.newServiceLocation = this.emptyLocation();
      return;
    }
    const location = this.locations.find(l => l.id === this.selectedLocationId);
    if (!location) return;

    this.model.contractServiceLocationId = location.id;
    this.model.newServiceLocation = {
      contractClientId: location.contractClientId,
      businessBrand: location.businessBrand,
      locationName: location.locationName,
      address: location.address,
      city: location.city,
      state: location.state,
      zip: location.zip
    };
  }

  /**
   * Picking a linked account pre-fills the client and its signer from that customer's own
   * record — name, email, phone and their primary address.
   *
   * Only ever fills BLANK fields plus the signer identity: an admin who has already typed a legal
   * entity name or a different company address has said something the account does not know, and
   * silently overwriting it would lose their work. The legal entity name in particular is
   * deliberately never guessed from a person's name — a business is not its owner.
   */
  onSourceUserSelected(): void {
    const userId = this.model.newClient?.sourceUserId ?? null;
    if (!userId || !this.model.newClient) return;

    const customer = this.businessCustomers.find(c => c.userId === userId);
    if (!customer) return;

    const client = this.model.newClient;
    if (!client.principalAddress?.trim()) client.principalAddress = customer.address ?? '';
    if (!client.city?.trim()) client.city = customer.city ?? '';
    if (!client.state?.trim() || client.state === 'NY') client.state = customer.state || client.state;
    if (!client.zip?.trim()) client.zip = customer.zip ?? '';

    // The signer IS this person, so their identity is filled in whether or not something was
    // already there — that is the whole point of linking the account.
    const signer = this.model.newClientSigner;
    if (signer) {
      signer.firstName = customer.firstName || signer.firstName;
      signer.lastName = customer.lastName || signer.lastName;
      signer.email = customer.email || signer.email;
      signer.phone = customer.phone || signer.phone;
      // A linked account is a new contact rather than one of the client's existing ones.
      this.selectedClientSignerId = null;
      this.model.clientSignerContactId = null;
    }

    this.syncNoticeContact();
  }

  // ── Notice contact ─────────────────────────────────────────────────────────
  // Section 32 serves notice on the client's own email and phone. In practice that is almost
  // always the signer's, so the form defaults to reusing them and only asks for a separate
  // address when the admin says the two genuinely differ.

  useSignerContactForNotices = true;

  onUseSignerContactChanged(): void {
    if (this.useSignerContactForNotices) this.syncNoticeContact();
  }

  /** Copies the signer's email/phone onto the client while the checkbox is ticked. */
  private syncNoticeContact(): void {
    if (!this.useSignerContactForNotices || !this.model.newClient) return;
    this.model.newClient.noticeEmail = this.model.newClientSigner?.email ?? '';
    this.model.newClient.phone = this.model.newClientSigner?.phone ?? '';
  }

  /** Called as the signer's own contact details are typed, so the mirror stays live. */
  onSignerContactChanged(): void {
    this.syncNoticeContact();
  }

  onClientSignerSelected(): void {
    if (!this.selectedClientSignerId) {
      this.model.clientSignerContactId = null;
      this.model.newClientSigner = this.emptySigner();
      this.syncNoticeContact();
      return;
    }
    const contact = this.clientSigners.find(c => c.id === this.selectedClientSignerId);
    if (!contact) return;

    this.model.clientSignerContactId = contact.id;
    this.model.newClientSigner = {
      firstName: contact.firstName,
      lastName: contact.lastName,
      title: contact.title,
      email: contact.email,
      phone: contact.phone,
      role: ContractContactRole.ClientSigner,
      contractClientId: this.selectedClientId ?? undefined
    };
    this.syncNoticeContact();
  }

  // ── scope ──────────────────────────────────────────────────────────────────

  onScopeTemplateChanged(): void {
    if (this.model.scopeTemplateId) this.applyScopeTemplate(this.model.scopeTemplateId);
  }

  private applyScopeTemplate(templateId: number): void {
    const template = this.scopeTemplates.find(t => t.id === templateId);
    if (!template) return;
    this.model.scopeTemplateId = template.id;
    // Deep clone, so toggling an item on this contract can never mutate the shared template.
    this.model.scope = JSON.parse(JSON.stringify(template.structure ?? { groups: [] })) as ScopeStructure;
    if (!this.premisesType) {
      this.premisesType = template.premisesType;
      this.model.premisesType = template.premisesType;
    }
  }

  get allowsCustomScopeRows(): boolean {
    const template = this.scopeTemplates.find(t => t.id === this.model.scopeTemplateId);
    return !!template?.allowsCustomRows;
  }

  addScopeRow(groupIndex: number, label: string, input: HTMLInputElement): void {
    const trimmed = (label ?? '').trim();
    if (!trimmed) return;
    this.model.scope.groups[groupIndex].items.push({ label: trimmed, selected: true, isCustom: true });
    input.value = '';
  }

  removeScopeRow(groupIndex: number, itemIndex: number): void {
    this.model.scope.groups[groupIndex].items.splice(itemIndex, 1);
  }

  selectedCount(groupIndex: number): number {
    return this.model.scope.groups[groupIndex].items.filter(i => i.selected).length;
  }

  // ── pricing ────────────────────────────────────────────────────────────────

  onPricingChanged(): void { this.pricingChanged$.next(); }

  private refreshPricingPreview(): void {
    this.contracts.pricingPreview(this.model.pricing).subscribe({
      next: preview => this.pricingPreview = preview,
      // A failed echo must not block the form — Generate Preview recomputes server-side anyway.
      error: () => this.pricingPreview = null
    });
  }

  // ── submit ─────────────────────────────────────────────────────────────────

  generatePreview(): void {
    if (this.saving) return;

    const problem = this.validate();
    if (problem) {
      this.errorMessage = problem;
      return;
    }

    this.saving = true;
    this.errorMessage = '';
    // Section 32 renders the CLIENT's notice email and phone, so the mirror has to be applied to
    // the model before it is sent — the checkbox alone would leave those columns empty.
    this.syncNoticeContact();
    this.model.effectiveDate = this.effectiveDate ? this.effectiveDate : null;
    this.model.premisesType = this.premisesType;
    if (this.model.newServiceLocation && this.model.contractClientId) {
      this.model.newServiceLocation.contractClientId = this.model.contractClientId;
    }

    const save$ = this.contractId
      ? this.contracts.updateContract(this.contractId, this.model)
      : this.contracts.createContract(this.model);

    save$.subscribe({
      next: detail => {
        // Save then generate: the preview is always rendered from what was just persisted, so a
        // failed generate never leaves the draft and the document out of step.
        this.contracts.generatePreview(detail.id).subscribe({
          next: withVersion => {
            this.saving = false;
            this.generated.emit(withVersion);
          },
          error: err => {
            this.saving = false;
            this.errorMessage = extractApiErrorMessage(err, 'Could not generate the preview.');
          }
        });
      },
      error: err => {
        this.saving = false;
        this.errorMessage = extractApiErrorMessage(err, 'Could not save the contract.');
      }
    });
  }

  private validate(): string | null {
    if (!this.model.contractTemplateId) return 'Choose a contract template.';
    if (!this.model.contractorProfileId) return 'Choose a contractor profile.';
    if (!this.model.newClient?.legalEntityName?.trim()) return 'Enter the legal entity name of the client.';
    if (!this.model.newClient?.principalAddress?.trim()) return 'Enter the principal address of the client.';
    if (!this.model.newServiceLocation?.address?.trim())
      return 'Enter the service location address — it is where the cleaning happens, and is not assumed to be the client address.';
    if (!this.model.newClientSigner?.firstName?.trim() || !this.model.newClientSigner?.lastName?.trim())
      return 'Enter the person who will sign for the client.';
    if (!this.model.newClientSigner?.email?.trim())
      return 'The client signer needs an email address — that is where the review and signing links go.';
    if (this.model.pricing.priceInput <= 0) return 'Enter the price per visit.';
    return null;
  }

  cancel(): void { this.cancelled.emit(); }

  // ── empty shapes ───────────────────────────────────────────────────────────

  private emptyModel(): SaveContract {
    return {
      contractTemplateId: 0,
      scopeTemplateId: undefined,
      contractorProfileId: 0,
      effectiveDate: null,
      contractClientId: null,
      newClient: this.emptyClient(),
      contractServiceLocationId: null,
      newServiceLocation: this.emptyLocation(),
      contractorSignerEmail: '',
      contractorSignerContactId: null,
      clientSignerContactId: null,
      newClientSigner: this.emptySigner(),
      premisesType: '',
      schedule: this.defaultSchedule(),
      term: this.defaultTerm(),
      pricing: this.defaultPricing(),
      advanced: this.defaultAdvanced(),
      scope: { groups: [] }
    };
  }

  private emptyClient() {
    return {
      legalEntityName: '', entityType: 'a limited liability company', formationState: '',
      principalAddress: '', city: '', state: 'NY', zip: '', noticeEmail: '', phone: '',
      sourceUserId: null
    };
  }

  private emptyLocation() {
    return {
      contractClientId: 0, businessBrand: '', locationName: '',
      address: '', city: '', state: 'NY', zip: ''
    };
  }

  private emptySigner() {
    return {
      firstName: '', lastName: '', title: '', email: '', phone: '',
      role: ContractContactRole.ClientSigner, contractClientId: undefined
    };
  }

  /** Defaults mirror the reference agreement, so an untouched form reproduces its wording. */
  private defaultSchedule(): ScheduleSnapshot {
    return {
      frequencyUnit: 'calendar week', visitsPerPeriod: 1,
      serviceDay: 'Sunday', serviceTime: '9:00 AM',
      flexibleScheduling: true, performedWhileClosed: true,
      accessType: 'key or other access credentials provided by Client'
    };
  }

  private defaultTerm(): TermSnapshot {
    return {
      initialTermMonths: 12, minimumCommitmentMonths: 3, terminationNoticeDays: 30,
      renewalType: 'month-to-month', governingLawState: 'New York', venueCounty: 'Kings County'
    };
  }

  private defaultPricing(): ContractPricingInput {
    return {
      priceMode: ContractPriceMode.PreTax, priceInput: 0, salesTaxRatePercent: 8.875,
      cancellationPercent: 50,
      invoiceTiming: 'In advance of each scheduled service visit, generally several days before service.',
      paymentDeadlineHours: 48, paymentMethod: 'ACH or bank-to-bank transfer',
      lateChargePercent: 1.5, returnedPaymentFee: 35
    };
  }

  private defaultAdvanced(): AdvancedTermsSnapshot {
    return {
      timelyRescheduleHours: 24, curePeriodDays: 15, pastDueDays: 30,
      billingDisputeDays: 10, qualityComplaintHours: 24,
      visibleDamageHours: 48, latentDamageDays: 30,
      confidentialityYears: 2, nonSolicitMonths: 12, nonHireDamages: 5000,
      insurancePerOccurrence: 1000000, insuranceAggregate: 2000000,
      insuranceJurisdiction: 'New York',
      liabilityCapLookbackMonths: 3, disputeDiscussionDays: 30,
      creditReturnDays: 30, mediationVenue: 'Kings County, New York'
    };
  }
}
