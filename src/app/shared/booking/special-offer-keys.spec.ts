import {
  FIRST_TIME_OFFER_KEY,
  findAdvertisedFirstTimeOffer,
  findFirstTimeOffer,
  isFirstTimeOffer,
  resetSpecialOfferKeyWarningsForTests
} from './special-offer-keys';

/** GET api/special-offers/public (production, 2026-10-04) with the migration's key. */
const productionOffer = (overrides: any = {}) => ({
  id: 1, name: 'First Time Customer', description: 'Get 10% off on your first order!',
  isPercentage: true, discountValue: 10, type: 'Custom', icon: '', badgeColor: '#28a745',
  minimumOrderAmount: null, requiresFirstTimeCustomer: true, offerKey: FIRST_TIME_OFFER_KEY,
  ...overrides
});

describe('special offer keys', () => {
  beforeEach(() => resetSpecialOfferKeyWarningsForTests());

  it('advertises the keyed offer, renamed or not', () => {
    expect(findAdvertisedFirstTimeOffer([productionOffer()])?.discountValue).toBe(10);
    expect(findAdvertisedFirstTimeOffer([productionOffer({ name: 'New Client Deal' })])?.discountValue).toBe(10);
  });

  it('advertises nothing rather than guess when no offer carries the key', () => {
    expect(findAdvertisedFirstTimeOffer([productionOffer({ offerKey: null })])).toBeUndefined();
    expect(findAdvertisedFirstTimeOffer([])).toBeUndefined();
    expect(findAdvertisedFirstTimeOffer(null)).toBeUndefined();
  });

  it('never takes a keyed offer for the first-time one by its name, type or flag', () => {
    const sale = productionOffer({ id: 2, name: 'First Time Spring Sale', type: 'FirstTime', offerKey: 'spring-sale', discountValue: 25 });
    expect(isFirstTimeOffer(sale)).toBe(false);
    expect(findFirstTimeOffer([sale, productionOffer()])?.id).toBe(1);
    expect(findAdvertisedFirstTimeOffer([sale, productionOffer()])?.id).toBe(1);
  });

  it('judges an unkeyed offer by the old rule in booking, and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockReturnValue(undefined);
    const unkeyed = productionOffer({ offerKey: null });

    expect(isFirstTimeOffer(unkeyed)).toBe(true);
    expect(isFirstTimeOffer(unkeyed)).toBe(true);
    expect(findFirstTimeOffer([unkeyed])?.id).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);

    // A call site's own legacy rule (booking's "first time" in the name) is honoured.
    expect(isFirstTimeOffer(productionOffer({ offerKey: '', name: 'Welcome', requiresFirstTimeCustomer: true }),
      (_, lower) => lower.includes('first time'))).toBe(false);
  });

  it('trims a key before comparing it', () => {
    expect(isFirstTimeOffer(productionOffer({ offerKey: ' first-time ' }))).toBe(true);
  });
});
