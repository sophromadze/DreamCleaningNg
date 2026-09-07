import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ContractSignatureBlock, ContractSignatureParty } from '../../../services/contract.service';

/**
 * Renders a generated contract: the document body plus the live signature block, drawn exactly
 * where the agreement says the signature block goes.
 *
 * Shared by all three surfaces that show a contract - the admin preview, the client review page
 * and the signing page - so what an admin approves is character-for-character what the client
 * reads and what the signer signs. The PDF writer consumes the same server-side block list, so
 * the printed copy matches too.
 *
 * The body arrives as server-rendered HTML built from an HTML-encoded block list (headings,
 * paragraphs, bullets and exhibit rows only); it is split at the server's signature anchor so the
 * interactive block can be projected into the middle rather than appended at the end.
 */
@Component({
  selector: 'app-contract-document',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './contract-document.component.html',
  styleUrls: ['./contract-document.component.scss']
})
export class ContractDocumentComponent {
  private _documentHtml = '';

  /**
   * A setter rather than ngOnChanges: the split has to happen whenever the html is assigned,
   * including when a host sets it on the instance directly. ngOnChanges only fires for
   * template-bound inputs, which would have left a programmatic assignment rendering nothing.
   */
  @Input()
  set documentHtml(value: string) {
    this._documentHtml = value ?? '';
    this.splitAtSignatureAnchor();
  }
  get documentHtml(): string { return this._documentHtml; }

  @Input() signatureBlock: ContractSignatureBlock | null = null;

  /** Shows "signature pending" placeholders rather than blank lines while unsigned. */
  @Input() showSignatureBlock = true;

  htmlBeforeSignatures = '';
  htmlAfterSignatures = '';

  private static readonly ANCHOR = '<div class="dc-doc-signature-anchor"></div>';

  private splitAtSignatureAnchor(): void {
    const html = this._documentHtml;
    const index = html.indexOf(ContractDocumentComponent.ANCHOR);
    if (index < 0) {
      // No anchor (a template body without a signature block) - render it all and let the
      // signature block fall to the end rather than dropping it.
      this.htmlBeforeSignatures = html;
      this.htmlAfterSignatures = '';
      return;
    }
    this.htmlBeforeSignatures = html.substring(0, index);
    this.htmlAfterSignatures = html.substring(index + ContractDocumentComponent.ANCHOR.length);
  }

  get parties(): ContractSignatureParty[] {
    if (!this.signatureBlock) return [];
    return [this.signatureBlock.contractor, this.signatureBlock.client];
  }

  /** True when the mark is a drawn image rather than a typed name. */
  isImageMark(party: ContractSignatureParty): boolean {
    return !!party.signatureMark && party.signatureMark.startsWith('data:image');
  }
}
