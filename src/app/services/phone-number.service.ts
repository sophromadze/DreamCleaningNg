import { Injectable, computed } from '@angular/core';

/** A phone number in both its human-readable and tel: forms. */
export interface PhoneNumberInfo {
  /** Human-readable display form, e.g. "(929) 930-1525". */
  display: string;
  /** tel: href form, e.g. "tel:+19299301525". */
  href: string;
}

/**
 * Main business number — the single number shown to every visitor and the only
 * number rendered anywhere (SSR/prerender and client). It MUST be present in the
 * server-rendered HTML because Google's website-call-conversion snippet (in
 * index.html) swaps it client-side with a forwarding number for ad visitors.
 * Change the number here to update it everywhere.
 */
export const MAIN_NUMBER: PhoneNumberInfo = {
  display: '(929) 930-1525',
  href: 'tel:+19299301525'
};

/**
 * Single source of truth for the phone number shown across the site. Templates bind
 * to the `displayNumber()` / `telHref()` signals instead of hardcoding the number.
 *
 * The site no longer swaps numbers itself — every visitor sees {@link MAIN_NUMBER}.
 * Ad attribution is handled entirely by Google's website-call-conversion snippet in
 * index.html, which replaces the displayed main number client-side for ad visitors.
 */
@Injectable({ providedIn: 'root' })
export class PhoneNumberService {
  /** Display string for templates, e.g. "(929) 930-1525". */
  readonly displayNumber = computed(() => MAIN_NUMBER.display);

  /** tel: href for templates, e.g. "tel:+19299301525". */
  readonly telHref = computed(() => MAIN_NUMBER.href);
}
