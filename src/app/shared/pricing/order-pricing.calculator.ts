/**
 * SINGLE SOURCE OF TRUTH for all order price math on the frontend.
 *
 * Every place that prices an order (booking page, user order edit, admin orders,
 * booking confirmation fallback, homepage starting prices) must go through this
 * module. Do not re-implement subtotal, tax, discount, duration, maids-count, or
 * cleaner-salary math anywhere else.
 *
 * This module is mirrored 1:1 by the backend calculator at
 * DreamCleaningBackend/DreamCleaningBackend/Services/OrderPricingCalculator.cs.
 * The two files use the same function names, the same step order, and the same
 * rounding (half-up — JS Math.round; the backend uses MidpointRounding.AwayFromZero
 * to match). ANY change here must be applied to the backend mirror in the same commit.
 *
 * The canonical algorithm is the booking page's calculateTotal() — when in doubt
 * about semantics, the booking flow's behavior wins.
 */

// ===== Shared constants (mirror: OrderPricingCalculator.cs) =====

/** NYC sales tax. The only place this rate may be defined on the frontend. */
export const SALES_TAX_RATE = 0.08875;

/** Flat price for a studio (bedrooms quantity = 0), before the cleaning-type multiplier. */
export const STUDIO_PRICE = 10;

/** Base duration in minutes for a studio, before the cleaning-type multiplier. */
export const STUDIO_DURATION = 20;

/** A single maid can work at most this many hours; above it we add maids. */
export const MAX_HOURS_PER_MAID = 6;

/** Per-maid minimum duration in minutes. */
export const PER_MAID_MINIMUM_MINUTES = 60;

/** Per-maid minimum when the Extra Cleaners extra is selected (2h30m floor). */
export const EXTRA_CLEANERS_PER_MAID_MINIMUM_MINUTES = 150;

/** Default cleaner hourly rates: regular vs deep/super-deep orders. */
export const REGULAR_CLEANER_HOURLY_RATE = 20;
export const DEEP_CLEANING_CLEANER_HOURLY_RATE = 21;

/** The extra service that adds cleaners is identified by name, like the booking page does. */
export const EXTRA_CLEANERS_NAME = 'Extra Cleaners';

/** Round to cents, half-up — the rounding used in every price step on both sides. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ===== Inputs =====

/** One selected service (bedrooms, bathrooms, cleaners, hours, sqft, ...). */
export interface ServiceLineInput {
  serviceId?: number;
  cost: number;
  timeDuration: number;
  serviceRelationType?: string | null;
  serviceKey?: string | null;
  quantity: number;
}

/** One selected extra service. */
export interface ExtraServiceLineInput {
  extraServiceId?: number;
  price: number;
  duration: number;
  priceMultiplier: number;
  isDeepCleaning: boolean;
  isSuperDeepCleaning: boolean;
  isSameDayService: boolean;
  hasHours: boolean;
  hasQuantity: boolean;
  name?: string | null;
  quantity: number;
  hours: number;
}

export function isExtraCleaners(extra: ExtraServiceLineInput): boolean {
  return extra.hasQuantity && extra.name === EXTRA_CLEANERS_NAME;
}

export interface QuoteInput {
  basePrice: number;
  baseDuration: number;
  services: ServiceLineInput[];
  extraServices: ExtraServiceLineInput[];

  /** Custom pricing (admin-entered amount/cleaners/duration) bypasses the service math. */
  isCustomPricing?: boolean;
  customAmount?: number | null;
  customCleaners?: number | null;
  /** Per-cleaner minutes. */
  customDuration?: number | null;
}

// ===== Outputs =====

export interface ServiceLineResult {
  serviceId: number;
  quantity: number;
  cost: number;
  duration: number;
  /** False for the hours line of a cleaner-hours pair (folded into the cleaner line). */
  shouldAddToOrder: boolean;
}

export interface ExtraServiceLineResult {
  extraServiceId: number;
  quantity: number;
  hours: number;
  cost: number;
  duration: number;
}

export interface QuoteResult {
  /** Rounded subtotal including the deep-cleaning fee. Pre-discount, pre-tax. */
  subTotal: number;
  priceMultiplier: number;
  deepCleaningFee: number;
  /**
   * TOTAL cleaner-minutes — what Order.TotalDuration stores on the backend. For
   * cleaner-hours service types this is per-cleaner (hours × 60); for everything
   * else it is the total work across all maids. Floors applied.
   */
  totalDuration: number;
  /** Per-maid duration the UI displays. Floors applied. */
  displayDuration: number;
  maidsCount: number;
  hasCleanerService: boolean;
  serviceLines: ServiceLineResult[];
  extraServiceLines: ExtraServiceLineResult[];
}

