/**
 * Marketing prices - every price the public pages, route meta descriptions, JSON-LD and /llms.txt
 * state - derived from the SAME public catalogue the booking page prices with
 * (GET api/booking/service-types), so a price changed in Admin > Services reaches the site within
 * the server's catalogue TTL (server.ts). There are no hard-coded fallbacks: a price that does not
 * resolve is null, and every surface drops that fragment or uses neutral wording instead.
 *
 * Pure TypeScript (no Angular), because server.ts imports it for /llms.txt as well.
 *
 * Service types are recognised ONLY by ServiceType.ServiceKey (MARKETING_SERVICE_KEYS), and the two
 * extras the FAQ prices ONLY by ExtraService.extraServiceKey (MARKETING_EXTRA_KEYS) - never by Id or
 * name, which differ between the local and production databases and can be renamed in admin. Custom (admin-only,
 * "Pre-arranged") types are never read: the public endpoint returns them for the admin booking
 * flow, and the booking page hides them client-side, so this file does the same.
 */
import {
  calculateQuote,
  ExtraServiceLineInput,
  QuoteInput,
  round2,
  ServiceLineInput
} from './order-pricing.calculator';
import { isLevelsService, MIN_LEVELS } from '../booking/property-type.utils';
import { isDisplayPriceUnit } from './display-price';
import { MarketingPrices, NO_MARKETING_PRICES } from './marketing-price-format';

// The shape and wording helpers, re-exported for server-side callers and specs. Browser code imports
// them from marketing-price-format.ts directly, so the calculator stays out of the initial bundle.
export * from './marketing-price-format';

/** ServiceType.ServiceKey values the marketing copy reads. Set by hand in Admin > Services > Service Types. */
export const MARKETING_SERVICE_KEYS = {
  residential: 'residential',
  moveInOut: 'move-in-out',
  heavyCondition: 'heavy-condition',
  custom: 'custom',
  filthy: 'filthy',
  office: 'office',
  postConstruction: 'post-construction'
} as const;

/**
 * ExtraService.extraServiceKey values the marketing copy reads (the FAQ's supplies and vacuum
 * prices). Unlike the booking surfaces there is NO name fallback here: a missing key drops the
 * price and logs a problem, because a wrong public price is worse than none.
 */
export const MARKETING_EXTRA_KEYS = {
  cleaningSupplies: 'cleaning-supplies',
  vacuumCleaner: 'vacuum-cleaner'
} as const;


export interface MarketingPricesResult {
  prices: MarketingPrices;
  /** Why a price did not resolve, for a server-side warning. Empty when everything resolved. */
  problems: string[];
}

/** The catalogue fields read here. Everything is optional on purpose: it arrives as raw JSON. */
interface CatalogueService {
  id?: number;
  cost?: number | null;
  timeDuration?: number | null;
  serviceKey?: string | null;
  serviceRelationType?: string | null;
  minValue?: number | null;
  isActive?: boolean | null;
  displayOrder?: number | null;
  chargeAboveThreshold?: boolean | null;
  zeroQuantityCost?: number | null;
  zeroQuantityDuration?: number | null;
  rateTiers?: ServiceLineInput['rateTiers'] | null;
  thresholds?: ServiceLineInput['thresholds'] | null;
}

interface CatalogueExtra {
  id?: number;
  name?: string | null;
  extraServiceKey?: string | null;
  price?: number | null;
  duration?: number | null;
  priceMultiplier?: number | null;
  isDeepCleaning?: boolean | null;
  isAvailableForAll?: boolean | null;
  isActive?: boolean | null;
}

interface CatalogueServiceType {
  serviceKey?: string | null;
  basePrice?: number | null;
  timeDuration?: number | null;
  minimumPrice?: number | null;
  isActive?: boolean | null;
  isCustom?: boolean | null;
  displayPrice?: number | null;
  displayPriceUnit?: string | null;
  services?: CatalogueService[] | null;
  extraServices?: CatalogueExtra[] | null;
}

function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function isActive(row: { isActive?: boolean | null } | null | undefined): boolean {
  return !!row && row.isActive !== false;
}

/** The public types marketing may read: active, and never a custom (admin-only) type. */
export function publicMarketingServiceTypes(catalogue: unknown): CatalogueServiceType[] {
  if (!Array.isArray(catalogue)) return [];
  return (catalogue as CatalogueServiceType[]).filter(t => isActive(t) && t.isCustom !== true);
}

function cleanerServices(type: CatalogueServiceType): CatalogueService[] {
  return (type.services ?? []).filter(s => isActive(s) && s.serviceRelationType === 'cleaner');
}

/**
 * The lowest quote the booking calculator produces for a flat-rate type: every active service at
 * its minimum (studio, the minimum bathrooms and sq.ft, one level), no extras - exactly what the
 * home hero's "from" price uses - plus the deep-cleaning extra when `deep` is set. Includes the
 * type's MinimumPrice floor, and the deep fee on top of it, through calculateQuote itself.
 */
