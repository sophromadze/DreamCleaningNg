import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { finalize } from 'rxjs/operators';

import { AdminService, ReorderPreview, ReorderDiscountChange } from '../../../services/admin.service';
import {
  BookingService,
  ExtraService,
  Service,
  ServiceType
} from '../../../services/booking.service';
import { extractApiErrorMessage } from '../../../utils/http-error.utils';
import { PAYMENT_METHOD_OPTIONS, PaymentMethodValue } from '../../payment-method';
import { DurationUtils } from '../../../utils/duration.utils';
import {
  LEVEL_OPTIONS,
  PROPERTY_TYPE_APARTMENT,
  PROPERTY_TYPE_HOUSE,
  PropertyType,
  isHouse,
  isLevelsService,
  levelsToSubmit,
  normalizePropertyType,
  serviceTypeCollectsPropertyType
} from '../../booking/property-type.utils';
import {
  EXTRA_CLEANERS_NAME,
  QuoteInput,
  buildQuoteInputFromSelections,
  calculateQuote,
  calculateTotals,
  clampRestoredSquareFeet,
  getSquareFeetForBedrooms,
  getSquareFeetOptions,
  rescaleDiscountToSubTotal,
  resolveLoyaltyStacking,
  resolveSquareFeetForBedroomChange,
  round2
} from '../../pricing/order-pricing.calculator';

interface SelectedService {
  service: Service;
  quantity: number;
}

/** Structurally identical to the booking page's selectedExtraServices entries. */
interface SelectedExtra {
  extraService: ExtraService;
  quantity: number;
  hours: number;
}

type Step = 'loading' | 'changes' | 'form' | 'error';

/**
 * Deep / Super Deep are a cleaning TYPE, not an extra — see the booking page's
 * getFilteredExtraServices. They are chosen here with their own buttons and never appear in the
 * extras list, exactly as on /booking.
 */
type CleaningType = 'normal' | 'deep' | 'superdeep';

/**
 * Admin "recreate this order" modal — used from the Users tab's Cleaning History.
 *
 * Two steps, deliberately in this order:
 *
 *  1. WHAT WILL BE DIFFERENT. Catalogue prices move, promo codes expire, gift cards get spent,
 *     the first-time flag is used up. An admin recreating a job needs to be able to explain the
 *     new number to the customer BEFORE they commit to it, not discover it afterwards on the
 *     orders panel. The whole diff is computed server-side (api/admin/orders/{id}/reorder-preview)
 *     by re-pricing the same lines through the shared calculator, so the "today" column is
 *     produced by the same code that will charge it. Sections with nothing in them are not
 *     rendered at all; a job whose price has not moved says so in one line.
 *
 *  2. A MINI BOOKING FORM, prefilled with the original order. Everything is editable, and the
 *     date accepts ANY value including past months — re-entering cash jobs that were missed at
 *     the time is the main reason this exists.
 *
 * Two rules that must hold:
 *
 *  - NO DISCOUNT IS CARRIED OVER. The prefill arrives with every discount slot already empty
 *     (the server clears them), and the customer's live loyalty / recurring-plan discounts are
 *     suppressed unless the admin explicitly ticks them back on. Loyalty in particular is not
 *     just a price: applying it CONSUMES the customer's entitlement.
 *  - NOTIFICATIONS ARE OPT-IN HERE. A normal admin booking emails and texts the customer
 *     immediately; recreating a job that already happened must not. Both toggles start OFF and
 *     are passed explicitly, so nothing is sent unless the admin asks for it.
 */
@Component({
  selector: 'app-recreate-order-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './recreate-order-modal.component.html',
  styleUrls: ['./recreate-order-modal.component.scss']
})
export class RecreateOrderModalComponent implements OnChanges {
  /** The order to recreate. Loading starts when this and `open` are both set. */
  @Input() sourceOrderId: number | null = null;
  @Input() open = false;

  @Output() closed = new EventEmitter<void>();
  /** Emitted after the new order is created, so the host can refresh its list. */
  @Output() created = new EventEmitter<{ orderId: number; total: number }>();

  step: Step = 'loading';
  errorMessage = '';
  submitting = false;

  preview: ReorderPreview | null = null;
  serviceType: ServiceType | null = null;

  selectedServices: SelectedService[] = [];
  selectedExtraServices: SelectedExtra[] = [];
  propertyType: PropertyType | null = null;
  levelsQuantity: number | null = null;

  /** Custom ("Pre-Arranged") pricing fields — only shown when the source type is custom. */
  customAmount = 0;
  customCleaners = 1;
  customDuration = 0;

