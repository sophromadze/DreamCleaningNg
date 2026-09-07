import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
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
  imports: [CommonModule, FormsModule, ContractDocumentComponent, SignatureCaptureComponent],
  templateUrl: './my-contract-detail.component.html',
  styleUrls: ['../contract-review/contract-review.component.scss']
})
export class MyContractDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private contracts = inject(ContractService);

  contractId = 0;
  page: ContractReviewPage | null = null;

  loading = true;
  loadError = '';

  editing = false;
  saving = false;
  saveError = '';
  successMessage = '';
  revisionNotice: { message: string; fields: string[] } | null = null;

  signing = false;
  signError = '';
  signed = false;
  signedMessage = '';

  form: ClientReviewInfo = this.emptyInfo();

  readonly ContractStatus = ContractStatus;

  ngOnInit(): void {
    this.contractId = Number(this.route.snapshot.paramMap.get('id'));
    if (!this.contractId) {
      this.loading = false;
      this.loadError = 'That contract could not be found.';
      return;
    }
    this.load();
  }

  private load(): void {
    this.loading = true;
    this.contracts.getMyContract(this.contractId).subscribe({
      next: page => {
        this.page = page;
        this.form = { ...page.yourInformation };
        this.loading = false;
      },
      error: err => {
        // The server answers 404 for a contract this account does not own, so there is nothing
        // here to distinguish "missing" from "someone else's".
        this.loadError = extractApiErrorMessage(err, 'That contract could not be found.');
        this.loading = false;
      }
    });
  }

  back(): void { this.router.navigate(['/profile/contracts']); }

  // ── your information ───────────────────────────────────────────────────────

  startEditing(): void {
    if (!this.page) return;
    this.form = { ...this.page.yourInformation };
    this.editing = true;
    this.saveError = '';
    this.successMessage = '';
  }

  cancelEditing(): void {
    if (this.page) this.form = { ...this.page.yourInformation };
    this.editing = false;
    this.saveError = '';
  }

  /** Warns before saving, so a revision is never a surprise. Mirrors the token page exactly. */
  get willCreateRevision(): boolean {
    if (!this.page) return false;
    const o = this.page.yourInformation;
    return this.differs(o.companyLegalName, this.form.companyLegalName)
      || this.differs(o.companyAddress, this.form.companyAddress)
      || this.differs(o.city, this.form.city)
      || this.differs(o.state, this.form.state)
      || this.differs(o.zip, this.form.zip);
  }

  private differs(a?: string, b?: string): boolean {
    return (a ?? '').trim().toLowerCase() !== (b ?? '').trim().toLowerCase();
  }

  save(): void {
    if (!this.page || this.saving) return;
    if (!this.form.firstName?.trim() || !this.form.lastName?.trim()) {
      this.saveError = 'Please enter the first and last name of the person who will sign.';
      return;
    }

    this.saving = true;
    this.saveError = '';
    this.contracts.updateMyContractInformation(this.contractId, this.form).subscribe({
      next: result => {
        this.saving = false;
        this.editing = false;
        if (result.createdRevision) {
          this.revisionNotice = { message: result.message, fields: result.changedFields };
          this.successMessage = '';
        } else {
          this.successMessage = result.message;
          this.revisionNotice = null;
        }
        this.load();
      },
      error: err => {
        this.saving = false;
        this.saveError = extractApiErrorMessage(err, 'We could not save your changes.');
      }
    });
  }

  // ── signing ────────────────────────────────────────────────────────────────

  get canSign(): boolean {
    return !!this.page?.canContinueToSignature && !this.signed;
  }

  onSigned(captured: CapturedSignature): void {
    if (this.signing) return;
    this.signing = true;
    this.signError = '';

    this.contracts.signMyContract(this.contractId, {
      signerName: captured.signerName,
      signerTitle: captured.signerTitle,
      signerEmail: captured.signerEmail,
      signatureMethod: captured.signatureMethod,
      signatureData: captured.signatureData,
      consentAccepted: true
    }).subscribe({
      next: result => {
        this.signing = false;
        this.signed = true;
        this.signedMessage = result.message;
        this.load();
      },
      error: err => {
        this.signing = false;
        this.signError = extractApiErrorMessage(err, 'We could not record your signature.');
      }
    });
  }

  get isExecuted(): boolean {
    return this.page?.status === ContractStatus.Completed
      || this.page?.status === ContractStatus.FullySigned;
  }

  downloadExecuted(): void {
    this.contracts.downloadMyExecutedContract(this.contractId).subscribe({
      next: blob => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${this.page?.contractNumber ?? 'agreement'}-Executed.pdf`;
        link.click();
        URL.revokeObjectURL(url);
      },
      error: err => {
        this.signError = extractApiErrorMessage(err, 'The executed copy is not available yet.');
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
