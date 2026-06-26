import { Injectable, signal, computed, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/** A phone number in both its human-readable and tel: forms. */
export interface PhoneNumberInfo {
  /** Human-readable display form, e.g. "(929) 930-1525". */
  display: string;
  /** tel: href form, e.g. "tel:+19299301525". */
  href: string;
}

/**
 * Main business number — shown to every visitor by default and the ONLY number
 * rendered on the server (SSR/prerender), so there is never a hydration mismatch.
 * Change the number here to update it everywhere.
 */
export const MAIN_NUMBER: PhoneNumberInfo = {
  display: '(929) 930-1525',
  href: 'tel:+19299301525'
};

/**
 * Dedicated Google Ads tracking number — shown only to visitors who arrived via a
 * paid ad, so ad-driven calls can be attributed. Change it here to update it everywhere.
 */
export const AD_NUMBER: PhoneNumberInfo = {
  display: '(929) 419-5681',
  href: 'tel:+19294195681'
};

/** sessionStorage flag persisting "this visitor came from an ad" across the session. */
const AD_VISITOR_STORAGE_KEY = 'dc_ad_visitor';

/**
 * Single source of truth for the phone number shown across the site. Templates bind
 * to the `displayNumber()` / `telHref()` signals instead of hardcoding the number.
 *
 * Ad visitors (arrived via Google Ads) see {@link AD_NUMBER}; everyone else sees
 * {@link MAIN_NUMBER}. Detection runs browser-only after hydration (see
 * {@link initAdDetection}) and is persisted in sessionStorage so the swapped number
 * stays put as the visitor navigates between pages.
 */
@Injectable({ providedIn: 'root' })
export class PhoneNumberService {
  private readonly isBrowser: boolean;

  /** True once we've determined the visitor arrived from a paid ad. */
  private readonly _isAdVisitor = signal(false);
  readonly isAdVisitor = this._isAdVisitor.asReadonly();

  /** The number currently in effect (ad number for ad visitors, otherwise main). */
  private readonly active = computed(() => (this._isAdVisitor() ? AD_NUMBER : MAIN_NUMBER));

  /** Display string for templates, e.g. "(929) 930-1525". */
  readonly displayNumber = computed(() => this.active().display);

  /** tel: href for templates, e.g. "tel:+19299301525". */
  readonly telHref = computed(() => this.active().href);

  constructor(@Inject(PLATFORM_ID) platformId: Object) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  /** Which number is currently shown — used to tag the GA4 phone_click event. */
  get variant(): 'ad' | 'main' {
    return this._isAdVisitor() ? 'ad' : 'main';
  }

  /**
   * Browser-only ad detection. Call once after hydration (via afterNextRender) so the
   * server still renders the MAIN number — a brief flash of the main number before the
   * swap is acceptable since JS runs before the visitor can click. The result is stored
   * in sessionStorage so the swap survives navigation and refreshes within the session.
   */
  initAdDetection(): void {
    if (!this.isBrowser) return;

    // Flagged earlier this session (e.g. a later page with no gclid) → keep the ad number.
    try {
      if (sessionStorage.getItem(AD_VISITOR_STORAGE_KEY) === '1') {
        this._isAdVisitor.set(true);
        return;
      }
    } catch {
      // sessionStorage can throw in private mode / restricted contexts — ignore.
    }

    if (this.arrivedFromAd()) {
      try {
        sessionStorage.setItem(AD_VISITOR_STORAGE_KEY, '1');
      } catch {
        // Ignore persistence failures; the in-memory signal still swaps for this page.
      }
      this._isAdVisitor.set(true);
    }
  }

  /** Inspect the current URL query string for Google Ads / paid-campaign markers. */
  private arrivedFromAd(): boolean {
    let search = '';
    try {
      search = window.location.search || '';
    } catch {
      return false;
    }
    if (!search) return false;

    const params = new URLSearchParams(search);

    // Google Ads click identifiers: gclid plus the iOS/web app-conversion variants.
    if (params.has('gclid') || params.has('gbraid') || params.has('wbraid')) {
      return true;
    }

    // Paid traffic via UTM tagging: utm_medium in {cpc, ppc, paid, ...}
    // (also covers utm_source=google paired with a paid medium).
    const medium = (params.get('utm_medium') || '').toLowerCase();
    const paidMediums = ['cpc', 'ppc', 'paid', 'paidsearch', 'paid_search'];
    if (paidMediums.includes(medium)) {
      return true;
    }

    return false;
  }
}
