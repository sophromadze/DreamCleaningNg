import { Component, OnInit, SimpleChanges, OnChanges, inject, ChangeDetectionStrategy, signal, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject, debounceTime } from 'rxjs';
import { ContractFormComponent } from './contract-form.component';
import { ContractDetailComponent } from './contract-detail.component';
import {
  ContractDetail, ContractListItem, ContractPermissions, ContractService, ContractStatus
} from '../../../../services/contract.service';
import { InvoiceService, ExistingDraftInvoice } from '../../../../services/invoice.service';
import { extractApiErrorMessage } from '../../../../utils/http-error.utils';

type ContractsView = 'list' | 'form' | 'detail';

/**
 * The CRM Contracts tab: a list of every commercial agreement, and the shell that swaps between
 * the list, the create/edit form and one contract's detail page.
 *
 * Contracts sit in the CRM rather than the admin panel because they are the commercial half of
 * the customer relationship — the same place leads and commercial customers already live.
 */
@Component({
  selector: 'app-contracts',
  standalone: true,
  imports: [CommonModule, FormsModule, ContractFormComponent, ContractDetailComponent],
  templateUrl: './contracts.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./contracts.component.scss']
})
export class ContractsComponent implements OnInit, OnChanges {
  /** Deep link from an email ("Open the contract") — opens straight onto the detail page. */
  readonly openContractId = input<number>();

  private contracts = inject(ContractService);
  private invoices = inject(InvoiceService);
  private router = inject(Router);

  readonly view = signal<ContractsView>('list');
  readonly contractsList = signal<ContractListItem[]>([]);

  readonly loading = signal(true);
  readonly errorMessage = signal('');

  /** Survives the navigation back to the list after a permanent delete. */
  readonly successMessage = signal('');

  readonly search = signal('');
  readonly statusFilter = signal<ContractStatus | null>(null);

  /**
   * "Show archived contracts" — archived rows, which are hidden from the default list and
   * restorable by the CTO. The query parameter keeps its original `includeHidden` spelling; only
   * the label changed, and renaming a deployed API parameter to match a label is not worth it.
   */
  readonly includeHidden = signal(false);

  readonly selectedContractId = signal<number | null>(null);
  readonly preloadedDetail = signal<ContractDetail | null>(null);

  /** The server's permission matrix for this account. Fetched once; the list and detail
   *  views both render from it so they cannot disagree about what is offered. */
  readonly permissions = signal<ContractPermissions | null>(null);

  private search$ = new Subject<void>();

  readonly ContractStatus = ContractStatus;
  readonly statusOptions: { value: ContractStatus | null; label: string }[] = [
    { value: null, label: 'All statuses' },
    { value: ContractStatus.Draft, label: 'Draft' },
    { value: ContractStatus.PreviewGenerated, label: 'Preview generated' },
    { value: ContractStatus.AwaitingClientReview, label: 'Awaiting client review' },
    { value: ContractStatus.NeedsRevision, label: 'Needs revision' },
    { value: ContractStatus.AwaitingSignatures, label: 'Awaiting signatures' },
    { value: ContractStatus.PartiallySigned, label: 'Partially signed' },
    { value: ContractStatus.Completed, label: 'Completed' },
    { value: ContractStatus.Voided, label: 'Voided' }
  ];

  ngOnInit(): void {
    this.search$.pipe(debounceTime(300)).subscribe(() => this.load());
    this.loadPermissions();
    this.load();
    const openContractId = this.openContractId();
    if (openContractId) this.openDetail(openContractId);
  }

  ngOnChanges(changes: SimpleChanges): void {
    const openContractId = this.openContractId();
    if (changes['openContractId'] && openContractId) {
      this.openDetail(openContractId);
    }
  }

  load(): void {
    this.loading.set(true);
    this.errorMessage.set('');
    this.contracts.getContracts(
      this.search() || undefined, this.statusFilter() ?? undefined, this.includeHidden()
    ).subscribe({
      next: rows => { this.contractsList.set(rows); this.loading.set(false); },
      error: err => {
        this.errorMessage.set(extractApiErrorMessage(err, 'Could not load contracts.'));
        this.loading.set(false);
      }
    });
  }

  /**
   * The matrix comes from the server. A failed fetch leaves it null, which hides every action
   * rather than assuming permission — the safe direction when authority is unknown.
   */
  private loadPermissions(): void {
    this.contracts.getMyPermissions().subscribe({
      next: permissions => this.permissions.set(permissions),
      error: () => this.permissions.set(null)
    });
  }

  onSearchChanged(): void { this.search$.next(); }

  get canCreateContract(): boolean {
    return this.permissions()?.createContract === true;
  }

  /** Only whoever can archive has any reason to look at the archived ones. */
  get canDeleteContracts(): boolean {
    return this.permissions()?.deleteContract === true;
  }

  // ── navigation ─────────────────────────────────────────────────────────────

  startNew(): void {
    this.successMessage.set('');
    this.selectedContractId.set(null);
    this.preloadedDetail.set(null);
    this.view.set('form');
  }

