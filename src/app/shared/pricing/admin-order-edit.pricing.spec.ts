import { ExtraService, Service, ServiceType } from '../../services/booking.service';
import { buildAdminEditQuoteInput } from './admin-order-edit.pricing';
import { calculateQuote } from './order-pricing.calculator';
import { PRICING_FIXTURES } from './pricing-fixtures.data';

/**
 * ADMIN ORDER EDITOR — CROSS-SURFACE EQUIVALENCE.
 *
 * The admin order editor used to price with its own arithmetic: linear unitPrice x quantity for
 * per-line costs, and a bare sum with no MinimumPrice for the subtotal. That made it disagree with
 * the booking page on every tiered service, and — because SuperAdminFullUpdateOrder persists
 * dto.SubTotal verbatim — the disagreeing number was the one that got SAVED.
 *
 * These tests drive the same adapter the component uses (buildAdminEditQuoteInput) with rows
 * shaped exactly as the edit form holds them, and assert the result matches the shared fixtures
 * generated from the real calculator against the production configuration. Same 100 rows the
 * backend cross-surface test asserts, so all three surfaces are pinned to one set of numbers.
 *
 * The house rows (levels 1-4) are what prove an admin can change a level count and have the
 * price recalculate through the shared calculator rather than through editor-local arithmetic.
 */
