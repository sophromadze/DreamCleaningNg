import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { AnalyticsService } from './analytics.service';

/**
 * Service to track phone link clicks for Google Ads conversion tracking.
 * Pushes a `phone_click` event to the GTM dataLayer; the GTM tags own the send.
 */
@Injectable({ providedIn: 'root' })
export class PhoneClickTrackingService {
  private isBrowser: boolean;

  constructor(
    private analytics: AnalyticsService,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
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
   * Pushes a `phone_click` dataLayer event for the GTM tags to pick up.
   * @param callback Optional callback to execute after tracking (e.g., navigate to tel:)
   */
  trackPhoneClick(callback?: () => void): void {
    if (!this.isBrowser) {
      callback?.();
      return;
    }

    // Single static number now (Google's call-reporting tag handles ad attribution).
    this.analytics.pushEvent('phone_click', {
      event_category: 'contact',
      event_label: 'website_phone_call',
      value: 20,
      phone_variant: 'main'
    });

    callback?.();
  }
}