// ===== Step 1: multiplier =====

/**
 * Cleaning-type multiplier: Super Deep wins over Deep wins over regular,
 * regardless of selection order. The fee is the matching extra's flat price,
 * added to the subtotal at the END (after service costs).
 */
export function resolvePriceMultiplier(
  extraServices: ExtraServiceLineInput[]
): { multiplier: number; deepCleaningFee: number } {
  const superDeep = extraServices.find(e => e.isSuperDeepCleaning);
  const deep = extraServices.find(e => e.isDeepCleaning);

  if (superDeep) return { multiplier: superDeep.priceMultiplier, deepCleaningFee: superDeep.price };
  if (deep) return { multiplier: deep.priceMultiplier, deepCleaningFee: deep.price };
  return { multiplier: 1, deepCleaningFee: 0 };
}

// ===== Step 2: subtotal + duration + maids =====

/**
 * The canonical quote: subtotal, durations, maids count and per-line costs.
 * Mirrors OrderPricingCalculator.CalculateQuote step for step.
 */
export function calculateQuote(input: QuoteInput): QuoteResult {
  if (input.isCustomPricing) {
    const perCleaner = input.customDuration ?? input.baseDuration;
    const maidsCount = Math.max(1, input.customCleaners ?? 1);
    return {
      subTotal: round2(input.customAmount ?? input.basePrice),
      priceMultiplier: 1,
      deepCleaningFee: 0,
      displayDuration: perCleaner,
      // Stored TotalDuration uses the TOTAL convention: per-cleaner × cleaners, min 1h.
      totalDuration: Math.max(perCleaner * maidsCount, PER_MAID_MINIMUM_MINUTES),
      maidsCount,
      hasCleanerService: false,
      serviceLines: [],
      extraServiceLines: []
    };
  }

  const { multiplier: priceMultiplier, deepCleaningFee } = resolvePriceMultiplier(input.extraServices);

  let subTotal = 0;
  let totalDuration = 0;
  let actualTotalDuration = 0;
  let displayDuration = 0;

  const hasCleanerService = input.services.some(s => s.serviceRelationType === 'cleaner');
  const hoursService = input.services.find(s => s.serviceRelationType === 'hours');
  const useExplicitHours = hasCleanerService && !!hoursService;

  const serviceLines: ServiceLineResult[] = [];
  const extraServiceLines: ExtraServiceLineResult[] = [];

  // Base price always contributes; base duration only when hours aren't explicit.
  subTotal += input.basePrice * priceMultiplier;
  if (useExplicitHours) {
    actualTotalDuration = hoursService!.quantity * 60;
    totalDuration = actualTotalDuration;
  } else {
    totalDuration += input.baseDuration;
    actualTotalDuration += input.baseDuration;
  }

  // Services
  for (const service of input.services) {
    const line: ServiceLineResult = {
      serviceId: service.serviceId ?? 0,
      quantity: service.quantity,
      cost: 0,
      duration: 0,
      shouldAddToOrder: true
    };

    if (service.serviceRelationType === 'cleaner') {
      if (hoursService) {
        const costPerCleanerPerHour = service.cost * priceMultiplier;
        line.cost = costPerCleanerPerHour * service.quantity * hoursService.quantity;
        line.duration = hoursService.quantity * 60;
        subTotal += line.cost;
      }
    } else if (service.serviceKey === 'bedrooms' && service.quantity === 0) {
      // Studio: flat price and duration, both scaled by cleaning type.
      line.cost = STUDIO_PRICE * priceMultiplier;
      line.duration = Math.round(STUDIO_DURATION * priceMultiplier);
      subTotal += line.cost;
      if (!useExplicitHours) {
        totalDuration += line.duration;
        actualTotalDuration += line.duration;
      }
    } else if (service.serviceRelationType === 'hours') {
      // Folded into the cleaner line above; never priced on its own.
      line.shouldAddToOrder = false;
    } else {
      line.cost = service.cost * service.quantity * priceMultiplier;
      line.duration = service.timeDuration * service.quantity;
      subTotal += line.cost;
      if (!useExplicitHours) {
        totalDuration += line.duration;
        actualTotalDuration += line.duration;
      }
    }

    serviceLines.push(line);
  }

  // Extra services
  for (const extra of input.extraServices) {
    const line: ExtraServiceLineResult = {
      extraServiceId: extra.extraServiceId ?? 0,
      quantity: extra.quantity,
      hours: extra.hours,
      cost: 0,
      duration: 0
    };

    if (extra.isDeepCleaning || extra.isSuperDeepCleaning) {
      // The fee is added to the subtotal at the end; the stored line keeps the flat price.
      line.cost = extra.price;
      line.duration = extra.duration;
      if (!useExplicitHours) {
        totalDuration += line.duration;
        actualTotalDuration += line.duration;
      }
    } else {
      // Same Day Service is exempt from the cleaning-type multiplier.
      const currentMultiplier = extra.isSameDayService ? 1 : priceMultiplier;

      if (extra.hasHours) {
        line.cost = extra.price * extra.hours * currentMultiplier;
        line.duration = extra.duration * extra.hours;
      } else if (extra.hasQuantity) {
        line.cost = extra.price * extra.quantity * currentMultiplier;
        line.duration = extra.duration * extra.quantity;
      } else {
        line.cost = extra.price * currentMultiplier;
        line.duration = extra.duration;
      }

      subTotal += line.cost;
      if (!useExplicitHours) {
        totalDuration += line.duration;
        actualTotalDuration += line.duration;
      }
    }

    extraServiceLines.push(line);
  }

  // Maids count: explicit cleaner quantity, or duration-derived; Extra Cleaners add on top.
  const extraCleanersLine = input.extraServices.find(isExtraCleaners);
  const extraCleaners = extraCleanersLine?.quantity ?? 0;
  const hasExtraCleanersSelected = !!extraCleanersLine;

  let baseMaidsCount = 1;
  if (hasCleanerService) {
    const cleanerService = input.services.find(s => s.serviceRelationType === 'cleaner');
    if (cleanerService) {
      baseMaidsCount = Math.max(1, cleanerService.quantity);
    }
    displayDuration = actualTotalDuration;
  } else {
    const totalHours = totalDuration / 60;
    baseMaidsCount = totalHours <= MAX_HOURS_PER_MAID ? 1 : Math.ceil(totalHours / MAX_HOURS_PER_MAID);
    displayDuration = totalDuration;
  }

  const maidsCount = baseMaidsCount + extraCleaners;

  if (maidsCount > 1 && !hasCleanerService) {
    displayDuration = Math.ceil(totalDuration / maidsCount);
  } else if (hasCleanerService && maidsCount > baseMaidsCount) {
    displayDuration = Math.ceil(actualTotalDuration / maidsCount);
  }

  // Per-maid floor: 1h normally, 2h30m when Extra Cleaners is selected.
  const perMaidMinMinutes = hasExtraCleanersSelected
    ? EXTRA_CLEANERS_PER_MAID_MINIMUM_MINUTES
    : PER_MAID_MINIMUM_MINUTES;
  displayDuration = Math.max(displayDuration, perMaidMinMinutes);

  // TotalDuration semantics: per-cleaner for cleaner-hours types, total for the rest.
  const totalMinMinutes = hasCleanerService
    ? perMaidMinMinutes
    : perMaidMinMinutes * Math.max(1, maidsCount);
  actualTotalDuration = Math.max(actualTotalDuration, totalMinMinutes);

  // Deep cleaning fee lands AFTER service costs.
  subTotal += deepCleaningFee;

  // With explicit hours the display is simply the hours themselves.
  if (useExplicitHours) {
    displayDuration = hoursService!.quantity * 60;
  }

  return {
    subTotal: round2(subTotal),
    priceMultiplier,
    deepCleaningFee,
    totalDuration: actualTotalDuration,
    displayDuration,
    maidsCount,
    hasCleanerService,
    serviceLines,
    extraServiceLines
  };
}

