import {
  ExtraServiceLineInput,
  QuoteInput,
  ServiceLineInput,
  calculateQuote,
  getExtraServiceDisplayPrice,
  getServiceDisplayDuration,
  resolvePriceMultiplier,
  resolveTimeMultiplier,
  scaleHomeMinutes
} from './order-pricing.calculator';

/**
 * What the Deep / Super Deep multipliers apply to (2026-10): the base service only (service-type
 * base price / duration + home lines). Extras keep their own price and minutes; the deep extra's
 * own fee and minutes are added once, flat. Mirrors DeepCleaningMultiplierScopeTests.cs case for
 * case - the numbers must stay identical on both sides, or the server re-prices the booking.
 */
describe('deep cleaning multiplier scope', () => {
  const BEDROOMS_ID = 1;
  const BATHROOMS_ID = 2;

  const service = (id: number, cost: number, minutes: number, key: string, quantity: number,
                   zeroQuantityCost: number | null = null, zeroQuantityDuration: number | null = null): ServiceLineInput => ({
    serviceId: id, cost, timeDuration: minutes, serviceKey: key, quantity, zeroQuantityCost, zeroQuantityDuration
  });

  const extra = (o: Partial<ExtraServiceLineInput>): ExtraServiceLineInput => ({
    extraServiceId: 0, price: 0, duration: 0, priceMultiplier: 1, timeMultiplier: 1,
    isDeepCleaning: false, isSuperDeepCleaning: false, isSameDayService: false,
    hasHours: false, hasQuantity: false, quantity: 1, hours: 0, ...o
  });

  const deep = (timeMultiplier = 1) => extra({
    extraServiceId: 1, name: 'Deep Cleaning', price: 50, duration: 60, priceMultiplier: 1.5, timeMultiplier, isDeepCleaning: true
  });
  const superDeep = () => extra({
    extraServiceId: 2, name: 'Super Deep Cleaning', price: 100, duration: 120, priceMultiplier: 2, timeMultiplier: 1.5, isSuperDeepCleaning: true
  });
  const windows = (count: number) => extra({ extraServiceId: 4, name: 'Window Cleaning', price: 15, duration: 20, hasQuantity: true, quantity: count });
  const organizing = (hours: number) => extra({ extraServiceId: 6, name: 'Organizing Service', price: 30, duration: 60, hasHours: true, hours });
  const sameDay = () => extra({ extraServiceId: 3, name: 'Same Day Service', price: 75, duration: 0, isSameDayService: true });

  /** Two bedrooms, one bathroom: home = 120 + 50 + 35 = $205.00 and 90 + 60 + 45 = 195 min. */
  const home = (...extras: ExtraServiceLineInput[]): QuoteInput => ({
    basePrice: 120,
    baseDuration: 90,
    services: [service(BEDROOMS_ID, 25, 30, 'bedrooms', 2), service(BATHROOMS_ID, 35, 45, 'bathrooms', 1)],
    extraServices: extras
  });

  it('regular: extras are added at their own price and time', () => {
    const quote = calculateQuote(home(windows(3)));
    expect(quote.subTotal).toBe(250);
    expect(quote.totalDuration).toBe(255);
    expect(quote.timeMultiplier).toBe(1);
  });

  it('deep without extras is exactly the old price', () => {
    const quote = calculateQuote(home(deep()));
    expect(quote.subTotal).toBe(357.5);
    expect(quote.totalDuration).toBe(255);
  });

  it('deep does not multiply extras', () => {
    const quote = calculateQuote(home(deep(), windows(3)));
    expect(quote.subTotal).toBe(402.5);
    expect(quote.extraServiceLines.find(l => l.extraServiceId === 4)!.cost).toBe(45);
    expect(quote.totalDuration).toBe(315);
  });

  it('deep: hourly and same-day extras keep their own price', () => {
    const quote = calculateQuote(home(deep(), organizing(2), sameDay()));
    expect(quote.extraServiceLines.find(l => l.extraServiceId === 6)!.cost).toBe(60);
    expect(quote.extraServiceLines.find(l => l.extraServiceId === 3)!.cost).toBe(75);
    expect(quote.subTotal).toBe(307.5 + 60 + 75 + 50);
    expect(quote.totalDuration).toBe(195 + 120 + 0 + 60);
  });

  it('the time multiplier scales the home minutes only, rounded per line', () => {
    const quote = calculateQuote(home(deep(1.25), windows(3)));
    expect(quote.serviceLines.find(l => l.serviceId === BEDROOMS_ID)!.duration).toBe(75);
    expect(quote.serviceLines.find(l => l.serviceId === BATHROOMS_ID)!.duration).toBe(56);
    expect(quote.extraServiceLines.find(l => l.extraServiceId === 4)!.duration).toBe(60);
    expect(quote.totalDuration).toBe(113 + 75 + 56 + 60 + 60);
    expect(quote.timeMultiplier).toBe(1.25);
    expect(quote.subTotal).toBe(402.5);
  });

  it('super deep uses its own multipliers and never multiplies extras', () => {
    const quote = calculateQuote(home(superDeep(), windows(3)));
    expect(quote.subTotal).toBe(555);
    expect(quote.totalDuration).toBe(135 + 90 + 68 + 60 + 120);
  });

  it('super deep wins over deep for both multipliers', () => {
    const extras = [deep(1.25), superDeep()];
    expect(resolvePriceMultiplier(extras).multiplier).toBe(2);
    expect(resolveTimeMultiplier(extras)).toBe(1.5);
  });

  it('studio zero-quantity minutes are a home line', () => {
    const input = home(deep(1.5));
    input.services[0] = service(BEDROOMS_ID, 25, 30, 'bedrooms', 0, 20, 20);
    const studio = calculateQuote(input).serviceLines.find(l => l.serviceId === BEDROOMS_ID)!;
    expect(studio.cost).toBe(30);
    expect(studio.duration).toBe(30);
  });

  it('cleaner hours are the customer\'s choice and never time-multiplied', () => {
    const quote = calculateQuote({
      basePrice: 0,
      baseDuration: 0,
      services: [
        { serviceId: 7, cost: 40, timeDuration: 0, serviceRelationType: 'cleaner', serviceKey: 'cleaners', quantity: 2 },
        { serviceId: 8, cost: 0, timeDuration: 0, serviceRelationType: 'hours', serviceKey: 'hours', quantity: 3 }
      ],
      extraServices: [deep(1.5)]
    });
    expect(quote.subTotal).toBe(40 * 1.5 * 2 * 3 + 50);
    expect(quote.displayDuration).toBe(180);
    expect(quote.totalDuration).toBe(180);
  });

  it('rounds scaled minutes half up, and never touches them at 1.0', () => {
    expect(scaleHomeMinutes(112.5, 1)).toBe(112.5);
    expect(scaleHomeMinutes(90, 1.25)).toBe(113);
    expect(scaleHomeMinutes(45, 1.25)).toBe(56);
    expect(scaleHomeMinutes(45, 1.3)).toBe(59);
  });

  it('the per-item chips agree with the quote', () => {
    // Extra price chip: catalogue price x quantity / hours, no multiplier argument at all.
    expect(getExtraServiceDisplayPrice({ price: 15, hasHours: false, hasQuantity: true }, 3, 0)).toBe(45);
    expect(getExtraServiceDisplayPrice({ price: 30, hasHours: true, hasQuantity: false }, 1, 2)).toBe(60);

    // Duration chip under the time multiplier equals the quote's line minutes.
    const bedrooms = { id: BEDROOMS_ID, cost: 25, timeDuration: 30, serviceKey: 'bedrooms' };
    const quote = calculateQuote(home(deep(1.25)));
    expect(getServiceDisplayDuration(bedrooms, 2, resolveTimeMultiplier([deep(1.25)])))
      .toBe(quote.serviceLines.find(l => l.serviceId === BEDROOMS_ID)!.duration);
  });
});
