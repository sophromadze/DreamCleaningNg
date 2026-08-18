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

/**
 * @deprecated LEGACY fallback only. Studio pricing is now admin-editable per service via
 * Service.zeroQuantityCost / Service.zeroQuantityDuration; this constant is used solely when
 * BOTH of those are null, so a missing seed can't zero out a studio booking.
 */
export const STUDIO_PRICE = 10;

/**
 * @deprecated LEGACY fallback only — see {@link STUDIO_PRICE}. Superseded by
 * Service.zeroQuantityDuration.
 */
export const STUDIO_DURATION = 20;

/** A single maid can work at most this many hours; above it we add maids. */
export const MAX_HOURS_PER_MAID = 6;

/**
 * Legacy auto-staffing rule: above MAX_HOURS_PER_MAID we used to add cleaners and show
 * the duration divided per cleaner. Disabled 2026-07 — customers now always see the full
 * total duration and admins set the cleaner count manually per order (the 1-per-6h math
 * survives only as an admin-panel suggestion). Flip to true together with
 * AutoAddCleanersByDuration in OrderPricingCalculator.cs to restore.
 * Typed as boolean (not literal false) so gated branches don't lint as unreachable.
 */
export const AUTO_ADD_CLEANERS_BY_DURATION: boolean = false;

/**
 * Scheduling/billing granularity for durations, in minutes. Durations shown to
 * customers/admins and the per-cleaner duration used for salary are rounded to this.
 * Mirrored by OrderPricingCalculator.DurationRoundingMinutes and DURATION_ROUNDING_MINUTES
 * in utils/duration.utils.ts.
 */
export const DURATION_ROUNDING_MINUTES = 30;

/** Per-maid minimum duration in minutes. */
export const PER_MAID_MINIMUM_MINUTES = 60;

/** Per-maid minimum when the Extra Cleaners extra is selected (2h30m floor). */
export const EXTRA_CLEANERS_PER_MAID_MINIMUM_MINUTES = 150;

/**
 * Default cleaner hourly rates. Regular residential is the base; deep/super-deep and
 * move in/out pay the mid rate; heavy-condition and post-construction pay the top rate.
 * Mirrored by *CleanerHourlyRate in OrderPricingCalculator.cs.
 */
export const REGULAR_CLEANER_HOURLY_RATE = 20;
export const DEEP_CLEANING_CLEANER_HOURLY_RATE = 21;
export const HEAVY_DUTY_CLEANER_HOURLY_RATE = 25;

/** The extra service that adds cleaners is identified by name, like the booking page does. */
export const EXTRA_CLEANERS_NAME = 'Extra Cleaners';

/** Round to cents, half-up — the rounding used in every price step on both sides. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Splits a TAX-INCLUSIVE amount into its pre-tax subtotal and the sales tax inside it,
 * such that `subTotal + tax === amount` EXACTLY, for every amount.
 *
 * Used by Custom Pricing: the admin types what the customer should pay in total, so both
 * halves are derived from it instead of the tax being added on top.
 *
 * The returned `tax` must be carried through as `TotalsInput.taxOverride` — re-deriving it
 * as `round2(subTotal × SALES_TAX_RATE)` reintroduces a cent of drift on roughly one amount
 * in twenty, because no cent-valued subtotal exists for those amounts (nothing satisfies
 * `S + round2(S × 8.875%) === 300.00`; 275.55 gives 300.01 and 275.54 gives 299.99).
 * Deriving the tax from the entered amount instead makes the split exact — the trade is that
 * the tax is up to half a cent off the literal 8.875% of the subtotal, which is the normal
 * and expected behaviour of tax-inclusive pricing.
 */
export function splitTaxInclusiveAmount(amountWithTax: number): { subTotal: number; tax: number } {
  const amount = round2(amountWithTax);
  if (!(amount > 0)) return { subTotal: 0, tax: 0 };

  const tax = round2((amount * SALES_TAX_RATE) / (1 + SALES_TAX_RATE));
  return { subTotal: round2(amount - tax), tax };
}

// ===== Inputs =====

