import { Component, OnInit, inject, ChangeDetectionStrategy, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ContractDocumentComponent } from '../../shared/components/contract-document/contract-document.component';
import {
  CapturedSignature, SignatureCaptureComponent
} from '../../shared/components/signature-capture/signature-capture.component';
import {
  ClientReviewInfo, ContractReviewPage, ContractService, ContractStatus
} from '../../services/contract.service';
import { extractApiErrorMessage } from '../../utils/http-error.utils';

/**
 * One contract in the customer's own portal: read it, correct their details, sign it.
 *
 * Deliberately the SAME page as the emailed token flow in everything the customer sees — the same
 * document renderer, the same "Your Information" block with the same personal-info-vs-modification
 * rule, the same signature capture and consent wording. Only the authentication differs: here the
 * session proves who they are, and the server re-checks ownership on every call.
 *
 * The emailed link keeps working in parallel and is not weakened by any of this; a customer may
 * still forward it to a colleague, or sign from a device they are not logged in on.
 */
@Component({
  selector: 'app-my-contract-detail',
  standalone: true,
  imports: [FormsModule, ContractDocumentComponent, SignatureCaptureComponent],
  templateUrl: './my-contract-detail.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../contract-review/contract-review.component.scss']
})
export class MyContractDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private contracts = inject(ContractService);

  contractId = 0;
  readonly page = signal<ContractReviewPage | null>(null);

  readonly loading = signal(true);
  readonly loadError = signal('');

  readonly editing = signal(false);
  readonly saving = signal(false);
  readonly saveError = signal('');
  readonly successMessage = signal('');
  readonly revisionNotice = signal<{ message: string; fields: string[] } | null>(null);

  readonly signing = signal(false);
  readonly signError = signal('');
  readonly signed = signal(false);
  readonly signedMessage = signal('');

  readonly form = signal<ClientReviewInfo>(this.emptyInfo());

  readonly ContractStatus = ContractStatus;

  ngOnInit(): void {
    this.contractId = Number(this.route.snapshot.paramMap.get('id'));
    if (!this.contractId) {
      this.loading.set(false);
      this.loadError.set('That contract could not be found.');
      return;
    }
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.contracts.getMyContract(this.contractId).subscribe({
      next: page => {
        this.page.set(page);
        this.form.set({ ...page.yourInformation });
        this.loading.set(false);
      },
      error: err => {
        // The server answers 404 for a contract this account does not own, so there is nothing
        // here to distinguish "missing" from "someone else's".
        this.loadError.set(extractApiErrorMessage(err, 'That contract could not be found.'));
        this.loading.set(false);
      }
    });
  }

  back(): void { this.router.navigate(['/profile/contracts']); }

  // ── your information ───────────────────────────────────────────────────────

  startEditing(): void {
    if (!this.page()) return;
    this.form.set({ ...this.page()!.yourInformation });
    this.editing.set(true);
    this.saveError.set('');
    this.successMessage.set('');
  }

  cancelEditing(): void {
    if (this.page()) this.form.set({ ...this.page()!.yourInformation });
    this.editing.set(false);
    this.saveError.set('');
  }

  /** Warns before saving, so a revision is never a surprise. Mirrors the token page exactly. */
  get willCreateRevision(): boolean {
    if (!this.page()) return false;
    const o = this.page()!.yourInformation;
    return this.differs(o.companyLegalName, this.form().companyLegalName)
      || this.differs(o.companyAddress, this.form().companyAddress)
      || this.differs(o.city, this.form().city)
      || this.differs(o.state, this.form().state)
      || this.differs(o.zip, this.form().zip);
  }

  private differs(a?: string, b?: string): boolean {
    return (a ?? '').trim().toLowerCase() !== (b ?? '').trim().toLowerCase();
  }

  save(): void {
    if (!this.page() || this.saving()) return;
    if (!this.form().firstName?.trim() || !this.form().lastName?.trim()) {
      this.saveError.set('Please enter the first and last name of the person who will sign.');
      return;
    }

    this.saving.set(true);
    this.saveError.set('');
    this.contracts.updateMyContractInformation(this.contractId, this.form()).subscribe({
      next: result => {
        this.saving.set(false);
        this.editing.set(false);
        if (result.createdRevision) {
          this.revisionNotice.set({ message: result.message, fields: result.changedFields });
          this.successMessage.set('');
        } else {
          this.successMessage.set(result.message);
          this.revisionNotice.set(null);
        }
        this.load();
      },
      error: err => {
        this.saving.set(false);
        this.saveError.set(extractApiErrorMessage(err, 'We could not save your changes.'));
      }
    });
  }

  // ── signing ────────────────────────────────────────────────────────────────

  get canSign(): boolean {
    return !!this.page()?.canContinueToSignature && !this.signed();
  }

  onSigned(captured: CapturedSignature): void {
    if (this.signing()) return;
    this.signing.set(true);
    this.signError.set('');

    this.contracts.signMyContract(this.contractId, {
      signerName: captured.signerName,
      signerTitle: captured.signerTitle,
      signerEmail: captured.signerEmail,
      signatureMethod: captured.signatureMethod,
      signatureData: captured.signatureData,
      consentAccepted: true
    }).subscribe({
      next: result => {
        this.signing.set(false);
        this.signed.set(true);
        this.signedMessage.set(result.message);
        this.load();
      },
      error: err => {
        this.signing.set(false);
        this.signError.set(extractApiErrorMessage(err, 'We could not record your signature.'));
      }
    });
  }

  get isExecuted(): boolean {
    return this.page()?.status === ContractStatus.Completed
      || this.page()?.status === ContractStatus.FullySigned;
  }

  downloadExecuted(): void {
    this.contracts.downloadMyExecutedContract(this.contractId).subscribe({
      next: blob => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${this.page()?.contractNumber ?? 'agreement'}-Executed.pdf`;
        link.click();
        URL.revokeObjectURL(url);
      },
      error: err => {
        this.signError.set(extractApiErrorMessage(err, 'The executed copy is not available yet.'));
      }
    });
  }

  private emptyInfo(): ClientReviewInfo {
    return {
      companyLegalName: '', firstName: '', lastName: '', title: '', email: '', phone: '',
      companyAddress: '', city: '', state: '', zip: ''
    };
  }
}
