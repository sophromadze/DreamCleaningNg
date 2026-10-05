import { InjectionToken } from '@angular/core';
import type { ServiceType } from '../../services/booking.service';
import type { MarketingPrices } from '../pricing/marketing-price-format';
import type { PublicSpecialOffer } from '../../services/special-offer.service';

/**
 * The public service catalogue as server.ts holds it in memory (see catalogue-cache.ts), handed
 * to every render via platformProviders so SSR never calls the backend for it: the home hero
 * builds its form from `serviceTypes` and MarketingPricingService reads `prices`.
 *
 * `serviceTypes` is null when the backend is unreachable or refuses (SIR's gated backend answers
 * 401); `prices` is then all-null and every surface uses its price-less wording. In the browser
 * the token is absent - inject with { optional: true }.
 */
export interface SsrCatalogue {
  serviceTypes: ServiceType[] | null;
  prices: MarketingPrices;
  /**
   * GET api/special-offers/public, held the same way (the home hero's welcome coupon). Null when
   * the backend is unreachable; the browser then fetches it after hydration, as it used to.
   */
  publicOffers?: PublicSpecialOffer[] | null;
}

export const SSR_CATALOGUE = new InjectionToken<SsrCatalogue>('SSR_CATALOGUE');