/**
 * One marginal rate band over the BILLABLE quantity (i.e. after the included allowance
 * has been subtracted), NOT over the raw selected quantity.
 */
export interface RateTierInput {
  /** Billable quantity at which this band starts. The lowest band must be 0. */
  fromQuantity: number;
  cost: number;
  timeDuration: number;
}

/**
 * Maps a source service's selected quantity to units of THIS service that are included
 * at no charge (e.g. bedrooms = 2 → 850 sqft included).
 */
export interface ThresholdInput {
  sourceServiceId: number;
  sourceQuantity: number;
  includedQuantity: number;
}

/** One selected service (bedrooms, bathrooms, cleaners, hours, sqft, ...). */
export interface ServiceLineInput {
  serviceId?: number;
  cost: number;
  timeDuration: number;
  serviceRelationType?: string | null;
  serviceKey?: string | null;
  quantity: number;

  /** When true, the included allowance is subtracted before billing. */
  chargeAboveThreshold?: boolean;

  /** Cost when the selected quantity is 0 (e.g. Studio). null/undefined = not applicable. */
  zeroQuantityCost?: number | null;

  /** Minutes when the selected quantity is 0 (e.g. Studio). null/undefined = not applicable. */
  zeroQuantityDuration?: number | null;

  /** Empty = flat `cost`/`timeDuration` across the whole billable quantity. */
  rateTiers?: RateTierInput[];

  /** Empty = no allowance, i.e. bill from zero. */
  thresholds?: ThresholdInput[];
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

  /**
   * Floor for the base-price + services portion of the subtotal (ServiceType.minimumPrice).
   * Extras and the deep-cleaning fee stack ON TOP of the floor. 0/omitted = no floor.
   */
  minimumPrice?: number;

  /** Custom pricing (admin-entered amount/cleaners/duration) bypasses the service math. */
  isCustomPricing?: boolean;
  /** TAX-INCLUSIVE total the admin typed; the subtotal is derived from it. */
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
  /** True when `minimumPrice` actually raised the subtotal. */
  minimumPriceApplied: boolean;
  /**
   * Custom Pricing only: the exact sales tax contained in the admin-entered tax-inclusive
   * amount. Pass it to calculateTotals as `taxOverride` so the charged total matches what
   * was typed to the cent. null for every ordinary quote (tax is derived from the subtotal).
   */
  taxOverride: number | null;
  /**
   * Non-fatal pricing anomalies for the caller to log — currently only the
   * missing-threshold-source fallback. Never surfaced to customers.
   */
  warnings: string[];
  serviceLines: ServiceLineResult[];
  extraServiceLines: ExtraServiceLineResult[];
}

/**
 * Custom Pricing only: records the selected extras as $0 / 0-minute lines.
 *
 * On a custom-priced ("Pre-Arranged") order the admin-entered amount and duration ARE the
 * quote, so an extra must never move either number. Extras still get persisted, because they
 * are how the admin panel and the cleaner assignment email/SMS learn what work was agreed —
 * they are informational, not billable. Quantity and hours are kept (they describe the job:
 * "Windows × 5"); cost and duration are hard 0 and must NOT be re-derived from the catalog
 * price/duration anywhere downstream.
 *
 * Mirror: OrderPricingCalculator.AddInformationalExtraLines.
 */