  /**
   * INFORMATIONAL bed/bath, for a service type that prices neither — a custom ("Pre-Arranged")
   * job, or a cleaner+hours type. They cost nothing and add no time; they are how the cleaner,
   * the admin list and the Excel export know what kind of place they are going to.
   *
   * Same fields the booking page collects in custom mode, and the same defaults (Studio, one
   * bathroom). Without them a recreated pre-arranged order posted null for both — its own
   * OrderServices are empty, which is exactly where the payload used to read them from — and the
   * crew got a job sheet with no property details on it at all.
   */
  informationalBedrooms = 0;
  informationalBathrooms = 1;

  // ─── The form ───────────────────────────────────────────────────────────────────────────
  serviceDate = '';           // yyyy-MM-dd; deliberately starts EMPTY (see resetForm)
  serviceTime = '';
  entryMethod = '';
  specialInstructions = '';
  contactFirstName = '';
  contactLastName = '';
  contactEmail = '';
  contactPhone = '';
  serviceAddress = '';
  aptSuite = '';
  city = '';
  state = '';
  zipCode = '';
  tips = 0;

  paymentMethod: PaymentMethodValue = 'Cash';
  paymentReference = '';
  paymentNotes = '';
  orderStatus: 'Pending' | 'Active' | 'Done' = 'Done';
  /** True once the admin has touched the status picker — stops the date/method default from
   *  overwriting a deliberate choice on every later keystroke. */
  private statusTouched = false;

  notifyByEmail = false;
  notifyBySms = false;
  applyCurrentDiscounts = false;

  // ─── Live quote ─────────────────────────────────────────────────────────────────────────
  quoteSubTotal = 0;
  quoteTax = 0;
  quoteTotal = 0;
  /** Per-cleaner minutes — what the label shows. */
  quoteDisplayDuration = 0;
  /** TOTAL cleaner-minutes — what Order.TotalDuration stores, so what gets submitted. */
  quoteTotalDuration = 0;
  quoteMaids = 1;
  appliedLoyalty = 0;
  appliedSubscription = 0;

  readonly paymentMethods = PAYMENT_METHOD_OPTIONS;
  readonly levelOptions: readonly number[] = LEVEL_OPTIONS;
  // Annotated rather than inferred so strict template checking sees the union the click handler
  // expects, not a widened `string`.
  readonly apartmentType: PropertyType = PROPERTY_TYPE_APARTMENT;
  readonly houseType: PropertyType = PROPERTY_TYPE_HOUSE;

  constructor(
    private adminService: AdminService,
    private bookingService: BookingService
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if ((changes['open'] || changes['sourceOrderId']) && this.open && this.sourceOrderId) {
      this.load(this.sourceOrderId);
    }
  }

  // ═══ Loading ════════════════════════════════════════════════════════════════════════════

  private load(orderId: number): void {
    this.step = 'loading';
    this.errorMessage = '';
    this.preview = null;

    // The catalogue is needed to render the steppers and the extras grid; the preview supplies
    // the prefill and the diff. One forkJoin so the form can never paint half-built.
    forkJoin({
      serviceTypes: this.bookingService.getServiceTypes(),
      preview: this.adminService.getReorderPreview(orderId)
    }).subscribe({
      next: ({ serviceTypes, preview }) => {
        const type = serviceTypes.find(st => st.id === preview.prefill.serviceTypeId) ?? null;
        if (!type) {
          this.step = 'error';
          this.errorMessage =
            'The service type this order was booked on is no longer available, so it cannot be recreated.';
          return;
        }
        this.applyPreview(preview, type);
        this.step = 'changes';
      },
      error: (err) => {
        this.step = 'error';
        this.errorMessage = extractApiErrorMessage(err, 'Failed to load this order for recreation.');
      }
    });
  }

  private applyPreview(preview: ReorderPreview, type: ServiceType): void {
    this.preview = preview;
    this.serviceType = type;
    const p = preview.prefill;

    // Services: only lines the server kept (it already dropped anything deactivated or deleted,
    // and listed each one under `unavailable` for the diff screen).
    this.selectedServices = (p.services || [])
      .map((line: { serviceId: number; quantity: number }) => {
        const service = type.services.find(s => s.id === line.serviceId);
        return service ? { service, quantity: line.quantity } : null;
      })
      .filter((s: SelectedService | null): s is SelectedService => s !== null);

    // Same rule as the booking page's restore path: the stored Sq.ft is an explicit choice, so it
    // is floored to the current allowance and NEVER lowered — and clamped ONCE, after the whole
    // loop, because the lines arrive in database order.
    this.clampSquareFeetToBedroomMinimum();

    this.selectedExtraServices = (p.extraServices || [])
      .map((line: { extraServiceId: number; quantity: number; hours: number }) => {
        const extraService = type.extraServices.find(es => es.id === line.extraServiceId);
        return extraService
          ? {
              extraService,
              quantity: line.quantity || 1,
              hours: line.hours || (extraService.hasHours ? 0.5 : 0)
            }
          : null;
      })
      .filter((s: SelectedExtra | null): s is SelectedExtra => s !== null);

    this.propertyType = normalizePropertyType(p.propertyType);
    this.levelsQuantity = this.resolveInitialLevels(p.levelsQuantity);

    this.customAmount = Number(p.customAmount) || 0;
    this.customCleaners = Number(p.customCleaners) || 1;
    this.customDuration = Number(p.customDuration) || 0;

    // The source order's own display columns. Null is a real answer here — every pre-arranged
    // order booked before this was fixed carries it — so it falls back to the booking page's
    // defaults rather than staying blank, and the admin sees the steppers and can correct them.
    this.informationalBedrooms = p.bedroomsQuantity == null ? 0 : Number(p.bedroomsQuantity);
    this.informationalBathrooms = p.bathroomsQuantity == null ? 1 : Number(p.bathroomsQuantity);

    this.resetForm(p);
    this.recalculate();
  }

