import {
  EXTRA_SERVICE_KEYS,
  extraIs,
  isDeepOrSuperDeepExtra,
  isSuperDeepExtra,
  legacyCleaningSupplies,
  resetExtraServiceKeyWarningsForTests
} from './extra-service-keys';
import { buildSupplyChecklistItems, resolveSupplyChecklistFacts } from './supply-checklist.utils';
import { getExtraServiceImage, getExtraServiceTooltip } from './extra-service-display.utils';
import { findResidentialServiceType } from './service-type-keys';
import { getDefaultCleanerHourlyRate, isExtraCleaners } from '../pricing/order-pricing.calculator';

/**
 * EXTRAS ARE RECOGNISED BY KEY, NOT BY NAME (2026-10). Mirrors ExtraServiceKeyTests.cs: a keyed
 * extra is judged by its extraServiceKey whatever it is called; only an UNKEYED row falls back to
 * the old name rule (and says so once in the console).
 */
describe('extra service keys', () => {
  beforeEach(() => resetExtraServiceKeyWarningsForTests());

  it('decides by the key when there is one, never by the name', () => {
    expect(extraIs({ name: 'Our Products', extraServiceKey: 'cleaning-supplies' },
      EXTRA_SERVICE_KEYS.cleaningSupplies, legacyCleaningSupplies)).toBe(true);
    expect(extraIs({ name: 'Cleaning Supplies', extraServiceKey: 'closets' },
      EXTRA_SERVICE_KEYS.cleaningSupplies, legacyCleaningSupplies)).toBe(false);
  });

  it('falls back to the name for an unkeyed row, and warns once per name', () => {
    const warn = vi.spyOn(console, 'warn').mockReturnValue(undefined);
    const unkeyed = { name: 'Cleaning Supplies', extraServiceKey: null };
    expect(extraIs(unkeyed, EXTRA_SERVICE_KEYS.cleaningSupplies, legacyCleaningSupplies)).toBe(true);
    expect(extraIs(unkeyed, EXTRA_SERVICE_KEYS.cleaningSupplies, legacyCleaningSupplies)).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('keeps Extra Cleaners working through a rename', () => {
    expect(isExtraCleaners({ name: 'More People', extraServiceKey: 'extra-cleaners', hasQuantity: true })).toBe(true);
    expect(isExtraCleaners({ name: 'Extra Cleaners', extraServiceKey: 'pets', hasQuantity: true })).toBe(false);
    // Unkeyed: the calculator's exact, case-sensitive rule, as before.
    vi.spyOn(console, 'warn').mockReturnValue(undefined);
    expect(isExtraCleaners({ name: 'Extra Cleaners', hasQuantity: true })).toBe(true);
    expect(isExtraCleaners({ name: 'extra cleaners', hasQuantity: true })).toBe(false);
  });

  it('drives the customer checklist from keys', () => {
    const facts = resolveSupplyChecklistFacts([
      { name: 'Eco Products Kit', extraServiceKey: 'cleaning-supplies' },
      { name: 'Paper & Bags', extraServiceKey: 'cleaning-essentials' },
      { name: 'Hoover', extraServiceKey: 'vacuum-cleaner' },
      { name: 'Range Interior', extraServiceKey: 'oven' }
    ], false);
    expect(facts).toEqual({
      hasCleaningSupplies: true,
      hasCleaningEssentials: true,
      weBringVacuum: true,
      requiresOvenCleaner: true,
      isCustomServiceType: false
    });
    expect(buildSupplyChecklistItems(facts)).toEqual([]);
  });

  it('reads Deep / Super Deep from the flags on an order line', () => {
    const deep = { extraServiceName: 'Thorough clean', extraServiceKey: 'deep-cleaning', isDeepCleaning: true };
    const superDeep = { extraServiceName: 'Top to bottom', extraServiceKey: 'super-deep', isSuperDeepCleaning: true };
    expect(isDeepOrSuperDeepExtra(deep)).toBe(true);
    expect(isSuperDeepExtra(deep)).toBe(false);
    expect(isSuperDeepExtra(superDeep)).toBe(true);
    // A keyed, un-flagged row named like deep cleaning is not deep.
    expect(isDeepOrSuperDeepExtra({ extraServiceName: 'Deep Cleaning of Ovens', extraServiceKey: 'oven' })).toBe(false);
  });

  it('keeps a renamed keyed extra\'s icon and tooltip', () => {
    expect(getExtraServiceImage({ name: 'Renamed', extraServiceKey: 'cleaning-supplies' }, true))
      .toBe('/images/cleaning_supplies.png');
    expect(getExtraServiceImage({ name: 'Renamed', extraServiceKey: 'home-office' }, false))
      .toBe('/images/office_disabled.png');
    expect(getExtraServiceTooltip({ name: 'More People', extraServiceKey: 'extra-cleaners', description: 'D' }))
      .toContain('Each extra cleaner reduces service duration.');
  });

  it('finds the default (residential) service type by its key first', () => {
    const types = [
      { id: 1, name: 'Residential Cleaning (old)', serviceKey: 'office' },
      { id: 2, name: 'Home Care', serviceKey: 'residential' }
    ];
    expect(findResidentialServiceType(types)?.id).toBe(2);
    expect(findResidentialServiceType([{ id: 3, name: 'Residential Cleaning', serviceKey: null }])?.id).toBe(3);
  });

  it('rates cleaners by the service-type key when one is given', () => {
    expect(getDefaultCleanerHourlyRate(0, 'Filthy Move Deep', 'office')).toBe(20);
    expect(getDefaultCleanerHourlyRate(0, 'Regular', 'filthy')).toBe(28);
    expect(getDefaultCleanerHourlyRate(0, 'Regular', 'post-construction')).toBe(25);
    expect(getDefaultCleanerHourlyRate(1, 'Regular', 'residential')).toBe(21);
    // No key: the name rules, unchanged.
    expect(getDefaultCleanerHourlyRate(0, 'Filthy Cleaning')).toBe(28);
  });
});
