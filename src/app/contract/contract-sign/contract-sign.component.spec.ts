import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { ContractSignComponent } from './contract-sign.component';
import { SignatureCaptureComponent } from '../../shared/components/signature-capture/signature-capture.component';
import {
  ContractSignatureMethod, ContractSignerRole, ContractSigningPage, ContractStatus
} from '../../services/contract.service';
import { ThemeService } from '../../services/theme.service';

/**
 * The emailed-link signing page. This path is the DEFAULT for every signer and must keep working
 * untouched now that two authenticated paths exist beside it.
 *
 * The capture itself (consent gate, draw-vs-type, validation) is covered in the shared
 * SignatureCaptureComponent's own spec; these tests cover what this page is responsible for:
 * refusing to offer signing on a dead link, and posting to the token endpoint.
 */
describe('ContractSignComponent', () => {
  let fixture: ComponentFixture<ContractSignComponent>;
  let component: ContractSignComponent;
  let http: HttpTestingController;

  const TOKEN = 'sign-token';

  const page = (overrides: Partial<ContractSigningPage> = {}): ContractSigningPage => ({
    contractNumber: 'DC-2026-0001',
    documentTitle: 'Master Service Agreement',
    versionNumber: 1,
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
    role: ContractSignerRole.ClientSigner,
    partyEntityName: 'Chick Tastic LLC',
    signerName: 'Natalie Finkels',
    signerTitle: '',
    signerEmail: 'natalie@example.com',
    nameLocked: false,
    titleLocked: false,
    alreadySigned: false,
    expired: false,
    superseded: false,
    consentText: 'I have reviewed this Agreement and agree to sign it electronically.',
    ...overrides
  });

  function setUp(token: string = TOKEN): void {
    TestBed.configureTestingModule({
      imports: [ContractSignComponent],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ token }) } }
        }
      ]
    });

    fixture = TestBed.createComponent(ContractSignComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
  }

  function load(overrides: Partial<ContractSigningPage> = {}): void {
    fixture.detectChanges();
    http.expectOne(r => r.url.endsWith(`/contracts/sign/${TOKEN}`)).flush(page(overrides));
    fixture.detectChanges();
  }

  afterEach(() => {
    if (http) http.verify({ ignoreCancelled: true });
    TestBed.resetTestingModule();
  });

  it('loads the agreement addressed by the token alone', () => {
    setUp();
    load();

    expect(component.page?.contractNumber).toBe('DC-2026-0001');
    expect(component.canSign).toBe(true);
  });

  it('shows the whole agreement above the signing controls', () => {
    setUp();
    load();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Sections 1-35');
  });

  it('renders the shared capture component rather than its own copy', () => {
    // Three surfaces sign contracts; only one of them may own the capture UI.
    setUp();
    load();

    const capture = fixture.debugElement.nativeElement
      .querySelector('app-signature-capture');
    expect(capture).toBeTruthy();
  });

  it('posts the captured signature to the TOKEN endpoint', () => {
    setUp();
    load();

    component.onSigned({
      signerName: 'Natalie Finkels',
      signerTitle: 'Owner',
      signerEmail: 'natalie@example.com',
      signatureMethod: ContractSignatureMethod.Type,
      signatureData: 'Natalie Finkels',
      consentAccepted: true
    });

    const request = http.expectOne(
      r => r.method === 'POST' && r.url.endsWith(`/contracts/sign/${TOKEN}`));
    expect(request.request.body.signatureData).toBe('Natalie Finkels');
    expect(request.request.body.consentAccepted).toBe(true);

    request.flush({
      status: ContractStatus.PartiallySigned, statusLabel: 'Partially signed',
      fullyExecuted: false, signedAt: '2026-09-06T10:00:00Z',
      message: 'Thank you. Your signature has been recorded.'
    });

    expect(component.completed).toBe(true);
    expect(component.fullyExecuted).toBe(false);
  });

  it('tells the client when their signature completed the agreement', () => {
    setUp();
    load();

    component.onSigned({
      signerName: 'Natalie Finkels', signatureMethod: ContractSignatureMethod.Type,
      signatureData: 'Natalie Finkels', consentAccepted: true
    });
    http.expectOne(r => r.method === 'POST').flush({
      status: ContractStatus.FullySigned, statusLabel: 'Fully signed',
      fullyExecuted: true, signedAt: '2026-09-06T10:00:00Z',
      message: 'Both parties have now signed.'
    });
    fixture.detectChanges();

    expect(component.fullyExecuted).toBe(true);
    expect((fixture.nativeElement as HTMLElement).textContent)
      .toContain('fully executed agreement');
  });

  // ── links that must not collect a signature ────────────────────────────────

  it('refuses to collect a signature on a superseded version', () => {
    setUp();
    load({
      superseded: true,
      message: 'This version has been replaced. Please use the most recent link we sent you.'
    });

    expect(component.canSign).toBe(false);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('has been replaced');
    expect(fixture.nativeElement.querySelector('app-signature-capture')).toBeNull();
  });

  it('refuses to collect a signature on an expired link', () => {
    setUp();
    load({ expired: true, message: 'This signing link has expired.' });

    expect(component.canSign).toBe(false);
    expect(fixture.nativeElement.querySelector('app-signature-capture')).toBeNull();
  });

  it('says the party has already signed rather than offering to sign twice', () => {
    setUp();
    load({ alreadySigned: true, signedAt: '2026-09-01T12:00:00Z' });

    expect(component.canSign).toBe(false);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('You signed this agreement');
  });

  it('explains a bad link instead of rendering a blank page', () => {
    setUp();
    fixture.detectChanges();
    http.expectOne(r => r.url.endsWith(`/contracts/sign/${TOKEN}`))
      .flush({ message: 'This signing link is not valid.' },
        { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent)
      .toContain('We could not open this signing link');
  });

  it('handles a link with no token at all', () => {
    setUp('');
    fixture.detectChanges();

    expect(component.loadError).toContain('missing its reference');
    http.expectNone(() => true);
  });
});

