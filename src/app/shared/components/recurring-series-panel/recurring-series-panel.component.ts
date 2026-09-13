import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs/operators';
import { Observable } from 'rxjs';

import {
  RecurringOrderService,
  RecurringSeries,
  RecurrenceIntervalUnit,
  SaveRecurringSeries, RecurringPricePreview
} from '../../../services/recurring-order.service';
import { extractApiErrorMessage } from '../../../utils/http-error.utils';

@Component({
  selector: 'app-recurring-series-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './recurring-series-panel.component.html',
  styleUrls: ['./recurring-series-panel.component.scss']
})
/**
 * The RECURRENCE card in the admin order detail panel: make this cleaning repeat, or manage the
 * schedule it is already part of.
 *
 * It shows the schedule, the occurrences already materialized, and the dates still to come — and
 * says out loud the two things that are easy to get wrong about recurring orders:
 *
 *  1. **Copying cleaners does not notify them.** The toggle's label says so, and every generated
 *     occurrence carrying an un-notified auto-assignment is counted in a warning line. The
 *     existing Send / Resend buttons on each order remain the only thing that contacts a cleaner.
 *  2. **Nothing asks the customer for money on its own** unless "Request payment automatically"
 *     is switched on — and even then not within 24 hours of the previous cleaning.
 *
 * The component only ever talks to the recurring endpoints; it does not create, price or edit
 * orders itself.
 */
export class RecurringSeriesPanelComponent implements OnChanges {
  @Input() orderId: number | null = null;

  /** Whether the signed-in admin may set a series up (Permission.Create on the backend). */
  @Input() canCreate = false;

  /** Whether they may edit or generate (Permission.Update). */
  @Input() canUpdate = false;

  /** Raised after a generation pass so the host can refresh its order list. */
  @Output() ordersGenerated = new EventEmitter<number[]>();

  series: RecurringSeries | null = null;
  loading = false;
  saving = false;
  generating = false;
  errorMessage = '';
  noticeMessage = '';

  /** The setup / edit form is only rendered once opened, so the card stays quiet by default. */
  editing = false;
  startingNew = false;

  // ── Form ────────────────────────────────────────────────────────────────────────────────
  intervalValue = 1;
  intervalUnit: RecurrenceIntervalUnit = RecurrenceIntervalUnit.Weeks;
  anchorDate = '';
  endDate = '';
  copyCleanerAssignments = false;
  autoRequestPayment = true;
  serviceTime = '';
  futureOrdersAction: 'Keep' | 'Regenerate' | null = null;
  pendingAction: { kind: 'pause' | 'resume' | 'stop' | 'skip'; orderId?: number } | null = null;
  isActive = true;
  notes = '';

  /**
   * How the standing discount is WRITTEN. Percentage is the default because that is how every
   * other discount in this system is expressed, so a fixed amount is the deliberate choice rather
   * than the one an admin falls into.
   *
   * The two values are kept in separate fields rather than one field reinterpreted by the mode:
   * a number that means 15% in one mode and $15 in the other is exactly the sort of thing that
   * gets saved as the wrong one. Only the field belonging to the active mode is ever sent, and
   * switching mode clears the other — the server refuses both at once.
   */
  loyaltyDiscountMode: 'percent' | 'fixed' = 'percent';
  recurringLoyaltyDiscountPercent: number | null = null;
  recurringLoyaltyDiscountAmount: number | null = null;
  pricePreview: RecurringPricePreview | null = null;
  previewLoading = false;
  previewError = '';
  private previewRequest = 0;

  readonly units: { value: RecurrenceIntervalUnit; label: string }[] = [
    { value: RecurrenceIntervalUnit.Days, label: 'day(s)' },
    { value: RecurrenceIntervalUnit.Weeks, label: 'week(s)' },
    { value: RecurrenceIntervalUnit.Months, label: 'month(s)' }
  ];

  readonly Units = RecurrenceIntervalUnit;

