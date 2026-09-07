import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { ActivatedRoute, convertToParamMap } from '@angular/router';

import { ContractReviewComponent } from './contract-review.component';
import { ContractReviewPage, ContractStatus } from '../../services/contract.service';

/**
 * The client review page. Two things it must get right, because the client is a stranger to this
 * system and has no account:
 *
 *  - It must SAY, before they save, when their edit will change the agreement rather than just
 *    their own details. A client who renames their company and is then told "we are preparing a
 *    revised version" with no warning has been ambushed.
 *  - A bad or expired token must produce a sentence, not a blank page.
 */
describe('ContractReviewComponent', () => {
  let fixture: ComponentFixture<ContractReviewComponent>;
  let component: ContractReviewComponent;
  let http: HttpTestingController;

  const TOKEN = 'a1b2c3';

  const page = (overrides: Partial<ContractReviewPage> = {}): ContractReviewPage => ({
    contractNumber: 'DC-2026-0001',
    documentTitle: 'Master Service Agreement',
    contractorDisplayName: 'Nodar Alania Inc. d/b/a Dream Cleaning NYC',
    clientLegalName: 'Chick Tastic LLC',
    versionNumber: 1,
    status: ContractStatus.AwaitingClientReview,
    statusLabel: 'Awaiting client review',
    documentHtml: '<p>Sections 1-35</p>',
    signatureBlock: {
      contractor: {
        partyLabel: 'CONTRACTOR', entityName: 'Nodar Alania Inc.',
        signerName: 'Nodar Alania', signerTitle: 'CEO', hasSigned: false, signatureMark: ''
      },
      client: {
        partyLabel: 'CLIENT', entityName: 'Chick Tastic LLC',
        signerName: 'Natalie Finkels', hasSigned: false, signatureMark: ''
      }
    },
    yourInformation: {
      companyLegalName: 'Chick Tastic LLC',
      firstName: 'Natalie', lastName: 'Finkels',
      title: '', email: 'natalie@example.com', phone: '7325471819',
      companyAddress: '1569 Flatbush Ave.', city: 'Brooklyn', state: 'NY', zip: '11210'
    },
    canEdit: true,
    canContinueToSignature: false,
    ...overrides
  });

  function setUp(token: string = TOKEN): void {
    TestBed.configureTestingModule({
      imports: [ContractReviewComponent],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ token }) } }
        }
      ]
    });

    fixture = TestBed.createComponent(ContractReviewComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
  }

  afterEach(() => {
    if (http) http.verify({ ignoreCancelled: true });
    TestBed.resetTestingModule();
  });

  it('loads the agreement addressed by the token alone', () => {
    setUp();
    fixture.detectChanges();
    http.expectOne(r => r.url.endsWith(`/contracts/review/${TOKEN}`)).flush(page());

    expect(component.page?.contractNumber).toBe('DC-2026-0001');
    expect(component.loading).toBe(false);
  });

  it('explains a bad link instead of rendering a blank page', () => {
    setUp();
    fixture.detectChanges();
    http.expectOne(r => r.url.endsWith(`/contracts/review/${TOKEN}`))
      .flush({ message: 'This review link has expired. Please ask us for a new one.' },
        { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();

    expect(component.loadError).toContain('expired');
    expect((fixture.nativeElement as HTMLElement).textContent)
      .toContain('We could not open this agreement');
  });

  it('renders the full agreement, not a summary', () => {
    setUp();
    fixture.detectChanges();
    http.expectOne(r => r.url.endsWith(`/contracts/review/${TOKEN}`)).flush(page());
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Sections 1-35');
  });

  // ── the warning that matters ───────────────────────────────────────────────

  it('does not warn about a revision for a personal correction', () => {
    setUp();
    fixture.detectChanges();
    http.expectOne(r => r.url.endsWith(`/contracts/review/${TOKEN}`)).flush(page());

    component.startEditing();
    component.form.lastName = 'Finkelstein';
    component.form.title = 'Owner';

    expect(component.willCreateRevision).toBe(false);
  });

  it('warns BEFORE saving when the edit would change the agreement itself', () => {
    setUp();
    fixture.detectChanges();
    http.expectOne(r => r.url.endsWith(`/contracts/review/${TOKEN}`)).flush(page());

    component.startEditing();
    component.form.companyLegalName = 'Chick Tastic Holdings LLC';
    fixture.detectChanges();

    expect(component.willCreateRevision).toBe(true);
    expect((fixture.nativeElement as HTMLElement).textContent)
      .toContain('changes the agreement itself');
  });

  it('treats a re-typed value in different casing as no change at all', () => {
    setUp();
    fixture.detectChanges();
    http.expectOne(r => r.url.endsWith(`/contracts/review/${TOKEN}`)).flush(page());

    component.startEditing();
    component.form.companyLegalName = '  chick tastic llc ';

    expect(component.willCreateRevision).toBe(false);
  });

  it('reports a revision distinctly from a plain save', () => {
    setUp();
    fixture.detectChanges();
    http.expectOne(r => r.url.endsWith(`/contracts/review/${TOKEN}`)).flush(page());

    component.startEditing();
    component.form.companyLegalName = 'Chick Tastic Holdings LLC';
    component.save();

    http.expectOne(r => r.url.endsWith(`/contracts/review/${TOKEN}/information`)).flush({
      createdRevision: true, versionNumber: 2, status: ContractStatus.NeedsRevision,
      message: 'We have prepared a revised version.', changedFields: ['Legal entity name']
    });
    // The page reloads afterwards — a modification replaced the document.
    http.expectOne(r => r.url.endsWith(`/contracts/review/${TOKEN}`))
      .flush(page({ status: ContractStatus.NeedsRevision, statusLabel: 'Needs revision' }));

    expect(component.revisionNotice?.fields).toEqual(['Legal entity name']);
    expect(component.successMessage).toBe('');
  });

  it('cancelling an edit leaves the displayed details untouched', () => {
    setUp();
    fixture.detectChanges();
    http.expectOne(r => r.url.endsWith(`/contracts/review/${TOKEN}`)).flush(page());

    component.startEditing();
    component.form.companyLegalName = 'Something Else LLC';
    component.cancelEditing();

    expect(component.form.companyLegalName).toBe('Chick Tastic LLC');
    expect(component.editing).toBe(false);
  });

  it('requires a signer name before saving', () => {
    setUp();
    fixture.detectChanges();
    http.expectOne(r => r.url.endsWith(`/contracts/review/${TOKEN}`)).flush(page());

    component.startEditing();
    component.form.firstName = '';
    component.save();

    expect(component.saveError).toContain('first and last name');
    http.expectNone(r => r.url.endsWith('/information'));
  });

  it('offers Continue to signature only once a signing link exists', () => {
    setUp();
    fixture.detectChanges();
    http.expectOne(r => r.url.endsWith(`/contracts/review/${TOKEN}`))
      .flush(page({ canContinueToSignature: true, signingToken: 'sign-me' }));
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Continue to signature');
  });

  it('says nothing about signing while the contract is still being revised', () => {
    setUp();
    fixture.detectChanges();
    http.expectOne(r => r.url.endsWith(`/contracts/review/${TOKEN}`)).flush(page({
      status: ContractStatus.NeedsRevision,
      canContinueToSignature: false,
      message: 'We are preparing a revised version based on your changes.'
    }));
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('preparing a revised version');
    expect(text).not.toContain('Continue to signature');
  });

  it('handles a link with no token at all', () => {
    setUp('');
    fixture.detectChanges();

    expect(component.loadError).toContain('missing its reference');
    http.expectNone(() => true);
  });
});