// ===== Step 3: discounts (loyalty stacking) =====

export interface LoyaltyStackingResult {
  loyaltyAmount: number;
  loyaltyPercentage: number;
  subscriptionAmount: number;
  promoAmount: number;
}

/**
 * Loyalty vs subscription vs promo stacking. Round 1: loyalty vs subscription
 * (tie → subscription). Round 2: surviving loyalty vs promo (tie → promo).
 * After stacking, at most two slots are non-zero: either {subscription, promo}
 * or {loyalty} alone or {subscription} alone or {promo} alone.
 */
export function resolveLoyaltyStacking(
  loyaltyCandidateAmount: number,
  loyaltyCandidatePercentage: number,
  subscriptionAmount: number,
  promoAmount: number
): LoyaltyStackingResult {
  if (loyaltyCandidateAmount <= 0 || loyaltyCandidatePercentage <= 0) {
    return { loyaltyAmount: 0, loyaltyPercentage: 0, subscriptionAmount, promoAmount };
  }

  let loyalty = loyaltyCandidateAmount;
  let loyaltyPct = loyaltyCandidatePercentage;

  if (loyalty > subscriptionAmount) {
    subscriptionAmount = 0;
  } else {
    loyalty = 0;
    loyaltyPct = 0;
  }

  if (loyalty > 0) {
    if (loyalty > promoAmount) {
      promoAmount = 0;
    } else {
      loyalty = 0;
      loyaltyPct = 0;
    }
  }

  return { loyaltyAmount: loyalty, loyaltyPercentage: loyaltyPct, subscriptionAmount, promoAmount };
}

