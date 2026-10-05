import { CATALOGUE_MAX_AGE_MS, CATALOGUE_TTL_MS, createCatalogueCache, createPublicOffersCache } from './catalogue-cache';

const residential = (minimumPrice: number) => [{ serviceKey: 'residential', basePrice: 0, minimumPrice, services: [] }];

describe('catalogue cache', () => {
  let now: number;
  let calls: number;
  let respond: () => Promise<Response>;
  const fetchImpl = (() => { calls++; return respond(); }) as unknown as typeof fetch;
  const ok = (body: unknown) => () => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  const log = { warn: vi.fn().mockName('warn') };
  const make = () => createCatalogueCache('http://backend/api/booking/service-types', { now: () => now, fetchImpl, log });
  /** Lets a background refresh settle. */
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));

  beforeEach(() => {
    now = 1_000_000;
    calls = 0;
    log.warn.mockClear();
  });

  it('waits for the first fetch on a cold cache, then answers from memory within the TTL', async () => {
    respond = ok(residential(130));
    const cache = make();
    expect((await cache.get(1000)).prices.standardFrom).toBe(130);
    now += CATALOGUE_TTL_MS - 1;
    expect((await cache.get(1000)).prices.standardFrom).toBe(130);
    expect(calls).toBe(1);
  });

  it('serves the stale copy while one background refresh picks up an admin price change', async () => {
    respond = ok(residential(130));
    const cache = make();
    await cache.get(1000);

    respond = ok(residential(150));
    now += CATALOGUE_TTL_MS + 1;
    expect((await cache.get(1000)).prices.standardFrom).toBe(130); // stale, never waits
    await flush();
    expect((await cache.get(1000)).prices.standardFrom).toBe(150);
    expect(calls).toBe(2);
  });

  it('keeps the last good copy through a failure, but never past the max age', async () => {
    respond = ok(residential(130));
    const cache = make();
    await cache.get(1000);

    respond = () => Promise.resolve(new Response('{}', { status: 401 }));
    now += CATALOGUE_TTL_MS + 1;
    await cache.get(0);
    await flush();
    expect((await cache.get(0)).prices.standardFrom).toBe(130);

    now += CATALOGUE_MAX_AGE_MS;
    const expired = await cache.get(0);
    expect(expired.serviceTypes).toBeNull();
    expect(expired.prices.standardFrom).toBeNull(); // neutral wording, not an old price
  });

  it('retries a failing backend at most once per window, and warns once per streak', async () => {
    respond = () => Promise.reject(new Error('ECONNREFUSED'));
    const cache = make();
    expect((await cache.get(1000)).serviceTypes).toBeNull();
    await cache.get(1000);
    await cache.get(1000);
    expect(calls).toBe(1);
    now += 30_001;
    await cache.get(1000);
    expect(calls).toBe(2);
    expect(vi.mocked(log.warn).mock.calls.filter(c => String(c[0]).includes('unavailable')).length).toBe(1);
  });

  it('warns about missing service keys, without repeating itself every refresh', async () => {
    respond = ok([{ serviceKey: null, minimumPrice: 130 }]);
    const cache = make();
    await cache.get(1000);
    now += CATALOGUE_TTL_MS + 1;
    await cache.get(0);
    await flush();
    const keyWarnings = vi.mocked(log.warn).mock.calls.filter(c => String(c[0]).includes('ServiceKey "residential"'));
    expect(keyWarnings.length).toBe(1);
  });
});

/** The public offers (home hero welcome coupon) ride the same refresh core (2026-10). */
describe('public offers cache', () => {
  let now = 1_000_000;
  let calls = 0;
  let respond: () => Promise<Response>;
  const fetchImpl = (() => { calls++; return respond(); }) as unknown as typeof fetch;
  const log = { warn: vi.fn().mockName('warn') };
  const make = () => createPublicOffersCache('http://backend/api/special-offers/public', { now: () => now, fetchImpl, log });
  const OFFERS = [{ id: 1, offerKey: 'first-time', discountValue: 10 }];

  beforeEach(() => { now = 1_000_000; calls = 0; log.warn.mockClear(); });

  it('answers from memory within the TTL and keeps the last good copy through a failure', async () => {
    respond = () => Promise.resolve(new Response(JSON.stringify(OFFERS), { status: 200 }));
    const cache = make();
    expect(await cache.get(1000)).toEqual(OFFERS);
    now += CATALOGUE_TTL_MS + 1;
    respond = () => Promise.resolve(new Response('down', { status: 503 }));
    expect(await cache.get(1000)).toEqual(OFFERS);
    await new Promise(r => setTimeout(r, 0));
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(log.warn).mock.lastCall![0]).toContain('[special offers]');
    now += CATALOGUE_MAX_AGE_MS;
    expect(await cache.get(0)).toBeNull();
  });

  it('is null (the browser then fetches the offers itself) when the backend never answered', async () => {
    respond = () => Promise.reject(new Error('ECONNREFUSED'));
    expect(await make().get(1000)).toBeNull();
    expect(calls).toBe(1);
  });
});