  constructor(private recurring: RecurringOrderService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['orderId']) this.load();
  }

  private load(): void {
    this.series = null;
    this.editing = false;
    this.startingNew = false;
    this.errorMessage = '';
    this.noticeMessage = '';

    if (!this.orderId) return;

    this.loading = true;
    this.recurring.forOrder(this.orderId)
      .pipe(finalize(() => { this.loading = false; }))
      .subscribe({
        next: (series) => {
          this.series = series;
          if (series) this.seedFormFrom(series);
        },
        error: (err) => {
          this.errorMessage = extractApiErrorMessage(err, 'Could not load the recurring schedule.');
        }
      });
  }

  private seedFormFrom(series: RecurringSeries): void {
    // The stored column says which way the agreement was written. Percentage when neither is
    // set, so a series with no discount opens on the default rather than on whatever was last used.
    this.recurringLoyaltyDiscountPercent = series.recurringLoyaltyDiscountPercent ?? null;
    this.recurringLoyaltyDiscountAmount = series.recurringLoyaltyDiscountAmount ?? null;
    this.loyaltyDiscountMode = series.recurringLoyaltyDiscountAmount != null ? 'fixed' : 'percent';
    this.intervalValue = series.intervalValue;
    this.intervalUnit = series.intervalUnit;
    this.anchorDate = (series.anchorDate || '').slice(0, 10);
    this.serviceTime = (series.serviceTime || '').slice(0, 5);
    this.futureOrdersAction = null;
    this.endDate = (series.endDate || '').slice(0, 10);
    this.copyCleanerAssignments = series.copyCleanerAssignments;
    this.autoRequestPayment = series.autoRequestPayment;
    this.isActive = series.isActive;
    this.notes = series.notes || '';
  }

  startSetup(startNew = false): void {
    if (startNew && (!this.canCreate || !this.series?.stoppedAt || this.series.templateOrderId !== this.orderId)) return;
    this.startingNew = startNew;
    this.editing = true;
    this.errorMessage = '';
    this.noticeMessage = '';

    if (!this.series || startNew) {
      // A fortnightly clean is by far the commonest arrangement, and an empty anchor means
      // "the order's own service date" — which is what "repeat this one" means.
      this.recurringLoyaltyDiscountPercent = null;
      this.recurringLoyaltyDiscountAmount = null;
      this.loyaltyDiscountMode = 'percent';
      this.intervalValue = 2;
      this.intervalUnit = RecurrenceIntervalUnit.Weeks;
      this.anchorDate = '';
      this.endDate = '';
      this.copyCleanerAssignments = false;
      this.autoRequestPayment = true;
      this.serviceTime = '';
      this.futureOrdersAction = null;
      this.isActive = true;
      this.notes = '';
    }
    this.refreshPricePreview();
  }

  /**
   * Switching how the discount is written CLEARS the other field rather than converting it.
   * 15% and $15 are different agreements, and a silent conversion would quietly turn "15% off"
   * into "$15 off" on a cleaning that happened to cost $100 today.
   */
  setLoyaltyDiscountMode(mode: 'percent' | 'fixed'): void {
    if (this.loyaltyDiscountMode === mode) return;
    this.loyaltyDiscountMode = mode;
    this.recurringLoyaltyDiscountPercent = null;
    this.recurringLoyaltyDiscountAmount = null;
    this.refreshPricePreview();
  }

  /** The value actually sent, as the mode decides — never both, which the server refuses. */
  private get loyaltyPercentToSend(): number | null {
    return this.loyaltyDiscountMode === 'percent' ? this.recurringLoyaltyDiscountPercent : null;
  }

  private get loyaltyAmountToSend(): number | null {
    return this.loyaltyDiscountMode === 'fixed' ? this.recurringLoyaltyDiscountAmount : null;
  }

  refreshPricePreview(): void {
    const id = this.series?.templateOrderId ?? this.orderId;
    const version = ++this.previewRequest;
    this.pricePreview = null; this.previewError = '';
    if (!id) return;
    this.previewLoading = true;
    this.recurring.preview(id, this.loyaltyPercentToSend, this.loyaltyAmountToSend).subscribe({
      next: preview => { if (version === this.previewRequest) { this.pricePreview = preview; this.previewLoading = false; } },
      error: err => { if (version === this.previewRequest) { this.previewLoading = false; this.previewError = extractApiErrorMessage(err, 'Could not calculate the recurring estimate.'); } }
    });
  }

  cancelEdit(): void {
    this.editing = false;
    this.startingNew = false;
    if (this.series) this.seedFormFrom(this.series);
  }

  /**
   * The one configuration this system does not support yet, stated where the admin is choosing
   * it rather than after they press Save. The server refuses it too — this is the courtesy.
   */
  get dailyNotSupported(): boolean {
    return this.intervalUnit === RecurrenceIntervalUnit.Days && this.intervalValue === 1;
  }

  get validationError(): string | null {
    if (this.needsFutureOrdersChoice && !this.futureOrdersAction) return 'Choose whether to keep or regenerate the future schedule.';
    if (this.loyaltyDiscountMode === 'percent' && this.recurringLoyaltyDiscountPercent != null
      && (this.recurringLoyaltyDiscountPercent < 0 || this.recurringLoyaltyDiscountPercent > 100))
      return 'Recurring loyalty must be between 0% and 100%.';
    if (this.loyaltyDiscountMode === 'fixed' && this.recurringLoyaltyDiscountAmount != null
      && this.recurringLoyaltyDiscountAmount < 0)
      return 'A fixed recurring discount cannot be negative.';
    if (this.intervalValue < 1) return 'The interval must be at least 1.';
    if (this.dailyNotSupported) {
      return 'Daily recurrence is not supported yet. Choose an interval of 2 days or more, '
           + 'or use weeks or months.';
    }
    return null;
  }

  save(): void {
    if (this.saving || !this.orderId) return;

    const invalid = this.validationError;
    if (invalid) { this.errorMessage = invalid; return; }

    this.errorMessage = '';
    this.saving = true;

    const dto: SaveRecurringSeries = {
      recurringLoyaltyDiscountPercent: this.loyaltyPercentToSend,
      recurringLoyaltyDiscountAmount: this.loyaltyAmountToSend,
      serviceTime: this.serviceTime ? `${this.serviceTime}:00` : null,
      futureOrdersAction: this.futureOrdersAction,
      intervalValue: this.intervalValue,
      intervalUnit: this.intervalUnit,
      anchorDate: this.anchorDate || null,
      endDate: this.endDate || null,
      copyCleanerAssignments: this.copyCleanerAssignments,
      autoRequestPayment: this.autoRequestPayment,
      isActive: this.isActive,
      notes: this.notes || null
    };

    const request = this.series && !this.startingNew
      ? this.recurring.update(this.series.id, dto)
      : this.recurring.createFromOrder(this.orderId, dto);

    request
      .pipe(finalize(() => { this.saving = false; }))
      .subscribe({
        next: (series) => {
          this.series = series;
          this.seedFormFrom(series);
          this.editing = false;
          this.startingNew = false;
          this.noticeMessage = ['Schedule saved.', ...(series.generationWarnings || [])].join(' ');
          this.errorMessage = series.generationWarnings?.join(' ') || '';
          this.ordersGenerated.emit(series.occurrences.map(o => o.orderId));
        },
        error: (err) => {
          this.errorMessage = extractApiErrorMessage(err, 'Could not save the recurring schedule.');
        }
      });
  }

  generateNow(): void {
    if (this.generating || !this.series) return;

    this.generating = true;
    this.errorMessage = '';
    this.noticeMessage = '';

    this.recurring.generate(this.series.id)
      .pipe(finalize(() => { this.generating = false; }))
      .subscribe({
        next: (result) => {
          // The SKIPPED count is reported, not hidden: it is how an admin can see for themselves
          // that pressing this twice does nothing rather than having to trust that it does not.
          this.noticeMessage = result.createdCount > 0
            ? `${result.createdCount} cleaning(s) created.`
            : 'Nothing to create — every cleaning in the next 30 days already exists.';

          if (result.warnings.length) {
            this.errorMessage = result.warnings.join(' ');
          }

          this.ordersGenerated.emit(result.createdOrderIds);
          this.refresh();
        },
        error: (err) => {
          this.errorMessage = extractApiErrorMessage(err, 'Could not generate the next cleanings.');
        }
      });
  }

  get needsFutureOrdersChoice(): boolean {
    const s = this.series;
    return !this.startingNew && !!s && this.futureOccurrences.some(o => o.wasGenerated && o.status !== 'Cancelled' && o.status !== 'Refunded')
      && (this.intervalValue !== s.intervalValue || this.intervalUnit !== s.intervalUnit
        || this.anchorDate !== s.anchorDate.slice(0, 10) || this.serviceTime !== s.serviceTime.slice(0, 5)
        || this.endDate !== (s.endDate || '').slice(0, 10)
        || (this.loyaltyPercentToSend ?? 0) !== (s.recurringLoyaltyDiscountPercent ?? 0)
        || (this.loyaltyAmountToSend ?? 0) !== (s.recurringLoyaltyDiscountAmount ?? 0));
  }

  confirmAction(): void {
    if (!this.series || !this.pendingAction || this.saving || !this.canUpdate) return;
    const action = this.pendingAction;
    this.saving = true;
    const request: Observable<unknown> = action.kind === 'skip'
      ? this.recurring.skip(this.series.id, action.orderId!)
      : this.recurring.setState(this.series.id, action.kind);
    request.pipe(finalize(() => { this.saving = false; })).subscribe({
      next: () => {
        this.pendingAction = null;
        this.noticeMessage = action.kind === 'skip' ? 'This cleaning was skipped. Later dates stay on the original schedule.' : 'Recurrence updated. Existing orders are kept.';
        this.refresh();
        this.ordersGenerated.emit([]);
      },
      error: err => { this.errorMessage = extractApiErrorMessage(err, 'Could not update the recurrence.'); }
    });
  }

  private refresh(): void {
    if (!this.series) return;
    this.recurring.get(this.series.id).subscribe({
      next: (series) => { this.series = series; this.seedFormFrom(series); },
      error: () => { /* the notice above already told them what happened */ }
    });
  }

  /** Occurrences carrying a cleaner the series assigned and nobody has notified. */
  get unnotifiedOccurrenceCount(): number {
    return (this.series?.occurrences ?? [])
      .filter(o => o.autoAssignedNotNotifiedCount > 0).length;
  }

  get futureOccurrences() {
    const today = new Date().toISOString().slice(0, 10);
    return (this.series?.occurrences ?? []).filter(o => o.serviceDate.slice(0, 10) >= today);
  }
}
