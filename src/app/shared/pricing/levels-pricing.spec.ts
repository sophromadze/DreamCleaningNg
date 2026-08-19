import { Service } from '../../services/booking.service';
import {
  ServiceLineInput,
  calculateQuote,
  getServiceDisplayDuration,
  getServiceDisplayPrice,
  resolveIncludedQuantity,
  STUDIO_PRICE
} from './order-pricing.calculator';

/**
 * The "Levels" service: stair pricing for a house. EXACT MIRROR of
 * DreamCleaningBackend.Tests/LevelsPricingTests.cs - same cases, same numbers, same names.
 *
 * The model is DATA, not a calculator special case. Levels is an ordinary service row with
 * chargeAboveThreshold and ONE self-referencing threshold row (sourceServiceId = the levels
 * service itself, sourceQuantity 1, includedQuantity 1). The existing threshold machinery then
 * produces billable = max(0, levels - 1) with no new branch anywhere in calculateQuote.
 *
 * These tests pin the CONTRACT that data relies on, so a future refactor of the threshold
 * resolver cannot quietly change what a three-level house costs.
 */
describe('levels pricing', () => {
  const BED_ID = 10;
  const BATH_ID = 20;
  const SQFT_ID = 30;

  // Deliberately NOT a seeded id: the levels service is created by raw SQL with a
  // database-assigned id, so nothing may assume a particular one.
  const LEVELS_ID = 900;

  const LEVELS_COST = 35;
  const LEVELS_MINUTES = 25;

  /** The levels line exactly as the migration seeds it, including the self-reference. */
  function levelsLine(levels: number): ServiceLineInput {
    return {
      serviceId: LEVELS_ID,
      cost: LEVELS_COST,
      timeDuration: LEVELS_MINUTES,
      serviceKey: 'levels',
      quantity: levels,
      chargeAboveThreshold: true,
      // zeroQuantityCost / zeroQuantityDuration stay null - see the studio guard below.
      zeroQuantityCost: null,
      zeroQuantityDuration: null,
      rateTiers: [],
      thresholds: [{ sourceServiceId: LEVELS_ID, sourceQuantity: 1, includedQuantity: 1 }]
    } as ServiceLineInput;
  }

  function withLevels(
    bedrooms: number, bathrooms: number, sqft: number, levels: number | null, deep = false
  ) {
    const services: ServiceLineInput[] = [
      {
        serviceId: BED_ID, cost: 22.5, timeDuration: 30, serviceKey: 'bedrooms',
        quantity: bedrooms, zeroQuantityCost: 0, zeroQuantityDuration: 0,
        chargeAboveThreshold: false, thresholds: [], rateTiers: []
      } as ServiceLineInput,
      {
        serviceId: BATH_ID, cost: 22.5, timeDuration: 30, serviceKey: 'bathrooms',
        quantity: bathrooms, chargeAboveThreshold: false, thresholds: [], rateTiers: []
      } as ServiceLineInput,
      {
        serviceId: SQFT_ID, cost: 0.18, timeDuration: 0.24, serviceKey: 'sqft',
        quantity: sqft, chargeAboveThreshold: true,
        thresholds: [
          { sourceServiceId: BED_ID, sourceQuantity: 0, includedQuantity: 400 },
          { sourceServiceId: BED_ID, sourceQuantity: 1, includedQuantity: 650 },
          { sourceServiceId: BED_ID, sourceQuantity: 2, includedQuantity: 850 },
          { sourceServiceId: BED_ID, sourceQuantity: 3, includedQuantity: 1000 },
          { sourceServiceId: BED_ID, sourceQuantity: 4, includedQuantity: 1500 }
        ],
        rateTiers: [
          { fromQuantity: 0, cost: 0.18, timeDuration: 0.24 },
          { fromQuantity: 400, cost: 0.135, timeDuration: 0.18 },
          { fromQuantity: 1200, cost: 0.11, timeDuration: 0.145 }
        ]
      } as ServiceLineInput
    ];

    if (levels != null) services.push(levelsLine(levels));

    return {
      basePrice: 90,
      baseDuration: 120,
      minimumPrice: 130,
      services,
      extraServices: deep
        ? [{
            extraServiceId: 1, name: 'Deep Cleaning', price: 90, duration: 120,
            priceMultiplier: 1.5, isDeepCleaning: true, isSuperDeepCleaning: false,
            isSameDayService: false, hasHours: false, hasQuantity: false, quantity: 1, hours: 0
          } as any]
        : []
    };
  }

  const levelsResultOf = (input: ReturnType<typeof withLevels>) =>
    calculateQuote(input).serviceLines.find(l => l.serviceId === LEVELS_ID)!;

  // ── The pricing table ──────────────────────────────────────────────────────────────

  [
    { levels: 1, cost: 0, minutes: 0 },
    { levels: 2, cost: 35, minutes: 25 },
    { levels: 3, cost: 70, minutes: 50 },
    { levels: 4, cost: 105, minutes: 75 }
  ].forEach(({ levels, cost, minutes }) => {
    it(`charges only above the first level: ${levels} levels -> $${cost} / ${minutes} min`, () => {
      const line = levelsResultOf(withLevels(3, 2, 1600, levels));
      expect(line.cost).toBe(cost);
      expect(line.duration).toBe(minutes);
    });
  });

  it('stores the ACTUAL level count on the line, not the billable count', () => {
    [1, 2, 3, 4].forEach(levels => {
      const line = levelsResultOf(withLevels(3, 2, 1600, levels));
      expect(line.quantity).toBe(levels);
    });
  });

  it('prices a one-level house exactly like the equivalent apartment', () => {
    const apartment = calculateQuote(withLevels(3, 2, 1600, null));
    const house = calculateQuote(withLevels(3, 2, 1600, 1));

    expect(house.subTotal).toBe(apartment.subTotal);
    expect(house.totalDuration).toBe(apartment.totalDuration);
  });

  // ── The deep-cleaning multiplier ───────────────────────────────────────────────────

  it('scales the levels COST by the cleaning-type multiplier but never the DURATION', () => {
    // Stair deep cleaning genuinely takes longer, so the multiplier applies to cost - it falls
    // out of treating levels as an ordinary service line.
    //
    // Duration is NOT multiplied. No duration anywhere is multiplier-scaled (see the note on
    // getServiceDisplayDuration about bug B1): Deep Cleaning contributes its own minutes through
    // its ExtraService row, and scaling service durations on top double-counted it.
    const line = levelsResultOf(withLevels(3, 2, 1600, 3, true));

    expect(line.cost).toBe(105);    // 35 x 2 x 1.5
    expect(line.duration).toBe(50); // 25 x 2, unscaled - not 75
  });

  it('reproduces the signed-off worked example end to end', () => {
    // Residential, 3bd, 2ba, 1600 sq.ft, 3 levels, Deep Cleaning, against the production
    // configuration (admin export 2026-08-02). The number the feature was approved on.
    const quote = calculateQuote(withLevels(3, 2, 1600, 3, true));

    expect(quote.subTotal).toBe(647.25);
    expect(quote.totalDuration).toBe(572);
    expect(quote.displayDuration).toBe(572);
    expect(quote.maidsCount).toBe(1);
  });

  // ── The self-reference contract ────────────────────────────────────────────────────

  it('supports a SELF-REFERENCING threshold: resolves, terminates, and warns about nothing', () => {
    // A self-reference is a supported configuration, not an incidental one. The resolver reads
    // the source service's quantity straight out of the same selection array and never resolves
    // the source's OWN allowance, so pointing a service at itself terminates in one step.
    //
    // If anyone ever makes the resolver recursive - to let allowances chain, say - this test
    // fails here instead of the server hanging on the first house booking.
    [0, 1, 2, 3, 4].forEach(levels => {
      const quote = calculateQuote(withLevels(3, 2, 1600, levels));
      const line = quote.serviceLines.find(l => l.serviceId === LEVELS_ID)!;
      const billable = Math.max(0, levels - 1);

      expect(quote.warnings).withContext(`levels=${levels}`).toEqual([]);
      expect(line.cost).toBe(LEVELS_COST * billable);
      expect(line.duration).toBe(LEVELS_MINUTES * billable);
    });
  });

  it('resolves the self-referencing allowance directly', () => {
    // Straight at resolveIncludedQuantity, with no quote around it, so the contract is pinned
    // even if calculateQuote's branch structure changes.
    const line = levelsLine(3);
    const warnings: string[] = [];

    expect(resolveIncludedQuantity(line, [line], warnings)).toBe(1);
    expect(warnings).toEqual([]);
  });

  it('bills every level when the threshold row is missing', () => {
    // Makes the single seeded row load-bearing rather than decorative.
    const input = withLevels(3, 2, 1600, 3);
    input.services.find(s => s.serviceId === LEVELS_ID)!.thresholds = [];

    expect(levelsResultOf(input).cost).toBe(LEVELS_COST * 3);
  });

  // ── The studio guard ───────────────────────────────────────────────────────────────

  it('never prices a levels line through the studio rule', () => {
    // The plan assumed the zero-quantity check keys on serviceKey === 'bedrooms'. It does not.
    // The FIRST zero-quantity branch is GENERIC - it fires for any service with a non-null
    // zeroQuantityCost or zeroQuantityDuration - and the bedrooms-keyed branch below it is only
    // the legacy fallback for when both are null.
    //
    // So the real invariant is not "levels is not called bedrooms", it is "the levels row leaves
    // both zero-quantity columns NULL", which is how the migration seeds it.
    const line = levelsResultOf(withLevels(3, 2, 1600, 0));

    expect(line.cost).toBe(0);
    expect(line.duration).toBe(0);
    expect(line.cost).not.toBe(STUDIO_PRICE);
  });

  it('demonstrates the hazard a configured zeroQuantityCost would create', () => {
    // Documents WHY the migration seeds both columns null. If this ever starts failing because
    // the generic branch was hardened to skip threshold-billed services, that is an improvement:
    // update this test, do not restore the old behaviour.
    const input = withLevels(3, 2, 1600, 0);
    input.services.find(s => s.serviceId === LEVELS_ID)!.zeroQuantityCost = 99;

    expect(levelsResultOf(input).cost).toBe(99);
  });

  it('still prices studio bedrooms as a studio when a levels line is present', () => {
    const quote = calculateQuote(withLevels(0, 1, 400, 2));
    const bedrooms = quote.serviceLines.find(l => l.serviceId === BED_ID)!;

    expect(bedrooms.cost).toBe(0);   // configured zeroQuantityCost 0
    expect(quote.serviceLines.find(l => l.serviceId === LEVELS_ID)!.cost).toBe(35);
  });

  // ── The per-item display helpers ───────────────────────────────────────────────────

  describe('display helpers', () => {
    const levelsService = {
      id: LEVELS_ID, name: 'Levels', serviceKey: 'levels', cost: LEVELS_COST,
      timeDuration: LEVELS_MINUTES, serviceTypeId: 1, inputType: 'dropdown',
      isRangeInput: false, isActive: true, minValue: 1, maxValue: 4, stepValue: 1,
      chargeAboveThreshold: true,
      thresholds: [{
        id: 1, serviceId: LEVELS_ID, sourceServiceId: LEVELS_ID,
        sourceQuantity: 1, includedQuantity: 1
      }],
      rateTiers: []
    } as Service;

    it('shows the same per-level price the quote charges', () => {
      const selected = [{ service: levelsService, quantity: 3 }];

      expect(getServiceDisplayPrice(levelsService, 3, 1, selected)).toBe(70);
      expect(getServiceDisplayPrice(levelsService, 1, 1, selected)).toBe(0);
      expect(getServiceDisplayPrice(levelsService, 3, 1.5, selected)).toBe(105);
    });

    it('shows the same per-level duration the quote adds, unscaled by the multiplier', () => {
      const selected = [{ service: levelsService, quantity: 3 }];

      expect(getServiceDisplayDuration(levelsService, 3, 1, selected)).toBe(50);
      expect(getServiceDisplayDuration(levelsService, 3, 1.5, selected)).toBe(50);
    });

    it('is still correct when a caller forgets to pass the selection array', () => {
      // A missing threshold source falls back to "treat its quantity as 0", which resolves to
      // the LOWEST configured row rather than to "no allowance". With a single row that is the
      // same allowance, so a call site that omits allSelected cannot overcharge for stairs.
      // This is a safety net, not a licence - components pass their live selection.
      expect(getServiceDisplayPrice(levelsService, 3, 1)).toBe(70);
      expect(getServiceDisplayDuration(levelsService, 3, 1)).toBe(50);
    });
  });
});
