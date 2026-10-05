import { computed, inject, Injectable, makeStateKey, PLATFORM_ID, signal, TransferState } from '@angular/core';
import { isPlatformServer } from '@angular/common';
import { BookingService } from '../../services/booking.service';
import { SSR_CATALOGUE } from '../ssr/ssr-catalogue.token';
import {
  formatDisplayPrice,
  formatMarketingMoney,
  MarketingDisplayPrice,
  MarketingPrices,
  NO_MARKETING_PRICES
} from './marketing-price-format';

const MARKETING_PRICES_KEY = makeStateKey<MarketingPrices>('marketing-prices');

/** Prices worded for copy. null = leave that fragment out (or use the neutral wording). */
export interface MarketingPriceText {
  /** "$130" */
  standardFrom: string | null;
  deepFrom: string | null;
  moveInOutFrom: string | null;
  /** "$50" - the per-cleaner hourly amount; the copy around it says "per hour per cleaner". */
  customPerHour: string | null;
  heavyPerHour: string | null;
  /** "$100 per hour per cleaner", "$100 per hour", "from $100" */
  filthy: string | null;
  /** "$100/hour per cleaner", "$100/hour", "from $100" - for copy that uses the slash form. */
  filthyShort: string | null;
  /** "$38" - the Cleaning Supplies / Vacuum Cleaner extras. */
  suppliesExtra: string | null;
  vacuumExtra: string | null;
}

function shortDisplayPrice(price: MarketingDisplayPrice): string {
  const money = formatMarketingMoney(price.amount);
  switch (price.unit) {
    case 'per-hour-per-cleaner': return `${money}/hour per cleaner`;
    case 'per-hour': return `${money}/hour`;
    case 'from': return `from ${money}`;
  }
}

/**
 * The ONE source of marketing prices for every public page, route meta description and JSON-LD
 * block (see shared/pricing/marketing-prices.ts for how each is derived from the catalogue).
 *
 * - Server: reads the prices server.ts resolved from its in-memory catalogue (SSR_CATALOGUE) and
 *   ships them in TransferState (~200 bytes; never the catalogue itself). AppComponent injects this
 *   service, so every render carries them.
 * - Browser: takes them from TransferState once - no request, and the first render matches the
 *   server HTML exactly, so nothing shifts. Prices that were null on the server (backend down,
 *   key not set) stay null for the session: the pages keep their neutral wording, never an old
 *   hard-coded price.
 * - Only when no server render carried them at all (a dev server without server.ts) does the
 *   browser fetch the catalogue itself - and only then loads the derivation (marketing-prices.ts
 *   and the booking calculator behind it), so neither is part of the initial bundle.
 */
@Injectable({ providedIn: 'root' })
export class MarketingPricingService {
  private readonly state = signal<MarketingPrices>(NO_MARKETING_PRICES);

  /** Numbers, for JSON-LD offers and anything that computes. */
  readonly prices = this.state.asReadonly();

  readonly text = computed<MarketingPriceText>(() => {
    const p = this.state();
    const money = (v: number | null) => (v === null ? null : formatMarketingMoney(v));
    return {
      standardFrom: money(p.standardFrom),
      deepFrom: money(p.deepFrom),
      moveInOutFrom: money(p.moveInOutFrom),
      customPerHour: money(p.customPerHour),
      heavyPerHour: money(p.heavyPerHour),
      filthy: p.filthy ? formatDisplayPrice(p.filthy) : null,
      filthyShort: p.filthy ? shortDisplayPrice(p.filthy) : null,
      suppliesExtra: money(p.suppliesExtra),
      vacuumExtra: money(p.vacuumExtra)
    };
  });

  constructor() {
    const transferState = inject(TransferState);

    if (isPlatformServer(inject(PLATFORM_ID))) {
      const catalogue = inject(SSR_CATALOGUE, { optional: true });
      if (catalogue) {
        this.state.set(catalogue.prices);
        transferState.set(MARKETING_PRICES_KEY, catalogue.prices);
      }
      return;
    }

    if (transferState.hasKey(MARKETING_PRICES_KEY)) {
      this.state.set(transferState.get(MARKETING_PRICES_KEY, NO_MARKETING_PRICES));
      return;
    }

    inject(BookingService).getServiceTypes().subscribe({
      next: catalogue => {
        import('./marketing-prices')
          .then(({ extractMarketingPrices }) => this.state.set(extractMarketingPrices(catalogue).prices))
          .catch(() => { /* keep the neutral wording */ });
      },
      error: () => { /* keep the neutral wording */ }
    });
  }
}
