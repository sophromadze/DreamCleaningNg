import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs/operators';
import { Observable } from 'rxjs';

import {
  RecurringOrderService,
  RecurringSeries,
  RecurrenceIntervalUnit,
  SaveRecurringSeries, RecurringPricePreview,
  RecurringContractOption, MAX_UPCOMING_OCCURRENCE_TARGET
} from '../../../services/recurring-order.service';

/** Sunday-first, the order the service-day chips are shown in. Values are JS/.NET weekday numbers. */
export const WEEKDAY_CHIPS: { value: number; label: string }[] = [
  { value: 0, label: 'Sun' }, { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' }, { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' }
];

/** The count a NEW plan starts with: about two weeks of a six-visit schedule. */
export const DEFAULT_UPCOMING_OCCURRENCE_TARGET = 12;

/**
 * The first date the schedule produces strictly AFTER `source` (yyyy-MM-dd), computed with the
 * source as the anchor — the same cycle rules as the server's RecurrenceCalculator, so the
 * suggestion is a date the plan would generate anyway:
 *  - weekdays: whole weeks from the week containing the source, every `interval` weeks;
 *  - month days: calendar months from the source's month, every `interval` months; a day the
 *    month lacks is skipped;
 *  - otherwise (no days chosen, or a days interval): source + one interval, month-end clamped.
 * Null when nothing lands within a generous window. Pure — no clock, no time zone.
 */
export function nextRecurrenceDateAfter(
  source: string, unit: RecurrenceIntervalUnit, interval: number,
  daysOfWeek: number[], daysOfMonth: number[], weekStart: number
): string | null {
  const [y, m, d] = source.split('-').map(Number);
  const start = Date.UTC(y, m - 1, d);
  const DAY = 86400000;
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  const every = Math.max(1, Math.floor(interval));

  if (unit === RecurrenceIntervalUnit.Weeks && daysOfWeek.length) {
    const dow = new Date(start).getUTCDay();
    const cycleStart = start - ((dow - weekStart + 7) % 7) * DAY;
    for (let i = 1; i <= 7 * every * 2 + 7; i++) {
      const t = start + i * DAY;
      const week = Math.floor((t - cycleStart) / (7 * DAY));
      if (week % every === 0 && daysOfWeek.includes(new Date(t).getUTCDay())) return iso(t);
    }
    return null;
  }

  if (unit === RecurrenceIntervalUnit.Months && daysOfMonth.length) {
    const days = [...daysOfMonth].sort((a, b) => a - b);
    for (let k = 0; k <= 12 * every * 4; k += every) {
      const year = y + Math.floor((m - 1 + k) / 12);
      const month = (m - 1 + k) % 12;
      const length = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      for (const day of days) {
        if (day > length) continue;
        const t = Date.UTC(year, month, day);
        if (t > start) return iso(t);
      }
    }
    return null;
  }

  if (unit === RecurrenceIntervalUnit.Months) {
    const target = new Date(Date.UTC(y, m - 1 + every, 1));
    const length = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    return iso(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, length)));
  }
  return iso(start + (unit === RecurrenceIntervalUnit.Weeks ? 7 : 1) * every * DAY);
}
import { extractApiErrorMessage } from '../../../utils/http-error.utils';

