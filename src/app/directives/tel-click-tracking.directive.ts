import { Directive, HostListener, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { PhoneClickTrackingService } from '../services/phone-click-tracking.service';

/**
 * Directive to track all tel: link clicks site-wide.
 * Attach to app root; uses document click delegation.
 * Tracks for Google Ads before allowing default tel: behavior.
 */
@Directive({
  selector: '[appTelClickTracking]',
  standalone: true
})
export class TelClickTrackingDirective {
  private isBrowser: boolean;

  constructor(
    private phoneTracking: PhoneClickTrackingService,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (!this.isBrowser) return;

    const target = event.target as HTMLElement;
    const anchor = target.closest('a[href^="tel:"]');
    if (anchor) {
      this.phoneTracking.trackPhoneClick();
    }
  }
}
