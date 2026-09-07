import {
  Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges, inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ContractDocumentComponent } from '../../../../shared/components/contract-document/contract-document.component';
import {
  CapturedSignature, SignatureCaptureComponent
} from '../../../../shared/components/signature-capture/signature-capture.component';
import {
  ContractDetail, ContractFileType, ContractPermissions, ContractService, ContractSignatureBlock,
  ContractSignerStatus, ContractStatus
} from '../../../../services/contract.service';
import { extractApiErrorMessage } from '../../../../utils/http-error.utils';

/**
 * One contract: the FULL rendered document (never a summary or just the signature page), the
 * actions available in its current state, the signer roster, the version history and the
 * plain-language audit timeline.
 *
 * Which actions appear is decided by the server and read off the detail DTO rather than
 * re-derived here, so the panel can never offer a button the API would reject.
 */
@Component({
  selector: 'app-contract-detail',
  standalone: true,
  imports: [CommonModule, ContractDocumentComponent, SignatureCaptureComponent],
  templateUrl: './contract-detail.component.html',
  styleUrls: ['./contract-detail.component.scss']
})
export class ContractDetailComponent implements OnInit, OnChanges {
  @Input() contractId!: number;
  /** Set when arriving straight from Generate Preview, to skip a redundant fetch. */
  @Input() preloaded: ContractDetail | null = null;

  /**
   * What this account may do, from the server's matrix. Passed in by the shell so the list and
   * detail views agree and the permissions are fetched once rather than per contract.
   */
  @Input() permissions: ContractPermissions | null = null;

  @Output() back = new EventEmitter<void>();
  @Output() edit = new EventEmitter<number>();

  private contracts = inject(ContractService);

  detail: ContractDetail | null = null;
  signatureBlock: ContractSignatureBlock | null = null;

  loading = true;
  busy = false;
  errorMessage = '';
  successMessage = '';

  /** Which historical version is being viewed; null shows the current one. */
  viewingVersionId: number | null = null;
  viewingHtml = '';

  readonly ContractStatus = ContractStatus;
  readonly ContractSignerStatus = ContractSignerStatus;
  readonly ContractFileType = ContractFileType;

  ngOnInit(): void {
    if (this.preloaded) {
      this.apply(this.preloaded);
      this.loading = false;
    } else {
      this.load();
    }
  }

  /**
   * The shell reuses this component when it swaps which contract is shown, so ngOnInit does not
   * run again. Without this, pointing the panel at a different contract left the previous one on
   * screen — which is exactly how Create Amendment appeared to do nothing.
   */
  ngOnChanges(changes: SimpleChanges): void {
    const changedId = changes['contractId'];
    if (!changedId || changedId.firstChange) return;

    if (this.preloaded && this.preloaded.id === this.contractId) {
      this.apply(this.preloaded);
      this.loading = false;
      return;
    }
    this.load();
  }

  private load(): void {
    this.loading = true;
    this.contracts.getContract(this.contractId).subscribe({
      next: detail => { this.apply(detail); this.loading = false; },
      error: err => {
        this.errorMessage = extractApiErrorMessage(err, 'Could not load this contract.');
        this.loading = false;
      }
    });
  }

  private apply(detail: ContractDetail): void {
    this.detail = detail;
    this.contractId = detail.id;
    this.viewingVersionId = null;
    this.viewingHtml = detail.documentHtml;
    // Composed server-side and carrying the real marks once signed, so the admin preview shows
    // the same executed block the client and the PDF do rather than a locally rebuilt one.
    this.signatureBlock = detail.signatureBlock ?? null;
  }

  // ── version viewing ────────────────────────────────────────────────────────

  viewVersion(versionId: number): void {
    if (!this.detail) return;
    if (versionId === this.detail.currentVersionId) {
      this.viewingVersionId = null;
      this.viewingHtml = this.detail.documentHtml;
      this.signatureBlock = this.detail.signatureBlock ?? null;
      return;
    }

    this.contracts.getVersionDocument(this.detail.id, versionId).subscribe({
      next: result => {
        this.viewingVersionId = versionId;
        this.viewingHtml = result.documentHtml;
        this.signatureBlock = result.signatureBlock;
      },
      error: err => this.errorMessage = extractApiErrorMessage(err, 'Could not load that version.')
    });
  }

  // ── actions ────────────────────────────────────────────────────────────────

