import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ContractDocumentComponent } from '../../shared/components/contract-document/contract-document.component';
import {
  ClientReviewInfo, ContractReviewPage, ContractService, ContractStatus
} from '../../services/contract.service';
import { extractApiErrorMessage } from '../../utils/http-error.utils';

/**
 * The page a commercial client lands on from their review email. No login: the opaque token in
 * the URL is the whole authorization, exactly like the tokenized customer payment links.
 *
 * Order on the page is deliberate and matches the spec: title and parties, then "Your
 * Information" so any correction happens BEFORE the client wades through the agreement, then the
 * complete document (every section and both exhibits, never a summary), then Continue to
 * Signature at the bottom.
 *
 * The distinction the page has to communicate honestly is which edits are free and which are not:
 * correcting a name or email is applied immediately, while changing the legal entity name or the
 * company address is a contract modification that produces a revised version needing our
 * approval. The server decides which happened; this page reports what it decided.
 */
@Component({
  selector: 'app-contract-review',
  standalone: true,
  imports: [CommonModule, FormsModule, ContractDocumentComponent],
  templateUrl: './contract-review.component.html',
  styleUrls: ['./contract-review.component.scss']
})
export class ContractReviewComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private contracts = inject(ContractService);

  token = '';
  page: ContractReviewPage | null = null;

  loading = true;
  loadError = '';

  editing = false;
  saving = false;
  saveError = '';
  successMessage = '';
  revisionNotice: { message: string; fields: string[] } | null = null;

  /** Working copy, so cancelling an edit leaves the displayed details untouched. */
  form: ClientReviewInfo = this.emptyInfo();

  readonly ContractStatus = ContractStatus;

  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    if (!this.token) {
      this.loading = false;
      this.loadError = 'This link is missing its reference. Please use the link from your email.';
      return;
    }
    this.load();
  }

  private load(): void {
    this.loading = true;
    this.contracts.getReviewPage(this.token).subscribe({
      next: page => {
        this.page = page;
        this.form = { ...page.yourInformation };
        this.loading = false;
      },
      error: err => {
        this.loadError = extractApiErrorMessage(err, 'We could not open this agreement.');
        this.loading = false;
      }
    });
  }

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

  /** True while the client has changed a field that would make this a contract modification. */
  get willCreateRevision(): boolean {
    if (!this.page) return false;
    const original = this.page.yourInformation;
    return this.differs(original.companyLegalName, this.form.companyLegalName)
      || this.differs(original.companyAddress, this.form.companyAddress)
      || this.differs(original.city, this.form.city)
      || this.differs(original.state, this.form.state)
      || this.differs(original.zip, this.form.zip);
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
    this.contracts.updateReviewInformation(this.token, this.form).subscribe({
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
        // Reload rather than patching locally: a modification replaced the document itself, and
        // even a personal correction re-rendered the signature block.
        this.load();
      },
      error: err => {
        this.saving = false;
        this.saveError = extractApiErrorMessage(err, 'We could not save your changes.');
      }
    });
  }

  continueToSignature(): void {
    if (this.page?.signingToken) {
      this.router.navigate(['/contract/sign', this.page.signingToken]);
    }
  }

  downloadExecuted(): void {
    this.contracts.downloadExecutedForClient(this.token).subscribe({
      next: blob => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${this.page?.contractNumber ?? 'agreement'}-Executed.pdf`;
        link.click();
        URL.revokeObjectURL(url);
      },
      error: err => {
        this.saveError = extractApiErrorMessage(err, 'The executed copy is not available yet.');
      }
    });
  }

  get isExecuted(): boolean {
    return this.page?.status === ContractStatus.Completed
      || this.page?.status === ContractStatus.FullySigned;
  }

  private emptyInfo(): ClientReviewInfo {
    return {
      companyLegalName: '', firstName: '', lastName: '', title: '', email: '', phone: '',
      companyAddress: '', city: '', state: '', zip: ''
    };
  }
}
