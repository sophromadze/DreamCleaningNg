import { Component, OnInit, inject, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ContractService, MyContractListItem } from '../../services/contract.service';
import { extractApiErrorMessage } from '../../utils/http-error.utils';

/**
 * "My Contracts" for business customers: every agreement linked to their own account.
 *
 * Reached from the account dropdown, guarded by authGuard, and scoped server-side to
 * ContractClient.SourceUserId — this page never asks for a contract by id without the server
 * re-checking ownership, so there is nothing to iterate.
 */
@Component({
  selector: 'app-my-contracts',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './my-contracts.component.html',
  // The review page's stylesheet is the single source for the client-facing chrome; this
  // component's own sheet adds only the list.
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: [
    '../contract-review/contract-review.component.scss',
    './my-contracts.component.scss'
  ]
})
export class MyContractsComponent implements OnInit {
  private contracts = inject(ContractService);
  private router = inject(Router);

  readonly rows = signal<MyContractListItem[]>([]);
  readonly loading = signal(true);
  readonly errorMessage = signal('');

  ngOnInit(): void {
    this.contracts.getMyContracts().subscribe({
      next: rows => { this.rows.set(rows); this.loading.set(false); },
      error: err => {
        this.errorMessage.set(extractApiErrorMessage(err, 'We could not load your contracts.'));
        this.loading.set(false);
      }
    });
  }

  open(row: MyContractListItem): void {
    this.router.navigate(['/profile/contracts', row.id]);
  }

  /** How many are waiting on this customer, for the heading nudge. */
  get awaitingCount(): number {
    return this.rows().filter(r => r.awaitingYourSignature).length;
  }
}