  /** Levels come from the priced line when there is one, and from the display column otherwise. */
  private resolveInitialLevels(fallback: number | null | undefined): number | null {
    const levelsLine = this.selectedServices.find(s => isLevelsService(s.service));
    if (levelsLine) return levelsLine.quantity;
    return fallback == null ? null : Number(fallback);
  }

  private resetForm(p: any): void {
    // The DATE STARTS EMPTY on purpose. Prefilling the original service date would make it one
    // Enter away from creating a duplicate of the order the admin is looking at; the original is
    // offered as a one-click fill instead, right next to the field.
    this.serviceDate = '';
    this.serviceTime = (p.serviceTime || '').slice(0, 5);
    this.entryMethod = p.entryMethod || '';
    this.specialInstructions = p.specialInstructions || '';
    this.contactFirstName = p.contactFirstName || '';
    this.contactLastName = p.contactLastName || '';
    this.contactEmail = p.contactEmail || '';
    this.contactPhone = p.contactPhone || '';
    this.serviceAddress = p.serviceAddress || '';
    this.aptSuite = p.aptSuite || '';
    this.city = p.city || '';
    this.state = p.state || '';
    this.zipCode = p.zipCode || '';
    this.tips = Number(p.tips) || 0;

    this.paymentMethod = 'Cash';
    this.paymentReference = '';
    this.paymentNotes = '';
    this.orderStatus = 'Done';
    this.statusTouched = false;

    // Both OFF: recreating a job must never text a customer about it unless asked. A channel with
    // no destination stays off and is disabled in the template.
    this.notifyByEmail = false;
    this.notifyBySms = false;
    this.applyCurrentDiscounts = false;
    this.submitting = false;
    this.errorMessage = '';
  }

  // ═══ Diff screen ════════════════════════════════════════════════════════════════════════

  get hasLineChanges(): boolean { return (this.preview?.lineChanges.length ?? 0) > 0; }
  get hasUnavailable(): boolean { return (this.preview?.unavailable.length ?? 0) > 0; }
  get hasDiscountChanges(): boolean { return (this.preview?.discounts.length ?? 0) > 0; }

  /** The bottom line only earns a section when it actually moved. */
  get hasTotalChange(): boolean {
    if (!this.preview) return false;
    return round2(this.preview.original.total) !== round2(this.preview.recreated.total);
  }

  get totalDelta(): number {
    if (!this.preview) return 0;
    return round2(this.preview.recreated.total - this.preview.original.total);
  }

  /** Discounts the admin can put back — the only two the customer may still be entitled to. */
  get reapplicableDiscounts(): ReorderDiscountChange[] {
    return (this.preview?.discounts ?? []).filter(d => d.canReapply);
  }

  get reapplicableTotal(): number {
    return round2(this.reapplicableDiscounts.reduce((sum, d) => sum + d.availableAmount, 0));
  }

  continueToForm(): void {
    this.step = 'form';
  }

  backToChanges(): void {
    this.step = 'changes';
  }

  // ═══ Services ═══════════════════════════════════════════════════════════════════════════

  /** Levels is excluded here because it has its own chips block, exactly like the booking page. */
  get stepperServices(): SelectedService[] {
    return this.selectedServices.filter(s => !isLevelsService(s.service));
  }

  /**
   * Whether to offer the informational bed/bath steppers: only when NEITHER is priced on this
   * order, which is the custom ("Pre-Arranged") case and the cleaner+hours one. Mirrors
   * shouldShowStandaloneBedroomBathroom on the booking page — gated on the LINES rather than on
   * the type's name, so an order that does carry a priced bedrooms row can never end up with two
   * controls for one number.
   */
  showInformationalBedBath(): boolean {
    if (!this.serviceType) return false;
    return !this.selectedServices.some(
      s => s.service.serviceKey === 'bedrooms' || s.service.serviceKey === 'bathrooms');
  }

  /** Studio at zero, same wording the booking page and the admin panel use. */
  get informationalBedroomsLabel(): string {
    return this.informationalBedrooms === 0 ? 'Studio' : String(this.informationalBedrooms);
  }

