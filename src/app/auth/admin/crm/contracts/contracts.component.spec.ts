import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { Router, provideRouter } from '@angular/router';

import { ContractsComponent } from './contracts.component';
import { ContractFormComponent } from './contract-form.component';
import { ContractDetailComponent } from './contract-detail.component';
import { ContractPriceMode, ContractStatus } from '../../../../services/contract.service';

/**
 * The Contracts tab, its form and its detail page. These specs exist mainly to hold the two rules
 * the UI is responsible for communicating honestly:
 *
 *  - Generating a preview notifies nobody. The form must never imply otherwise, and it must land
 *    on the preview rather than back on the list.
 *  - The form never computes a contract figure. Pre-tax / tax / total / cancellation come back
 *    from the server, so the numbers on screen are the numbers that reach Exhibit B.
 */
describe('ContractsComponent', () => {
  let fixture: ComponentFixture<ContractsComponent>;
  let component: ContractsComponent;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ContractsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])]
    }).compileComponents();

    fixture = TestBed.createComponent(ContractsComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify({ ignoreCancelled: true });
  });

  function flushList(rows: any[] = []): void {
    const request = http.expectOne(r => r.url.endsWith('/crm/contracts'));
    request.flush(rows);
  }

  /** The tab asks the server what this account may do; every action button reads from it. */
  function flushPermissions(overrides: Record<string, boolean> = {}): void {
    http.expectOne(r => r.url.endsWith('/my-permissions')).flush({
      viewContracts: true, createContract: true, generatePreview: true,
      sendForReview: true, sendForSignature: true, duplicate: true,
      regenerateExecutedPdf: true, resendExecutedCopy: true,
      backToEdit: true, createRevision: true, createAmendment: true,
      deleteContract: true, restoreContract: true, signAsContractor: true,
      toggleBusinessFlag: true, assignOrgTitle: true,
    authority: 'cto',
      ...overrides
    });
  }

  it('should create and load the contract list', () => {
    fixture.detectChanges();
    flushPermissions();
    flushList();
    expect(component).toBeTruthy();
    expect(component.view).toBe('list');
  });

  it('opens the detail view for a deep link from an email', () => {
    component.openContractId = 42;
    fixture.detectChanges();
    flushPermissions();
    flushList();

    expect(component.view).toBe('detail');
    expect(component.selectedContractId).toBe(42);

    // The detail child mounts and fetches that contract — the whole point of the deep link.
    http.expectOne(r => r.url.endsWith('/crm/contracts/42')).flush({
      id: 42, contractNumber: 'DC-2026-0042', status: ContractStatus.Draft, statusLabel: 'Draft',
      draft: {
        contractor: { legalEntityName: 'Nodar Alania Inc.' },
        client: { legalEntityName: 'Chick Tastic LLC' },
        contractorSigner: { firstName: 'Nodar', lastName: 'Alania' },
        clientSigner: { firstName: 'Natalie', lastName: 'Finkels' }
      },
      documentHtml: '', unresolvedTokens: [], versions: [], signers: [], auditLog: []
    });
  });

  it('renders a signature progress summary rather than a bare count', () => {
    expect(component.signatureProgress({ signedCount: 1, signerCount: 2 } as any))
      .toBe('1 of 2 signed');
    // Nothing has been sent for signature yet — "0 of 0 signed" would read as a problem.
    expect(component.signatureProgress({ signedCount: 0, signerCount: 0 } as any)).toBe('—');
  });

  it('lands on the generated preview, not back on the list', () => {
    fixture.detectChanges();
    flushPermissions();
    flushList();

    component.onGenerated({ id: 7, status: ContractStatus.PreviewGenerated } as any);
    flushList();

    expect(component.view).toBe('detail');
    expect(component.selectedContractId).toBe(7);
    // Handed straight through, so the preview does not re-fetch what it was just given.
    expect(component.preloadedDetail?.id).toBe(7);
  });

  // ── Create next invoice, from the list ───────────────────────────────────
  //
  // It used to live only in one contract's detail action bar, among up to ten buttons. Billing a
  // contract is the routine thing an admin does with this list, so it is a per-row action.

  // ELIGIBILITY IS THE SERVER'S ANSWER (2026-09). It used to be re-derived here as "not hidden
  // and past Draft", which let an awaiting-signature, partially-signed, needs-revision, voided or
  // expired contract through — and invoicing any of those bills a client for terms they have not
  // accepted. The rule now lives in ContractInvoiceEligibility, the endpoint enforces it, and the
  // row carries the verdict; these tests assert the component READS it rather than second-guessing.

  it('offers Create next invoice when the server says the contract is billable', () => {
    // The FIRST invoice on a signed agreement is exactly the case this is wanted for. Having no
    // previous invoice must never hide the action — the generator falls back to the contract's own
    // pricing when there is nothing to model on, and the server flag is a pure function of status,
    // so it cannot see invoice history in the first place.
    expect(component.canCreateNextInvoice(
      { id: 1, status: ContractStatus.Completed, isHidden: false,
        canCreateNextInvoice: true } as any)).toBeTrue();
  });

  it('withholds it whenever the server says so, whatever the status looks like', () => {
    expect(component.canCreateNextInvoice(
      { id: 2, status: ContractStatus.Draft, isHidden: false,
        canCreateNextInvoice: false } as any)).toBeFalse();

    // Deleted, even though it is Completed.
    expect(component.canCreateNextInvoice(
      { id: 3, status: ContractStatus.Completed, isHidden: true,
        canCreateNextInvoice: false } as any)).toBeFalse();

    // The case the old local rule got WRONG: partially signed is not an executed agreement.
    expect(component.canCreateNextInvoice(
      { id: 4, status: ContractStatus.PartiallySigned, isHidden: false,
        canCreateNextInvoice: false } as any)).toBeFalse();
  });

  it('renders the button in the row, not only inside the detail view', () => {
    fixture.detectChanges();
    flushPermissions();
    flushList([{
      id: 9, contractNumber: 'DCC-2026-48392175', clientLegalName: 'Chick Tastic LLC',
      serviceLocationLabel: '1569 Flatbush Ave', status: ContractStatus.Completed,
      statusLabel: 'Completed', currentVersionNumber: 1, createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z', totalPrice: 925.43,
      signedCount: 2, signerCount: 2, isHidden: false,
      // The server's verdict — the row renders the button from this, not from its status.
      canCreateNextInvoice: true
    }]);
    fixture.detectChanges();

    const button: HTMLButtonElement | null =
      fixture.nativeElement.querySelector('.btn-row-action');
    expect(button).withContext('the list row carries its own billing action').not.toBeNull();
    expect(button!.textContent).toContain('Create next invoice');
  });

  it('creates a DRAFT and lands on its edit form, emailing nobody', () => {
    fixture.detectChanges();
    flushPermissions();
    flushList();

    const router = TestBed.inject(Router);
    const navigate = spyOn(router, 'navigate');

    component.createNextInvoice(
      { id: 9, status: ContractStatus.Completed, isHidden: false } as any);

    const request = http.expectOne(r => r.url.endsWith('/from-contract/9'));
    expect(request.request.body).toEqual({ allowDuplicatePeriod: false });
    request.flush({ invoice: { id: 55, invoiceNumber: 'DCI-2026-10713354' }, warnings: [] });

    // The EDIT form, not the read-only detail: reviewing the generated dates and figures before
    // anything is sent is the entire reason the draft exists.
    expect(navigate).toHaveBeenCalledWith(['/admin/commercial/invoices', 55, 'edit']);
    expect(component.billingContractId).toBeNull();
  });

  it('clears the preloaded detail when returning to the list', () => {
    fixture.detectChanges();
    flushPermissions();
    flushList();

    component.onGenerated({ id: 7 } as any);
    flushList();
    component.backToList();
    flushList();

    expect(component.view).toBe('list');
    expect(component.preloadedDetail).toBeNull();
    expect(component.selectedContractId).toBeNull();
  });
});