describe('admin order edit pricing', () => {
  const BED_ID = 10;
  const BATH_ID = 20;
  const SQFT_ID = 30;
  const LEVELS_ID = 40;

  const SQFT_THRESHOLD_ROWS: [number, number][] =
    [[0, 400], [1, 650], [2, 850], [3, 1000], [4, 1500], [5, 1800], [6, 2000]];

  interface TypeConfig {
    basePrice: number;
    timeDuration: number;
    minimumPrice: number;
    bedroomTiers: { fromQuantity: number; cost: number; timeDuration: number }[];
    sqftTiers: { fromQuantity: number; cost: number; timeDuration: number }[];
  }

  const CONFIG: Record<string, TypeConfig> = {
    'Residential Cleaning': {
      basePrice: 90, timeDuration: 120, minimumPrice: 130,
      bedroomTiers: [],
      sqftTiers: [
        { fromQuantity: 0, cost: 0.18, timeDuration: 0.24 },
        { fromQuantity: 400, cost: 0.135, timeDuration: 0.18 },
        { fromQuantity: 1200, cost: 0.11, timeDuration: 0.145 }
      ]
    },
    'Move in/out Cleaning': {
      basePrice: 187.5, timeDuration: 270, minimumPrice: 245,
      bedroomTiers: [
        { fromQuantity: 0, cost: 45, timeDuration: 60 },
        { fromQuantity: 1, cost: 22.5, timeDuration: 30 }
      ],
      sqftTiers: [
        { fromQuantity: 0, cost: 0.18, timeDuration: 0.24 },
        { fromQuantity: 400, cost: 0.12, timeDuration: 0.16 },
        { fromQuantity: 1200, cost: 0.1125, timeDuration: 0.15 }
      ]
    }
  };

  const tier = (serviceId: number, t: { fromQuantity: number; cost: number; timeDuration: number }, i: number) =>
    ({ id: i + 1, serviceId, fromQuantity: t.fromQuantity, cost: t.cost, timeDuration: t.timeDuration, displayOrder: i + 1 });

  function serviceType(name: string): ServiceType {
    const cfg = CONFIG[name];
    const bedrooms: Service = {
      id: BED_ID, name: 'Bedrooms', serviceKey: 'bedrooms', cost: 22.5, timeDuration: 30,
      serviceTypeId: 1, inputType: 'dropdown', isRangeInput: false, isActive: true,
      zeroQuantityCost: 0, zeroQuantityDuration: 0,
      chargeAboveThreshold: false, thresholds: [],
      rateTiers: cfg.bedroomTiers.map((t, i) => tier(BED_ID, t, i))
    };
    const bathrooms: Service = {
      id: BATH_ID, name: 'Bathrooms', serviceKey: 'bathrooms', cost: 22.5, timeDuration: 30,
      serviceTypeId: 1, inputType: 'dropdown', isRangeInput: false, isActive: true,
      chargeAboveThreshold: false, thresholds: [], rateTiers: []
    };
    const sqft: Service = {
      id: SQFT_ID, name: 'Sq.ft', serviceKey: 'sqft', cost: 0.18, timeDuration: 0.24,
      serviceTypeId: 1, inputType: 'slider', isRangeInput: true, isActive: true,
      chargeAboveThreshold: true,
      thresholds: SQFT_THRESHOLD_ROWS.map(([q, included], i) => ({
        id: i + 1, serviceId: SQFT_ID, sourceServiceId: BED_ID,
        sourceServiceKey: 'bedrooms', sourceQuantity: q, includedQuantity: included
      })),
      rateTiers: cfg.sqftTiers.map((t, i) => tier(SQFT_ID, t, i))
    };

    // Levels: ChargeAboveThreshold with ONE self-referencing threshold row, so the first level
    // is included and billable = max(0, levels - 1). sourceServiceId is LEVELS_ID, not BED_ID.
    const levels: Service = {
      id: LEVELS_ID, name: 'Levels', serviceKey: 'levels', cost: 35, timeDuration: 25,
      serviceTypeId: 1, inputType: 'dropdown', isRangeInput: false, isActive: true,
      minValue: 1, maxValue: 4, stepValue: 1, displayOrder: 4,
      chargeAboveThreshold: true,
      thresholds: [{
        id: 99, serviceId: LEVELS_ID, sourceServiceId: LEVELS_ID,
        sourceServiceKey: 'levels', sourceQuantity: 1, includedQuantity: 1
      }],
      rateTiers: []
    } as Service;

    return {
      id: 1, name, basePrice: cfg.basePrice, timeDuration: cfg.timeDuration,
      minimumPrice: cfg.minimumPrice, services: [bedrooms, bathrooms, sqft, levels],
      extraServices: [], isActive: true, hasPoll: false
    };
  }

  const DEEP_CLEANING: ExtraService = {
    id: 1, name: 'Deep Cleaning', price: 90, duration: 120, priceMultiplier: 1.5,
    isDeepCleaning: true, isSuperDeepCleaning: false, isSameDayService: false,
    hasQuantity: false, hasHours: false, isAvailableForAll: true, isActive: true
  } as ExtraService;

  /** Included allowance for a bedroom count — the editor clamps sqft up to this. */
  function includedFor(bedrooms: number): number {
    let match = SQFT_THRESHOLD_ROWS[0];
    for (const row of SQFT_THRESHOLD_ROWS) if (row[0] <= bedrooms) match = row;
    return match[1];
  }

  PRICING_FIXTURES.forEach(fixture => {
    const label = `${fixture.serviceTypeName} ${fixture.bedrooms}bd/${fixture.bathrooms}ba/` +
      `${fixture.sqft}sqft ${fixture.deepCleaning ? 'Deep' : 'Regular'}` +
      `${fixture.levels == null ? '/apt' : `/${fixture.levels}lv`}`;

    it(`matches the shared fixture: ${label}`, () => {
      const st = serviceType(fixture.serviceTypeName);
      const [bedroomsDef, bathroomsDef, sqftDef, levelsDef] = st.services;

      // Rows exactly as the admin edit form holds them: quantity + cost, index-aligned with
      // the catalog definitions. The sqft row is clamped to the allowance, as the editor does
      // when bedrooms change.
      const rows = [
        { row: { quantity: fixture.bedrooms }, definition: bedroomsDef },
        { row: { quantity: fixture.bathrooms }, definition: bathroomsDef },
        { row: { quantity: Math.max(fixture.sqft, includedFor(fixture.bedrooms)) }, definition: sqftDef }
      ];

      // An apartment order carries NO levels row at all, which is exactly how the editor sees a
      // legacy order too. A house order carries one, at the real level count.
      if (fixture.levels != null) {
        rows.push({ row: { quantity: fixture.levels }, definition: levelsDef });
      }

      const built = buildAdminEditQuoteInput(
        st,
        rows,
        fixture.deepCleaning
          ? [{ row: { quantity: 1, hours: 0 }, definition: DEEP_CLEANING }]
          : []
      );

      expect(built).not.toBeNull();
      const quote = calculateQuote(built!.input);

      expect(quote.subTotal).toBe(fixture.expectedSubTotal);
      expect(quote.displayDuration).toBe(fixture.expectedDisplayDuration);
      expect(quote.minimumPriceApplied).toBe(fixture.expectedMinimumPriceApplied);
    });
  });

  it('covers both service types and both cleaning levels', () => {
    expect(PRICING_FIXTURES.length).toBe(100);
    expect(PRICING_FIXTURES.some(f => f.serviceTypeName.startsWith('Residential'))).toBeTrue();
    expect(PRICING_FIXTURES.some(f => f.serviceTypeName.startsWith('Move'))).toBeTrue();
    expect(PRICING_FIXTURES.some(f => f.expectedMinimumPriceApplied)).toBeTrue();
    expect(PRICING_FIXTURES.some(f => f.levels == null)).toBeTrue();
    [1, 2, 3, 4].forEach(n => expect(PRICING_FIXTURES.some(f => f.levels === n)).toBeTrue());
  });

  it('returns row index maps so per-line costs can be written back in place', () => {
    const st = serviceType('Residential Cleaning');
    const built = buildAdminEditQuoteInput(
      st,
      [
        { row: { quantity: 2 }, definition: st.services[0] },
        { row: { quantity: 1 }, definition: null },          // unresolved row must be skipped
        { row: { quantity: 1000 }, definition: st.services[2] }
      ],
      []
    );

    expect(built!.serviceRowIndices).toEqual([0, 2]);
    expect(built!.input.services.length).toBe(2);
  });

  it('returns null when the service type is unknown, so the form is left alone', () => {
    expect(buildAdminEditQuoteInput(null, [], [])).toBeNull();
  });

  /**
   * REGRESSION — order #305 (Heavy Conditional Cleaning, 1 cleaner x 3h @ $60 + $165 of extras).
   *
   * Hours lines are never persisted on an order (the calculator folds them into the cleaner line),
   * so the edit form holds a cleaner row with no hours row. The calculator's cleaner branch prices
   * only when a paired hours line is present, so it left that line at $0 and the subtotal collapsed
   * from $345 to $165 — the extras alone — the moment any field was touched. Editing cleaners,
   * hours or cost then moved nothing, because the cleaner line contributed nothing either way.
   * SuperAdminFullUpdateOrder persists dto.SubTotal verbatim, so the wrong number was saveable.
   */
  describe('cleaner + hours orders (no persisted hours row)', () => {
    const CLEANERS: Service = {
      id: 40, name: 'Cleaners', serviceKey: 'cleaners', serviceRelationType: 'cleaner',
      cost: 60, timeDuration: 0, serviceTypeId: 2, inputType: 'dropdown',
      isRangeInput: false, isActive: true, thresholds: [], rateTiers: []
    } as unknown as Service;

    const SUPPLIES: ExtraService = {
      id: 2, name: 'Cleaning Supplies', price: 35, duration: 0, priceMultiplier: 1,
      isDeepCleaning: false, isSuperDeepCleaning: false, isSameDayService: false,
      hasQuantity: true, hasHours: false, isAvailableForAll: true, isActive: true
    } as ExtraService;

    const VACUUM: ExtraService = {
      id: 3, name: 'Vacuum Cleaner', price: 130, duration: 0, priceMultiplier: 1,
      isDeepCleaning: false, isSuperDeepCleaning: false, isSameDayService: false,
      hasQuantity: true, hasHours: false, isAvailableForAll: true, isActive: true
    } as ExtraService;

    const HEAVY: ServiceType = {
      id: 2, name: 'Heavy Conditional Cleaning', basePrice: 0, timeDuration: 0,
      minimumPrice: 0, services: [CLEANERS], extraServices: [SUPPLIES, VACUUM],
      isActive: true, hasPoll: false
    } as unknown as ServiceType;

    const build = (cleaners: number, hours: number) => buildAdminEditQuoteInput(
      HEAVY,
      [{ row: { quantity: cleaners }, definition: CLEANERS }],
      [
        { row: { quantity: 1, hours: 0 }, definition: SUPPLIES },
        { row: { quantity: 1, hours: 0 }, definition: VACUUM }
      ],
      hours
    );

    it('prices the cleaner line from the form hours instead of dropping it', () => {
      const quote = calculateQuote(build(1, 3)!.input);

      expect(quote.subTotal).toBe(345.00); // 1 x 3h x $60 + $35 + $130 — NOT the $165 extras alone
      expect(quote.serviceLines[0].cost).toBe(180.00);
      expect(quote.displayDuration).toBe(180);
      expect(quote.maidsCount).toBe(1);
    });

    it('moves the subtotal when cleaners or hours change', () => {
      expect(calculateQuote(build(2, 3)!.input).subTotal).toBe(525.00); // 2 x 3h x $60 + 165
      expect(calculateQuote(build(1, 4)!.input).subTotal).toBe(405.00); // 1 x 4h x $60 + 165
      expect(calculateQuote(build(1, 2.5)!.input).subTotal).toBe(315.00); // half-hour steps
    });

    it('keeps the synthetic hours line out of the row index map', () => {
      const built = build(1, 3)!;

      expect(built.input.services.length).toBe(2);            // cleaner + synthetic hours
      expect(built.serviceRowIndices).toEqual([0]);            // only the real row is writable
      expect(built.input.services[1].serviceRelationType).toBe('hours');
      expect(calculateQuote(built.input).serviceLines[1].shouldAddToOrder).toBeFalse();
    });

    it('does not synthesise an hours line for orders without a cleaner service', () => {
      const built = buildAdminEditQuoteInput(
        serviceType('Residential Cleaning'),
        [{ row: { quantity: 2 }, definition: serviceType('Residential Cleaning').services[0] }],
        [],
        3
      );

      expect(built!.input.services.every(s => s.serviceRelationType !== 'hours')).toBeTrue();
    });
  });

  it('prices the Studio floor for both service types', () => {
    const residential = calculateQuote(buildAdminEditQuoteInput(
      serviceType('Residential Cleaning'),
      [
        { row: { quantity: 0 }, definition: serviceType('Residential Cleaning').services[0] },
        { row: { quantity: 1 }, definition: serviceType('Residential Cleaning').services[1] },
        { row: { quantity: 400 }, definition: serviceType('Residential Cleaning').services[2] }
      ], []
    )!.input);

    const moveInOut = calculateQuote(buildAdminEditQuoteInput(
      serviceType('Move in/out Cleaning'),
      [
        { row: { quantity: 0 }, definition: serviceType('Move in/out Cleaning').services[0] },
        { row: { quantity: 1 }, definition: serviceType('Move in/out Cleaning').services[1] },
        { row: { quantity: 400 }, definition: serviceType('Move in/out Cleaning').services[2] }
      ], []
    )!.input);

    // The exact numbers the admin must see instead of the unfloored 112.50 / 210.00.
    expect(residential.subTotal).toBe(130.00);
    expect(residential.minimumPriceApplied).toBeTrue();
    expect(moveInOut.subTotal).toBe(245.00);
    expect(moveInOut.minimumPriceApplied).toBeTrue();
  });
});