  changeInformationalBedrooms(delta: number): void {
    // A house has no studio — the same floor the priced bedrooms row gets from getServiceMinValue.
    const min = isHouse(this.propertyType) ? 1 : 0;
    this.informationalBedrooms = Math.min(Math.max(this.informationalBedrooms + delta, min), 10);
  }

  changeInformationalBathrooms(delta: number): void {
    this.informationalBathrooms = Math.min(Math.max(this.informationalBathrooms + delta, 0), 10);
  }

  getServiceMinValue(service: Service): number {
    const baseMin = service.minValue || 0;
    // A house has no studio — raising the floor here greys out the minus button at one bedroom
    // rather than adding a second rule to the template.
    if (service.serviceKey === 'bedrooms' && isHouse(this.propertyType)) {
      return Math.max(baseMin, 1);
    }
    return baseMin;
  }

  incrementService(service: Service): void {
    const selected = this.selectedServices.find(s => s.service.id === service.id);
    if (!selected) return;
    const step = service.stepValue || 1;
    this.updateServiceQuantity(service, Math.min(selected.quantity + step, service.maxValue || 10));
  }

  decrementService(service: Service): void {
    const selected = this.selectedServices.find(s => s.service.id === service.id);
    if (!selected) return;
    const step = service.stepValue || 1;
    this.updateServiceQuantity(service, Math.max(selected.quantity - step, this.getServiceMinValue(service)));
  }

  updateServiceQuantity(service: Service, quantity: number): void {
    const selected = this.selectedServices.find(s => s.service.id === service.id);
    if (!selected) return;

    // Captured BEFORE the write: the bedrooms→sqft rule needs the OUTGOING bedroom count to tell
    // an inherited sq.ft from one the customer chose.
    const previousQuantity = selected.quantity;
    selected.quantity = quantity;

    if (service.serviceKey === 'bedrooms') {
      const sqft = this.selectedServices.find(s => s.service.serviceKey === 'sqft');
      if (sqft) {
        sqft.quantity = resolveSquareFeetForBedroomChange(
          sqft.quantity,
          this.squareFeetForBedrooms(previousQuantity),
          this.squareFeetForBedrooms(quantity)
        );
      }
    }

    if (service.serviceKey === 'sqft') {
      const min = this.squareFeetMinimum();
      if (quantity < min) selected.quantity = min;
    }

    this.sqftOptionsCache = null;
    this.recalculate();
  }

  // ─── Sq.ft slider (index-based, same reason as the booking page) ─────────────────────────
  private sqftOptionsCache: { key: string; options: number[] } | null = null;

  private squareFeetForBedrooms(bedrooms: number): number {
    const sqft = this.selectedServices.find(s => s.service.serviceKey === 'sqft');
    const bedroomsService = this.selectedServices.find(s => s.service.serviceKey === 'bedrooms');
    return getSquareFeetForBedrooms(bedrooms, sqft?.service?.thresholds, bedroomsService?.service?.id);
  }

  private squareFeetMinimum(): number {
    const bedroomsService = this.selectedServices.find(s => s.service.serviceKey === 'bedrooms');
    return bedroomsService ? this.squareFeetForBedrooms(bedroomsService.quantity) : 400;
  }

  private clampSquareFeetToBedroomMinimum(): void {
    const sqft = this.selectedServices.find(s => s.service.serviceKey === 'sqft');
    if (!sqft) return;
    sqft.quantity = clampRestoredSquareFeet(sqft.quantity, this.squareFeetMinimum());
  }

  private squareFeetOptionsFor(service: Service): number[] {
    const min = this.squareFeetMinimum();
    const max = service.maxValue || 5000;
    const step = service.stepValue || 100;
    const key = `${min}|${max}|${step}`;
    if (this.sqftOptionsCache?.key !== key) {
      this.sqftOptionsCache = { key, options: getSquareFeetOptions(min, max, step) };
    }
    return this.sqftOptionsCache.options;
  }

  squareFeetSliderMaxIndex(service: Service): number {
    return this.squareFeetOptionsFor(service).length - 1;
  }

  /** Nearest allowed value — a saved order can legitimately sit off the grid. */
  squareFeetSliderIndex(service: Service, quantity: number): number {
    const options = this.squareFeetOptionsFor(service);
    const q = Number(quantity) || 0;
    let best = 0;
    for (let i = 1; i < options.length; i++) {
      if (Math.abs(options[i] - q) < Math.abs(options[best] - q)) best = i;
    }
    return best;
  }

  onSquareFeetSliderChange(service: Service, rawIndex: string | number): void {
    const options = this.squareFeetOptionsFor(service);
    const i = Math.max(0, Math.min(options.length - 1, Number(rawIndex) || 0));
    this.updateServiceQuantity(service, options[i]);
  }

  // ═══ Property type + levels ═════════════════════════════════════════════════════════════

