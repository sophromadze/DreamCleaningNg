import { CATALOGUE_MAX_AGE_MS, CATALOGUE_TTL_MS, createCatalogueCache, createPublicListCache, createPublicOffersCache, watchCatalogueVersion } from './catalogue-cache';

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

describe('public list cache (booking plans, blocked time slots)', () => {
  let now: number;
  let calls: number;
  let body: unknown;
  const fetchImpl = (() => { calls++; return Promise.resolve(new Response(JSON.stringify(body), { status: 200 })); }) as unknown as typeof fetch;
  const log = { warn: vi.fn().mockName('warn') };
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));

  beforeEach(() => { now = 1_000_000; calls = 0; log.warn.mockClear(); });

  it('honours its own TTL: blocked slots refresh after a minute, not after five', async () => {
    body = [{ id: 1, date: '2026-10-14', isFullDay: true }];
    const cache = createPublicListCache('http://backend/api/booking/blocked-time-slots', 'blocked time slots',
      { now: () => now, fetchImpl, log, ttlMs: 60_000, maxAgeMs: 600_000 });
    expect(await cache.get(1000)).toEqual(body);

    now += 59_000;
    await cache.get(1000);
    expect(calls).toBe(1);

    body = [];
    now += 2_000;
    await cache.get(1000);
    await flush();
    expect(await cache.get(1000)).toEqual([]);
    expect(calls).toBe(2);
  });

  it('defaults to the catalogue TTL', async () => {
    body = [{ id: 1, subscriptionDays: 0 }];
    const cache = createPublicListCache('http://backend/api/booking/subscriptions', 'booking plans', { now: () => now, fetchImpl, log });
    await cache.get(1000);
    now += CATALOGUE_TTL_MS - 1;
    await cache.get(1000);
    expect(calls).toBe(1);
  });
});

describe('immediate refresh after an admin edit', () => {
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));

  it('invalidate() keeps serving the last copy and refreshes now, inside the TTL', async () => {
    let body: unknown = [{ id: 1, subscriptionDays: 7, discountPercentage: 10 }];
    let calls = 0;
    const fetchImpl = (() => { calls++; return Promise.resolve(new Response(JSON.stringify(body), { status: 200 })); }) as unknown as typeof fetch;
    const cache = createPublicListCache('http://backend/api/booking/subscriptions', 'booking plans', { fetchImpl, log: { warn: () => {} } });
    await cache.get(1000);

    body = [{ id: 1, subscriptionDays: 7, discountPercentage: 15 }];
    cache.invalidate();
    expect(((await cache.get(1000)) as any[])[0].discountPercentage).toBe(10); // never waits
    await flush();
    expect(((await cache.get(1000)) as any[])[0].discountPercentage).toBe(15);
    expect(calls).toBe(2);
  });

  describe('watchCatalogueVersion', () => {
    let versions: Array<string | Error>;
    let requests: number;
    let inFlight: number;
    let maxInFlight: number;
    const fetchImpl = (async () => {
      requests++; inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        const next = versions.shift() ?? versions[versions.length - 1];
        if (next instanceof Error) throw next;
        return new Response(JSON.stringify({ version: next }), { status: 200 });
      } finally { inFlight--; }
    }) as unknown as typeof fetch;

    beforeEach(() => { versions = []; requests = 0; inFlight = 0; maxInFlight = 0; vi.useFakeTimers(); });
    afterEach(() => vi.useRealTimers());

    it('records the first stamp, then calls back only when it moves', async () => {
      versions = ['a-0', 'a-0', 'a-1', 'a-1'];
      const onChange = vi.fn();
      const watch = watchCatalogueVersion('http://backend/v', onChange, { fetchImpl, intervalMs: 2000 });

      await vi.advanceTimersByTimeAsync(0);
      expect(onChange).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2000);
      expect(onChange).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2000);
      expect(onChange).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2000);
      expect(onChange).toHaveBeenCalledTimes(1);
      watch.stop();
    });

    it('a backend restart (new boot id) counts as a change', async () => {
      versions = ['a-5', 'b-0'];
      const onChange = vi.fn();
      const watch = watchCatalogueVersion('http://backend/v', onChange, { fetchImpl, intervalMs: 2000 });
      await vi.advanceTimersByTimeAsync(2000);
      expect(onChange).toHaveBeenCalledTimes(1);
      watch.stop();
    });

    it('stays silent while the backend is unreachable and never overlaps requests', async () => {
      const hanging = (() => { requests++; inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); return new Promise(() => {}); }) as unknown as typeof fetch;
      const onChange = vi.fn();
      const watch = watchCatalogueVersion('http://backend/v', onChange, { fetchImpl: hanging, intervalMs: 2000 });
      await vi.advanceTimersByTimeAsync(10_000);

      expect(requests).toBe(1);
      expect(maxInFlight).toBe(1);
      expect(onChange).not.toHaveBeenCalled();
      watch.stop();
    });

    it('a failed poll changes nothing; the next good answer is compared with the last good one', async () => {
      versions = ['a-1', new Error('ECONNREFUSED'), 'a-1', 'a-2'];
      const onChange = vi.fn();
      const watch = watchCatalogueVersion('http://backend/v', onChange, { fetchImpl, intervalMs: 2000 });
      await vi.advanceTimersByTimeAsync(4000);
      expect(onChange).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2000);
      expect(onChange).toHaveBeenCalledTimes(1);
      watch.stop();
    });
  });
});