  private run(action: () => void): void {
    this.errorMessage = '';
    this.successMessage = '';
    this.busy = true;
    action();
  }

  private handle(message: string) {
    return {
      next: (detail: ContractDetail) => {
        this.busy = false;
        this.apply(detail);
        this.successMessage = message;
      },
      error: (err: any) => {
        this.busy = false;
        this.errorMessage = extractApiErrorMessage(err, 'That action could not be completed.');
      }
    };
  }

  sendForReview(): void {
    this.run(() => this.contracts.sendForReview(this.contractId)
      .subscribe(this.handle('The review link has been emailed to the client.')));
  }

  sendForSignature(): void {
    if (!confirm('Send signing links to both parties? The contract locks once you do.')) return;
    this.run(() => this.contracts.sendForSignature(this.contractId)
      .subscribe(this.handle('Signing links have been emailed to both parties.')));
  }

  revise(): void {
    if (!confirm('Reopen this contract for editing? Any outstanding signing links will stop working.')) return;
    this.run(() => this.contracts.revise(this.contractId)
      .subscribe(this.handle('Reopened for revision. Outstanding signing links have been voided.')));
  }

  deleteContract(): void {
    // Says what actually happens, including the part that is not obvious: the links stop working
    // immediately, and the record is not gone forever.
    if (!confirm(
      'Delete this contract?\n\n' +
      'It will be hidden from the list and any outstanding signing links will stop working. ' +
      'You can restore it for the next 6 months, after which it is permanently deleted.'
    )) return;
    this.run(() => this.contracts.deleteContract(this.contractId)
      .subscribe(this.handle('Contract deleted. You can restore it from “Show hidden contracts”.')));
  }

  restoreContract(): void {
    this.run(() => this.contracts.restoreContract(this.contractId)
      .subscribe(this.handle('Contract restored.')));
  }

  /**
   * Amendment and Duplicate both produce a fresh Draft carrying every field of the source, and
   * the only thing anyone does next is edit it. So they land the admin straight in the edit form
   * rather than on the new contract's preview — a preview of a Draft has no document to show, and
   * the admin's next three clicks were always list → open → "Back to edit".
   *
   * Emitting `edit` rather than reopening the detail view also sidesteps a component-reuse trap:
   * the shell keeps the SAME detail component mounted when only its contractId input changes, so
   * routing a new id back into the detail view left the source contract on screen and looked as
   * though the button had done nothing at all — which is what ngOnChanges above now also covers.
   */
  duplicate(asAmendment: boolean): void {
    this.run(() => this.contracts.duplicate(this.contractId, asAmendment).subscribe({
      next: created => {
        this.busy = false;
        this.edit.emit(created.id);
      },
      error: err => {
        this.busy = false;
        this.errorMessage = extractApiErrorMessage(err, 'Could not create the copy.');
      }
    }));
  }

  regenerateExecuted(): void {
    this.run(() => this.contracts.regenerateExecuted(this.contractId)
      .subscribe(this.handle('The executed PDF has been regenerated. Nothing was emailed.')));
  }

  resendExecuted(): void {
    if (!confirm('Email the executed agreement to both parties again?')) return;
    this.run(() => this.contracts.resendExecuted(this.contractId)
      .subscribe(this.handle('The executed copy has been emailed to both parties.')));
  }

  // ── in-app contractor signing ──────────────────────────────────────────────

  signingOpen = false;
  signingBusy = false;
  signingError = '';

  openSigning(): void {
    this.signingOpen = true;
    this.signingError = '';
    this.successMessage = '';
  }

  cancelSigning(): void {
    this.signingOpen = false;
    this.signingError = '';
  }

  onSignedAsContractor(captured: CapturedSignature): void {
    if (this.signingBusy) return;
    this.signingBusy = true;
    this.signingError = '';

    this.contracts.signAsContractor(this.contractId, {
      signerName: captured.signerName,
      signerTitle: captured.signerTitle,
      signerEmail: captured.signerEmail,
      signatureMethod: captured.signatureMethod,
      signatureData: captured.signatureData,
      consentAccepted: true
    }).subscribe({
      next: result => {
        this.signingBusy = false;
        this.signingOpen = false;
        this.successMessage = result.message;
        this.load();
      },
      error: err => {
        this.signingBusy = false;
        this.signingError = extractApiErrorMessage(err, 'Your signature could not be recorded.');
      }
    });
  }