  showPropertyTypeSelector(): boolean {
    return serviceTypeCollectsPropertyType(this.serviceType);
  }

  /** Levels are never priced on a custom type — same rule as the booking page. */
  showLevelsSelector(): boolean {
    return this.showPropertyTypeSelector()
      && isHouse(this.propertyType)
      && !this.serviceType?.isCustom;
  }

  selectPropertyType(type: PropertyType): void {
    if (this.propertyType === type) return;
    this.propertyType = type;

    if (!isHouse(type)) {
      // An apartment can never carry a stair charge. Forcing the line to the included count
      // rather than deleting it keeps the submitted selection an honest image of the answer and
      // matches what the server clamps to anyway.
      this.levelsQuantity = null;
      this.setLevelsLineQuantity(1);
    } else {
      // A house has no studio — raise bedrooms to at least one before anything is priced. The
      // informational count follows the same rule; it is priced by nothing, so it just moves.
      if (this.informationalBedrooms < 1) this.informationalBedrooms = 1;
      const bedrooms = this.selectedServices.find(s => s.service.serviceKey === 'bedrooms');
      if (bedrooms && bedrooms.quantity < 1) {
        this.updateServiceQuantity(bedrooms.service, 1);
        return; // updateServiceQuantity already recalculated
      }
      if (this.levelsQuantity != null) this.setLevelsLineQuantity(this.levelsQuantity);
    }
    this.recalculate();
  }

  selectLevels(levels: number): void {
    this.levelsQuantity = levels;
    this.setLevelsLineQuantity(levels);
    this.recalculate();
  }

  /**
   * Writes the level count onto the priced line, adding it when the source order predates the
   * levels feature. The line is the pricing source of truth; Order.LevelsQuantity is only a
   * display column the server derives from it.
   */
  private setLevelsLineQuantity(levels: number): void {
    const existing = this.selectedServices.find(s => isLevelsService(s.service));
    if (existing) {
      existing.quantity = levels;
      return;
    }
    const catalogueLine = this.serviceType?.services?.find(s => isLevelsService(s) && s.isActive);
    if (catalogueLine) {
      this.selectedServices.push({ service: catalogueLine, quantity: levels });
    }
  }

  // ═══ Cleaning type (Deep / Super Deep) ══════════════════════════════════════════════════
  //
  // Deep and Super Deep are the cleaning TYPE, never an extras card — the same rule the booking
  // page applies in getFilteredExtraServices. They still live in `selectedExtraServices`, because
  // that is what carries the price multiplier into the calculator; they are simply chosen with
  // their own buttons and filtered out of the extras list below.

  /** The type's active Deep / Super Deep row, or null. Null for a custom ("Pre-Arranged") type:
   *  it is served the WHOLE catalogue, so it "has" a deep row it must never be able to select —
   *  the same reason booking's getActiveDeepCleaningExtraService returns null in custom mode. */
  private findCleaningTypeExtra(match: (e: ExtraService) => boolean): ExtraService | null {
    if (!this.serviceType || this.serviceType.isCustom) return null;
    return this.serviceType.extraServices.find(e => match(e) && e.isActive !== false) ?? null;
  }

  get deepCleaningExtra(): ExtraService | null {
    return this.findCleaningTypeExtra(e => e.isDeepCleaning);
  }

  get superDeepCleaningExtra(): ExtraService | null {
    return this.findCleaningTypeExtra(e => e.isSuperDeepCleaning);
  }

  /**
   * Gated on the row EXISTING, not on the service type's name.
   *
   * The booking page additionally requires "Residential Cleaning", which means a non-residential
   * type that happens to own a deep row offers no way to pick it. That is survivable for a new
   * booking and not survivable here: an order already booked with that extra would show buttons
   * that cannot represent it, and the admin could neither see nor remove the line.
   */
  get showCleaningTypeSelector(): boolean {
    return !!this.deepCleaningExtra || !!this.superDeepCleaningExtra;
  }

  get cleaningTypeOptions(): { value: CleaningType; label: string }[] {
    const options: { value: CleaningType; label: string }[] = [
      { value: 'normal', label: 'Regular Cleaning' }
    ];
    if (this.deepCleaningExtra) options.push({ value: 'deep', label: this.deepCleaningExtra.name });
    if (this.superDeepCleaningExtra) {
      options.push({ value: 'superdeep', label: this.superDeepCleaningExtra.name });
    }
    return options;
  }

  /** Derived from the selection, never stored separately — one source of truth for the price. */
  get cleaningType(): CleaningType {
    if (this.selectedExtraServices.some(s => s.extraService.isSuperDeepCleaning)) return 'superdeep';
    if (this.selectedExtraServices.some(s => s.extraService.isDeepCleaning)) return 'deep';
    return 'normal';
  }

