import { Component, EventEmitter, Input, OnInit, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, forkJoin } from 'rxjs';
import {
  AdvancedTermsSnapshot, BillingCadenceSnapshot, BusinessCustomer, ContractBillingFrequency,
  ContractClient, ContractContact, ContractContactRole, ContractDetail,
  ContractPricingInput, ContractPricingPreview, ContractPriceMode, ContractService,
  ContractServiceLocation, ContractSnapshot, ContractTemplate, ContractorProfile,
  SaveContract, ScheduleSnapshot, ScopeStructure, ScopeTemplate, TermSnapshot
} from '../../../../services/contract.service';
import { InvoiceService, InvoiceTaxType } from '../../../../services/invoice.service';
import { extractApiErrorMessage } from '../../../../utils/http-error.utils';
import { applyInferredEntityType } from '../../../../utils/entity-type.utils';

/**
 * The regular service weekdays a schedule actually has.
 *
 * The list is authoritative; the legacy single `serviceDay` is the fallback for a contract drafted
 * before multiple days existed. Reading them the other way round is the bug this exists to prevent
 * — it would silently collapse a Mon/Wed/Fri schedule to one day.
 */
export function resolveServiceDays(schedule: ScheduleSnapshot | undefined): string[] {
  if (!schedule) return [];
  if (schedule.serviceDays?.length) return [...schedule.serviceDays];
  return schedule.serviceDay ? [schedule.serviceDay] : [];
}

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
  | 'location' | 'schedule' | 'billing' | 'term' | 'pricing' | 'scope' | 'advanced';

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
  private invoices = inject(InvoiceService);

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

  /**
   * True once the entity type is somebody's answer rather than something this form guessed from
   * the legal name's suffix — an admin typed it, or a saved client arrived carrying one. While it
   * is false the field follows the name; once true it is never guessed over again.
   */
  private entityTypeManuallyEdited = false;

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
  readonly ContractBillingFrequency = ContractBillingFrequency;
  readonly weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  readonly frequencyUnits = ['calendar week', 'calendar month', 'two calendar weeks'];

  /**
   * The tax rate is shown LOCKED with an Edit control rather than as a live field.
   *
   * It is the same rate on every commercial document the business issues, so the common case is
   * "confirm it" rather than "type it" — and an always-editable number invites an accidental
   * keystroke on a field that decides what a client is charged. Unlocking it is one click, and it
   * is what reveals "save as the default for future documents".
   */
  taxRateUnlocked = false;

  /** True once the saved commercial defaults have been applied to a NEW draft. */
  private defaultsApplied = false;

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
    // THE DEFAULT-FLAGGED TEMPLATE, not the first row — same rule as the contractor profile below.
    // The master agreement is versioned by ADDING a row rather than editing one, so "first" is the
    // OLDEST version: taking it meant every new contract silently kept rendering superseded
    // language (v1.0 wording, no multiple service days, no billing-cadence row) even though a
    // newer default existed.
    this.model.contractTemplateId =
      (this.templates.find(t => t.isDefault) ?? this.templates[0])?.id ?? 0;
    this.model.contractorProfileId =
      (this.contractorProfiles.find(p => p.isDefault) ?? this.contractorProfiles[0])?.id ?? 0;

    const restaurant = this.scopeTemplates.find(t => t.name === 'Restaurant') ?? this.scopeTemplates[0];
    if (restaurant) this.applyScopeTemplate(restaurant.id);

    this.model.contractorSignerEmail = this.contractorSigners[0]?.email ?? '';
    this.model.contractorSignerContactId = this.contractorSigners[0]?.id ?? null;

    this.applyBillingDefaults();
    this.refreshPricingPreview();
  }

  /**
   * Seeds the tax rate and price mode from the ONE saved source of commercial billing defaults,
   * shared with the invoice form.
   *
   * NEW DRAFTS ONLY. An existing contract is hydrated from its own snapshot, which is the whole
   * point of snapshotting the rate per document — a contract signed at 8.875% must not silently
   * re-rate because the default moved afterwards.
   *
   * A failed load is not fatal: the form keeps the values already on screen and the admin can
   * still type. Blocking contract creation on a settings read would be the wrong trade.
   */
  private applyBillingDefaults(): void {
    this.invoices.getBillingDefaults().subscribe({
      next: defaults => {
        this.defaultsApplied = true;

        // 0 = tax-inclusive, 1 = pre-tax; the two enums are deliberately identical.
        const mode = defaults.defaultContractPriceMode === ContractPriceMode.PreTax
          ? ContractPriceMode.PreTax
          : ContractPriceMode.TaxInclusive;

        const rate = defaults.defaultTaxType === InvoiceTaxType.Exempt
          ? 0
          : defaults.defaultTaxRate ?? this.model.pricing.salesTaxRatePercent;

        const changed = mode !== this.model.pricing.priceMode
          || rate !== this.model.pricing.salesTaxRatePercent;

        this.model.pricing.priceMode = mode;
        this.model.pricing.salesTaxRatePercent = rate;

        // Only re-ask when something actually moved. The form already requested a preview with
        // its own defaults, and a second identical round trip on every page load is noise.
        if (changed) this.refreshPricingPreview();
      },
      error: () => { this.defaultsApplied = true; }
    });
  }

  /** Unlocks the protected tax rate for editing. One click, and it reveals the "save" option. */
  unlockTaxRate(): void {
    this.taxRateUnlocked = true;
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
      // serviceDays is normalised below rather than taken raw: a pre-2026-09 snapshot has an empty
      // list and its day in the legacy field, and reopening such a draft must show the day it has.
      schedule: { ...snapshot.schedule, serviceDays: resolveServiceDays(snapshot.schedule) },
      billing: { ...(snapshot.billing ?? this.defaultBilling()) },
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
        // Round-tripped, never re-defaulted. A contract drafted before the fee was retired still
        // carries $35, and reopening it must not silently drop a term it already states.
        returnedPaymentFee: snapshot.pricing.returnedPaymentFee,
        saveAsDefault: false
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

    // Whatever the draft was saved with is an answer already given.
    this.entityTypeManuallyEdited = !!snapshot.client.entityType?.trim();

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

  /**
   * ENTITY TYPE FOLLOWS THE LEGAL NAME'S SUFFIX until an admin answers it themselves.
   *
   * "Chick Tastic LLC" fills in "a limited liability company" — the sentence fragment the
   * agreement body prints, which was being retyped by hand for every client. A name with no
   * recognized suffix says nothing and leaves the field alone, so this can never blank it.
   */
  onClientLegalNameChange(value: string): void {
    if (!this.model.newClient) return;

    const inferred = applyInferredEntityType(value, this.entityTypeManuallyEdited);
    if (inferred !== null) this.model.newClient.entityType = inferred;
  }

  /** A typed answer — or one picked from the list — is final and is never guessed over again. */
  onClientEntityTypeChange(): void {
    this.entityTypeManuallyEdited = true;
  }

  onClientSelected(): void {
    if (!this.selectedClientId) {
      // "New client": clear the fields rather than leaving the previous client's details behind.
      this.model.contractClientId = null;
      this.model.newClient = this.emptyClient();
      this.locations = [];
      this.clientSigners = [];
      this.selectedLocationId = null;
      this.selectedClientSignerId = null;
      this.entityTypeManuallyEdited = false;
      return;
    }

    const client = this.clients.find(c => c.id === this.selectedClientId);
    if (!client) return;

    this.model.contractClientId = client.id;

    // EVERY piece of the client's master data, in one gesture. Selecting a client used to hydrate
    // the company fields and silently drop `sourceUserId`, so re-saving an existing contract could
    // sever a linked account's access to their own My Contracts area - and the admin had to pick
    // the linked customer separately to get the rest of the hydration, which is the confusion this
    // whole selector was meant to end.
    // A saved client's entity type is already somebody's answer — never re-guess it from the name.
    this.entityTypeManuallyEdited = !!client.entityType?.trim();

    this.model.newClient = {
      legalEntityName: client.legalEntityName,
      entityType: client.entityType,
      formationState: client.formationState,
      principalAddress: client.principalAddress,
      city: client.city,
      state: client.state,
      zip: client.zip,
      noticeEmail: client.noticeEmail,
      phone: client.phone,
      sourceUserId: client.sourceUserId ?? null
    };

    // A saved client's own notice contact is what it is; mirroring the signer's over it would
    // overwrite an address staff deliberately set. The checkbox re-ticks only if they already match.
    this.useSignerContactForNotices =
      !client.noticeEmail && !client.phone;

    this.loadClientChildren(client.id);
  }

  /**
   * The account this client belongs to, for the read-only "Linked account" line.
   *
   * The ContractClient is the commercial source of truth; the account is a relationship it HAS,
   * shown so an admin can see it rather than offered as a second thing to choose. It is only
   * selectable while creating a NEW client, where there is nothing to link yet.
   */
  get linkedAccountLabel(): string | null {
    const client = this.clients.find(c => c.id === this.selectedClientId);
    if (!client?.sourceUserId) return null;

    const name = client.sourceUserName?.trim();
    const email = client.sourceUserEmail?.trim();

    if (name && email) return `${name} (${email})`;
    return name || email || `Account #${client.sourceUserId}`;
  }

  /** True while creating a new client, which is the only time the link can be chosen. */
  get isNewClient(): boolean {
    return !this.selectedClientId;
  }

  /**
   * Loads everything hanging off the selected client: its premises and its contacts.
   *
   * The contacts drive "Who signs for them", and the PRIMARY BILLING CONTACT is preselected when
   * the client has one - which is what makes a business account seeded from its website user show
   * that person here automatically instead of leaving the section blank.
   */
  private loadClientChildren(clientId: number): void {
    this.contracts.getLocations(clientId).subscribe({
      next: rows => {
        this.locations = rows;
        // One premises: preselect it. A client with several is asked, because picking the first of
        // three addresses on their behalf is how a cleaner ends up at the wrong site.
        if (rows.length === 1 && !this.selectedLocationId) {
          this.selectedLocationId = rows[0].id;
          this.onLocationSelected();
        }
      },
      error: () => this.locations = []
    });

    this.contracts.getContacts(ContractContactRole.ClientSigner, clientId).subscribe({
      next: rows => {
        this.clientSigners = rows;
        if (rows.length > 0 && !this.selectedClientSignerId) {
          this.selectedClientSignerId = rows[0].id;
          this.onClientSignerSelected();
        }
      },
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

    // ── That account may ALREADY be a commercial client ──
    //
    // Ticking the business flag on a customer auto-creates their ContractClient, so by the time an
    // admin can pick the account here, its client almost always exists. Switching the selector to
    // it is what the admin meant, and it is the difference between hydrating a company that has
    // history and starting a second, empty record for the same business. The server adopts the
    // existing row either way — the unique link column makes a duplicate impossible — but doing it
    // here means the form shows the real client, its contacts and its locations immediately rather
    // than only after a save.
    const existing = this.clients.find(c => c.sourceUserId === userId);
    if (existing) {
      this.selectedClientId = existing.id;
      this.onClientSelected();
      return;
    }

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

  // ── schedule: regular service days ─────────────────────────────────────────
  //
  // "Regular day" stops meaning anything once a client is cleaned three times a week, so the
  // control is a MULTI-SELECT and the label follows the count. One day and several days are the
  // same control, not two - a single-visit contract simply has one chip ticked.

  /** Ticked days, always read through the legacy fallback. */
  get selectedServiceDays(): string[] {
    return resolveServiceDays(this.model.schedule);
  }

  isServiceDaySelected(day: string): boolean {
    return this.selectedServiceDays.includes(day);
  }

  /**
   * Toggles one weekday.
   *
   * The legacy `serviceDay` is kept in step with the first selected day so an export, an older
   * reader or a partially-deployed instance never shows a weekday the contract does not have. The
   * server normalises this again on save; doing it here as well is what keeps the FORM honest
   * while the admin is still typing.
   */
  toggleServiceDay(day: string): void {
    const current = this.selectedServiceDays;
    const next = current.includes(day)
      ? current.filter(d => d !== day)
      : [...current, day];

    // Monday-first, so "Friday, Monday, Wednesday" never reaches the agreement.
    const ordered = this.weekdays.filter(d => next.includes(d));

    this.model.schedule.serviceDays = ordered;
    this.model.schedule.serviceDay = ordered[0] ?? '';
  }

  /** "Regular service day" for one, "Regular service days" for several. */
  get serviceDaysLabel(): string {
    return this.model.schedule.visitsPerPeriod > 1 || this.selectedServiceDays.length > 1
      ? 'Regular service days'
      : 'Regular day';
  }

  /**
   * The mismatch warning between how many visits were promised and how many days were picked.
   *
   * A WARNING, NEVER A BLOCK, and it is silent when scheduling is flexible: a flexible contract
   * describes ANTICIPATED days, and an incomplete list there is a legitimate statement about an
   * arrangement that is not fixed yet. With flexible scheduling off the days ARE the schedule, and
   * promising three visits while naming two days is a contradiction the client would spot.
   */
  get serviceDayCountWarning(): string | null {
    if (this.model.schedule.flexibleScheduling) return null;

    const picked = this.selectedServiceDays.length;
    const promised = Math.max(1, this.model.schedule.visitsPerPeriod);

    if (picked === 0) {
      return 'Choose at least one regular service day.';
    }
    if (picked !== promised) {
      return `This contract promises ${promised} visit${promised === 1 ? '' : 's'} per `
        + `${this.model.schedule.frequencyUnit} but names ${picked} service `
        + `day${picked === 1 ? '' : 's'}. Adjust one of the two, or turn on flexible scheduling.`;
    }
    return null;
  }

  // ── billing cadence ────────────────────────────────────────────────────────

  /** Whether the "every N" box is meaningful for the chosen cadence. */
  get showBillingInterval(): boolean {
    return this.model.billing.frequency !== ContractBillingFrequency.PerServiceVisit;
  }

  /** Plain-language echo of the cadence, so "every 1 weeks" never appears on screen. */
  get billingCadenceText(): string {
    const n = Math.max(1, this.model.billing.intervalCount || 1);

    switch (this.model.billing.frequency) {
      case ContractBillingFrequency.PerServiceVisit:
        return 'An invoice is issued for each scheduled cleaning.';
      case ContractBillingFrequency.Weekly:
        return n === 1
          ? 'An invoice is issued every week.'
          : `An invoice is issued every ${n} weeks.`;
      case ContractBillingFrequency.CustomDays:
        return `An invoice is issued every ${n} days.`;
      default:
        return n === 1
          ? 'An invoice is issued every month.'
          : `An invoice is issued every ${n} months.`;
    }
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

  /**
   * Adds a whole category to THIS draft — "Outdoor seating", say.
   *
   * The key is derived from the title and prefixed so it can never collide with one of the
   * standard keys the agreement body inlines ({{SCOPE:included-areas}} and friends). A key the
   * body does not know is APPENDED to the document under "Additional Scope" rather than dropped,
   * which is what makes a custom category safe to add without touching the template.
   */
  addScopeGroup(title: string, input: HTMLInputElement): void {
    const trimmed = (title ?? '').trim();
    if (!trimmed) return;

    const key = 'custom-' + trimmed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50);

    this.model.scope.groups.push({
      key: key === 'custom-' ? 'custom-scope' : key,
      title: trimmed,
      kind: 'included',
      inline: true,
      items: []
    });

    input.value = '';
  }

  /**
   * Removes a category from THIS draft only.
   *
   * The master business type is a deep copy away and is untouched — retiring a category there is
   * a separate, deliberate act on the Business Types screen, and it would affect every future
   * contract rather than this one.
   */
  removeScopeGroup(groupIndex: number): void {
    this.model.scope.groups.splice(groupIndex, 1);
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
      billing: this.defaultBilling(),
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
      serviceDay: 'Sunday', serviceDays: ['Sunday'], serviceTime: '9:00 AM',
      flexibleScheduling: true, performedWhileClosed: true,
      accessType: 'key or other access credentials provided by Client'
    };
  }

  /** Monthly-every-one: the arrangement almost every commercial client is actually on. */
  private defaultBilling(): BillingCadenceSnapshot {
    return {
      frequency: ContractBillingFrequency.Monthly,
      intervalCount: 1,
      anchorDate: null
    };
  }

  /**
   * Committed for six months, then month-to-month with sixty days notice (2026-09).
   *
   * These are the terms actually being offered. They apply to NEW drafts only — every generated
   * version carries its own frozen copy, so nothing already signed moves when this changes.
   */
  private defaultTerm(): TermSnapshot {
    return {
      initialTermMonths: 6, minimumCommitmentMonths: 6, terminationNoticeDays: 60,
      renewalType: 'month-to-month', governingLawState: 'New York', venueCounty: 'Kings County'
    };
  }

  /**
   * Tax-inclusive at 8.875%, and NO returned-payment fee.
   *
   * The tax mode and rate are overwritten from the saved commercial defaults as soon as they
   * load — these are only what the form shows in the moment before that arrives. The fee is
   * hard zero: it is retired for new contracts and is not on the form at all, so there is nothing
   * for it to be overwritten from.
   */
  private defaultPricing(): ContractPricingInput {
    return {
      priceMode: ContractPriceMode.TaxInclusive, priceInput: 0, salesTaxRatePercent: 8.875,
      cancellationPercent: 50,
      invoiceTiming: 'In advance of each scheduled service visit, generally several days before service.',
      paymentDeadlineHours: 48, paymentMethod: 'ACH or bank-to-bank transfer',
      lateChargePercent: 1.5, returnedPaymentFee: 0, saveAsDefault: false
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
