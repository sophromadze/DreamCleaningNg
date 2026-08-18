import { calculateQuote, ExtraServiceLineInput, QuoteInput } from './order-pricing.calculator';

/**
 * EXTRAS ON A CUSTOM-PRICED ("Pre-Arranged") ORDER ARE INFORMATIONAL.
 *
 * The admin types the total amount, the cleaner count and the per-cleaner duration; those three
 * numbers ARE the quote. Extras are still selectable on that service type — that is how the admin
 * panel and the cleaner's job email learn the fridge and the windows are part of the job — so they
 * must be recorded on the order while contributing exactly $0 and 0 minutes.
 *
 * Mirror of CustomPricingGuardTests.CustomPricing_Extras_ArePersistedButCostNothingAndAddNoTime.
 * Both a quantity extra and an hours extra are exercised, because the ordinary branch prices those
 * as price × quantity and price × hours — either one leaking through would move the total.
 */
describe('calculateQuote — custom pricing with extras', () => {
  const windows: ExtraServiceLineInput = {
    extraServiceId: 10,
    price: 12,
    duration: 20,
    priceMultiplier: 1,
    isDeepCleaning: false,
    isSuperDeepCleaning: false,
    isSameDayService: false,
    hasHours: false,
    hasQuantity: true,
    name: 'Windows',
    quantity: 5,
    hours: 0
  };

  const organizing: ExtraServiceLineInput = {
    extraServiceId: 11,
    price: 30,
    duration: 60,
    priceMultiplier: 1,
    isDeepCleaning: false,
    isSuperDeepCleaning: false,
    isSameDayService: false,
    hasHours: true,
    hasQuantity: false,
    name: 'Folding / Organizing',
    quantity: 1,
    hours: 2
  };

  const input = (extras: ExtraServiceLineInput[]): QuoteInput => ({
    basePrice: 0,
    baseDuration: 60,
    services: [],
    extraServices: extras,
    isCustomPricing: true,
    customAmount: 300,
    customCleaners: 2,
    customDuration: 240
  });

  it('leaves the entered amount untouched', () => {
    const quote = calculateQuote(input([windows, organizing]));

    // The typed amount is tax-inclusive: subtotal + tax add back to it exactly.
    expect(quote.subTotal + quote.taxOverride!).toBe(300);
    expect(quote.subTotal).toBe(calculateQuote(input([])).subTotal);
  });

  it('leaves the entered duration untouched', () => {
    const quote = calculateQuote(input([windows, organizing]));

    // 2 cleaners × 240 min — not 480 + 5×20 + 2×60.
    expect(quote.totalDuration).toBe(480);
    expect(quote.displayDuration).toBe(240);
  });

  it('records every extra at zero cost and zero duration, keeping quantity and hours', () => {
    const quote = calculateQuote(input([windows, organizing]));

    expect(quote.extraServiceLines.length).toBe(2);
    quote.extraServiceLines.forEach(line => {
      expect(line.cost).toBe(0);
      expect(line.duration).toBe(0);
    });

    expect(quote.extraServiceLines.find(l => l.extraServiceId === 10)!.quantity).toBe(5);
    expect(quote.extraServiceLines.find(l => l.extraServiceId === 11)!.hours).toBe(2);
  });

  it('ignores a deep-cleaning extra rather than applying its multiplier', () => {
    const deep: ExtraServiceLineInput = {
      ...windows,
      extraServiceId: 12,
      price: 60,
      priceMultiplier: 1.5,
      isDeepCleaning: true,
      hasQuantity: false,
      quantity: 1,
      name: 'Deep Cleaning'
    };

    const quote = calculateQuote(input([deep]));

    expect(quote.priceMultiplier).toBe(1);
    expect(quote.deepCleaningFee).toBe(0);
    expect(quote.subTotal + quote.taxOverride!).toBe(300);
    expect(quote.extraServiceLines[0].cost).toBe(0);
  });
});
