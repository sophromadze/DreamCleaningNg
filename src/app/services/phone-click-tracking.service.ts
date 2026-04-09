import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
  }
}

/**
 * Service to track phone link clicks for Google Ads conversion tracking.
 * Fires gtag events that can be imported into Google Ads as conversions.
 */
@Injectable({ providedIn: 'root' })
export class PhoneClickTrackingService {
  private isBrowser: boolean;

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  /**
   * Track phone click and initiate the call.
   * Use this for programmatic tel: links (e.g., buttons that trigger calls).
   */
  trackAndCall(telUrl: string = 'tel:+19299301525'): void {
    if (!this.isBrowser) return;

    this.trackPhoneClick(() => {
      window.location.href = telUrl;
    });
  }

  /**
   * Track phone click event. Call this before navigating to tel: link.
   * Uses GA4 event (importable into Google Ads as conversion).
   * @param callback Optional callback to execute after tracking (e.g., navigate to tel:)
   */
  trackPhoneClick(callback?: () => void): void {
    if (!this.isBrowser) {
      callback?.();
      return;
    }

    try {
      if (typeof window.gtag === 'function') {
        // GA4 event - can be imported into Google Ads as conversion
        window.gtag('event', 'phone_click', {
          event_category: 'contact',
          event_label: 'website_phone_call',
          value: 20
        });
        // Also send Google Ads conversion (replace PHONE_CLICK_LABEL when creating conversion in Google Ads)
        window.gtag('event', 'conversion', {
          send_to: 'AW-16660459036/PHONE_CLICK_LABEL'
        });
      }
    } catch {
      // Ignore tracking errors
    }
    callback?.();
  }
}
