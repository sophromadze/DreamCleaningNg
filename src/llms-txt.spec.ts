import { renderLlmsTxt } from './llms-txt';
import { extractMarketingPrices, MARKETING_SERVICE_KEYS as KEYS } from './app/shared/pricing/marketing-prices';

/** Shaped like GET api/booking/service-types; Ids and names deliberately differ from production. */
function catalogue(overrides: { filthyDisplayPrice?: boolean } = {}) {
  const hourly = (id: number, key: string, cost: number) => ({
    id, name: `Type ${id}`, serviceKey: key, basePrice: 0, minimumPrice: 0,
    services: [
      { id: id * 10, serviceKey: 'cleaners', serviceRelationType: 'cleaner', cost },
      { id: id * 10 + 1, serviceKey: 'hours', serviceRelationType: 'hours', cost: 0 }
    ]
  });
  return [
    {
      id: 41, name: 'Renamed Residential', serviceKey: KEYS.residential, basePrice: 90, minimumPrice: 130,
      services: [{ id: 1, serviceKey: 'bathrooms', cost: 22.5, minValue: 1 }],
      extraServices: [{ id: 5, name: 'Deep', isDeepCleaning: true, price: 90, priceMultiplier: 1 }]
    },
    { id: 7, name: 'Moving', serviceKey: KEYS.moveInOut, basePrice: 0, minimumPrice: 245, services: [] },
    hourly(3, KEYS.heavyCondition, 60),
    hourly(9, KEYS.custom, 50),
    hourly(11, KEYS.office, 50),
    hourly(12, KEYS.postConstruction, 60),
    {
      id: 13, name: 'Filthy', serviceKey: KEYS.filthy, hasPoll: true, services: [],
      displayPrice: overrides.filthyDisplayPrice === false ? null : 100,
      displayPriceUnit: overrides.filthyDisplayPrice === false ? null : 'per-hour-per-cleaner'
    }
  ];
}

const render = (c: unknown) => renderLlmsTxt(extractMarketingPrices(c).prices);

describe('llms.txt generation', () => {
  it('renders prices into the summary and the service lines', () => {
    const text = render(catalogue());
    expect(text).toContain('Flat-rate cleanings start at $130 (standard), $220 (deep) and $245 (move in/out).');
    expect(text).toContain('cleaning from $130, with weekly');
    expect(text).toContain('): From $220; baseboards');
    expect(text).toContain('): $60 per hour per cleaner, for homes');
    expect(text).toContain('duration; $50 per hour per cleaner');
  });

  it('covers every priced service type, including office, post-construction and filthy', () => {
    const text = render(catalogue());
    expect(text).toContain('surface sanitizing; $50 per hour per cleaner');
    expect(text).toContain('residue removal; $60 per hour per cleaner');
    expect(text).toContain('heavy buildup; $100 per hour per cleaner');
  });

  it('says "priced after assessment" for filthy cleaning without a display price', () => {
    const text = render(catalogue({ filthyDisplayPrice: false }));
    expect(text).toContain('heavy buildup; priced after assessment');
    expect(text).not.toContain('$100');
  });

  it('omits every price fragment, and only those, when nothing resolved', () => {
    const withPrices = render(catalogue());
    const without = renderLlmsTxt(null);

    expect(without).not.toMatch(/\$\d/);
    expect(without).not.toContain('Flat-rate cleanings start at');
    expect(without).toContain('): Baseboards, inside appliances, behind furniture');
    expect(without).toContain('): For homes not cleaned in 6+ months');
    // Same document otherwise: same number of lines, same links.
    expect(without.split('\n').length).toBe(withPrices.split('\n').length);
    expect(without.match(/\]\(https:\/\//g)?.length).toBe(withPrices.match(/\]\(https:\/\//g)?.length);
  });

  it('renders the price-less document for a refused (401) body', () => {
    expect(render({ message: 'Unauthorized' })).toBe(renderLlmsTxt(null));
  });

  it('follows the llms.txt shape: H1 first, blockquote summary, H2 sections, absolute links', () => {
    const text = renderLlmsTxt(null);
    const lines = text.split('\n');

    expect(lines[0]).toMatch(/^# \S/);
    expect(lines[2]).toMatch(/^> \S/);
    expect(lines.filter(l => l.startsWith('## ')).length).toBeGreaterThanOrEqual(5);
    expect(lines).toContain('## Optional');
    expect(text.endsWith('\n')).toBeTrue();
    expect(text).not.toContain('\r');
    for (const l of lines.filter(x => x.startsWith('- ['))) {
      expect(l).toMatch(/^- \[[^\]]+\]\(https:\/\/[^)\s]+\): \S/);
    }
  });

  it('never links a private, account or token page', () => {
    const text = renderLlmsTxt(null);
    for (const path of ['/admin', '/login', '/profile', '/rewards', '/cleaner-portal', '/contract/',
                        '/invoice/', '/pay-invoice/', '/order/', '/booking-confirmation', '/api/']) {
      expect(text).not.toContain(`.com${path}`);
    }
  });
});