// ===== Step 4: tax + total =====

export interface TotalsInput {
  subTotal: number;
  discountAmount?: number;
  subscriptionDiscountAmount?: number;
  loyaltyDiscountAmount?: number;
  tips?: number;
  companyDevelopmentTips?: number;
  giftCardAmountUsed?: number;
  pointsRedeemedDiscount?: number;
  rewardBalanceUsed?: number;
}

export interface TotalsResult {
  discountedSubTotal: number;
  tax: number;
  /** discountedSubTotal + tax + tips + companyTips — before gift card / points / credits. */
  totalBeforeGiftCard: number;
  /** Final charge amount, clamped at 0. */
  total: number;
}

/**
 * Tax on the DISCOUNTED subtotal; tips are never taxed; gift card, bubble
 * points and reward credits come off the very end.
 */
export function calculateTotals(input: TotalsInput): TotalsResult {
  let discountedSubTotal =
    input.subTotal -
    (input.discountAmount ?? 0) -
    (input.subscriptionDiscountAmount ?? 0) -
    (input.loyaltyDiscountAmount ?? 0);
  if (discountedSubTotal < 0) discountedSubTotal = 0;

  const tax = round2(discountedSubTotal * SALES_TAX_RATE);
  const totalBeforeGiftCard =
    discountedSubTotal + tax + (input.tips ?? 0) + (input.companyDevelopmentTips ?? 0);

  let total =
    totalBeforeGiftCard -
    (input.giftCardAmountUsed ?? 0) -
    (input.pointsRedeemedDiscount ?? 0) -
    (input.rewardBalanceUsed ?? 0);
  if (total < 0) total = 0;

  return {
    discountedSubTotal,
    tax,
    totalBeforeGiftCard,
    total: round2(total)
  };
}

/** Gift card draw: as much of the pre-gift-card total as the balance covers. */
export function resolveGiftCardAmountToUse(giftCardBalance: number, totalBeforeGiftCard: number): number {
  return Math.min(giftCardBalance, Math.max(0, totalBeforeGiftCard));
}

// ===== Step 5: cleaner salary =====

/** Deep/super-deep orders pay cleaners the higher rate. */
export function getDefaultCleanerHourlyRate(deepCleaningFee: number): number {
  return deepCleaningFee > 0 ? DEEP_CLEANING_CLEANER_HOURLY_RATE : REGULAR_CLEANER_HOURLY_RATE;
}

/**
 * Per-cleaner duration rounded to 15 minutes, then perCleaner/60 × maids × rate.
 * Only cleaner-hours service types store TotalDuration as per-cleaner; everything
 * else (including Custom Pricing) stores it as TOTAL across all maids and we divide.
 */
export function calculateCleanerTotalSalary(
  totalDuration: number,
  maidsCount: number,
  hasCleanerService: boolean,
  hourlyRate: number
): number {
  const maids = Math.max(1, maidsCount);
  const perCleanerDuration = hasCleanerService
    ? totalDuration
    : maids > 1
      ? totalDuration / maids
      : totalDuration;
  const roundedPerCleaner = Math.round(perCleanerDuration / 15) * 15;
  return round2((roundedPerCleaner / 60) * maids * hourlyRate);
}

// ===== Input builders (shared by booking + order edit) =====

/** Structural shape of a selected service in the booking/order-edit components. */
export interface SelectedServiceLike {
  service: {
    id: number;
    cost: number;
    timeDuration: number;
    serviceRelationType?: string | null;
    serviceKey?: string | null;
  };
  quantity: number;
}

