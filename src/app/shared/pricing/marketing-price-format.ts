/**
 * The marketing-price SHAPE and its wording helpers - everything a page needs to show prices it
 * already has. Deliberately free of the booking calculator: the browser receives resolved prices
 * from the server (TransferState) and never prices anything itself, so this module is what the
 * initial bundle carries. The derivation lives in marketing-prices.ts (server, specs, and the rare
 * browser fallback, which loads it on demand).
 */
import { DisplayPriceUnit } from './display-price';

/** An admin-entered display price (ServiceType.DisplayPrice), for a type the calculator can't price. */
export interface MarketingDisplayPrice {
  amount: number;
  unit: DisplayPriceUnit;
}

/** Every resolved price. null = unresolved: that fragment is left out wherever it would appear. */
export interface MarketingPrices {
  /** Lowest standard residential quote (minimum home, no extras). */
  standardFrom: number | null;
  /** The same quote with the residential type's deep-cleaning extra selected. */
  deepFrom: number | null;
  /** Lowest move in/out quote (minimum home, no extras). */
  moveInOutFrom: number | null;
  /** Per cleaner, per hour: the cost of the type's one "cleaner" service. */
  customPerHour: number | null;
  heavyPerHour: number | null;
  officePerHour: number | null;
  postConstructionPerHour: number | null;
  /** Filthy Cleaning is inspected and priced by hand; this is its admin-entered display price. */
  filthy: MarketingDisplayPrice | null;
  /** The "Cleaning Supplies" / "Vacuum Cleaner" extras the FAQ quotes (see extraPriceByKey in marketing-prices.ts). */
  suppliesExtra: number | null;
  vacuumExtra: number | null;
}

export const NO_MARKETING_PRICES: MarketingPrices = Object.freeze({
  standardFrom: null,
  deepFrom: null,
  moveInOutFrom: null,
  customPerHour: null,
  heavyPerHour: null,
  officePerHour: null,
  postConstructionPerHour: null,
  filthy: null,
  suppliesExtra: null,
  vacuumExtra: null
});

/** True when at least one price resolved. */
export function hasAnyMarketingPrice(prices: MarketingPrices | null | undefined): boolean {
  return !!prices && Object.values(prices).some(v => v !== null);
}

/** "$130", "$112.50". */
export function formatMarketingMoney(value: number): string {
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

/** Wording for a display price: "$100 per hour per cleaner", "from $100". */
export function formatDisplayPrice(price: MarketingDisplayPrice): string {
  const money = formatMarketingMoney(price.amount);
  switch (price.unit) {
    case 'per-hour-per-cleaner': return `${money} per hour per cleaner`;
    case 'per-hour': return `${money} per hour`;
    case 'from': return `from ${money}`;
  }
}

/**
 * "standard cleaning starts from $130, deep cleaning from $220, and move in/out cleaning from $245"
 * from [label, price] pairs, leaving out the unresolved ones; null when none resolved, so the
 * caller drops the whole sentence. `lead` is the verb used for the first item only.
 */
export function listStartingPrices(items: [label: string, price: string | null][], lead = 'starts from'): string | null {
  const phrases = items
    .filter((item): item is [string, string] => item[1] !== null)
    .map(([label, price], i) => `${label} ${i === 0 ? lead : 'from'} ${price}`);
  return phrases.length ? joinWithAnd(phrases) : null;
}

/** "a", "a and b", "a, b, and c". */
export function joinWithAnd(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

/** `before + price + after` when the price resolved, '' otherwise - for copy built in TypeScript. */
export function priceFragment(price: string | null, before: string, after = ''): string {
  return price === null ? '' : `${before}${price}${after}`;
}

/**
 * A schema.org starting-price offer to spread into a Service: `{ offers: AggregateOffer }`, or
 * nothing when the price did not resolve (an offer is never published without a real price). No
 * highPrice: a "highest" price depends on the home and is not something the catalogue states.
 */
export function startingPriceOffer(price: number | null): { offers?: Record<string, string> } {
  return price === null
    ? {}
    : { offers: { '@type': 'AggregateOffer', 'lowPrice': String(price), 'priceCurrency': 'USD' } };
}