  selectCleaningType(type: CleaningType): void {
    // Mutually exclusive: two multipliers must never stack.
    this.selectedExtraServices = this.selectedExtraServices.filter(
      s => !s.extraService.isDeepCleaning && !s.extraService.isSuperDeepCleaning);

    const extra = type === 'deep' ? this.deepCleaningExtra
                : type === 'superdeep' ? this.superDeepCleaningExtra
                : null;
    if (extra) {
      this.selectedExtraServices.push({
        extraService: extra,
        quantity: 1,
        hours: extra.hasHours ? 0.5 : 0
      });
    }
    this.recalculate();
  }

  // ═══ Extras ═════════════════════════════════════════════════════════════════════════════

  /**
   * The extras offered as ordinary add-ons.
   *
   * Deep / Super Deep are always excluded — they are the cleaning type above. "Extra Cleaners" is
   * deliberately NOT excluded the way the customer booking page excludes it: this is an admin
   * surface reproducing a real order, and hiding a line the order was priced with would silently
   * change the total. A custom ("Pre-Arranged") type follows the booking page's rule instead,
   * because its extras carry no price at all.
   */
  get selectableExtras(): ExtraService[] {
    const all = (this.serviceType?.extraServices ?? [])
      .filter(es => !es.isDeepCleaning && !es.isSuperDeepCleaning);
    if (!this.serviceType?.isCustom) return all;
    return all.filter(es => !es.isSameDayService && es.name !== EXTRA_CLEANERS_NAME);
  }

  isExtraSelected(extra: ExtraService): boolean {
    return this.selectedExtraServices.some(s => s.extraService.id === extra.id);
  }

  extraQuantity(extra: ExtraService): number {
    return this.selectedExtraServices.find(s => s.extraService.id === extra.id)?.quantity ?? 1;
  }

  extraHours(extra: ExtraService): number {
    return this.selectedExtraServices.find(s => s.extraService.id === extra.id)?.hours ?? 0.5;
  }

  toggleExtra(extra: ExtraService): void {
    const index = this.selectedExtraServices.findIndex(s => s.extraService.id === extra.id);
    if (index >= 0) {
      this.selectedExtraServices.splice(index, 1);
    } else {
      this.selectedExtraServices.push({
        extraService: extra,
        quantity: 1,
        hours: extra.hasHours ? 0.5 : 0
      });
    }
    this.selectedExtraServices = [...this.selectedExtraServices];
    this.recalculate();
  }

  changeExtraQuantity(extra: ExtraService, delta: number): void {
    const selection = this.selectedExtraServices.find(s => s.extraService.id === extra.id);
    if (!selection) return;
    selection.quantity = Math.max(1, selection.quantity + delta);
    this.recalculate();
  }

  /** Hours are bought in 30-minute steps with a half-hour floor, same as the booking page. */
  changeExtraHours(extra: ExtraService, delta: number): void {
    const selection = this.selectedExtraServices.find(s => s.extraService.id === extra.id);
    if (!selection) return;
    selection.hours = Math.max(0.5, selection.hours + delta);
    this.recalculate();
  }

  // ═══ Live quote ═════════════════════════════════════════════════════════════════════════

  private buildQuoteInput(): QuoteInput {
    // Gated on the MODE, never on the amount being filled in: a custom order with the Total
    // Amount cleared is $0 until one is typed, and must not fall through to catalogue pricing
    // and charge the informational extras as a real line.
    if (this.serviceType?.isCustom) {
      return {
        basePrice: this.serviceType.basePrice ?? 0,
        baseDuration: this.serviceType.timeDuration ?? 0,
        minimumPrice: this.serviceType.minimumPrice ?? 0,
        services: [],
        extraServices: buildQuoteInputFromSelections(
          this.serviceType, [], this.selectedExtraServices).extraServices,
        isCustomPricing: true,
        customAmount: this.customAmount || 0,
        customCleaners: Math.max(1, this.customCleaners || 1),
        customDuration: this.customDuration || 0
      };
    }
    return buildQuoteInputFromSelections(
      this.serviceType, this.selectedServices, this.selectedExtraServices);
  }