/** Structural shape of a selected extra service in the booking/order-edit components. */
export interface SelectedExtraServiceLike {
  extraService: {
    id: number;
    price: number;
    duration: number;
    priceMultiplier: number;
    isDeepCleaning: boolean;
    isSuperDeepCleaning: boolean;
    isSameDayService: boolean;
    hasHours: boolean;
    hasQuantity: boolean;
    name?: string | null;
  };
  quantity: number;
  hours: number;
}

/** Maps component selections to calculator extra-service inputs. */
export function mapSelectedExtraInputs(selected: SelectedExtraServiceLike[]): ExtraServiceLineInput[] {
  return selected.map(s => ({
    extraServiceId: s.extraService.id,
    price: s.extraService.price,
    duration: s.extraService.duration,
    priceMultiplier: s.extraService.priceMultiplier,
    isDeepCleaning: s.extraService.isDeepCleaning,
    isSuperDeepCleaning: s.extraService.isSuperDeepCleaning,
    isSameDayService: s.extraService.isSameDayService,
    hasHours: s.extraService.hasHours,
    hasQuantity: s.extraService.hasQuantity,
    name: s.extraService.name,
    quantity: s.quantity,
    hours: s.hours
  }));
}

/**
 * Builds the calculator input from component selections — the one place that
 * knows how booking/order-edit selections map to the quote input.
 */
export function buildQuoteInputFromSelections(
  serviceType: { basePrice?: number | null; timeDuration?: number | null } | null | undefined,
  selectedServices: SelectedServiceLike[],
  selectedExtraServices: SelectedExtraServiceLike[]
): QuoteInput {
  return {
    basePrice: serviceType?.basePrice ?? 0,
    baseDuration: serviceType?.timeDuration ?? 0,
    services: selectedServices.map(s => ({
      serviceId: s.service.id,
      cost: s.service.cost,
      timeDuration: s.service.timeDuration,
      serviceRelationType: s.service.serviceRelationType,
      serviceKey: s.service.serviceKey,
      quantity: s.quantity
    })),
    extraServices: mapSelectedExtraInputs(selectedExtraServices)
  };
}

// ===== Quantity linkage (shared by booking + order edits) =====

/**
 * Default square-feet for a bedroom count — the booking page auto-raises the
 * Sq.ft service to this when bedrooms change, and it doubles as the Sq.ft
 * minimum for that bedroom count. One definition for booking, user order edit,
 * and admin order edit so the linked pricing behaves identically everywhere.
 */
export function getSquareFeetForBedrooms(bedrooms: number): number {
  switch (bedrooms) {
    case 0: return 400;  // Studio
    case 1: return 650;
    case 2: return 850;
    case 3: return 1000;
    case 4: return 1500;
    case 5: return 1800;
    case 6: return 2000;
    default: return Math.max(400, bedrooms * 300); // Fallback for 7+
  }
}

// ===== Per-item display helpers (shared by booking + order-edit templates) =====

/** Display price for one service at a given quantity (studio rule included). */
export function getServiceDisplayPrice(
  service: { cost: number; serviceKey?: string | null },
  quantity: number,
  priceMultiplier: number
): number {
  if (service.serviceKey === 'bedrooms' && quantity === 0) {
    return STUDIO_PRICE * priceMultiplier;
  }
  return service.cost * quantity * priceMultiplier;
}

/** Display price for one extra service (same-day exemption included). */
export function getExtraServiceDisplayPrice(
  extra: {
    price: number;
    isSameDayService: boolean;
    hasHours: boolean;
    hasQuantity: boolean;
  },
  quantity: number,
  hours: number,
  priceMultiplier: number
): number {
  const currentMultiplier = extra.isSameDayService ? 1 : priceMultiplier;
  if (extra.hasHours) {
    return extra.price * hours * currentMultiplier;
  }
  if (extra.hasQuantity) {
    return extra.price * quantity * currentMultiplier;
  }
  return extra.price * currentMultiplier;
}

/**
 * Display duration for one service. Unlike the quote's internal duration math,
 * the per-service chip scales with the cleaning-type multiplier (booking page
 * behavior — getServiceDuration).
 */
export function getServiceDisplayDuration(
  service: { timeDuration: number; serviceKey?: string | null; serviceRelationType?: string | null },
  quantity: number,
  durationMultiplier: number
): number {
  if (service.serviceKey === 'bedrooms' && quantity === 0) {
    return Math.round(STUDIO_DURATION * durationMultiplier);
  }
  if (service.serviceRelationType === 'cleaner' || service.serviceRelationType === 'hours') {
    return Math.round(service.timeDuration * durationMultiplier);
  }
  return Math.round(service.timeDuration * quantity * durationMultiplier);
}
