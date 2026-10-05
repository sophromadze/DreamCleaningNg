/**
 * The public service catalogue (GET api/booking/service-types), held in memory by server.ts and
 * shared by every SSR render (home hero form + MarketingPricingService, via SSR_CATALOGUE) and by
 * /llms.txt. One backend call per TTL for the whole process instead of one per render.
 *
 * - Fresh for CATALOGUE_TTL_MS: an admin price change reaches the site within that time (plus the
 *   one request that triggers the refresh).
 * - Stale-while-revalidate: once expired, renders keep using the last good copy while ONE refresh
 *   runs in the background, so no visitor waits on the backend except right after a cold start
 *   (bounded by the caller's wait).
 * - A failed refresh keeps the last good copy until CATALOGUE_MAX_AGE_MS after it was fetched, so
 *   a short backend blip doesn't strip prices; after that renders fall back to the price-less copy.
 *   Never an old hard-coded price.
 * - After a failure the backend is retried at most every RETRY_AFTER_FAILURE_MS, so a backend that
 *   is down or gated (SIR answers 401) costs one cheap attempt per window, never one per render.
 *
 * The public special offers (GET api/special-offers/public, the home hero's welcome coupon) are
 * held the same way by createPublicOffersCache, on the same refresh core (2026-10).
 *
 * Nothing is written to disk.
 */
import {
  extractMarketingPrices,
  MarketingPrices,
  NO_MARKETING_PRICES
} from './app/shared/pricing/marketing-prices';

export const CATALOGUE_TTL_MS = 5 * 60_000;
export const CATALOGUE_MAX_AGE_MS = 30 * 60_000;
const RETRY_AFTER_FAILURE_MS = 30_000;
const FETCH_TIMEOUT_MS = 3000;
/** Same problems are logged again at most this often (they are re-detected on every refresh). */
const REPEAT_WARNING_MS = 60 * 60_000;

export interface CatalogueSnapshot {
  /** Raw catalogue as the backend returned it; null when there is no usable copy. */
  serviceTypes: unknown[] | null;
  prices: MarketingPrices;
}

const EMPTY_SNAPSHOT: CatalogueSnapshot = Object.freeze({ serviceTypes: null, prices: NO_MARKETING_PRICES });

export interface CatalogueCache {
  /**
   * The current snapshot. Waits up to `waitMs` for a refresh only when there is no usable copy at
   * all (cold start, or the last good one is older than CATALOGUE_MAX_AGE_MS).
   */
  get(waitMs: number): Promise<CatalogueSnapshot>;
}

interface CacheOptions {
  now?: () => number;
  fetchImpl?: typeof fetch;
  log?: Pick<Console, 'warn'>;
}

/**
 * The refresh core both caches share: TTL, stale-while-revalidate, max age, retry window, one
 * failure warning per streak. `toSnapshot` turns a backend list into the snapshot (and may log);
 * `describeFailure` words the one warning a failure streak gets.
 */
function createRefreshingListCache<S>(
  url: string,
  empty: S,
  toSnapshot: (body: unknown[]) => S,
  describeFailure: (error: string, hasGoodCopy: boolean) => string,
  options: CacheOptions
): { get(waitMs: number): Promise<S> } {
  const now = options.now ?? Date.now;
  const fetchImpl = options.fetchImpl ?? fetch;
  const log = options.log ?? console;

  let good: { snapshot: S; fetchedAt: number } | null = null;
  let lastFailureAt: number | null = null;
  let failureLogged = false;
  let inFlight: Promise<void> | null = null;

  const refresh = (): Promise<void> => {
    inFlight ??= (async () => {
      try {
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body: unknown = await response.json();
        if (!Array.isArray(body)) throw new Error('response is not a list');
        good = { snapshot: toSnapshot(body), fetchedAt: now() };
        lastFailureAt = null;
        failureLogged = false;
      } catch (error) {
        lastFailureAt = now();
        // One warning per failure streak, not one per retry.
        if (!failureLogged) {
          failureLogged = true;
          log.warn(describeFailure(String((error as Error)?.message || error), !!good));
        }
      }
    })().finally(() => { inFlight = null; });
    return inFlight;
  };

  const usable = () => (good && now() - good.fetchedAt < CATALOGUE_MAX_AGE_MS ? good.snapshot : null);

  return {
    async get(waitMs: number): Promise<S> {
      const fresh = good && now() - good.fetchedAt < CATALOGUE_TTL_MS;
      if (!fresh && !(lastFailureAt !== null && now() - lastFailureAt < RETRY_AFTER_FAILURE_MS)) {
        void refresh();
      }

      const current = usable();
      if (current) return current;

      if (inFlight && waitMs > 0) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          inFlight,
          new Promise<void>(resolve => { timer = setTimeout(resolve, waitMs); })
        ]);
        clearTimeout(timer);
        const after = usable();
        if (after) return after;
      }
      return empty;
    }
  };
}

export function createCatalogueCache(url: string, options: CacheOptions = {}): CatalogueCache {
  const now = options.now ?? Date.now;
  const log = options.log ?? console;
  let lastProblems = '';
  let lastProblemsAt = 0;

  const reportProblems = (problems: string[]) => {
    const text = problems.join(' ');
    if (!text) {
      lastProblems = '';
      return;
    }
    if (text === lastProblems && now() - lastProblemsAt < REPEAT_WARNING_MS) return;
    lastProblems = text;
    lastProblemsAt = now();
    log.warn(`[marketing prices] Some prices are left out of the site and /llms.txt: ${text} ` +
      'Set the keys in Admin > Services: the ServiceKey (and Filthy Cleaning\'s display price) on Service Types, ' +
      'the Key on Extra Services.');
  };

  return createRefreshingListCache<CatalogueSnapshot>(
    url,
    EMPTY_SNAPSHOT,
    body => {
      const { prices, problems } = extractMarketingPrices(body);
      reportProblems(problems);
      return { serviceTypes: body, prices: Object.freeze(prices) };
    },
    (error, hasGoodCopy) => `[marketing prices] Service catalogue unavailable (${error}); ` +
      (hasGoodCopy ? 'keeping the last good copy for up to 30 minutes.' : 'pages render without prices.'),
    options
  );
}

export interface PublicOffersCache {
  /** The public offers as the backend returned them; null when there is no usable copy. */
  get(waitMs: number): Promise<unknown[] | null>;
}

/**
 * GET api/special-offers/public, for the home hero's welcome coupon. With no usable copy the
 * coupon is simply left to the browser, which fetches the offers after hydration as it always did.
 */
export function createPublicOffersCache(url: string, options: CacheOptions = {}): PublicOffersCache {
  return createRefreshingListCache<unknown[] | null>(
    url,
    null,
    body => body,
    (error, hasGoodCopy) => `[special offers] Public offers unavailable (${error}); ` +
      (hasGoodCopy ? 'keeping the last good copy for up to 30 minutes.' : 'the welcome coupon is left to the browser.'),
    options
  );
}
