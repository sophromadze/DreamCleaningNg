import {
  extractMarketingPrices,
  formatDisplayPrice,
  hasAnyMarketingPrice,
  listStartingPrices,
  MARKETING_EXTRA_KEYS,
  MARKETING_SERVICE_KEYS as KEYS,
  startingPriceOffer
} from './marketing-prices';

/**
 * A slice of the production catalogue (GET api/booking/service-types, 2026-10): the residential
 * shape the booking calculator prices - studio floor, included sq.ft, a self-referencing levels
 * allowance, a MinimumPrice floor - plus hourly and poll types. Ids and names deliberately differ
 * from production: only ServiceKey may be used to recognise a type, and only extraServiceKey an
 * extra (the supplies and vacuum rows are named nothing like production on purpose).
 */
function catalogue(o: { residentialMinimum?: number; deepMultiplier?: number; preArrangedKey?: string | null } = {}) {
  const residentialServices = [
    { id: 101, serviceKey: 'bedrooms', cost: 22.5, minValue: 0, zeroQuantityCost: 0, displayOrder: 1 },
    { id: 102, serviceKey: 'bathrooms', cost: 22.5, minValue: 1, displayOrder: 2 },
    {
      id: 103, serviceKey: 'sqft', cost: 0.18, minValue: 400, chargeAboveThreshold: true, displayOrder: 3,
      rateTiers: [{ fromQuantity: 0, cost: 0.18, timeDuration: 0.24 }],
      thresholds: [{ sourceServiceId: 101, sourceQuantity: 0, includedQuantity: 400 }]
    },
    {
      id: 104, serviceKey: 'levels', cost: 35, minValue: 1, chargeAboveThreshold: true, displayOrder: 4,
      thresholds: [{ sourceServiceId: 104, sourceQuantity: 1, includedQuantity: 1 }]
    }
  ];
  const hourly = (id: number, key: string, cost: number) => ({
    id, name: `Hourly ${id}`, serviceKey: key, isActive: true, basePrice: 0, minimumPrice: 0,
    services: [
      { id: id * 10, serviceKey: 'cleaners', serviceRelationType: 'cleaner', cost },
      { id: id * 10 + 1, serviceKey: 'hours', serviceRelationType: 'hours', cost: 0 }
    ],
    extraServices: [{ id: 900, name: 'Our Products', extraServiceKey: 'cleaning-supplies', price: 38, isAvailableForAll: true }]
  });
  return [
    {
      id: 15, name: 'House & Apartment', serviceKey: KEYS.residential, isActive: true, basePrice: 90,
      minimumPrice: o.residentialMinimum ?? 130, services: residentialServices,
      extraServices: [
        { id: 1, name: 'Deep Cleaning', isDeepCleaning: true, price: 90, priceMultiplier: o.deepMultiplier ?? 1 },
        { id: 900, name: 'Our Products', extraServiceKey: 'cleaning-supplies', price: 38, isAvailableForAll: true },
        { id: 901, name: 'We Bring a Hoover', extraServiceKey: 'vacuum-cleaner', price: 150, isAvailableForAll: true }
      ]
    },
    {
      id: 16, name: 'Moving Out', serviceKey: KEYS.moveInOut, isActive: true, basePrice: 187.5, minimumPrice: 245,
      services: residentialServices, extraServices: []
    },
    hourly(2, KEYS.office, 50),
    hourly(3, KEYS.custom, 50),
    hourly(8, KEYS.heavyCondition, 60),
    hourly(6, KEYS.postConstruction, 60),
    {
      id: 5, name: 'Filthy', serviceKey: KEYS.filthy, isActive: true, hasPoll: true, services: [],
      displayPrice: 100, displayPriceUnit: 'per-hour-per-cleaner', extraServices: []
    },
    // Admin-only custom type, returned by the public endpoint. Never read - even holding a key.
    {
      id: 7, name: 'Pre-arranged Cleaning', isCustom: true, isActive: true, serviceKey: o.preArrangedKey ?? null,
      basePrice: 999, minimumPrice: 999, services: [],
      extraServices: [{ id: 902, name: 'Our Products', extraServiceKey: 'cleaning-supplies', price: 1, isAvailableForAll: false }]
    }
  ];
}