  recalculate(): void {
    const quote = calculateQuote(this.buildQuoteInput());

    // The two live discounts, re-scaled to the quote the admin is actually looking at: the server
    // computed them against the untouched prefill, and changing a quantity moves the base. The
    // server re-derives both from scratch on save — this is the preview, not the authority.
    let loyalty = 0;
    let loyaltyPct = 0;
    let subscription = 0;
    if (this.applyCurrentDiscounts && this.preview) {
      const base = this.preview.recreated.subTotal;
      const loyaltySlot = this.preview.discounts.find(d => d.kind === 'Loyalty' && d.canReapply);
      const subscriptionSlot = this.preview.discounts.find(d => d.kind === 'Subscription' && d.canReapply);
      if (loyaltySlot) {
        loyalty = rescaleDiscountToSubTotal(loyaltySlot.availableAmount, base, quote.subTotal);
        // Any positive percentage keeps the stacking gate live; the real figure is the server's.
        loyaltyPct = loyalty > 0 ? 1 : 0;
      }
      if (subscriptionSlot) {
        subscription = rescaleDiscountToSubTotal(subscriptionSlot.availableAmount, base, quote.subTotal);
      }
      // Same stacking gate the backend runs — loyalty and the plan discount never both apply.
      const stacked = resolveLoyaltyStacking(loyalty, loyaltyPct, subscription, 0);
      loyalty = stacked.loyaltyAmount;
      subscription = stacked.subscriptionAmount;
    }

    const totals = calculateTotals({
      subTotal: quote.subTotal,
      taxOverride: quote.taxOverride,
      loyaltyDiscountAmount: loyalty,
      subscriptionDiscountAmount: subscription,
      tips: Number(this.tips) || 0
    });

    this.quoteSubTotal = quote.subTotal;
    this.quoteTax = totals.tax;
    this.quoteTotal = totals.total;
    this.quoteDisplayDuration = quote.displayDuration;
    this.quoteTotalDuration = quote.totalDuration;
    this.quoteMaids = quote.maidsCount;
    this.appliedLoyalty = loyalty;
    this.appliedSubscription = subscription;
  }

  /**
   * Nearest-increment rounding, the same mode the booking page and the chat agent use. A quoted
   * duration must read identically on every customer-facing surface.
   */
  get formattedDuration(): string {
    return DurationUtils.formatDurationRounded(this.quoteDisplayDuration);
  }

  // ═══ Form behaviour ═════════════════════════════════════════════════════════════════════

  useOriginalDate(): void {
    if (!this.preview) return;
    this.serviceDate = this.preview.originalServiceDate.slice(0, 10);
    this.onScheduleChange();
  }

  /** True when the chosen date is before today — the banner and the status default hang on it. */
  get isBackDated(): boolean {
    if (!this.serviceDate) return false;
    return this.serviceDate < this.todayIso();
  }

  private todayIso(): string {
    const now = new Date();
    const month = `${now.getMonth() + 1}`.padStart(2, '0');
    const day = `${now.getDate()}`.padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
  }

  /**
   * Keeps the status suggestion in step with the date and the payment method until the admin
   * makes their own choice. A back-dated manual-payment job has already happened, so it starts
   * at Done; a future one starts Active; Stripe starts Pending because nothing is paid yet.
   */
  onScheduleChange(): void {
    if (this.statusTouched) return;
    if (this.paymentMethod === 'Normal') {
      this.orderStatus = 'Pending';
    } else {
      this.orderStatus = this.isBackDated ? 'Done' : 'Active';
    }
  }

  onStatusChange(): void {
    this.statusTouched = true;
  }

  onTipsChange(): void {
    this.recalculate();
  }

  onDiscountToggleChange(): void {
    this.recalculate();
  }

  get canNotifyByEmail(): boolean {
    return !!this.preview?.notificationEmail;
  }

  get canNotifyBySms(): boolean {
    return !!this.preview?.notificationPhone;
  }

  // ═══ Submit ═════════════════════════════════════════════════════════════════════════════

  get validationError(): string | null {
    if (!this.serviceDate) return 'Choose a service date.';
    if (!this.serviceTime) return 'Choose a service time.';
    if (!this.entryMethod.trim()) return 'Entry method is required.';
    if (!this.contactFirstName.trim() || !this.contactLastName.trim()) return 'Contact name is required.';
    if (!this.contactPhone.trim()) return 'Contact phone is required.';
    if (!this.serviceAddress.trim()) return 'Service address is required.';
    if (!this.city.trim() || !this.state.trim() || !this.zipCode.trim()) return 'City, state and ZIP are required.';
    if (this.showPropertyTypeSelector() && !this.propertyType) return 'Choose the property type.';
    if (this.showLevelsSelector() && this.levelsQuantity == null) return 'Choose how many levels need cleaning.';
    if (this.serviceType?.isCustom && !(this.customAmount > 0)) return 'Enter the total amount for this pre-arranged job.';
    return null;
  }

  submit(): void {
    if (this.submitting) return;
    const invalid = this.validationError;
    if (invalid) {
      this.errorMessage = invalid;
      return;
    }
    if (!this.preview || !this.serviceType) return;

    this.errorMessage = '';
    this.submitting = true;

    const bookingData = this.buildBookingData();
    const manual = this.paymentMethod !== 'Normal';

    this.bookingService.createBookingForUser(
      this.preview.customerUserId,
      bookingData,
      this.paymentMethod,
      manual ? (this.paymentReference || null) : null,
      manual ? (this.paymentNotes || null) : null,
      {
        // Always EXPLICIT, never omitted: an omitted flag means "send", which is precisely the
        // behaviour this flow exists to opt out of.
        sendCustomerEmail: this.notifyByEmail && this.canNotifyByEmail,
        sendCustomerSms: this.notifyBySms && this.canNotifyBySms,
        applyCurrentDiscounts: this.applyCurrentDiscounts,
        initialStatus: this.orderStatus,
        recreatedFromOrderId: this.preview.sourceOrderId
      }
    )
      .pipe(finalize(() => { this.submitting = false; }))
      .subscribe({
        next: (response) => {
          this.created.emit({ orderId: response.orderId, total: response.total });
          this.close();
        },
        error: (err) => {
          this.errorMessage = extractApiErrorMessage(err, 'Failed to recreate this order.');
        }
      });
  }

