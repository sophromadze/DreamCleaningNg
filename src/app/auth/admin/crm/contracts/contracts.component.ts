import { Component, Input, OnInit, SimpleChanges, OnChanges, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime } from 'rxjs';
import { ContractFormComponent } from './contract-form.component';
import { ContractDetailComponent } from './contract-detail.component';
import {
  ContractDetail, ContractListItem, ContractPermissions, ContractService, ContractStatus
} from '../../../../services/contract.service';
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
  styleUrls: ['./contracts.component.scss']
})
export class ContractsComponent implements OnInit, OnChanges {
  /** Deep link from an email ("Open the contract") — opens straight onto the detail page. */
  @Input() openContractId?: number;

  private contracts = inject(ContractService);

  view: ContractsView = 'list';
  contractsList: ContractListItem[] = [];

  loading = true;
  errorMessage = '';

  search = '';
  statusFilter: ContractStatus | null = null;

  /** "Show hidden contracts" — soft-deleted rows, restorable by the CTO for 6 months. */
  includeHidden = false;

  selectedContractId: number | null = null;
  preloadedDetail: ContractDetail | null = null;

  /** The server's permission matrix for this account. Fetched once; the list and detail
   *  views both render from it so they cannot disagree about what is offered. */
  permissions: ContractPermissions | null = null;

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
    if (this.openContractId) this.openDetail(this.openContractId);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['openContractId'] && this.openContractId) {
      this.openDetail(this.openContractId);
    }
  }

  load(): void {
    this.loading = true;
    this.contracts.getContracts(
      this.search || undefined, this.statusFilter ?? undefined, this.includeHidden
    ).subscribe({
      next: rows => { this.contractsList = rows; this.loading = false; },
      error: err => {
        this.errorMessage = extractApiErrorMessage(err, 'Could not load contracts.');
        this.loading = false;
      }
    });
  }

  /**
   * The matrix comes from the server. A failed fetch leaves it null, which hides every action
   * rather than assuming permission — the safe direction when authority is unknown.
   */
  private loadPermissions(): void {
    this.contracts.getMyPermissions().subscribe({
      next: permissions => this.permissions = permissions,
      error: () => this.permissions = null
    });
  }

  onSearchChanged(): void { this.search$.next(); }

  get canCreateContract(): boolean {
    return this.permissions?.createContract === true;
  }

  /** Only whoever can delete has any reason to look at the hidden ones. */
  get canDeleteContracts(): boolean {
    return this.permissions?.deleteContract === true;
  }

  // ── navigation ─────────────────────────────────────────────────────────────

  startNew(): void {
    this.selectedContractId = null;
    this.preloadedDetail = null;
    this.view = 'form';
  }

  openDetail(id: number): void {
    this.selectedContractId = id;
    this.preloadedDetail = null;
    this.view = 'detail';
  }

  editContract(id: number): void {
    this.selectedContractId = id;
    this.preloadedDetail = null;
    this.view = 'form';
  }

  /** Generate Preview lands straight on the preview, which is the whole point of the button. */
  onGenerated(detail: ContractDetail): void {
    this.selectedContractId = detail.id;
    this.preloadedDetail = detail;
    this.view = 'detail';
    this.load();
  }

  backToList(): void {
    this.view = 'list';
    this.selectedContractId = null;
    this.preloadedDetail = null;
    this.load();
  }

  // ── list helpers ───────────────────────────────────────────────────────────

  signatureProgress(row: ContractListItem): string {
    if (!row.signerCount) return '—';
    return `${row.signedCount} of ${row.signerCount} signed`;
  }
}
