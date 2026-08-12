import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/**
 * The ONLY place the app pushes to the GTM dataLayer, and since Phase 2 the ONLY analytics
 * path in the app at all — the legacy `window.gtag('event', …)` calls and the hardcoded
 * gtag.js snippet in index.html were removed, so GA4 and Google Ads are driven entirely by
 * tags in GTM container GTM-PMSDXVF3 triggering on these events.
 *
 * Events pushed: purchase, phone_click, quote_form_submit, contact_form_submit,
 * poll_form_submit. Callers own their own dedupe guards.
 */

/** Scalar parameters. */
const FLAT_PARAM_KEYS = [
  'event_category',
  'event_label',
  'value',
  'currency',
  'transaction_id',
  'phone_variant',
  'service_type'
] as const;

/** Nested object parameters. */
const OBJECT_PARAM_KEYS = ['user_data'] as const;

/**
 * Every parameter key any tracked event sends, across all events.
 *
 * GTM's data model MERGES pushes and keys persist for the lifetime of the page, so an event
 * that omits a key would let a tag read the previous event's value (e.g. `phone_click` sets
 * `phone_variant: 'main'`, then a later `contact_form_submit` that omits it would still read
 * 'main'). Every push therefore carries the full key set, with `null` for keys that don't
 * apply to that event, which clears the stale value.
 *
 * This matters most for `user_data`: only `purchase` sends it, and clearing it on every other
 * event stops customer PII from lingering in the data model where a tag firing on a later
 * event on the same page could read it (/booking-success renders phone links, so a subsequent
 * phone_click there is a real path, not a hypothetical one).
 */
const TRACKED_PARAM_KEYS = [...FLAT_PARAM_KEYS, ...OBJECT_PARAM_KEYS] as const;

/**
 * Enhanced Conversions identity signals, in Google's documented `user_data` shape.
 *
 * Values are PLAIN TEXT by design — Google's tag hashes them (SHA-256) client-side before
 * transmission. Do NOT hash them before passing them in. GTM reads them via a
 * User-Provided Data variable pointed at the `user_data` key.
 */
export interface AnalyticsUserData {
  email_address?: string;
  phone_number?: string;
  address?: {
    first_name?: string;
    last_name?: string;
    street?: string;
    city?: string;
    region?: string;
    postal_code?: string;
    country?: string;
  };
}

export type AnalyticsParams =
  Partial<Record<typeof FLAT_PARAM_KEYS[number], string | number>> &
  { user_data?: AnalyticsUserData };

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly isBrowser: boolean;

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  /**
   * Push a named event to the GTM dataLayer. Browser-only (no-ops under SSR/prerender).
   */
  pushEvent(event: string, params: AnalyticsParams = {}): void {
    if (!this.isBrowser) return;

    try {
      window.dataLayer = window.dataLayer || [];

      const payload: Record<string, unknown> = { event };
      for (const key of TRACKED_PARAM_KEYS) {
        payload[key] = params[key] ?? null;
      }

      window.dataLayer.push(payload);
    } catch {
      // Silent fail — never break UI over tracking.
    }
  }
}