  private buildBookingData(): any {
    const prefill = this.preview!.prefill;

    // Levels rides as an ordinary priced line, exactly like bedrooms; levelsQuantity is only the
    // informational fallback for a type that does not price levels.
    const services = this.selectedServices.map(s => ({
      serviceId: s.service.id,
      quantity: isLevelsService(s.service)
        ? levelsToSubmit(this.propertyType, this.levelsQuantity)
        : s.quantity
    }));

    return {
      serviceTypeId: this.serviceType!.id,
      customServiceDisplayName: this.serviceType!.isCustom
        ? (prefill.customServiceDisplayName || null)
        : undefined,
      services,
      extraServices: this.selectedExtraServices.map(s => ({
        extraServiceId: s.extraService.id,
        quantity: s.quantity,
        hours: s.hours
      })),
      // The plan the original job was on, so the recreated order still counts as recurring in the
      // CRM. Its DISCOUNT is a separate decision, carried by applyCurrentDiscounts.
      subscriptionId: prefill.subscriptionId || 0,
      serviceDate: this.serviceDate,
      serviceTime: this.serviceTime,
      entryMethod: this.entryMethod.trim(),
      specialInstructions: this.specialInstructions || null,
      contactFirstName: this.contactFirstName.trim(),
      contactLastName: this.contactLastName.trim(),
      // null, never '' — the backend's [EmailAddress] accepts null but rejects an empty string,
      // which is how a no-email cash customer gets booked at all.
      contactEmail: this.contactEmail.trim() ? this.contactEmail.trim() : null,
      contactPhone: this.contactPhone.trim(),
      serviceAddress: this.serviceAddress.trim(),
      aptSuite: this.aptSuite || null,
      city: this.city.trim(),
      state: this.state.trim(),
      zipCode: this.zipCode.trim(),
      apartmentId: prefill.apartmentId ?? null,
      apartmentName: prefill.apartmentName || null,

      // Every discount slot stays empty. The server clears them again on its side, so this is
      // belt-and-braces rather than the only guard.
      promoCode: null,
      giftCardCode: null,
      giftCardAmountToUse: 0,
      userSpecialOfferId: undefined,
      specialOfferId: undefined,
      pointsToRedeem: 0,
      useCredits: false,
      creditsToApply: 0,
      discountAmount: 0,
      subscriptionDiscountAmount: 0,
      loyaltyDiscountAmount: 0,

      tips: Number(this.tips) || 0,
      maidsCount: this.quoteMaids,
      totalDuration: this.quoteTotalDuration,
      subTotal: this.quoteSubTotal,
      tax: this.quoteTax,
      total: this.quoteTotal,

      isCustomPricing: !!this.serviceType!.isCustom,
      customAmount: this.serviceType!.isCustom ? this.customAmount : undefined,
      customCleaners: this.serviceType!.isCustom ? this.customCleaners : undefined,
      customDuration: this.serviceType!.isCustom ? this.customDuration : undefined,

      // A PRICED line always wins — it is what the customer is charged from. When the type
      // prices neither (custom / cleaner+hours) the informational steppers are the only record,
      // exactly as they are on the booking page.
      bedroomsQuantity: this.selectedServices.find(s => s.service.serviceKey === 'bedrooms')?.quantity
        ?? (this.showInformationalBedBath() ? this.informationalBedrooms : null),
      bathroomsQuantity: this.selectedServices.find(s => s.service.serviceKey === 'bathrooms')?.quantity
        ?? (this.showInformationalBedBath() ? this.informationalBathrooms : null),
      propertyType: this.propertyType ?? null,
      levelsQuantity: this.levelsQuantity,
      floorTypes: prefill.floorTypes || null,
      floorTypeOther: prefill.floorTypeOther || null,
      uploadedPhotos: [],
      saveCardForFutureUse: false
    };
  }

  close(): void {
    this.step = 'loading';
    this.preview = null;
    this.serviceType = null;
    this.selectedServices = [];
    this.selectedExtraServices = [];
    this.informationalBedrooms = 0;
    this.informationalBathrooms = 1;
    this.errorMessage = '';
    this.closed.emit();
  }

  /** Backdrop click closes; a click inside must not bubble out to it. */
  onPanelClick(event: MouseEvent): void {
    event.stopPropagation();
  }
}