  openDetail(id: number): void {
    this.successMessage.set('');
    this.selectedContractId.set(id);
    this.preloadedDetail.set(null);
    this.view.set('detail');
  }

  editContract(id: number): void {
    this.selectedContractId.set(id);
    this.preloadedDetail.set(null);
    this.view.set('form');
  }

  /**
   * "Create next invoice" lands on the new DRAFT's edit form.
   *
   * The edit form rather than the detail view because reviewing and correcting the generated dates
   * and figures is the entire next step - the draft exists precisely so somebody looks at it
   * before it is sent, and dropping the admin on a read-only page would make them hunt for Edit.
   */
  openInvoice(invoiceId: number): void {
    this.router.navigate(['/admin/commercial/invoices', invoiceId, 'edit']);
  }

  /** Generate Preview lands straight on the preview, which is the whole point of the button. */
  onGenerated(detail: ContractDetail): void {
    this.selectedContractId.set(detail.id);
    this.preloadedDetail.set(detail);
    this.view.set('detail');
    this.load();
  }

  /**
   * A contract was PERMANENTLY deleted. The panel has nothing left to show, so the list is the
   * only correct destination — and the message has to survive the navigation, which is why the
   * detail component hands it up rather than rendering it itself.
   */
  onContractDeleted(message: string): void {
    this.backToList();
    this.successMessage.set(message);
  }

  backToList(): void {
    this.view.set('list');
    this.selectedContractId.set(null);
    this.preloadedDetail.set(null);
    this.load();
  }

  // ── Create next invoice, from the list ─────────────────────────────────────
  //
  // The action existed only inside one contract's detail view, in an action bar that can carry ten
  // buttons — so billing a contract meant opening it and finding "Create next invoice" among
  // Revise, Amend, Duplicate, Regenerate and the rest. Nobody reported a broken button; they
  // reported not being able to find one. It is a per-row action here.

  /** The row whose draft is being created, so only that button says "Creating…". */
  readonly billingContractId = signal<number | null>(null);

  /**
   * Whether this contract can be billed — the SERVER'S answer, carried on the row.
   *
   * It used to be re-derived here as "not hidden and past Draft", which was too generous: a
   * contract awaiting signatures, partially signed, needing revision, voided or expired all
   * passed, and invoicing any of those bills a client for terms they have not accepted. The rule
   * now lives in ONE place (`ContractInvoiceEligibility`), and the endpoint enforces it — hiding
   * the button is the convenience, that check is the control.
   *
   * HAVING NO PREVIOUS INVOICE IS STILL NOT A REASON TO HIDE IT. The generator falls back to the
   * contract's own pricing and schedule when there is nothing to model on, and the first invoice
   * of an agreement is exactly the one an admin wants this for.
   */
  canCreateNextInvoice(row: ContractListItem): boolean {
    return row.canCreateNextInvoice;
  }

  /**
   * Produces a DRAFT and emails nobody, then lands on its edit form — the same contract of the
   * detail view's button, including the duplicate-period confirmation, which is a question rather
   * than a refusal and is asked once.
   */
  createNextInvoice(row: ContractListItem, allowDuplicatePeriod = false, acknowledgeUndatedDraft = false): void {
    if (this.billingContractId() !== null) return;

    this.errorMessage.set('');
    this.billingContractId.set(row.id);

    this.invoices.createNextFromContract(row.id, allowDuplicatePeriod, acknowledgeUndatedDraft).subscribe({
      next: result => {
        this.billingContractId.set(null);
        this.openInvoice(result.invoice.id);
      },
      error: err => {
        this.billingContractId.set(null);

        const message = extractApiErrorMessage(err, 'The next invoice could not be created.');

        // 409 — an unsent DRAFT already exists for this contract. Not an error: the thing being
        // asked for is already there, so the useful response is to open it. This is the commonest
        // operational mistake (pressing the button twice, or forgetting last week's draft) and it
        // used to produce a second identical draft that could be sent alongside the first.
        const existingDraft: ExistingDraftInvoice | undefined = err?.error?.existingDraft;
        if (err?.status === 409 && existingDraft) {
          if (confirm(`${existingDraft.message}\n\nOpen that draft?`)) {
            this.openInvoice(existingDraft.invoiceId);
          } else if (confirm(existingDraft.isUndated ? 'Leave the undated draft intact and create a draft for the intended period?' : 'Create a SECOND draft for this period anyway?')) {
            this.createNextInvoice(row, existingDraft.isUndated ? allowDuplicatePeriod : true, existingDraft.isUndated || acknowledgeUndatedDraft);
          }
          return;
        }

        if (err?.status === 400 && !allowDuplicatePeriod && message.includes('already covers')) {
          if (confirm(`${message}\n\nCreate a second invoice for the same period anyway?`)) {
            this.createNextInvoice(row, true, acknowledgeUndatedDraft);
          }
          return;
        }

        this.errorMessage.set(message);
      }
    });
  }

  // ── list helpers ───────────────────────────────────────────────────────────

  signatureProgress(row: ContractListItem): string {
    if (!row.signerCount) return '—';
    return `${row.signedCount} of ${row.signerCount} signed`;
  }
}