function informationalExtraLines(extraServices: ExtraServiceLineInput[]): ExtraServiceLineResult[] {
  return extraServices.map(extra => ({
    extraServiceId: extra.extraServiceId ?? 0,
    quantity: extra.quantity,
    hours: extra.hours,
    cost: 0,
    duration: 0
  }));
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

// ===== Threshold + tier resolution (mirror: OrderPricingCalculator.cs) =====

/**
 * Resolves how many units of `service` are included at no charge, based on the
 * quantities of its configured source services.
 *
 * Lookup is a FLOOR match: the highest configured row whose sourceQuantity is <= the
 * selected source quantity. A source quantity below every row uses the lowest row; above
 * every row uses the highest. That subsumes exact-match and handles gaps in the config.
 *
 * When several source services are configured, the MAXIMUM included value wins — never
 * the sum. Summing would let two sources grant more free area than the home has.
 */
export function resolveIncludedQuantity(
  service: ServiceLineInput,
  allServices: ServiceLineInput[],
  warnings: string[]
): number {
  if (!service.chargeAboveThreshold) return 0;
  const thresholds = service.thresholds ?? [];
  if (thresholds.length === 0) return 0;

  const bySource = new Map<number, ThresholdInput[]>();
  for (const t of thresholds) {
    const rows = bySource.get(t.sourceServiceId);
    if (rows) rows.push(t);
    else bySource.set(t.sourceServiceId, [t]);
  }

  let included = 0;

  for (const [sourceServiceId, group] of bySource) {
    const rows = [...group].sort((a, b) => a.sourceQuantity - b.sourceQuantity);
    if (rows.length === 0) continue;

    const source = allServices.find(s => s.serviceId === sourceServiceId);
    if (!source) {
      // Fail toward the customer: treat a missing source as quantity 0, which resolves to
      // the smallest configured allowance rather than to "no allowance". Billing a large
      // home from zero would be a severe overcharge.
      warnings.push(
        `Threshold source service ${sourceServiceId} was not present in the selection for ` +
        `service ${service.serviceId} ('${service.serviceKey}'); treated its quantity as 0.`
      );
    }

    const sourceQuantity = source?.quantity ?? 0;
    let match = rows[0];
    for (const row of rows) {
      if (row.sourceQuantity <= sourceQuantity) match = row;
    }
    included = Math.max(included, match.includedQuantity);
  }

  return included;
}

/**
 * Prices one ordinary service line: subtract the included allowance, then apply the rate
 * tiers MARGINALLY over what remains (each tier bills only the slice of the billable
 * quantity that falls inside its own band — never the top tier applied to everything).
 *
 * No tiers configured → flat `cost`/`timeDuration` across the whole billable quantity,
 * which is exactly the pre-refactor behaviour every other service still relies on.
 *
 * Cost takes the cleaning-type multiplier; duration does not.
 */
export function calculateTieredLine(
  service: ServiceLineInput,
  allServices: ServiceLineInput[],
  priceMultiplier: number,
  warnings: string[]
): { cost: number; duration: number } {
  const included = resolveIncludedQuantity(service, allServices, warnings);
  const billable = Math.max(0, service.quantity - included);

  let cost = 0;
  let duration = 0;

  const rateTiers = service.rateTiers ?? [];
  if (rateTiers.length === 0) {
    cost = service.cost * billable;
    duration = service.timeDuration * billable;
  } else {
    const tiers = [...rateTiers].sort((a, b) => a.fromQuantity - b.fromQuantity);
    for (let i = 0; i < tiers.length; i++) {
      const from = tiers[i].fromQuantity;
      if (billable <= from) break;

      const upperBound = i + 1 < tiers.length
        ? Math.min(billable, tiers[i + 1].fromQuantity)
        : billable;

      const width = upperBound - from;
      if (width <= 0) continue;

      cost += width * tiers[i].cost;
      duration += width * tiers[i].timeDuration;
    }
  }

  return { cost: cost * priceMultiplier, duration };
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
    // The admin-entered amount is the TAX-INCLUSIVE total: the subtotal and the tax are both
    // split out of it (they add back to it exactly) rather than the tax landing on top.
    const split = splitTaxInclusiveAmount(input.customAmount ?? input.basePrice);
    return {
      subTotal: split.subTotal,
      taxOverride: split.tax,
      priceMultiplier: 1,
      deepCleaningFee: 0,
      displayDuration: perCleaner,
      // Stored TotalDuration uses the TOTAL convention: per-cleaner × cleaners, min 1h.
      totalDuration: Math.max(perCleaner * maidsCount, PER_MAID_MINIMUM_MINUTES),
      maidsCount,
      hasCleanerService: false,
      minimumPriceApplied: false,
      warnings: [],
      serviceLines: [],
      extraServiceLines: informationalExtraLines(input.extraServices)
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
  const warnings: string[] = [];

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
    } else if (service.serviceRelationType === 'hours') {
      // Folded into the cleaner line above; never priced on its own. Checked before the
      // zero-quantity branches so an hours line can never be hijacked by them.
      line.shouldAddToOrder = false;
    } else if (
      service.quantity === 0 &&
      (service.zeroQuantityCost != null || service.zeroQuantityDuration != null)
    ) {
      // Generic zero-quantity rule (Studio is just bedrooms = 0). Cost takes the
      // cleaning-type multiplier; duration does NOT — no duration anywhere in the quote is
      // multiplier-scaled, and Deep Cleaning contributes its own minutes through its
      // ExtraService row.
      line.cost = (service.zeroQuantityCost ?? 0) * priceMultiplier;
      line.duration = service.zeroQuantityDuration ?? 0;
      subTotal += line.cost;
      if (!useExplicitHours) {
        totalDuration += line.duration;
        actualTotalDuration += line.duration;
      }
    } else if (service.serviceKey === 'bedrooms' && service.quantity === 0) {
      // Legacy studio fallback — only reachable when BOTH zero-quantity fields are null,
      // so a missing seed can't silently price a studio at $0.
      line.cost = STUDIO_PRICE * priceMultiplier;
      line.duration = STUDIO_DURATION;
      subTotal += line.cost;
      if (!useExplicitHours) {
        totalDuration += line.duration;
        actualTotalDuration += line.duration;
      }
    } else {
      const tiered = calculateTieredLine(service, input.services, priceMultiplier, warnings);
      line.cost = tiered.cost;
      line.duration = tiered.duration;
      subTotal += line.cost;
      if (!useExplicitHours) {
        totalDuration += line.duration;
        actualTotalDuration += line.duration;
      }
    }

    serviceLines.push(line);
  }

  // Minimum price floor. Applies to base price + services ONLY, so extras and the
  // deep-cleaning fee stack on top of the floor rather than being absorbed by it.
  const minimumPrice = input.minimumPrice ?? 0;
  let minimumPriceApplied = false;
  if (minimumPrice > 0 && subTotal < minimumPrice) {
    subTotal = minimumPrice;
    minimumPriceApplied = true;
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
    baseMaidsCount = AUTO_ADD_CLEANERS_BY_DURATION && totalHours > MAX_HOURS_PER_MAID
      ? Math.ceil(totalHours / MAX_HOURS_PER_MAID)
      : 1;
    displayDuration = totalDuration;
  }

  const maidsCount = baseMaidsCount + extraCleaners;

  if (AUTO_ADD_CLEANERS_BY_DURATION && maidsCount > 1 && !hasCleanerService) {
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

  // Auto-staffing off: customers see the full (floored) total, never a per-maid split.
  if (!AUTO_ADD_CLEANERS_BY_DURATION && !hasCleanerService) {
    displayDuration = actualTotalDuration;
  }

  // Deep cleaning fee lands AFTER service costs.
  subTotal += deepCleaningFee;

  // With explicit hours the display is simply the hours themselves.
  if (useExplicitHours) {
    displayDuration = hoursService!.quantity * 60;
  }

  return {
    subTotal: round2(subTotal),
    taxOverride: null,
    priceMultiplier,
    deepCleaningFee,
    totalDuration: actualTotalDuration,
    displayDuration,
    maidsCount,
    hasCleanerService,
    minimumPriceApplied,
    warnings,
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

/**
 * Re-scale a discount recorded on an order to a NEW subtotal, keeping the same proportion.
 *
 * Used by both edit surfaces (admin order editor and customer order-edit) when a quantity
 * change moves the subtotal. It is a PURE function of the three inputs: the same new subtotal
 * always yields the same discount, so any sequence of edits that returns the order to a given
 * subtotal returns the discount to its exact original value. Never derive the next discount
 * from the current one — that made the admin editor lag a step behind, so bathrooms 2→1→2 left
 * a 20% promo at 108.10 on a 563.00 subtotal instead of 112.60.
 *
 * KNOWN LIMITATION — this scales a FIXED-amount promo ("$50 off") proportionally, which is
 * wrong for that promo type. Both surfaces have always behaved this way. The component cannot
 * do better today: the order DTO exposes the promo CODE and the resulting dollar amount, but
 * not whether the code is a percentage or a flat amount, so the original ratio is the only
 * available signal. Fixing it properly means exposing the promo type on the order DTO and is
 * deliberately out of scope here.
 *
 * MIRRORED IN C#, but inline rather than as a named function: OrderService.UpdateOrder
 * (~line 447) and CalculateAdditionalAmount (~line 745) run the same
 * `round2(newSubTotal × (storedDiscount / storedSubTotal))` server-side, from the STORED
 * order values, and deliberately ignore the client's discount figures. Change this and those
 * together — the customer order-edit page previews a number the backend then re-derives, so
 * any drift shows up as a total that changes the moment the customer saves.
 *
 * The admin SuperAdmin save path is the exception: it persists the posted discount verbatim
 * without re-deriving anything.
 */
export function rescaleDiscountToSubTotal(
  originalDiscount: number,
  originalSubTotal: number,
  newSubTotal: number
): number {
  if (!(originalSubTotal > 0)) return 0;
  return round2(newSubTotal * (originalDiscount / originalSubTotal));
}

// ===== Step 4: tax + total =====

export interface TotalsInput {
  subTotal: number;
  discountAmount?: number;
  subscriptionDiscountAmount?: number;
  loyaltyDiscountAmount?: number;
  tips?: number;
  /**
   * RETIRED — "Tips for Company Development" is no longer offered anywhere. No form, no
   * input DTO, and no caller may set it from user input; new orders are always 0.
   *
   * It survives here only so a LEGACY order that stored a non-zero amount still recomputes
   * to the total its customer actually paid. Pass the order's STORED value when re-pricing
   * an existing order, and nothing at all otherwise.
   */
  companyDevelopmentTips?: number;
  giftCardAmountUsed?: number;
  pointsRedeemedDiscount?: number;
  rewardBalanceUsed?: number;
  /**
   * Custom Pricing only (see {@link splitTaxInclusiveAmount}): the exact tax contained in the
   * tax-inclusive amount the admin typed, used verbatim so the total matches it to the cent.
   *
   * Honoured ONLY while no discount has reduced the subtotal. Once one does, the entered
   * total no longer describes what is owed, so tax reverts to the normal
   * `round2(discountedSubTotal × SALES_TAX_RATE)`.
   */
  taxOverride?: number | null;
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

  // The override is only meaningful against the subtotal it was split out of, so any
  // discount hands the tax back to the standard rate math.
  const useOverride =
    input.taxOverride != null && discountedSubTotal === round2(input.subTotal);

  const tax = useOverride ? round2(input.taxOverride!) : round2(discountedSubTotal * SALES_TAX_RATE);
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

/**
 * Default cleaner hourly rate for an order, matched on the EFFECTIVE service-type name
 * (i.e. the custom "Pre-Arranged" label when there is one) and, for residential, on whether
 * the deep-cleaning extra was picked:
 *   heavy condition / post construction → 25, move in/out → 21,
 *   residential deep / super-deep → 21, everything else → 20.
 * The rate is only a DEFAULT — admins can override it per order in the orders panel.
 * Mirrored by GetDefaultCleanerHourlyRate in OrderPricingCalculator.cs.
 */
export function getDefaultCleanerHourlyRate(
  deepCleaningFee: number,
  serviceTypeName?: string | null
): number {
  const name = normalizeServiceTypeName(serviceTypeName);

  if (name.includes('heavy') || name.includes('post construction')) {
    return HEAVY_DUTY_CLEANER_HOURLY_RATE;
  }

  if (name.includes('move')) {
    return DEEP_CLEANING_CLEANER_HOURLY_RATE;
  }

  return deepCleaningFee > 0 ? DEEP_CLEANING_CLEANER_HOURLY_RATE : REGULAR_CLEANER_HOURLY_RATE;
}

/** Lowercased, hyphen/underscore-flattened service-type name for keyword matching. */
function normalizeServiceTypeName(serviceTypeName?: string | null): string {
  return (serviceTypeName ?? '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Billable minutes ONE cleaner is paid for, snapped to DURATION_ROUNDING_MINUTES.
 * SINGLE source for both the payroll figure and the "· X per cleaner" label admins see —
 * they must never disagree. Mirrors OrderPricingCalculator.CalculatePerCleanerBillableMinutes.
 *
 * Only cleaner-hours service types store TotalDuration as per-cleaner; everything
 * else (including Custom Pricing) stores it as TOTAL across all maids and we divide.
 *
 * The split rounds DOWN, and that is the whole point. Rounding each share to the NEAREST
 * increment and then multiplying back by the cleaner count inflated payroll purely because
 * an admin raised the count: a 456-minute job paid 450 min (7h30) at 1 cleaner but
 * 2 × 240 min (2 × 4h) at 2 cleaners, +$10.50 for identical work. Flooring makes the paid
 * total a multiple of the increment that is always ≤ the raw total, so raising maidsCount
 * can never increase what we pay out.
 */
export function calculatePerCleanerBillableMinutes(
  totalDuration: number,
  maidsCount: number,
  hasCleanerService: boolean
): number {
  const maids = Math.max(1, maidsCount);

  // Already per-cleaner (cleaner-hours types), or nothing to split: keep the historical
  // nearest-increment behaviour so single-cleaner orders are untouched.
  if (hasCleanerService || maids === 1) {
    return Math.round(totalDuration / DURATION_ROUNDING_MINUTES) * DURATION_ROUNDING_MINUTES;
  }

  const floored =
    Math.floor(totalDuration / maids / DURATION_ROUNDING_MINUTES) * DURATION_ROUNDING_MINUTES;

  // Never floor a real job down to zero pay: with more cleaners than there are half-hours of
  // work (6 cleaners on a 1h job) the share floors to 0. Pay one increment instead. This is
  // the ONE case where the never-raises guarantee can be exceeded, and $0 payroll is worse.
  return totalDuration > 0 && floored <= 0 ? DURATION_ROUNDING_MINUTES : floored;
}

/**
 * Per-cleaner billable minutes / 60 × maids × rate. See calculatePerCleanerBillableMinutes
 * for why the split rounds down.
 */
export function calculateCleanerTotalSalary(
  totalDuration: number,
  maidsCount: number,
  hasCleanerService: boolean,
  hourlyRate: number
): number {
  const maids = Math.max(1, maidsCount);
  const perCleaner = calculatePerCleanerBillableMinutes(totalDuration, maidsCount, hasCleanerService);
  return round2((perCleaner / 60) * maids * hourlyRate);
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
    chargeAboveThreshold?: boolean;
    zeroQuantityCost?: number | null;
    zeroQuantityDuration?: number | null;
    rateTiers?: RateTierInput[];
    thresholds?: ThresholdInput[];
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
  serviceType:
    | { basePrice?: number | null; timeDuration?: number | null; minimumPrice?: number | null }
    | null
    | undefined,
  selectedServices: SelectedServiceLike[],
  selectedExtraServices: SelectedExtraServiceLike[]
): QuoteInput {
  return {
    basePrice: serviceType?.basePrice ?? 0,
    baseDuration: serviceType?.timeDuration ?? 0,
    minimumPrice: serviceType?.minimumPrice ?? 0,
    services: selectedServices.map(mapSelectedServiceInput),
    extraServices: mapSelectedExtraInputs(selectedExtraServices)
  };
}

/**
 * Maps one component selection to a calculator service input. Separate from
 * buildQuoteInputFromSelections so the per-item display helpers can price a line through
 * exactly the same shape the quote uses — that equivalence is what keeps the summary and
 * the per-service chips in agreement.
 */
export function mapSelectedServiceInput(s: SelectedServiceLike): ServiceLineInput {
  return {
    serviceId: s.service.id,
    cost: s.service.cost,
    timeDuration: s.service.timeDuration,
    serviceRelationType: s.service.serviceRelationType,
    serviceKey: s.service.serviceKey,
    quantity: s.quantity,
    chargeAboveThreshold: s.service.chargeAboveThreshold ?? false,
    zeroQuantityCost: s.service.zeroQuantityCost ?? null,
    zeroQuantityDuration: s.service.zeroQuantityDuration ?? null,
    rateTiers: s.service.rateTiers ?? [],
    thresholds: s.service.thresholds ?? []
  };
}

// ===== Quantity linkage (shared by booking + order edits) =====

/**
 * Default/minimum square-feet for a bedroom count.
 *
 * This is now the SAME data that drives billing: the Sq.ft service's ServiceThreshold rows
 * are both the free allowance and the slider minimum, so a customer can never sit below the
 * included amount and the default configuration always costs exactly 0 extra sqft.
 *
 * Pass the sqft service's `thresholds`. Lookup is the same FLOOR match the calculator uses.
 * The hardcoded switch survives ONLY as a fallback for when the catalog hasn't loaded yet
 * (first paint / prerender) — it mirrors the shipped seed values.
 */
export function getSquareFeetForBedrooms(
  bedrooms: number,
  thresholds?: ThresholdInput[] | null,
  sourceServiceId?: number | null
): number {
  // Restrict to the rows driven by the bedrooms service when the caller knows its id. A
  // service can in principle carry allowances from several sources, and mixing them here
  // would produce a minimum that doesn't correspond to any single one of them.
  const rows = (thresholds ?? []).filter(
    t => sourceServiceId == null || t.sourceServiceId === sourceServiceId
  );

  if (rows.length > 0) {
    const sorted = [...rows].sort((a, b) => a.sourceQuantity - b.sourceQuantity);
    let match = sorted[0];
    for (const row of sorted) {
      if (row.sourceQuantity <= bedrooms) match = row;
    }
    return match.includedQuantity;
  }

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

/**
 * Sq.ft to use after the bedroom count changed.
 *
 * The old behaviour reset Sq.ft to the new bedroom's included amount unconditionally, which
 * threw away a value the customer had deliberately chosen: 2 bedrooms at 2650 sq.ft became
 * 1000 the moment they picked a third bedroom.
 *
 * The rule distinguishes a value that was *chosen* from one that was merely *inherited*:
 *   - sitting exactly on the previous floor  → never explicitly chosen, so it keeps tracking
 *     the floor, in BOTH directions (4bd 1500 → 3bd gives 1000, not 1500).
 *   - anything above the previous floor      → a deliberate customer value; preserve it, and
 *     only raise it when the new floor overtakes it.
 *
 * Pass the floors resolved by the caller's own configured-threshold lookup (see
 * getSquareFeetForBedrooms) — this helper is pure arithmetic and never reads the catalog.
 *
 * NOTE: this is UI quantity linkage, not price math, so it has no C# mirror. The backend
 * takes the submitted Sq.ft as given; OrderPricingInputBuilder.GetSquareFeetForBedrooms is
 * only a fallback for a DTO with no Sq.ft line at all.
 */
export function resolveSquareFeetForBedroomChange(
  currentSquareFeet: number,
  oldMinSquareFeet: number,
  newMinSquareFeet: number
): number {
  const current = Number(currentSquareFeet) || 0;
  if (current === oldMinSquareFeet) return newMinSquareFeet;
  return Math.max(current, newMinSquareFeet);
}

/**
 * Sq.ft to use when RESTORING a stored value (session draft, reorder, saved order).
 *
 * Deliberately not the bedroom-change rule above: there is no "previous bedroom count" during
 * a restore, and the stored figure is by definition an explicit customer choice. So it is
 * floored and never lowered — the only thing this guards against is an allowance that grew
 * after the value was stored, which would otherwise leave the customer below their included
 * amount.
 */
export function clampRestoredSquareFeet(
  storedSquareFeet: number,
  minSquareFeet: number
): number {
  return Math.max(Number(storedSquareFeet) || 0, minSquareFeet);
}

/**
 * The Sq.ft values a customer may pick for a given bedroom minimum.
 *
 * A range input anchors its steps to `min`, so a 1-bedroom minimum of 650 with the
 * catalog step of 100 only ever produced 650 / 750 / 850… — round values like 700
 * or 900 were unreachable. The slider is therefore driven by an index into this
 * list instead of by a raw step: the bedroom minimum is the first entry, and every
 * entry after it is a plain multiple of the step, so a `…50` minimum is the only
 * off-round value that ever appears.
 *
 *   650 → 650, 700, 800, 900, 1000…
 *   850 → 850, 900, 1000, 1100…
 *   400 → 400, 500, 600…            (minimum already on the grid)
 */
export function getSquareFeetOptions(
  minSquareFeet: number,
  maxSquareFeet?: number | null,
  configuredStep?: number | null
): number[] {
  const step = Math.max(1, Math.round(configuredStep || 100));
  const min = Math.max(0, Math.round(minSquareFeet) || 0);
  const max = Math.max(min, Math.round(maxSquareFeet || 0) || min);

  const options = [min];
  // First multiple of the step strictly above the minimum (min + step when the
  // minimum already sits on the grid, so the first entry is never duplicated).
  let next = Math.floor(min / step) * step + step;
  while (next <= max) {
    options.push(next);
    next += step;
  }
  return options;
}

// ===== Per-item display helpers (shared by booking + order-edit templates) =====

/**
 * Prices ONE service line exactly as calculateQuote's services loop would, so a
 * per-service chip can never disagree with the summary. Both the zero-quantity rule and
 * the threshold/tier math live in one place; this just replays the same branches.
 *
 * `allSelected` supplies the threshold source quantities (e.g. bedrooms for sqft). Pass the
 * component's live selection array.
 */
function calculateServiceLineDisplay(
  service: SelectedServiceLike['service'],
  quantity: number,
  priceMultiplier: number,
  allSelected: SelectedServiceLike[]
): { cost: number; duration: number } {
  const line: SelectedServiceLike = { service, quantity };
  const input = mapSelectedServiceInput(line);

  if (input.serviceRelationType === 'cleaner' || input.serviceRelationType === 'hours') {
    // Cleaner-hours pairs are priced together in the quote; the chip shows the raw unit.
    return { cost: input.cost * priceMultiplier, duration: input.timeDuration };
  }

  if (quantity === 0 && (input.zeroQuantityCost != null || input.zeroQuantityDuration != null)) {
    return {
      cost: (input.zeroQuantityCost ?? 0) * priceMultiplier,
      duration: input.zeroQuantityDuration ?? 0
    };
  }

  if (input.serviceKey === 'bedrooms' && quantity === 0) {
    return { cost: STUDIO_PRICE * priceMultiplier, duration: STUDIO_DURATION };
  }

  // Warnings are irrelevant for a display chip — the quote already collected them.
  return calculateTieredLine(input, allSelected.map(mapSelectedServiceInput), priceMultiplier, []);
}

/** Display price for one service at a given quantity (zero-quantity + tier rules included). */
export function getServiceDisplayPrice(
  service: SelectedServiceLike['service'],
  quantity: number,
  priceMultiplier: number,
  allSelected: SelectedServiceLike[] = []
): number {
  return calculateServiceLineDisplay(service, quantity, priceMultiplier, allSelected).cost;
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
 * Display duration for one service.
 *
 * NOTE (bug B1, fixed 2026-07): this used to multiply by the cleaning-type multiplier while
 * the quote did not, so a Deep Cleaning booking showed chips that summed to more than the
 * summary's duration (2BR read 90m per the chip vs 60m in the quote). No duration anywhere
 * is multiplier-scaled now — Deep Cleaning contributes its own minutes through its
 * ExtraService row. The multiplier parameter is retained for signature symmetry with
 * getServiceDisplayPrice and is deliberately unused for duration.
 */
export function getServiceDisplayDuration(
  service: SelectedServiceLike['service'],
  quantity: number,
  _durationMultiplier: number,
  allSelected: SelectedServiceLike[] = []
): number {
  return calculateServiceLineDisplay(service, quantity, 1, allSelected).duration;
}