describe('marketing prices', () => {
  it('derives every price from the catalogue, by service key', () => {
    const { prices, problems } = extractMarketingPrices(catalogue());
    expect(prices).toEqual({
      standardFrom: 130,
      deepFrom: 220,
      moveInOutFrom: 245,
      customPerHour: 50,
      heavyPerHour: 60,
      officePerHour: 50,
      postConstructionPerHour: 60,
      filthy: { amount: 100, unit: 'per-hour-per-cleaner' },
      suppliesExtra: 38,
      vacuumExtra: 150
    });
    expect(problems).toEqual([]);
  });

  it('prices "from" through the booking calculator, not from MinimumPrice alone', () => {
    // No floor: the minimum home itself (studio, 1 bath, included sq.ft, one level) = 90 + 22.50.
    const { prices } = extractMarketingPrices(catalogue({ residentialMinimum: 0 }));
    expect(prices.standardFrom).toBe(112.5);
    // The deep fee stacks on top of whatever the cleaning costs.
    expect(prices.deepFrom).toBe(202.5);
  });

  it('keeps the deep price when the deep multiplier is not 1 (the calculator applies it)', () => {
    const { prices } = extractMarketingPrices(catalogue({ deepMultiplier: 1.5 }));
    expect(prices.deepFrom).not.toBeNull();
    expect(prices.deepFrom!).toBeGreaterThan(prices.standardFrom!);
  });

  it('never reads a custom (admin-only) type, even one holding a marketing key', () => {
    const { prices, problems } = extractMarketingPrices(catalogue({ preArrangedKey: KEYS.residential }));
    expect(prices.standardFrom).toBe(130);
    expect(problems).toEqual([]);
  });

  it('drops a price whose key two public types share, and reports it', () => {
    const c = catalogue();
    c.push({ ...c[0], id: 99, name: 'Copy' } as any);
    const { prices, problems } = extractMarketingPrices(c);
    expect(prices.standardFrom).toBeNull();
    expect(prices.deepFrom).toBeNull();
    expect(prices.moveInOutFrom).toBe(245);
    expect(problems.join(' ')).toContain('2 public service types share ServiceKey "residential"');
  });

  it('resolves nothing before the keys are set, and names every missing key', () => {
    const unkeyed = catalogue().map(t => ({ ...t, serviceKey: null }));
    const { prices, problems } = extractMarketingPrices(unkeyed);
    expect(prices.standardFrom).toBeNull();
    expect(prices.filthy).toBeNull();
    for (const key of Object.values(KEYS)) {
      expect(problems.join(' ')).toContain(`"${key}"`);
    }
  });

  describe('extras (the FAQ supplies / vacuum prices)', () => {
    const extrasOf = (c: any[]) => c.flatMap(t => (t.extraServices ?? []) as any[]);

    it('reads them by key only - a row NAMED like production but unkeyed is not used', () => {
      const c = catalogue();
      for (const e of extrasOf(c)) {
        if (e.extraServiceKey === MARKETING_EXTRA_KEYS.vacuumCleaner) {
          e.extraServiceKey = null;
          e.name = 'Vacuum Cleaner';
        }
      }
      const { prices, problems } = extractMarketingPrices(c);
      expect(prices.suppliesExtra).toBe(38);
      expect(prices.vacuumExtra).toBeNull();
      expect(problems.join(' ')).toContain('extraServiceKey "vacuum-cleaner"');
    });

    it('survives a rename: the price follows the key', () => {
      const c = catalogue();
      for (const e of extrasOf(c)) e.name = 'Renamed in admin';
      const { prices, problems } = extractMarketingPrices(c);
      expect(prices.suppliesExtra).toBe(38);
      expect(prices.vacuumExtra).toBe(150);
      expect(problems).toEqual([]);
    });

    it('skips inactive rows - and never falls back to the custom type\'s copy', () => {
      const c = catalogue();
      // Every public supplies row inactive; only the custom (admin-only) type's copy is left.
      for (const e of extrasOf(c)) if (e.id === 900) e.isActive = false;
      const { prices } = extractMarketingPrices(c);
      expect(prices.suppliesExtra).toBeNull();
    });

    it('states no price when type-specific copies disagree and no universal row exists', () => {
      const c = catalogue();
      let n = 0;
      for (const e of extrasOf(c)) {
        if (e.extraServiceKey === MARKETING_EXTRA_KEYS.cleaningSupplies) {
          e.isAvailableForAll = false;
          e.price = 38 + n++;
        }
      }
      const { prices, problems } = extractMarketingPrices(c);
      expect(prices.suppliesExtra).toBeNull();
      expect(problems.join(' ')).toContain('different prices');
    });
  });

  it('resolves nothing from a refused or missing body', () => {
    expect(hasAnyMarketingPrice(extractMarketingPrices({ message: 'Unauthorized' }).prices)).toBeFalse();
    expect(hasAnyMarketingPrice(extractMarketingPrices(null).prices)).toBeFalse();
  });

  it('leaves filthy cleaning unpriced without a complete display price', () => {
    const c = catalogue();
    (c.find(t => t.serviceKey === KEYS.filthy) as any).displayPriceUnit = null;
    expect(extractMarketingPrices(c).prices.filthy).toBeNull();
  });

  it('words display prices by unit', () => {
    expect(formatDisplayPrice({ amount: 100, unit: 'per-hour-per-cleaner' })).toBe('$100 per hour per cleaner');
    expect(formatDisplayPrice({ amount: 99.5, unit: 'per-hour' })).toBe('$99.50 per hour');
    expect(formatDisplayPrice({ amount: 100, unit: 'from' })).toBe('from $100');
  });

  it('lists only the starting prices that resolved', () => {
    expect(listStartingPrices([['standard', '$130'], ['deep', '$220'], ['move', '$245']]))
      .toBe('standard starts from $130, deep from $220, and move from $245');
    expect(listStartingPrices([['standard', null], ['deep', '$220'], ['move', '$245']]))
      .toBe('deep starts from $220 and move from $245');
    expect(listStartingPrices([['standard', null]])).toBeNull();
  });

  it('publishes a schema offer only for a real price, and never a highPrice', () => {
    expect(startingPriceOffer(null)).toEqual({});
    expect(startingPriceOffer(130)).toEqual({ offers: { '@type': 'AggregateOffer', lowPrice: '130', priceCurrency: 'USD' } });
  });
});
