import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ContractDocumentComponent } from './contract-document.component';
import { ContractSignatureBlock } from '../../../services/contract.service';

/**
 * The document renderer is shared by the admin preview, the client review page and the signing
 * page, so a bug here shows a different agreement to whoever is reading it. Two things matter:
 * the body splits at the server's signature anchor (so the live block lands where the agreement
 * says it goes, not appended at the end), and a drawn mark is told apart from a typed one.
 */
describe('ContractDocumentComponent', () => {
  let fixture: ComponentFixture<ContractDocumentComponent>;
  let component: ContractDocumentComponent;

  const ANCHOR = '<div class="dc-doc-signature-anchor"></div>';

  const block = (): ContractSignatureBlock => ({
    contractor: {
      partyLabel: 'CONTRACTOR', entityName: 'Nodar Alania Inc. d/b/a Dream Cleaning NYC',
      signerName: 'Nodar Alania', signerTitle: 'CEO',
      hasSigned: false, signatureMark: ''
    },
    client: {
      partyLabel: 'CLIENT', entityName: 'Chick Tastic LLC',
      signerName: 'Natalie Finkels', signerTitle: 'Owner',
      hasSigned: false, signatureMark: ''
    }
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ContractDocumentComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(ContractDocumentComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('splits the document at the signature anchor so the block renders in the middle', () => {
    component.documentHtml = `<p>Sections 1-35</p>${ANCHOR}<h2>EXHIBIT A</h2>`;
    component.signatureBlock = block();
    fixture.detectChanges();

    expect(component.htmlBeforeSignatures).toContain('Sections 1-35');
    expect(component.htmlAfterSignatures).toContain('EXHIBIT A');
    // The anchor itself is consumed, never rendered.
    expect(component.htmlBeforeSignatures).not.toContain('dc-doc-signature-anchor');
    expect(component.htmlAfterSignatures).not.toContain('dc-doc-signature-anchor');
  });

  it('renders the whole body when there is no anchor rather than dropping it', () => {
    component.documentHtml = '<p>A body with no signature block</p>';
    fixture.detectChanges();

    expect(component.htmlBeforeSignatures).toContain('A body with no signature block');
    expect(component.htmlAfterSignatures).toBe('');
  });

  it('shows an awaiting-signature placeholder until a party signs', () => {
    component.documentHtml = ANCHOR;
    component.signatureBlock = block();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Awaiting signature');
    expect(text).toContain('Nodar Alania');
    expect(text).toContain('Chick Tastic LLC');
  });

  it('tells a drawn mark apart from a typed one', () => {
    const drawn = block();
    drawn.contractor.hasSigned = true;
    drawn.contractor.signatureMark = 'data:image/png;base64,iVBORw0KGgo=';
    drawn.client.hasSigned = true;
    drawn.client.signatureMark = 'Natalie Finkels';

    expect(component.isImageMark(drawn.contractor)).toBe(true);
    expect(component.isImageMark(drawn.client)).toBe(false);
  });

  it('renders a typed signature as text and a drawn one as an image', () => {
    const signed = block();
    signed.contractor.hasSigned = true;
    signed.contractor.signatureMark = 'data:image/png;base64,iVBORw0KGgo=';
    signed.client.hasSigned = true;
    signed.client.signatureMark = 'Natalie Finkels';

    component.documentHtml = ANCHOR;
    component.signatureBlock = signed;
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('img').length).toBe(1);
    expect(host.querySelector('.dc-signature-typed')?.textContent).toContain('Natalie Finkels');
    expect(host.textContent).not.toContain('Awaiting signature');
  });

  it('can hide the signature block entirely', () => {
    component.documentHtml = ANCHOR;
    component.signatureBlock = block();
    component.showSignatureBlock = false;
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('.dc-signature-grid')).toBeNull();
  });
});