describe('ContractFormComponent', () => {
  let fixture: ComponentFixture<ContractFormComponent>;
  let component: ContractFormComponent;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ContractFormComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])]
    }).compileComponents();

    fixture = TestBed.createComponent(ContractFormComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify({ ignoreCancelled: true }));

  /** Answers the six reference-data requests the form fires on init. */
  function flushReferenceData(): void {
    http.expectOne(r => r.url.endsWith('/contract-templates'))
      .flush([{ id: 1, name: 'MSA', version: '1.0', isActive: true }]);
    http.expectOne(r => r.url.endsWith('/scope-templates'))
      .flush([{
        id: 5, name: 'Restaurant', premisesType: 'restaurant', allowsCustomRows: false,
        structure: {
          groups: [{
            key: 'included-areas', title: 'Included Areas', kind: 'included', inline: true,
            items: [{ label: 'Dining area', selected: true }, { label: 'Office', selected: true }]
          }]
        }
      }]);
    // Carries a notice email and phone, because Exhibit B4's contractor contacts are seeded from
    // the PROFILE rather than from constants in the form.
    http.expectOne(r => r.url.endsWith('/contractor-profiles'))
      .flush([{
        id: 2, legalEntityName: 'Nodar Alania Inc.', isDefault: true,
        noticeEmail: 'hello@dreamcleaningnyc.com', phone: '9299301525'
      }]);
    http.expectOne(r => r.url.endsWith('/clients')).flush([]);
    http.expectOne(r => r.url.includes('/contacts')).flush([]);
    // Business-flagged accounts, for the "linked customer account" picker.
    http.expectOne(r => r.url.includes('/business-customers')).flush([{
      userId: 77, fullName: 'Natalie Finkels',
      firstName: 'Natalie', lastName: 'Finkels',
      email: 'natalie@example.com', phone: '7325471819',
      address: '1569 Flatbush Ave.', city: 'Brooklyn', state: 'NY', zip: '11210'
    }]);

    // The ONE saved source of commercial billing defaults, shared with the invoice form. Flushed
    // with exactly what the form already defaults to, so it does not trigger a second pricing
    // preview — see applyBillingDefaults, which only re-asks when something actually moved.
    http.expectOne(r => r.url.endsWith('/billing-settings/defaults')).flush({
      defaultTaxType: 1, defaultTaxRate: 8.875, defaultContractPriceMode: 0, defaultDueTerms: 2,
      achCustomerFeeEnabled: true, achCustomerFeeRatePercent: 0.8, achCustomerFeeCapAmount: 5
    });
  }

  /** The form asks the server to echo the derived figures as soon as it has its defaults. */
  function flushPricingPreview(): void {
    http.expectOne(r => r.url.endsWith('/pricing-preview')).flush({
      preTaxPrice: 0, salesTaxAmount: 0, totalPrice: 0,
      cancellationAmount: 0, remainingBalance: 0, lockoutFee: 0,
      liabilityCapAmount: 0, lateChargeAnnualPercent: 0
    });
  }

  it('defaults to the seeded template, the default contractor profile and the Restaurant scope', () => {
    fixture.detectChanges();
    flushReferenceData();

    flushPricingPreview();

    expect(component.model.contractTemplateId).toBe(1);
    expect(component.model.contractorProfileId).toBe(2);
    expect(component.model.scopeTemplateId).toBe(5);
    expect(component.model.scope.groups.length).toBe(1);
  });

  /**
   * THE DEFAULT-FLAGGED TEMPLATE WINS, NOT THE FIRST ROW.
   *
   * The master agreement is versioned by ADDING a row rather than editing one, so the list can
   * legitimately contain v1.0 and v1.1 at once and "first" is the OLDEST. Taking templates[0] meant
   * every new contract silently kept rendering superseded language — caught in the deployment smoke
   * test, where a freshly generated contract came out with the v1.0 body despite v1.1 being seeded
   * and flagged default.
   */
  it('preselects the DEFAULT contract template, not whichever arrives first', () => {
    fixture.detectChanges();

    http.expectOne(r => r.url.endsWith('/contract-templates')).flush([
      { id: 1, name: 'MSA', version: '1.0', isActive: true, isDefault: false },
      { id: 2, name: 'MSA', version: '1.1', isActive: true, isDefault: true }
    ]);
    http.expectOne(r => r.url.endsWith('/scope-templates')).flush([]);
    http.expectOne(r => r.url.endsWith('/contractor-profiles')).flush([]);
    http.expectOne(r => r.url.endsWith('/clients')).flush([]);
    http.expectOne(r => r.url.includes('/contacts')).flush([]);
    http.expectOne(r => r.url.includes('/business-customers')).flush([]);
    http.expectOne(r => r.url.endsWith('/billing-settings/defaults')).flush({
      defaultTaxType: 1, defaultTaxRate: 8.875, defaultContractPriceMode: 0, defaultDueTerms: 2,
      achCustomerFeeEnabled: true, achCustomerFeeRatePercent: 0.8, achCustomerFeeCapAmount: 5
    });
    flushPricingPreview();

    expect(component.model.contractTemplateId).toBe(2);
  });

  it('copies the scope template rather than sharing it, so toggling never edits the template', () => {
    fixture.detectChanges();
    flushReferenceData();
    http.expectOne(r => r.url.endsWith('/pricing-preview')).flush({});

    component.model.scope.groups[0].items[0].selected = false;

    // The template the picker still offers is untouched.
    expect(component.scopeTemplates[0].structure.groups[0].items[0].selected).toBe(true);
  });

  it('asks the SERVER for every derived figure instead of computing one', () => {
    fixture.detectChanges();
    flushReferenceData();

    const request = http.expectOne(r => r.url.endsWith('/pricing-preview'));
    expect(request.request.method).toBe('POST');
    // Only the admin's own inputs are sent; nothing derived is posted back.
    // Tax-inclusive by default since 2026-09: the amount a commercial client agrees to is the
    // amount they pay, and quoting pre-tax then adding 8.875% at invoice time is not what was
    // discussed.
    expect(request.request.body.priceMode).toBe(ContractPriceMode.TaxInclusive);
    expect(request.request.body.salesTaxRatePercent).toBe(8.875);

    // The liability cap is one of the admin's own inputs — a multiple. The AMOUNT it produces is
    // derived server-side like every other figure the agreement quotes.
    expect(request.request.body.liabilityCapMultiple).toBe(13);

    // The caps come back built on the PRE-TAX fee: 50% of $849.99 is $425.00, not half of the
    // tax-inclusive $925.43. Tax attaches to a completed visit, and a cancelled one is not.
    request.flush({
      preTaxPrice: 849.99, salesTaxAmount: 75.44, totalPrice: 925.43,
      cancellationAmount: 425.00, remainingBalance: 424.99, lockoutFee: 849.99,
      liabilityCapAmount: 11049.87, lateChargeAnnualPercent: 12
    });

    expect(component.pricingPreview?.totalPrice).toBe(925.43);
    expect(component.pricingPreview?.cancellationAmount).toBe(425.00);
  });

  it('defaults every advanced term to the drafted agreement', () => {
    fixture.detectChanges();
    flushReferenceData();

    flushPricingPreview();

    // An admin who never opens the Advanced panel must produce the standard wording.
    expect(component.model.advanced.curePeriodDays).toBe(15);
    expect(component.model.advanced.confidentialityYears).toBe(2);
    expect(component.model.advanced.makeupWindowDays).toBe(14);
    expect(component.model.advanced.lockoutWaitMinutes).toBe(20);
    expect(component.model.advanced.qualityComplaintHours).toBe(48);
    expect(component.model.pricing.cancellationPercent).toBe(50);

    // A MULTIPLE of the per-visit fee, not a lookback in months. A months-based cap moves every
    // time the visit frequency or billing cadence changes, so the ceiling a client agreed to
    // would silently drift.
    expect(component.model.pricing.liabilityCapMultiple).toBe(13);

    // TERM DEFAULTS (2026-09-15): committed for TEN months, then month-to-month on sixty days
    // notice. New drafts only — every generated version freezes its own copy, so changing these
    // can never move a contract that already exists.
    //
    // These three MIRROR `TermSnapshot`'s server-side defaults, asserted in
    // `CommercialBillingUpgradeTests.NewContract_TermDefaults_AreTenSixtyAndMonthToMonth`. The
    // server fills in a draft that arrives without them, so a number changed on one side only
    // produces a contract whose preview disagrees with the form that submitted it.
    expect(component.model.term.initialTermMonths).toBe(10);
    expect(component.model.term.minimumCommitmentMonths).toBe(10);
    expect(component.model.term.terminationNoticeDays).toBe(60);
    expect(component.model.term.renewalType).toBe('month-to-month');

    // NOT seeded with today. The minimum-commitment and initial-term end dates are both derived
    // from it, so a default would print three confident dates nobody chose — and would shorten
    // the commitment on any contract signed ahead of its start.
    expect(component.model.term.serviceCommencementDate).toBeNull();

    // The $35 failed-payment fee is RETIRED and has no field on the form. At zero the clause is
    // dropped from the generated agreement rather than printed as "$0.00".
    expect(component.model.pricing.returnedPaymentFee).toBe(0);
  });

  // ── the drafted agreement's new inputs ────────────────────────────────────

  /**
   * THE SCHEDULE IS AN ARRIVAL WINDOW, and the legacy single start time follows its opening.
   *
   * Section 14 only permits a failed-access charge when the crew arrived INSIDE the agreed
   * window, so both ends of it are contract data. The legacy field is kept in step so an export
   * or an older reader never shows a start time the contract does not have — the same rule
   * `serviceDay` follows behind `serviceDays`.
   */
  it('keeps the legacy start time in step with the arrival window', () => {
    fixture.detectChanges();
    flushReferenceData();
    flushPricingPreview();

    expect(component.model.schedule.arrivalWindowStart).toBe('8:30 AM');
    expect(component.model.schedule.arrivalWindowEnd).toBe('9:30 AM');
    expect(component.model.schedule.serviceTime).toBe('8:30 AM');

    component.model.schedule.arrivalWindowStart = '6:00 AM';
    component.onArrivalWindowChange();

    expect(component.model.schedule.serviceTime).toBe('6:00 AM');
  });

  /**
   * Exhibit A's site facts start EMPTY. Nothing here can be guessed from another record, and a
   * plausible-looking default would be printed in an executed agreement as though somebody had
   * walked the building and verified it.
   */
  it('leaves every Exhibit A site detail blank rather than guessing one', () => {
    fixture.detectChanges();
    flushReferenceData();
    flushPricingPreview();

    expect(component.model.siteDetails.approximateSquareFootage).toBe('');
    expect(component.model.siteDetails.customerRestroomCounts).toBe('');
    expect(component.model.siteDetails.foodServicePermitHolder).toBe('');
    expect(component.model.siteDetails.foodContactSanitizing).toBe('');
  });

  /**
   * THE CLIENT IS NEVER ASKED FOR A MAILING ADDRESS (2026-09-15).
   *
   * Template v2.2 identifies the Client by legal entity in the preamble, dropped the Exhibit B4
   * row, and serves formal notice on the notice email under Section 32. A box that reaches no
   * part of the document is worse than no box — an admin would chase a client for an address
   * nobody is going to print, and a value typed into it would silently go nowhere.
   *
   * The model FIELD survives so a draft written before this round-trips unchanged; only the
   * input is gone.
   */
  it('no longer asks the client for a formal notice mailing address', () => {
    fixture.detectChanges();
    flushReferenceData();
    flushPricingPreview();

    component.openPanels.add('contacts');
    fixture.detectChanges();

    const dom = fixture.nativeElement as HTMLElement;
    expect(dom.querySelector('#clientNoticeMailingAddress')).toBeNull();
    // The email the notice actually goes to is still collected.
    expect(dom.querySelector('#clientOperationalEmail')).not.toBeNull();

    // Still on the model, still posted, so an older draft is not silently stripped on re-save.
    component.model.contacts.clientNoticeMailingAddress = '12 Water Street, Jersey City, NJ';
    expect(component.model.contacts.clientNoticeMailingAddress)
      .toBe('12 Water Street, Jersey City, NJ');
  });

  /**
   * Floor materials and the food-service permit holder are OPTIONAL, and the form has to say so.
   *
   * Both used to print a ruled blank and land in the preview's unresolved-token banner when left
   * empty, which is how an optional field comes to look mandatory to the person filling it in.
   * Nothing in the agreement depends on either: A4 obliges surface-appropriate products whether
   * or not the materials were recorded, and Section 26(b) leaves the client responsible for its
   * own permits whether or not a holder was named.
   */
  it('labels the two fully optional Exhibit A details as optional', () => {
    fixture.detectChanges();
    flushReferenceData();
    flushPricingPreview();

    component.openPanels.add('siteDetails');
    fixture.detectChanges();

    const dom = fixture.nativeElement as HTMLElement;
    const floorLabel = dom.querySelector('label[for="floorMaterials"]')?.textContent ?? '';
    const permitLabel = dom.querySelector('label[for="foodPermitHolder"]')?.textContent ?? '';

    expect(floorLabel).toContain('optional');
    expect(permitLabel).toContain('optional');
  });

  /**
   * THE BACKUP ON-CALL CONTACTS ARE OPTIONAL, AND THE FORM HAS TO SAY SO (2026-09-16).
   *
   * Section 16(c) asks the client for a PRIMARY contact and says a backup is one it may designate
   * if available, so an unfilled box is not an unanswered question. It used to print a ruled blank
   * in Exhibit B4 and land in the preview's unresolved-token banner, which is how an optional
   * field comes to look mandatory to the person filling the form in.
   *
   * Both sides, because the contractor's half is seeded from the profile and an account with one
   * supervisor and nobody behind them is the ordinary case there too.
   */
  it('labels both backup on-call contacts as optional', () => {
    fixture.detectChanges();
    flushReferenceData();
    flushPricingPreview();

    component.openPanels.add('contacts');
    fixture.detectChanges();

    const dom = fixture.nativeElement as HTMLElement;
    const contractorLabel =
      dom.querySelector('label[for="contractorBackupContact"]')?.textContent ?? '';
    const clientLabel =
      dom.querySelector('label[for="clientBackupContact"]')?.textContent ?? '';

    expect(contractorLabel).toContain('optional');
    expect(clientLabel).toContain('optional');

    // The PRIMARIES are not relabelled — Section 14 hangs a failed-access charge on Contractor
    // having tried to reach one, so those stay questions the preview is entitled to chase.
    const clientPrimary = dom.querySelector('label[for="clientOnCallName"]')?.textContent ?? '';
    expect(clientPrimary).not.toContain('optional');
  });

  /**
   * And optional has to mean optional at the point it counts: a draft with neither backup filled
   * in saves and generates, with nothing on the client half of the form objecting.
   */
  it('saves and generates a draft with both backup contacts left blank', () => {
    fixture.detectChanges();
    flushReferenceData();
    http.expectOne(r => r.url.endsWith('/pricing-preview')).flush({});

    component.model.newClient!.legalEntityName = 'Chick Tastic LLC';
    component.model.newClient!.principalAddress = '1569 Flatbush Ave.';
    component.model.newServiceLocation!.address = '1569 Flatbush Ave.';
    component.model.newClientSigner!.firstName = 'Natalie';
    component.model.newClientSigner!.lastName = 'Finkels';
    component.model.newClientSigner!.email = 'n@example.com';
    component.model.pricing.priceInput = 849.99;
    component.model.contacts.contractorBackupContact = '';
    component.model.contacts.clientBackupContact = '';

    let emitted: any = null;
    component.generated.subscribe(d => emitted = d);
    component.generatePreview();

    expect(component.errorMessage).toBeFalsy();

    const saved = http.expectOne(r => r.method === 'POST' && r.url.endsWith('/crm/contracts'));
    // Still POSTED, as empty strings rather than dropped keys — the fields stay on the model so a
    // draft that DOES carry a backup round-trips it unchanged.
    expect(saved.request.body.contacts.contractorBackupContact).toBe('');
    expect(saved.request.body.contacts.clientBackupContact).toBe('');
    saved.flush({ id: 11 });

    http.expectOne(r => r.url.endsWith('/11/generate-preview'))
      .flush({ id: 11, status: ContractStatus.PreviewGenerated });

    expect(emitted?.id).toBe(11);
  });

  /**
   * The contractor's operational contacts come from the PROFILE, not from constants in the form.
   * A hardcoded number would be wrong the day the business changes it, and wrong silently —
   * inside the clause that tells a client where to send a cancellation that stops a charge.
   */
  it('seeds the contractor contacts from the selected profile', () => {
    fixture.detectChanges();
    flushReferenceData();
    flushPricingPreview();

    expect(component.model.contacts.contractorOperationalEmail).toBe('hello@dreamcleaningnyc.com');
    expect(component.model.contacts.contractorSupervisorPhone).toBeTruthy();
  });

  /** Reselecting a profile must not wipe a supervisor an admin typed for this contract. */
  it('never overwrites a contact the admin has already typed', () => {
    fixture.detectChanges();
    flushReferenceData();
    flushPricingPreview();

    component.model.contacts.contractorSupervisorName = 'Weekend crew lead';
    component.onContractorProfileChange();

    expect(component.model.contacts.contractorSupervisorName).toBe('Weekend crew lead');
  });

  /**
   * The two derived term dates are echoed under the commencement field, using month arithmetic
   * that CLAMPS like the server's. A plain setMonth rolls 31 January into 3 March, so the form
   * would advertise a commitment end date the document would never print.
   */
  it('echoes the derived term dates, clamping a short month like the server does', () => {
    fixture.detectChanges();
    flushReferenceData();
    flushPricingPreview();

    expect(component.termDatesHint).toContain('run from this date');

    component.model.term.serviceCommencementDate = '2026-01-31';
    component.model.term.minimumCommitmentMonths = 1;
    component.model.term.initialTermMonths = 6;

    expect(component.termDatesHint).toContain('February 28, 2026');
    expect(component.termDatesHint).toContain('July 30, 2026');
  });

  it('pre-fills the client and signer from a linked customer account', () => {
    fixture.detectChanges();
    flushReferenceData();
    flushPricingPreview();

    component.model.newClient!.sourceUserId = 77;
    component.onSourceUserSelected();

    // The signer IS that person, so their identity is filled in outright.
    expect(component.model.newClientSigner!.firstName).toBe('Natalie');
    expect(component.model.newClientSigner!.lastName).toBe('Finkels');
    expect(component.model.newClientSigner!.email).toBe('natalie@example.com');
    // Their address seeds the company's, which the admin can then correct.
    expect(component.model.newClient!.principalAddress).toBe('1569 Flatbush Ave.');
    expect(component.model.newClient!.city).toBe('Brooklyn');
    expect(component.model.newClient!.zip).toBe('11210');
  });

  it('never guesses the legal entity name from the linked person', () => {
    // A business is not its owner. Filling "Natalie Finkels" in as the counterparty on a legal
    // agreement would be worse than leaving it blank.
    fixture.detectChanges();
    flushReferenceData();
    flushPricingPreview();

    component.model.newClient!.sourceUserId = 77;
    component.onSourceUserSelected();

    expect(component.model.newClient!.legalEntityName).toBe('');
  });

  it('does not overwrite a company address the admin has already typed', () => {
    fixture.detectChanges();
    flushReferenceData();
    flushPricingPreview();

    component.model.newClient!.principalAddress = '2000 Kings Highway';
    component.model.newClient!.sourceUserId = 77;
    component.onSourceUserSelected();

    expect(component.model.newClient!.principalAddress).toBe('2000 Kings Highway');
  });

  it('mirrors the signer contact into the notice fields while the box is ticked', () => {
    // Section 32 renders the CLIENT's notice email, so the mirror has to reach the model — the
    // checkbox alone would leave those columns empty.
    fixture.detectChanges();
    flushReferenceData();
    flushPricingPreview();

    expect(component.useSignerContactForNotices).toBe(true);

    component.model.newClientSigner!.email = 'ap@northline.example';
    component.model.newClientSigner!.phone = '2125551234';
    component.onSignerContactChanged();

    expect(component.model.newClient!.noticeEmail).toBe('ap@northline.example');
    expect(component.model.newClient!.phone).toBe('2125551234');
  });

  it('leaves the notice contact alone once the box is unticked', () => {
    fixture.detectChanges();
    flushReferenceData();
    flushPricingPreview();

    component.useSignerContactForNotices = false;
    component.model.newClient!.noticeEmail = 'legal@northline.example';
    component.model.newClientSigner!.email = 'dana@northline.example';
    component.onSignerContactChanged();

    expect(component.model.newClient!.noticeEmail).toBe('legal@northline.example');
  });

  it('keeps the Advanced panel collapsed and the essentials open', () => {
    fixture.detectChanges();
    flushReferenceData();

    flushPricingPreview();

    expect(component.isOpen('advanced')).toBe(false);
    expect(component.isOpen('client')).toBe(true);
    // The service location gets its own open panel — it is never inherited from the client.
    expect(component.isOpen('location')).toBe(true);
  });

  it('refuses to generate without a service location address', () => {
    fixture.detectChanges();
    flushReferenceData();
    http.expectOne(r => r.url.endsWith('/pricing-preview')).flush({});

    component.model.newClient!.legalEntityName = 'Chick Tastic LLC';
    component.model.newClient!.principalAddress = '1569 Flatbush Ave.';
    component.model.newClientSigner!.firstName = 'Natalie';
    component.model.newClientSigner!.lastName = 'Finkels';
    component.model.newClientSigner!.email = 'n@example.com';
    component.model.pricing.priceInput = 849.99;
    component.model.newServiceLocation!.address = '';

    component.generatePreview();

    expect(component.errorMessage).toContain('service location');
    http.expectNone(r => r.method === 'POST' && r.url.endsWith('/crm/contracts'));
  });

  it('saves and then generates, so the preview always matches what was persisted', () => {
    fixture.detectChanges();
    flushReferenceData();
    http.expectOne(r => r.url.endsWith('/pricing-preview')).flush({});

    component.model.newClient!.legalEntityName = 'Chick Tastic LLC';
    component.model.newClient!.principalAddress = '1569 Flatbush Ave.';
    component.model.newServiceLocation!.address = '1569 Flatbush Ave.';
    component.model.newClientSigner!.firstName = 'Natalie';
    component.model.newClientSigner!.lastName = 'Finkels';
    component.model.newClientSigner!.email = 'n@example.com';
    component.model.pricing.priceInput = 849.99;

    let emitted: any = null;
    component.generated.subscribe(d => emitted = d);
    component.generatePreview();

    http.expectOne(r => r.method === 'POST' && r.url.endsWith('/crm/contracts')).flush({ id: 11 });
    http.expectOne(r => r.url.endsWith('/11/generate-preview'))
      .flush({ id: 11, status: ContractStatus.PreviewGenerated });

    expect(emitted?.id).toBe(11);
  });

  // ── reopening a draft saved on a superseded agreement version ──────────────
  //
  // The master agreement is versioned by ADDING a row and retiring the old one, and the picker
  // lists ACTIVE templates only. So a draft saved on a version that has since been withdrawn
  // holds an id that matches no option: the select renders blank while the model quietly keeps
  // the retired version and sends it straight back on save. That is how a draft went on printing
  // the withdrawn wording — hand soap and a signature block above the exhibits — with nothing on
  // the form to say so. The server performs the same substitution in SaveDraftAsync; this is the
  // half that makes the screen agree with it.

  it('reopens a draft on the default template when its saved version has been retired', () => {
    component.templates = [
      { id: 9, name: 'MSA', version: '2.1', isActive: true, isDefault: true } as any
    ];

    expect((component as any).resolveEditableTemplateId(4)).toBe(9);
  });

  it('keeps the saved template when it is still offered', () => {
    component.templates = [
      { id: 4, name: 'MSA', version: '2.0', isActive: true, isDefault: false } as any,
      { id: 9, name: 'MSA', version: '2.1', isActive: true, isDefault: true } as any
    ];

    // A template that is still on offer is the admin's choice, not something to override.
    expect((component as any).resolveEditableTemplateId(4)).toBe(4);
  });

  it('leaves the saved id alone when nothing has loaded to replace it', () => {
    // No templates yet is not a reason to blank the draft's own template — that would send 0 and
    // fail validation on a form the admin never touched.
    component.templates = [];

    expect((component as any).resolveEditableTemplateId(4)).toBe(4);
  });
});