/**
 * The shared capture. Every signing route in the app funnels through it, so the consent gate and
 * the two methods are asserted once, here.
 */
describe('SignatureCaptureComponent', () => {
  let fixture: ComponentFixture<SignatureCaptureComponent>;
  let component: SignatureCaptureComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SignatureCaptureComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(SignatureCaptureComponent);
    component = fixture.componentInstance;
    component.signerName = 'Natalie Finkels';
    fixture.detectChanges();
  });

  // The theme is persisted, so a test that flips it would decide the look for whichever spec
  // ran next.
  afterEach(() => TestBed.inject(ThemeService).setTheme('light'));

  it('refuses to emit without consent', () => {
    let emitted = false;
    component.signed.subscribe(() => emitted = true);

    component.typedSignature = 'Natalie Finkels';
    component.consentAccepted = false;
    component.submit();

    expect(emitted).toBe(false);
    expect(component.validationError).toContain('consent');
  });

  it('refuses to emit with an empty typed signature', () => {
    let emitted = false;
    component.signed.subscribe(() => emitted = true);

    component.consentAccepted = true;
    component.typedSignature = '   ';
    component.submit();

    expect(emitted).toBe(false);
    expect(component.validationError).toContain('type your name');
  });

  it('refuses to emit with an untouched drawing pad', () => {
    let emitted = false;
    component.signed.subscribe(() => emitted = true);

    component.consentAccepted = true;
    component.setMethod(ContractSignatureMethod.Draw);
    component.submit();

    expect(emitted).toBe(false);
    expect(component.validationError).toContain('draw your signature');
  });

  it('emits the typed name and the method when consent is given', () => {
    let emitted: any = null;
    component.signed.subscribe(v => emitted = v);

    component.consentAccepted = true;
    component.typedSignature = 'Natalie Finkels';
    component.submit();

    expect(emitted?.signatureData).toBe('Natalie Finkels');
    expect(emitted?.signatureMethod).toBe(ContractSignatureMethod.Type);
    expect(emitted?.consentAccepted).toBe(true);
  });

  it('locks the name field for a contractor signer', () => {
    component.nameLocked = true;
    fixture.detectChanges();

    const name = (fixture.nativeElement as HTMLElement)
      .querySelector('#captureName') as HTMLInputElement;
    expect(name.readOnly).toBe(true);
  });

  // The canvas used to be [hidden], which .signature-input's own display:flex overrode — so an
  // empty, unusable pad sat under the typed name. It must not be in the DOM at all.
  it('renders only the pad in Draw mode and only the text box in Type mode', () => {
    const host = fixture.nativeElement as HTMLElement;

    component.setMethod(ContractSignatureMethod.Type);
    fixture.detectChanges();
    expect(host.querySelector('canvas.signature-pad')).toBeNull();
    expect(host.querySelector('input.typed-signature')).not.toBeNull();

    component.setMethod(ContractSignatureMethod.Draw);
    fixture.detectChanges();
    expect(host.querySelector('canvas.signature-pad')).not.toBeNull();
    expect(host.querySelector('input.typed-signature')).toBeNull();
  });

  // The caption is what the consent line's "the signature above" refers to, so it has to name
  // the mark actually on screen rather than one fixed wording.
  it('describes the mark that the current mode actually captures', () => {
    component.setMethod(ContractSignatureMethod.Draw);
    expect(component.modeCaption).toContain('drawn above');

    component.setMethod(ContractSignatureMethod.Type);
    expect(component.modeCaption).toContain('typed name above');
  });

  // Legal wording: it must match the server's token-page text word for word, so the evidence
  // reads the same whichever of the three channels captured it.
  it('defaults to the agreed consent wording', () => {
    expect(component.consentText).toBe(
      'I have reviewed this Agreement, agree to its terms, and adopt the signature above as my ' +
      'electronic signature with the intent to be legally bound.'
    );
  });

  // The pad follows the theme on screen, but the PDF page it ends up on is white. A signature
  // exported in the white ink a dark-mode admin drew with would file a blank signature box.
  it('exports the drawn mark in dark ink even when the pad is drawing in light ink', () => {
    const theme = TestBed.inject(ThemeService);
    theme.setTheme('dark');

    component.setMethod(ContractSignatureMethod.Draw);
    fixture.detectChanges();

    const canvas = component.padCanvas!.nativeElement;
    // jsdom-free: give the bitmap a real size, then draw through the component's own path.
    canvas.width = 40;
    canvas.height = 20;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, 40, 20);
    component['hasDrawnStrokes'] = true;

    const exported = component['exportMark']();

    // Read the exported PNG back and check the ink that actually left the component.
    const probe = document.createElement('canvas');
    probe.width = 40;
    probe.height = 20;
    const probeCtx = probe.getContext('2d')!;

    const image = new Image();
    const done = new Promise<Uint8ClampedArray>(resolve => {
      image.onload = () => {
        probeCtx.drawImage(image, 0, 0);
        resolve(probeCtx.getImageData(20, 10, 1, 1).data);
      };
    });
    image.src = exported;

    return done.then(pixel => {
      expect(pixel[3]).toBeGreaterThan(0);                 // the mark is there at all
      expect(pixel[0]).toBeLessThan(60);                   // ...and it is dark, not the
      expect(pixel[1]).toBeLessThan(60);                   //    near-white it was drawn in
      expect(pixel[2]).toBeLessThan(80);
    });
  });

  it('hides the email field where the host already knows the address', () => {
    component.showEmailField = false;
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('#captureEmail')).toBeNull();
  });
});
