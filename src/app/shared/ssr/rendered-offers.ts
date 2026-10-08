import { StateKey, TransferState } from '@angular/core';
import { PublicSpecialOffer } from '../../services/special-offer.service';
import { findAdvertisedFirstTimeOffer } from '../booking/special-offer-keys';
import { SsrCatalogue } from './ssr-catalogue.token';

/**
 * The public offers a page renders its first-time-customer offer from, when the page can know them
 * WITHOUT a request: `GET api/special-offers` is on the SSR skip-list (server-url.interceptor), so a
 * page that only fetched it drew the offer after hydration and pushed everything below it down
 * (/services/deep-cleaning: CLS 0.066 on mobile, 2026-10).
 *
 *  - Server: server.ts's in-memory copy (SSR_CATALOGUE.publicOffers) — reduced to the advertised
 *    first-time offer and handed to the browser under `key`.
 *  - Hydrating browser: exactly what the server rendered from (and the key is consumed).
 *  - Otherwise null: the caller fetches as before (in-app navigation, or no catalogue on the server).
 */
export function resolveRenderedOffers(
  key: StateKey<PublicSpecialOffer[]>,
  ctx: { isBrowser: boolean; hydrating: boolean; transferState: TransferState; ssrCatalogue: SsrCatalogue | null }
): PublicSpecialOffer[] | null {
  if (!ctx.isBrowser) {
    const offers = ctx.ssrCatalogue?.publicOffers;
    if (!offers) return null;
    const advertised = findAdvertisedFirstTimeOffer(offers);
    const list = advertised ? [advertised] : [];
    ctx.transferState.set(key, list);
    return list;
  }
  if (ctx.hydrating && ctx.transferState.hasKey(key)) {
    const list = ctx.transferState.get(key, []);
    ctx.transferState.remove(key);
    return list;
  }
  return null;
}
