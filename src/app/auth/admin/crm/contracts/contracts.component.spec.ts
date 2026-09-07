import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';

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
    http.expectOne(r => r.url.endsWith('/contractor-profiles'))
      .flush([{ id: 2, legalEntityName: 'Nodar Alania Inc.', isDefault: true }]);
    http.expectOne(r => r.url.endsWith('/clients')).flush([]);
    http.expectOne(r => r.url.includes('/contacts')).flush([]);
    // Business-flagged accounts, for the "linked customer account" picker.
    http.expectOne(r => r.url.includes('/business-customers')).flush([{
      userId: 77, fullName: 'Natalie Finkels',
      firstName: 'Natalie', lastName: 'Finkels',
      email: 'natalie@example.com', phone: '7325471819',
      address: '1569 Flatbush Ave.', city: 'Brooklyn', state: 'NY', zip: '11210'
    }]);
  }

  /** The form asks the server to echo the derived figures as soon as it has its defaults. */
  function flushPricingPreview(): void {
    http.expectOne(r => r.url.endsWith('/pricing-preview')).flush({
      preTaxPrice: 0, salesTaxAmount: 0, totalPrice: 0,
      cancellationAmount: 0, remainingBalance: 0, lockoutFee: 0
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
    expect(request.request.body.priceMode).toBe(ContractPriceMode.PreTax);
    expect(request.request.body.salesTaxRatePercent).toBe(8.875);

    request.flush({
      preTaxPrice: 849.99, salesTaxAmount: 75.44, totalPrice: 925.43,
      cancellationAmount: 462.72, remainingBalance: 462.71, lockoutFee: 925.43
    });

    expect(component.pricingPreview?.totalPrice).toBe(925.43);
  });

  it('defaults every advanced term to the reference agreement', () => {
    fixture.detectChanges();
    flushReferenceData();

    flushPricingPreview();

    // An admin who never opens the Advanced panel must produce the standard wording.
    expect(component.model.advanced.curePeriodDays).toBe(15);
    expect(component.model.advanced.confidentialityYears).toBe(2);
    expect(component.model.advanced.nonSolicitMonths).toBe(12);
    expect(component.model.advanced.liabilityCapLookbackMonths).toBe(3);
    expect(component.model.term.initialTermMonths).toBe(12);
    expect(component.model.pricing.cancellationPercent).toBe(50);
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
});

describe('ContractDetailComponent', () => {
  let fixture: ComponentFixture<ContractDetailComponent>;
  let component: ContractDetailComponent;
  let http: HttpTestingController;

  /** Everything permitted, so a spec only has to name what it is withholding. */
  const allPermissions = (overrides: Record<string, boolean> = {}): any => ({
    viewContracts: true, createContract: true, generatePreview: true,
    sendForReview: true, sendForSignature: true, duplicate: true,
    regenerateExecutedPdf: true, resendExecutedCopy: true,
    backToEdit: true, createRevision: true, createAmendment: true,
    deleteContract: true, restoreContract: true, signAsContractor: true,
    toggleBusinessFlag: true, assignOrgTitle: true,
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
});