function lowestFlatQuote(type: CatalogueServiceType, deep: boolean, problems: string[], key: string): number | null {
  if (cleanerServices(type).length > 0) {
    problems.push(`"${key}" is an hourly (cleaner) service type, so it has no flat "from" price.`);
    return null;
  }

  const services: ServiceLineInput[] = [...(type.services ?? [])]
    .filter(isActive)
    .sort((a, b) => (a.displayOrder || 999) - (b.displayOrder || 999))
    .map(s => ({
      serviceId: s.id,
      cost: s.cost ?? 0,
      timeDuration: s.timeDuration ?? 0,
      serviceRelationType: s.serviceRelationType,
      serviceKey: s.serviceKey,
      quantity: s.serviceKey === 'bedrooms' ? 0 : isLevelsService(s) ? MIN_LEVELS : (s.minValue ?? 1),
      chargeAboveThreshold: s.chargeAboveThreshold ?? false,
      zeroQuantityCost: s.zeroQuantityCost ?? null,
      zeroQuantityDuration: s.zeroQuantityDuration ?? null,
      rateTiers: s.rateTiers ?? [],
      thresholds: s.thresholds ?? []
    }));

  const extraServices: ExtraServiceLineInput[] = [];
  if (deep) {
    const deepExtras = (type.extraServices ?? []).filter(e => isActive(e) && e.isDeepCleaning === true);
    if (deepExtras.length !== 1) {
      problems.push(`"${key}" has ${deepExtras.length} active deep-cleaning extras (expected 1), so the deep price is left out.`);
      return null;
    }
    const e = deepExtras[0];
    extraServices.push({
      extraServiceId: e.id,
      price: e.price ?? 0,
      duration: e.duration ?? 0,
      priceMultiplier: e.priceMultiplier || 1,
      isDeepCleaning: true,
      isSuperDeepCleaning: false,
      isSameDayService: false,
      hasHours: false,
      hasQuantity: false,
      name: e.name,
      quantity: 0,
      hours: 0
    });
  }

  const input: QuoteInput = {
    basePrice: type.basePrice ?? 0,
    baseDuration: type.timeDuration ?? 0,
    minimumPrice: type.minimumPrice ?? 0,
    services,
    extraServices
  };
  return positive(round2(calculateQuote(input).subTotal));
}

/**
 * An extra's price by its key. The same extra appears under every public type that offers it
 * (and per-type copies share the key), so the universal row wins, then the first copy - and if
 * the active copies disagree on the price, none is stated rather than picking one.
 */
function extraPriceByKey(types: CatalogueServiceType[], key: string, problems: string[]): number | null {
  const matches = types
    .flatMap(t => t.extraServices ?? [])
    .filter(e => isActive(e) && (e.extraServiceKey ?? '').trim() === key);
  if (matches.length === 0) {
    problems.push(`No active public extra service has extraServiceKey "${key}".`);
    return null;
  }
  const universal = matches.find(e => e.isAvailableForAll === true);
  if (!universal && new Set(matches.map(e => e.price)).size > 1) {
    problems.push(`Extra services keyed "${key}" have different prices per service type, so no single price is stated.`);
    return null;
  }
  return positive((universal ?? matches[0]).price);
}

/**
 * Maps the public catalogue to every marketing price. Never throws; anything that does not resolve
 * cleanly (key not set yet, two types holding one key, no single cleaner service, the backend
 * unreachable or gated) leaves that price null and records why in `problems`.
 */
export function extractMarketingPrices(catalogue: unknown): MarketingPricesResult {
  const problems: string[] = [];
  if (!Array.isArray(catalogue)) {
    return { prices: { ...NO_MARKETING_PRICES }, problems: ['The service catalogue is unavailable.'] };
  }
  const types = publicMarketingServiceTypes(catalogue);

  const byKey = (key: string): CatalogueServiceType | null => {
    const matches = types.filter(t => t.serviceKey === key);
    if (matches.length === 1) return matches[0];
    problems.push(matches.length === 0
      ? `No public service type has ServiceKey "${key}".`
      : `${matches.length} public service types share ServiceKey "${key}".`);
    return null;
  };

  const hourly = (key: string): number | null => {
    const type = byKey(key);
    if (!type) return null;
    const cleaners = cleanerServices(type);
    if (cleaners.length !== 1) {
      problems.push(`"${key}" has ${cleaners.length} active cleaner services (expected 1), so its hourly rate is left out.`);
      return null;
    }
    return positive(cleaners[0].cost);
  };

  const residential = byKey(MARKETING_SERVICE_KEYS.residential);
  const moveInOut = byKey(MARKETING_SERVICE_KEYS.moveInOut);
  const filthyType = byKey(MARKETING_SERVICE_KEYS.filthy);

  // Display price: only when amount and unit are both valid. Empty is a legitimate state (the
  // pages then say "priced after assessment"), so it is not reported as a problem.
  const filthyAmount = positive(filthyType?.displayPrice);
  const filthyUnit = filthyType?.displayPriceUnit;
  const filthy = filthyAmount !== null && isDisplayPriceUnit(filthyUnit)
    ? { amount: filthyAmount, unit: filthyUnit }
    : null;

  return {
    prices: {
      standardFrom: residential ? lowestFlatQuote(residential, false, problems, MARKETING_SERVICE_KEYS.residential) : null,
      deepFrom: residential ? lowestFlatQuote(residential, true, problems, MARKETING_SERVICE_KEYS.residential) : null,
      moveInOutFrom: moveInOut ? lowestFlatQuote(moveInOut, false, problems, MARKETING_SERVICE_KEYS.moveInOut) : null,
      customPerHour: hourly(MARKETING_SERVICE_KEYS.custom),
      heavyPerHour: hourly(MARKETING_SERVICE_KEYS.heavyCondition),
      officePerHour: hourly(MARKETING_SERVICE_KEYS.office),
      postConstructionPerHour: hourly(MARKETING_SERVICE_KEYS.postConstruction),
      filthy,
      suppliesExtra: extraPriceByKey(types, MARKETING_EXTRA_KEYS.cleaningSupplies, problems),
      vacuumExtra: extraPriceByKey(types, MARKETING_EXTRA_KEYS.vacuumCleaner, problems)
    },
    problems
  };
}
