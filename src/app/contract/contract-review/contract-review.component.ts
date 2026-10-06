import { Component, OnInit, inject, ChangeDetectionStrategy, signal } from '@angular/core';
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
  imports: [FormsModule, ContractDocumentComponent],
  templateUrl: './contract-review.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./contract-review.component.scss']
})
export class ContractReviewComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private contracts = inject(ContractService);

  token = '';
  readonly page = signal<ContractReviewPage | null>(null);

  readonly loading = signal(true);
  readonly loadError = signal('');

  readonly editing = signal(false);
  readonly saving = signal(false);
  readonly saveError = signal('');
  readonly successMessage = signal('');
  readonly revisionNotice = signal<{ message: string; fields: string[] } | null>(null);

  /** Working copy, so cancelling an edit leaves the displayed details untouched. */
  readonly form = signal<ClientReviewInfo>(this.emptyInfo(), { equal: () => false });

  readonly ContractStatus = ContractStatus;

  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    if (!this.token) {
      this.loading.set(false);
      this.loadError.set('This link is missing its reference. Please use the link from your email.');
      return;
    }
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.contracts.getReviewPage(this.token).subscribe({
      next: page => {
        this.page.set(page);
        this.form.set({ ...page.yourInformation });
        this.loading.set(false);
      },
      error: err => {
        this.loadError.set(extractApiErrorMessage(err, 'We could not open this agreement.'));
        this.loading.set(false);
      }
    });
  }

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

  /** True while the client has changed a field that would make this a contract modification. */
  get willCreateRevision(): boolean {
    if (!this.page()) return false;
    const original = this.page()!.yourInformation;
    return this.differs(original.companyLegalName, this.form().companyLegalName)
      || this.differs(original.companyAddress, this.form().companyAddress)
      || this.differs(original.city, this.form().city)
      || this.differs(original.state, this.form().state)
      || this.differs(original.zip, this.form().zip);
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
    this.contracts.updateReviewInformation(this.token, this.form()).subscribe({
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
        // Reload rather than patching locally: a modification replaced the document itself, and
        // even a personal correction re-rendered the signature block.
        this.load();
      },
      error: err => {
        this.saving.set(false);
        this.saveError.set(extractApiErrorMessage(err, 'We could not save your changes.'));
      }
    });
  }

  continueToSignature(): void {
    if (this.page()?.signingToken) {
      this.router.navigate(['/contract/sign', this.page()!.signingToken]);
    }
  }

  downloadExecuted(): void {
    this.contracts.downloadExecutedForClient(this.token).subscribe({
      next: blob => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${this.page()?.contractNumber ?? 'agreement'}-Executed.pdf`;
        link.click();
        URL.revokeObjectURL(url);
      },
      error: err => {
        this.saveError.set(extractApiErrorMessage(err, 'The executed copy is not available yet.'));
      }
    });
  }

  get isExecuted(): boolean {
    return this.page()?.status === ContractStatus.Completed
      || this.page()?.status === ContractStatus.FullySigned;
  }

  private emptyInfo(): ClientReviewInfo {
    return {
      companyLegalName: '', firstName: '', lastName: '', title: '', email: '', phone: '',
      companyAddress: '', city: '', state: '', zip: ''
    };
  }
}
