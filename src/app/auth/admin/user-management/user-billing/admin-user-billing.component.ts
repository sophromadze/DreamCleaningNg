import { Component, OnChanges, OnDestroy, SimpleChanges, ChangeDetectionStrategy, inject, signal, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import { AdminUserBilling, BillingService, cardExpiry, cardLabel } from '../../../../services/billing.service';
import { extractApiErrorMessage } from '../../../../utils/http-error.utils';

/**
 * Admin → Users → User Details → Billing. VISIBILITY ONLY.
 *
 * Shows the customer's masked cards and their roles, AutoPay and every arrangement's own
 * authorisation (never one misleading ON/OFF), balances still owed, saved-card charge attempts
 * and recent billing history. It deliberately offers no way to add a card, change a role, change
 * consent or charge anything: those belong to the customer (and the one legitimate admin charge
 * lives on the order, behind the customer's office authorisation).
 */
@Component({
  selector: 'app-admin-user-billing',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './admin-user-billing.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./admin-user-billing.component.scss']
})
export class AdminUserBillingComponent implements OnChanges, OnDestroy {
  private billing = inject(BillingService);

  readonly userId = input.required<number>();

  readonly cardLabel = cardLabel;
  readonly cardExpiry = cardExpiry;

  readonly data = signal<AdminUserBilling | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');

  private destroy$ = new Subject<void>();
  private request$ = new Subject<void>();

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['userId'] && this.userId()) this.load();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  load(): void {
    this.request$.next(); // a newer user's request supersedes an older one
    this.loading.set(true);
    this.error.set('');
    const forUser = this.userId();
    this.billing.getAdminUserBilling(forUser).pipe(takeUntil(this.request$), takeUntil(this.destroy$)).subscribe({
      next: (data) => {
        if (forUser !== this.userId()) return;
        this.data.set(data);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(extractApiErrorMessage(err, 'Could not load this customer\'s billing.'));
      }
    });
  }

  statusClass(status: string): string {
    return 'st-' + status.toLowerCase().replace(/\s+/g, '-');
  }
}