describe('ContractDetailComponent', () => {
  let fixture: ComponentFixture<ContractDetailComponent>;
  let component: ContractDetailComponent;
  let http: HttpTestingController;

  /** Everything permitted, so a spec only has to name what it is withholding. */
  // `unknown` rather than `boolean`: the server also reports the AUTHORITY level, which is a
  // string, and specs override it to reproduce an untitled account.
  const allPermissions = (overrides: Record<string, unknown> = {}): any => ({
    viewContracts: true, createContract: true, generatePreview: true,
    sendForReview: true, sendForSignature: true, duplicate: true,
    regenerateExecutedPdf: true, resendExecutedCopy: true,
    backToEdit: true, createRevision: true, createAmendment: true,
    deleteContract: true, restoreContract: true, signAsContractor: true,
    toggleBusinessFlag: true, assignOrgTitle: true,
    authority: 'cto',
    ...overrides
  });

  const detail = (overrides: Partial<any> = {}) => ({
    id: 3, contractNumber: 'DC-2026-0003',
    status: ContractStatus.PreviewGenerated, statusLabel: 'Preview generated',
    createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
    currentVersionId: 9, currentVersionNumber: 1,
    documentHtml: '<p>Body</p>', documentHash: 'abc', unresolvedTokens: [],
    draft: {
      contractor: { legalEntityName: 'Nodar Alania Inc.', dba: 'Dream Cleaning NYC' },
      client: { legalEntityName: 'Chick Tastic LLC' },
      contractorSigner: { firstName: 'Nodar', lastName: 'Alania', title: 'CEO' },
      clientSigner: { firstName: 'Natalie', lastName: 'Finkels' }
    },
    versions: [], signers: [], auditLog: [],
    canEdit: true, canGeneratePreview: true, canSendForReview: true,
    canSendForSignature: true, isLocked: false,
    isHidden: false, canDelete: true, canRestore: false,
    isPendingContractorSigner: false,
    ...overrides
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ContractDetailComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])]
    }).compileComponents();

    fixture = TestBed.createComponent(ContractDetailComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify({ ignoreCancelled: true }));

  it('renders a preloaded contract without re-fetching it', () => {
    component.contractId = 3;
    component.preloaded = detail() as any;
    fixture.detectChanges();

    http.expectNone(r => r.url.endsWith('/crm/contracts/3'));
    expect(component.detail?.contractNumber).toBe('DC-2026-0003');
  });

  it('shows the signature block the SERVER composed, marks and all', () => {
    // Rebuilding it in the browser would show "awaiting signature" for a party who had already
    // signed, because the marks only exist server-side.
    component.contractId = 3;
    component.preloaded = detail({
      signatureBlock: {
        contractor: {
          partyLabel: 'CONTRACTOR', entityName: 'Nodar Alania Inc. d/b/a Dream Cleaning NYC',
          signerName: 'Nodar Alania', signerTitle: 'CEO',
          hasSigned: true, signedAt: '2026-09-05T09:00:00Z',
          signatureMark: 'data:image/png;base64,iVBORw0KGgo='
        },
        client: {
          partyLabel: 'CLIENT', entityName: 'Chick Tastic LLC',
          signerName: 'Natalie Finkels', hasSigned: false, signatureMark: ''
        }
      }
    }) as any;
    fixture.detectChanges();

    expect(component.signatureBlock?.contractor.hasSigned).toBe(true);
    expect(component.signatureBlock?.contractor.signatureMark).toContain('data:image/png');
    expect(component.signatureBlock?.client.hasSigned).toBe(false);

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Awaiting signature');   // the client half only
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('img').length).toBe(1);
  });

  it('offers Create revision only for a contract that was sent but is not executed', () => {
    const cases: [ContractStatus, boolean][] = [
      [ContractStatus.Draft, false],
      [ContractStatus.PreviewGenerated, false],
      [ContractStatus.AwaitingSignatures, true],
      [ContractStatus.PartiallySigned, true],
      // An executed contract is amended or duplicated — never revised.
      [ContractStatus.FullySigned, false],
      [ContractStatus.Completed, false]
    ];

    for (const [status, expected] of cases) {
      component.contractId = 3;
      component.permissions = allPermissions();
      component.preloaded = detail({ status }) as any;
      component.ngOnInit();
      expect(component.canRevise).toBe(expected);
    }
  });

  // ── the permission matrix, as the panel renders it ─────────────────────────

  it('hides every edit-related action from a Manager', () => {
    // A Manager keeps the whole create/send flow but cannot change a generated document.
    component.contractId = 3;
    component.permissions = allPermissions({
      backToEdit: false, createRevision: false, createAmendment: false,
      deleteContract: false, restoreContract: false, signAsContractor: false
    });
    component.preloaded = detail({ status: ContractStatus.AwaitingSignatures }) as any;
    component.ngOnInit();

    expect(component.showEdit).toBe(false);
    expect(component.canRevise).toBe(false);
    expect(component.canAmend).toBe(false);
    expect(component.showDelete).toBe(false);
    // ...but the ordinary flow is untouched.
    expect(component.canDuplicate).toBe(true);
    expect(component.showSendForSignature).toBe(true);
  });

  it('shows every edit action to a CEO but never the Void button', () => {
    component.contractId = 3;
    component.permissions = allPermissions({ deleteContract: false });
    component.preloaded = detail({ status: ContractStatus.AwaitingSignatures }) as any;
    component.ngOnInit();

    expect(component.canRevise).toBe(true);
    expect(component.canAmend).toBe(true);
    expect(component.showDelete).toBe(false);
  });

  it('renders nothing actionable until the permissions have loaded', () => {
    // Unknown authority must fail closed, not flash buttons that then vanish.
    component.contractId = 3;
    component.permissions = null;
    component.preloaded = detail({ status: ContractStatus.PreviewGenerated }) as any;
    component.ngOnInit();

    expect(component.showEdit).toBe(false);
    expect(component.showSendForReview).toBe(false);
    expect(component.canDuplicate).toBe(false);
  });

  it('offers Sign as Contractor only to the designated signer who also holds the authority', () => {
    // Identity AND authority. Either alone is not enough, and the API re-checks both.
    component.contractId = 3;
    component.permissions = allPermissions();
    component.preloaded = detail({ isPendingContractorSigner: true }) as any;
    component.ngOnInit();
    expect(component.canSignAsContractor).toBe(true);

    // Right authority, but this account is not the named signer.
    component.preloaded = detail({ isPendingContractorSigner: false }) as any;
    component.ngOnInit();
    expect(component.canSignAsContractor).toBe(false);

    // Named signer, but no officer title.
    component.permissions = allPermissions({ signAsContractor: false });
    component.preloaded = detail({ isPendingContractorSigner: true }) as any;
    component.ngOnInit();
    expect(component.canSignAsContractor).toBe(false);
  });

  it('separates regenerating the PDF from re-sending it', () => {
    component.contractId = 3;
    component.permissions = allPermissions();
    component.preloaded = detail({ status: ContractStatus.Completed }) as any;
    component.ngOnInit();

    expect(component.canRegenerateExecuted).toBe(true);
    expect(component.canResendExecuted).toBe(true);

    // They are independently gated, so one can be withheld without the other.
    component.permissions = allPermissions({ resendExecutedCopy: false });
    component.ngOnInit();
    expect(component.canRegenerateExecuted).toBe(true);
    expect(component.canResendExecuted).toBe(false);
  });

  // Both buttons produce a fresh Draft that carries every field of the source, and the only thing
  // anyone does next is edit it. Landing on the new contract's preview instead showed a Draft with
  // no document, which read as "the button did nothing".
  it('lands the admin in the edit form after Create Amendment', () => {
    component.contractId = 3;
    component.permissions = allPermissions();
    component.preloaded = detail({ status: ContractStatus.Completed }) as any;
    component.ngOnInit();

    let editing: any = null;
    component.edit.subscribe(id => editing = id);
    component.duplicate(true);

    const request = http.expectOne(r => r.url.includes('/crm/contracts/3/duplicate'));
    expect(request.request.url).toContain('asAmendment=true');
    request.flush(detail({ id: 12, contractNumber: 'DC-2026-0012' }));

    expect(editing).toBe(12);
    expect(component.busy).toBe(false);
  });

  it('lands the admin in the edit form after Duplicate as new contract', () => {
    component.contractId = 3;
    component.permissions = allPermissions();
    component.preloaded = detail({ status: ContractStatus.Completed }) as any;
    component.ngOnInit();

    let editing: any = null;
    component.edit.subscribe(id => editing = id);
    component.duplicate(false);

    const request = http.expectOne(r => r.url.includes('/crm/contracts/3/duplicate'));
    expect(request.request.url).toContain('asAmendment=false');
    request.flush(detail({ id: 13 }));

    expect(editing).toBe(13);
  });

  // The shell keeps this component mounted and only swaps the input, so ngOnInit does not run
  // again — without ngOnChanges the previous contract simply stayed on screen.
  it('reloads when the shell points it at a different contract', () => {
    component.contractId = 3;
    component.preloaded = detail() as any;
    fixture.detectChanges();
    expect(component.detail?.id).toBe(3);

    component.contractId = 4;
    component.preloaded = null;
    component.ngOnChanges({
      contractId: { currentValue: 4, previousValue: 3, firstChange: false, isFirstChange: () => false }
    });

    http.expectOne(r => r.url.endsWith('/crm/contracts/4')).flush(detail({ id: 4 }));
    expect(component.detail?.id).toBe(4);
  });

  it('warns about unfilled placeholders before the document can be sent', () => {
    component.contractId = 3;
    component.preloaded = detail({ unresolvedTokens: ['CLIENT_PHONE'] }) as any;
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Unfilled placeholders');
    expect(text).toContain('CLIENT_PHONE');
  });

  // ── the production-vs-local button mismatch (2026-09-16) ───────────────────

  /**
   * THE REPORTED SYMPTOM, pinned.
   *
   * Localhost showed six actions; production showed three. The cause is DATA — the production
   * account holds no officer title, so the server's matrix resolves it to Manager and withholds
   * exactly Back to edit, Create amendment and Delete. Nothing seeds a title, so on a freshly
   * migrated database every admin is a Manager.
   *
   * The fix is NOT to show the buttons. It is to stop the absence being silent, because a gap
   * where a button used to be is indistinguishable from a stale deployment — which is exactly how
   * it was read.
   */
  it('explains which actions need an officer title instead of leaving a silent gap', () => {
    component.contractId = 3;
    component.permissions = allPermissions({
      authority: 'manager',
      backToEdit: false, createRevision: false, createAmendment: false,
      deleteContract: false, restoreContract: false, signAsContractor: false
    });
    component.preloaded = detail({ status: ContractStatus.PreviewGenerated }) as any;
    component.ngOnInit();
    fixture.detectChanges();

    expect(component.authorityLimitsActions).toBe(true);
    expect(component.actionsNeedingOfficerTitle).toContain('Back to edit');
    expect(component.actionsNeedingOfficerTitle).toContain('Create amendment');
    expect(component.actionsNeedingOfficerTitle).toContain('Delete');

    // The note is on screen, names the remedy, and says this is not a deployment problem.
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('officer title');
    expect(text).toContain('Officer title');
    expect(text).toContain('not a missing deployment');

    // And the buttons are still correctly absent — the note explains, it does not unlock.
    expect(component.showEdit).toBe(false);
    expect(component.canAmend).toBe(false);
    expect(component.showDelete).toBe(false);
  });

  /** An officer sees no note at all, because nothing is being withheld from them. */
  it('shows no officer-title note to a CEO or CTO', () => {
    for (const authority of ['ceo', 'cto']) {
      component.contractId = 3;
      component.permissions = allPermissions({ authority });
      component.preloaded = detail() as any;
      component.ngOnInit();
      fixture.detectChanges();

      expect(component.authorityLimitsActions).toBe(false);
      expect(component.actionsNeedingOfficerTitle).toEqual([]);
    }
  });

  /**
   * An older backend does not send `authority`. The note must stay away rather than appearing for
   * everybody — a missing field is not evidence of a missing title.
   */
  it('stays quiet when the server does not report an authority level', () => {
    component.contractId = 3;
    component.permissions = allPermissions({ backToEdit: false });
    delete (component.permissions as any).authority;
    component.preloaded = detail() as any;
    component.ngOnInit();

    expect(component.authorityLimitsActions).toBe(false);
  });

  /** The note only lists what the contract's own state would otherwise have offered. */
  it('does not list Delete when the contract is already archived', () => {
    component.contractId = 3;
    component.permissions = allPermissions({ authority: 'manager', deleteContract: false });
    component.preloaded = detail({ isHidden: true, canDelete: false, canRestore: true }) as any;
    component.ngOnInit();

    expect(component.actionsNeedingOfficerTitle).not.toContain('Delete');
  });

  // ── delete or archive ──────────────────────────────────────────────────────

  /**
   * DELETE OPENS A CHOICE, IT DOES NOT DELETE.
   *
   * Two genuinely different outcomes used to share one word: the old "Delete" archived the
   * contract, which is not what the word promises, and there was no way at all to clear a test
   * contract out.
   */
  it('opens the delete-or-archive dialog rather than acting immediately', () => {
    component.contractId = 3;
    component.permissions = allPermissions();
    component.preloaded = detail({ canHardDelete: true }) as any;
    component.ngOnInit();
    fixture.detectChanges();

    const deleteButton = (fixture.nativeElement as HTMLElement)
      .querySelector('.action-bar .btn-danger') as HTMLButtonElement;
    deleteButton.click();
    fixture.detectChanges();

    expect(component.deleteDialogOpen).toBe(true);
    // Nothing was sent — opening a dialog is not an action.
    http.expectNone(r => r.url.includes('/delete'));
    http.expectNone(r => r.url.includes('/permanent'));

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Delete or archive contract?');
  });

  /** Archive is the long-standing soft delete, under the name it always deserved. */
  it('archives through the existing soft-delete endpoint', () => {
    component.contractId = 3;
    component.permissions = allPermissions();
    component.preloaded = detail() as any;
    component.ngOnInit();

    component.openDeleteDialog();
    component.archiveContract();

    const req = http.expectOne(r => r.url.endsWith('/crm/contracts/3/delete'));
    expect(req.request.method).toBe('POST');
    req.flush(detail({ isHidden: true, canDelete: false, canRestore: true }));

    expect(component.deleteDialogOpen).toBe(false);
    expect(component.successMessage).toContain('archived');
  });

  /**
   * THE TYPED CONFIRMATION IS REQUIRED, and nothing is sent without it. The server checks the
   * same phrase, so this only decides whether to bother asking.
   */
  it('refuses to permanently delete until the contract number is typed', () => {
    component.contractId = 3;
    component.permissions = allPermissions();
    component.preloaded = detail({ canHardDelete: true }) as any;
    component.ngOnInit();
    component.openDeleteDialog();

    expect(component.hardDeleteConfirmationPhrase).toBe('DELETE DC-2026-0003');

    component.hardDeleteConfirmation = 'DELETE';
    expect(component.hardDeleteConfirmed).toBe(false);
    component.permanentlyDeleteContract();
    http.expectNone(r => r.url.includes('/permanent'));

    // Wrong contract's number — the point of typing it is that it names the one you mean.
    component.hardDeleteConfirmation = 'DELETE DC-2026-0004';
    expect(component.hardDeleteConfirmed).toBe(false);

    // Case and surrounding space are not the test.
    component.hardDeleteConfirmation = '  delete dc-2026-0003  ';
    expect(component.hardDeleteConfirmed).toBe(true);
  });

  /** With the phrase typed, it deletes and hands the list a message to show. */
  it('permanently deletes and returns to the list with a message', () => {
    component.contractId = 3;
    component.permissions = allPermissions();
    component.preloaded = detail({ canHardDelete: true }) as any;
    component.ngOnInit();
    component.openDeleteDialog();
    component.hardDeleteConfirmation = 'DELETE DC-2026-0003';

    let emitted = '';
    component.deleted.subscribe(m => emitted = m);
    component.permanentlyDeleteContract();

    const req = http.expectOne(r => r.url.endsWith('/crm/contracts/3/permanent'));
    expect(req.request.method).toBe('DELETE');
    expect(req.request.params.get('confirmation')).toBe('DELETE DC-2026-0003');
    req.flush({ message: 'Contract DC-2026-0003 was permanently deleted.' });

    expect(emitted).toContain('permanently deleted');
  });

  /**
   * WHEN THE SERVER SAYS NO, THE ADMIN READS WHY.
   *
   * A disabled button with no explanation sends somebody hunting for a permission problem that
   * does not exist — the reason names which record is protecting the contract.
   */
  it('shows the server reason instead of the confirmation field when full delete is blocked', () => {
    component.contractId = 3;
    component.permissions = allPermissions();
    component.preloaded = detail({
      status: ContractStatus.FullySigned,
      canHardDelete: false,
      cannotHardDeleteReason:
        'This contract carries a signature and cannot be permanently deleted. Archive it instead.'
    }) as any;
    component.ngOnInit();
    component.openDeleteDialog();
    fixture.detectChanges();

    expect(component.canHardDelete).toBe(false);
    expect(component.hardDeleteBlockedReason).toContain('carries a signature');

    const dom = fixture.nativeElement as HTMLElement;
    expect(dom.querySelector('#hardDeleteConfirm')).toBeNull();
    expect(dom.querySelector('.blocked-reason')?.textContent).toContain('Archive it instead');

    // And it cannot be fired past the UI either.
    component.hardDeleteConfirmation = 'DELETE DC-2026-0003';
    component.permanentlyDeleteContract();
    http.expectNone(r => r.url.includes('/permanent'));
  });

  /** An older backend omits the flag, so the option is simply not offered. */
  it('does not offer full delete when the server did not say it was allowed', () => {
    component.contractId = 3;
    component.permissions = allPermissions();
    component.preloaded = detail() as any;   // no canHardDelete field at all
    component.ngOnInit();

    expect(component.canHardDelete).toBe(false);
  });
});
