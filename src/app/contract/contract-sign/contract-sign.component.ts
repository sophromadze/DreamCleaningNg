import { Component, OnInit, inject, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ContractDocumentComponent } from '../../shared/components/contract-document/contract-document.component';
import {
  CapturedSignature, SignatureCaptureComponent
} from '../../shared/components/signature-capture/signature-capture.component';
import {
  ContractService, ContractSignerRole, ContractSigningPage
} from '../../services/contract.service';
import { extractApiErrorMessage } from '../../utils/http-error.utils';

/**
 * The signing page reached from an emailed link. Anonymous and addressed by a per-signer,
 * per-VERSION token, so a link signs for exactly one party on exactly one version of the
 * document — it can neither sign on behalf of the counterparty nor survive a revision.
 *
 * This remains the DEFAULT path for every signer type. The two authenticated paths added later
 * (a CEO/CTO in the admin panel, a business customer in their portal) are conveniences layered
 * beside it, and this one is never removed or weakened by their existence.
 *
 * The capture itself lives in the shared SignatureCaptureComponent, so all three routes present
 * the identical two methods and identical consent wording.
 */
@Component({
  selector: 'app-contract-sign',
  standalone: true,
  imports: [CommonModule, FormsModule, ContractDocumentComponent, SignatureCaptureComponent],
  templateUrl: './contract-sign.component.html',
  // The review page's stylesheet is the single source for the shared client-page chrome; this
  // component's own sheet adds only what is specific to signing.
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: [
    '../contract-review/contract-review.component.scss',
    './contract-sign.component.scss'
  ]
})
export class ContractSignComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private contracts = inject(ContractService);

  token = '';
  readonly page = signal<ContractSigningPage | null>(null);

  readonly loading = signal(true);
  readonly loadError = signal('');
  readonly submitting = signal(false);
  readonly submitError = signal('');
  readonly completed = signal(false);
  readonly completionMessage = signal('');
  readonly fullyExecuted = signal(false);

  readonly ContractSignerRole = ContractSignerRole;

  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    if (!this.token) {
      this.loading.set(false);
      this.loadError.set('This link is missing its reference. Please use the link from your email.');
      return;
    }

    this.contracts.getSigningPage(this.token).subscribe({
      next: page => {
        this.page.set(page);
        this.loading.set(false);
      },
      error: err => {
        this.loadError.set(extractApiErrorMessage(err, 'We could not open this signing link.'));
        this.loading.set(false);
      }
    });
  }

  get canSign(): boolean {
    return !!this.page() && !this.page()!.alreadySigned && !this.page()!.expired
      && !this.page()!.superseded && !this.completed();
  }

  onSigned(captured: CapturedSignature): void {
    if (this.submitting()) return;
    this.submitting.set(true);
    this.submitError.set('');

    this.contracts.sign(this.token, {
      signerName: captured.signerName,
      signerTitle: captured.signerTitle,
      signerEmail: captured.signerEmail,
      signatureMethod: captured.signatureMethod,
      signatureData: captured.signatureData,
      consentAccepted: true
    }).subscribe({
      next: result => {
        this.submitting.set(false);
        this.completed.set(true);
        this.completionMessage.set(result.message);
        this.fullyExecuted.set(result.fullyExecuted);
      },
      error: err => {
        this.submitting.set(false);
        this.submitError.set(extractApiErrorMessage(err, 'We could not record your signature.'));
      }
    });
  }
}