@Component({
  selector: 'app-recurring-series-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './recurring-series-panel.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
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
  private recurring = inject(RecurringOrderService);

  @Input() orderId: number | null = null;

  /** Whether the signed-in admin may set a series up (Permission.Create on the backend). */
  @Input() canCreate = false;

  /** Whether they may edit or generate (Permission.Update). */
  @Input() canUpdate = false;

  /**
   * The order's own service date (yyyy-MM-dd…). Seeds the first service day of a NEW plan when
   * "First cleaning" is left blank, because blank means "this order's date".
   */
  @Input() orderServiceDate: string | Date | null = null;

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

  // ── Which days, and how many upcoming cleanings (2026-10) ──
  /** Weekly plans: the weekdays to clean on (0 = Sunday). Any combination; none is hard-coded away. */
  serviceDaysOfWeek: number[] = [];
  /** Monthly plans: the calendar days to clean on. A day a month lacks is skipped that month. */
  serviceDaysOfMonth: number[] = [];
  /** How many upcoming cleanings the plan keeps generated — a count of ORDERS, not of days. */
  upcomingOccurrenceTarget: number | null = DEFAULT_UPCOMING_OCCURRENCE_TARGET;

  readonly weekdayChips = WEEKDAY_CHIPS;
  readonly monthDayChoices = Array.from({ length: 31 }, (_, i) => i + 1);
  readonly maxUpcoming = MAX_UPCOMING_OCCURRENCE_TARGET;

  // ── Commercial contract ──
  contractOptions: RecurringContractOption[] = [];
  contractId: number | null = null;

  // ── Suggested "First recurring cleaning" (new plans only) ──
  //
  // The source order IS the first cleaning, so a new plan's first recurring cleaning is the next
  // date the schedule produces AFTER it — Sunday Oct 4 with Sun–Fri selected suggests Monday
  // Oct 5. This only pre-fills the existing date field: the server applies its ordinary rule to
  // whatever is sent, and a blank field still means "continue from the source order's date".
  // Once the admin edits the date it is theirs and is never overwritten; a saved plan's stored
  // date is never touched.

  /** True once the admin has typed or picked the first recurring cleaning themselves. */
  anchorTouched = false;

  onAnchorDateChange(): void {
    this.anchorTouched = true;
  }

  /** Re-suggest after anything the suggestion depends on changes. */
  refreshSuggestedFirstCleaning(): void {
    if (this.anchorTouched || (this.series && !this.startingNew)) return;
    const source = this.sourceServiceDate;
    if (!source) return;
    this.anchorDate = nextRecurrenceDateAfter(source, this.intervalUnit, Number(this.intervalValue) || 1,
      this.serviceDaysOfWeek, this.serviceDaysOfMonth, this.cycleWeekStart) ?? '';
  }

  /** The source order's own service date, yyyy-MM-dd. */
  private get sourceServiceDate(): string {
    const own = this.orderServiceDate;
    const text = own instanceof Date
      ? `${own.getFullYear()}-${String(own.getMonth() + 1).padStart(2, '0')}-${String(own.getDate()).padStart(2, '0')}`
      : (own || '');
    const date = text.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
  }

  /**
   * Where a weekly cycle starts, exactly as the server decides it: the linked contract's service
   * week (the first weekday its definition names, Monday when it names none), Sunday otherwise.
   */
  private get cycleWeekStart(): number {
    const contract = this.selectedContract;
    if (!contract) return 0;
    const text = (contract.weekDefinition || '').toLowerCase();
    let best = -1;
    let day = 1;
    ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].forEach((name, i) => {
      const at = text.indexOf(name);
      if (at >= 0 && (best < 0 || at < best)) { best = at; day = i; }
    });
    return day;
  }

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
    this.serviceDaysOfWeek = [...(series.serviceDaysOfWeek ?? [])];
    this.serviceDaysOfMonth = [...(series.serviceDaysOfMonth ?? [])];
    this.upcomingOccurrenceTarget = series.upcomingOccurrenceTarget ?? null;
    this.contractId = series.contract?.id ?? null;
    if (series.contract && !this.contractOptions.some(c => c.id === series.contract!.id)) {
      this.contractOptions = [series.contract, ...this.contractOptions];
    }
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
      this.serviceDaysOfWeek = [];
      this.serviceDaysOfMonth = [];
      this.upcomingOccurrenceTarget = DEFAULT_UPCOMING_OCCURRENCE_TARGET;
      this.contractId = null;
      this.anchorTouched = false;
      this.seedDaysForUnit();
      this.refreshSuggestedFirstCleaning();
    }
    this.loadContractOptions(!this.series || startNew);
    this.refreshPricePreview();
  }

  /**
   * A NEW plan starts on the first cleaning's own weekday (or day of the month), so the common
   * "repeat this one" case needs no clicks — the admin then adds the other days. An existing plan
   * saved before day selection keeps its empty list, which means its original single-date rule.
   */
  private seedDaysForUnit(): void {
    const own = this.orderServiceDate instanceof Date
      ? `${this.orderServiceDate.getFullYear()}-${String(this.orderServiceDate.getMonth() + 1).padStart(2, '0')}-${String(this.orderServiceDate.getDate()).padStart(2, '0')}`
      : this.orderServiceDate;
    const date = (own || this.anchorDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const [y, m, d] = date.split('-').map(Number);
    if (this.intervalUnit === RecurrenceIntervalUnit.Weeks && this.serviceDaysOfWeek.length === 0) {
      this.serviceDaysOfWeek = [new Date(y, m - 1, d).getDay()];
    }
    if (this.intervalUnit === RecurrenceIntervalUnit.Months && this.serviceDaysOfMonth.length === 0) {
      this.serviceDaysOfMonth = [d];
    }
  }

  onIntervalUnitChange(): void {
    if (!this.isLegacyPattern) this.seedDaysForUnit();
    this.refreshSuggestedFirstCleaning();
  }

  private loadContractOptions(preselect: boolean): void {
    const id = this.series?.templateOrderId ?? this.orderId;
    if (!id) return;
    this.recurring.contractOptions(id).subscribe({
      next: options => {
        const current = this.series?.contract;
        this.contractOptions = current && !options.contracts.some(c => c.id === current.id)
          ? [current, ...options.contracts] : options.contracts;
        if (preselect && this.contractId == null && options.suggestedContractId != null) {
          this.contractId = options.suggestedContractId;
          this.refreshSuggestedFirstCleaning();
        }
      },
      // Optional: a plan with no contract is the ordinary residential case.
      error: () => { this.contractOptions = this.series?.contract ? [this.series.contract] : []; }
    });
  }

  /** True while editing a plan saved BEFORE day selection existed, with no days chosen. */
  get isLegacyPattern(): boolean {
    const s = this.series;
    if (!s || this.startingNew || s.intervalUnit !== this.intervalUnit) return false;
    if (this.intervalUnit === RecurrenceIntervalUnit.Weeks)
      return !(s.serviceDaysOfWeek?.length) && this.serviceDaysOfWeek.length === 0;
    if (this.intervalUnit === RecurrenceIntervalUnit.Months)
      return !(s.serviceDaysOfMonth?.length) && this.serviceDaysOfMonth.length === 0;
    return false;
  }

  /** A plan saved before the count existed may keep its 30-day window until a number is chosen. */
  get allowsLegacyWindow(): boolean {
    return !!this.series && !this.startingNew && this.series.upcomingOccurrenceTarget == null;
  }

  toggleWeekday(day: number): void {
    this.serviceDaysOfWeek = this.serviceDaysOfWeek.includes(day)
      ? this.serviceDaysOfWeek.filter(d => d !== day)
      : [...this.serviceDaysOfWeek, day].sort((a, b) => a - b);
    this.refreshSuggestedFirstCleaning();
  }

  toggleMonthDay(day: number): void {
    this.serviceDaysOfMonth = this.serviceDaysOfMonth.includes(day)
      ? this.serviceDaysOfMonth.filter(d => d !== day)
      : [...this.serviceDaysOfMonth, day].sort((a, b) => a - b);
    this.refreshSuggestedFirstCleaning();
  }

  get selectedContract(): RecurringContractOption | null {
    return this.contractOptions.find(c => c.id === this.contractId) ?? null;
  }

  /**
   * A WEEKLY FLAT FEE contract bills the week, so the plan's cleanings are operational records:
   * no per-cleaning estimate is shown as if it were a charge, and no per-visit payment request
   * can be switched on. Residential plans are unaffected.
   */
  get billingControlledByContract(): boolean {
    return !!this.selectedContract?.isWeeklyFlatFee;
  }

  /** "Sun, Mon, Tue" / "1st, 15th" — how the chosen days read back. */
  describeDays(days: number[] | undefined, unit: RecurrenceIntervalUnit): string {
    if (!days?.length) return '';
    if (unit === RecurrenceIntervalUnit.Weeks) {
      return days.map(d => WEEKDAY_CHIPS.find(c => c.value === d)?.label ?? '').join(', ');
    }
    return days.map(d => d + this.ordinal(d)).join(', ');
  }

  private ordinal(day: number): string {
    if (day >= 11 && day <= 13) return 'th';
    return ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] ?? 'th';
  }

  /** The last of those, or null when there are none. */
  get lastRetainedFutureDate(): string | null {
    const retained = this.retainedFutureOccurrences;
    return retained.length ? retained[retained.length - 1].serviceDate : null;
  }

  /** Future generated cleanings an edit leaves exactly as they are under "Keep". */
  get retainedFutureOccurrences() {
    return this.futureOccurrences.filter(o => o.wasGenerated && o.status !== 'Cancelled' && o.status !== 'Refunded');
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
    if (this.intervalUnit === RecurrenceIntervalUnit.Weeks && this.serviceDaysOfWeek.length === 0 && !this.isLegacyPattern)
      return 'Choose at least one service day.';
    if (this.intervalUnit === RecurrenceIntervalUnit.Months && this.serviceDaysOfMonth.length === 0 && !this.isLegacyPattern)
      return 'Choose at least one day of the month.';
    const target = this.upcomingOccurrenceTarget as number | string | null;
    if (target == null || target === '') {
      if (!this.allowsLegacyWindow) return 'Choose how many upcoming cleanings to generate.';
    } else if (!Number.isInteger(Number(target)) || Number(target) < 1 || Number(target) > this.maxUpcoming) {
      return `Generate between 1 and ${this.maxUpcoming} upcoming cleanings (a whole number).`;
    }
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
      serviceDaysOfWeek: this.intervalUnit === RecurrenceIntervalUnit.Weeks && this.serviceDaysOfWeek.length
        ? [...this.serviceDaysOfWeek] : null,
      serviceDaysOfMonth: this.intervalUnit === RecurrenceIntervalUnit.Months && this.serviceDaysOfMonth.length
        ? [...this.serviceDaysOfMonth] : null,
      upcomingOccurrenceTarget: this.targetToSend,
      contractId: this.contractId,
      anchorDate: this.anchorDate || null,
      endDate: this.endDate || null,
      copyCleanerAssignments: this.copyCleanerAssignments,
      // Never per-visit requests under a weekly flat fee — the server enforces it too.
      autoRequestPayment: this.billingControlledByContract ? false : this.autoRequestPayment,
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
          const target = this.series?.upcomingOccurrenceTarget;
          this.noticeMessage = result.createdCount > 0
            ? `${result.createdCount} cleaning(s) created.`
            : target
              ? `Nothing to create — the plan already has its ${target} upcoming cleaning(s).`
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
        || this.daysKey(this.intervalUnit === RecurrenceIntervalUnit.Weeks ? this.serviceDaysOfWeek : [])
          !== this.daysKey(s.intervalUnit === RecurrenceIntervalUnit.Weeks ? s.serviceDaysOfWeek : [])
        || this.daysKey(this.intervalUnit === RecurrenceIntervalUnit.Months ? this.serviceDaysOfMonth : [])
          !== this.daysKey(s.intervalUnit === RecurrenceIntervalUnit.Months ? s.serviceDaysOfMonth : [])
        || (this.loyaltyPercentToSend ?? 0) !== (s.recurringLoyaltyDiscountPercent ?? 0)
        || (this.loyaltyAmountToSend ?? 0) !== (s.recurringLoyaltyDiscountAmount ?? 0));
  }

  private daysKey(days: number[] | undefined | null): string {
    return [...(days ?? [])].sort((a, b) => a - b).join(',');
  }

  /** The count as sent: a whole number, or null for a legacy plan keeping its 30-day window. */
  private get targetToSend(): number | null {
    const target = this.upcomingOccurrenceTarget as number | string | null;
    return target == null || target === '' ? null : Number(target);
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