  /** The contractor signer row, for pre-filling the locked name/title on the capture form. */
  get contractorSigner() {
    return this.detail?.signers.find(s => s.role === 0);
  }

  resendInvite(signerId: number): void {
    this.errorMessage = '';
    this.contracts.resendSignerInvite(this.contractId, signerId).subscribe({
      next: res => { this.successMessage = res.message; this.load(); },
      error: err => this.errorMessage = extractApiErrorMessage(err, 'Could not re-send that link.')
    });
  }

  downloadFile(fileId: number, fileName: string): void {
    this.contracts.downloadFile(fileId).subscribe({
      next: blob => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(url);
      },
      error: err => this.errorMessage = extractApiErrorMessage(err, 'Could not download that file.')
    });
  }

  copyReviewLink(): void {
    if (!this.detail?.clientReviewUrl) return;
    navigator.clipboard?.writeText(this.detail.clientReviewUrl)
      .then(() => this.successMessage = 'Review link copied.')
      .catch(() => this.errorMessage = 'Could not copy the link.');
  }

  copySigningLink(url?: string): void {
    if (!url) return;
    navigator.clipboard?.writeText(url)
      .then(() => this.successMessage = 'Signing link copied.')
      .catch(() => this.errorMessage = 'Could not copy the link.');
  }

  fileLabel(type: ContractFileType): string {
    switch (type) {
      case ContractFileType.Preview: return 'Preview PDF';
      case ContractFileType.FinalExecuted: return 'Executed PDF';
      case ContractFileType.AuditCertificate: return 'Signature certificate';
      default: return 'Document';
    }
  }

  signerRoleLabel(role: number): string {
    return role === 0 ? 'Contractor' : 'Client';
  }

  /**
   * Every visible action is the AND of two things: does the contract's state allow it, and does
   * the matrix let this account do it. The permission half is the server's answer, never
   * re-derived from a role here — and the API re-checks it regardless, so hiding a button is
   * presentation, not enforcement.
   */
  private allowed(action: keyof ContractPermissions): boolean {
    // No permissions loaded yet: show nothing rather than flashing buttons that may vanish.
    return this.permissions?.[action] === true;
  }

  get showEdit(): boolean {
    return !!this.detail?.canEdit && this.allowed('backToEdit');
  }

  get showSendForReview(): boolean {
    return !!this.detail?.canSendForReview && this.allowed('sendForReview');
  }

  get showSendForSignature(): boolean {
    return !!this.detail?.canSendForSignature && this.allowed('sendForSignature');
  }

  /**
   * Reopening for revision is for a contract that has been SENT but not executed. A fully signed
   * or completed contract is never revised — it is amended or duplicated, and the executed
   * document is never touched.
   */
  get canRevise(): boolean {
    const status = this.detail?.status;
    const stateAllows = status === ContractStatus.ReadyForSignature
      || status === ContractStatus.AwaitingSignatures
      || status === ContractStatus.PartiallySigned;
    return stateAllows && this.allowed('createRevision');
  }

  private get isExecutedState(): boolean {
    return this.detail?.status === ContractStatus.FullySigned
      || this.detail?.status === ContractStatus.Completed;
  }

  get canRegenerateExecuted(): boolean {
    return this.isExecutedState && this.allowed('regenerateExecutedPdf');
  }

  /** Separate from regenerate: this one puts mail in the client's inbox. */
  get canResendExecuted(): boolean {
    return this.isExecutedState && this.allowed('resendExecutedCopy');
  }

  get canDuplicate(): boolean {
    return !!this.detail && this.allowed('duplicate');
  }

  get canAmend(): boolean {
    return !!this.detail && this.allowed('createAmendment');
  }

  /** Soft delete — CTO-only, as Void was. Hidden contracts offer Restore instead. */
  get showDelete(): boolean {
    return !!this.detail?.canDelete && this.allowed('deleteContract');
  }

  get showRestore(): boolean {
    return !!this.detail?.canRestore && this.allowed('restoreContract');
  }

  /**
   * The in-app contractor signing option. Both halves are required and mean different things:
   * identity (this account IS the designated signer, still pending) and authority (CEO/CTO).
   */
  get canSignAsContractor(): boolean {
    return !!this.detail?.isPendingContractorSigner && this.allowed('signAsContractor');
  }
}
