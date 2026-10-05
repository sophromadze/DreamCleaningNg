/**
 * ServiceType.DisplayPrice / DisplayPriceUnit - the marketing-only price for a service type the
 * booking calculator cannot price (today Filthy Cleaning: inspected first, priced by hand).
 * Never part of a quote. Mirrors Helpers/ServiceTypeDisplayPricePolicy.cs: change both together.
 */
export type DisplayPriceUnit = 'per-hour-per-cleaner' | 'per-hour' | 'from';

export const DISPLAY_PRICE_UNITS: readonly { value: DisplayPriceUnit; label: string }[] = [
  { value: 'per-hour-per-cleaner', label: 'per hour per cleaner' },
  { value: 'per-hour', label: 'per hour' },
  { value: 'from', label: 'from (starting price)' }
];

export function isDisplayPriceUnit(value: unknown): value is DisplayPriceUnit {
  return DISPLAY_PRICE_UNITS.some(u => u.value === value);
}
