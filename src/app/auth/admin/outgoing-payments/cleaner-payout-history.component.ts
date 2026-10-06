import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs/operators';

import {
  CleanerPayout, CleanerPayoutHistory, CleanerPayoutLine, OutgoingPaymentService
} from '../../../services/outgoing-payment.service';
import { normalizeCleanerPaymentMethod } from '../../../services/cleaner-management.service';
import { resolveServiceTypeShortLabel } from '../../../shared/admin/service-type-short-label';
import { extractApiErrorMessage } from '../../../utils/http-error.utils';

/**
 * Outgoing Payments → Paid cleaners (2026-10): the payout history.
 *
 * One row per payout — one payment to one cleaner — with exactly the order lines it covered, who
 * recorded it and when. Filterable by the day paid and by cleaner, newest first. A payout can be
 * REVERTED (the page is SuperAdmin-only, so whoever sees the button may use it): its amounts move
 * back to Unpaid cleaners and the row stays here, marked reverted with who did it and why. Nothing
 * on this page deletes history.
 */
@Component({
  selector: 'app-cleaner-payout-history',
  imports: [FormsModule, CurrencyPipe, DatePipe],
  templateUrl: './cleaner-payout-history.component.html',
  styleUrl: './cleaner-payouts.shared.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CleanerPayoutHistoryComponent implements OnInit {
  private service = inject(OutgoingPaymentService);
  private destroyRef = inject(DestroyRef);

  /** Emitted after a revert, so the Orders view and the badges reload. */
  readonly changed = output<void>();

  readonly pageSize = 20;

  readonly data = signal<CleanerPayoutHistory | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly success = signal('');

  readonly from = signal('');
  readonly to = signal('');
  readonly cleanerId = signal<number | null>(null);
  readonly page = signal(1);

  readonly expanded = signal<ReadonlySet<number>>(new Set());

  readonly reverting = signal<CleanerPayout | null>(null);
  readonly revertReason = signal('');
  readonly revertBusy = signal(false);

  readonly totalPages = computed(() => {
    const d = this.data();
    return d ? Math.max(1, Math.ceil(d.totalCount / d.pageSize)) : 1;
  });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.service.getPayoutHistory({
      from: this.from() || null,
      to: this.to() || null,
      cleanerId: this.cleanerId(),
      page: this.page(),
      pageSize: this.pageSize
    })
      .pipe(finalize(() => this.loading.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: data => this.data.set(data),
        error: err => this.error.set(extractApiErrorMessage(err, 'Could not load the payout history.'))
      });
  }

  onFilterChange(): void {
    this.page.set(1);
    this.load();
  }

  clearFilters(): void {
    this.from.set('');
    this.to.set('');
    this.cleanerId.set(null);
    this.onFilterChange();
  }

  get hasFilters(): boolean {
    return !!this.from() || !!this.to() || this.cleanerId() !== null;
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages() || page === this.page()) return;
    this.page.set(page);
    this.load();
  }

  isExpanded(payout: CleanerPayout): boolean {
    return this.expanded().has(payout.id);
  }

  toggleExpanded(payout: CleanerPayout): void {
    const next = new Set(this.expanded());
    if (next.has(payout.id)) next.delete(payout.id);
    else next.add(payout.id);
    this.expanded.set(next);
  }

  // ── Reverting ──

  openRevert(payout: CleanerPayout): void {
    this.reverting.set(payout);
    this.revertReason.set('');
    this.error.set('');
    this.success.set('');
  }

  cancelRevert(): void {
    this.reverting.set(null);
  }

  confirmRevert(): void {
    const payout = this.reverting();
    const reason = this.revertReason().trim();
    if (!payout || reason.length < 3 || this.revertBusy()) return;

    this.revertBusy.set(true);
    this.service.revertPayout(payout.id, reason)
      .pipe(finalize(() => this.revertBusy.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: updated => {
          this.reverting.set(null);
          this.success.set(`Payout to ${updated.cleanerName} reverted — the amounts are back under Unpaid cleaners.`);
          this.changed.emit();
          this.load();
        },
        error: err => this.error.set(extractApiErrorMessage(err, 'Could not revert the payout.'))
      });
  }

  // ── Display ──

  statusLabel(payout: CleanerPayout): string {
    switch (payout.status) {
      case 'Reverted': return 'Reverted';
      case 'PartiallyReverted': return 'Partly reverted';
      default: return 'Paid';
    }
  }

  statusClass(payout: CleanerPayout): string {
    switch (payout.status) {
      case 'Reverted': return 'status-reverted';
      case 'PartiallyReverted': return 'status-partial';
      default: return 'status-paid';
    }
  }

  method(payout: CleanerPayout): string {
    return normalizeCleanerPaymentMethod(payout.paidVia) ?? 'Not recorded';
  }

  serviceTypeShort(line: CleanerPayoutLine): string {
    return resolveServiceTypeShortLabel({
      serviceTypeName: line.rawServiceTypeName,
      isCustomServiceType: line.isCustomServiceType,
      customServiceDisplayName: line.customServiceDisplayName,
      isDeepCleaning: line.isDeepCleaning
    });
  }
}
