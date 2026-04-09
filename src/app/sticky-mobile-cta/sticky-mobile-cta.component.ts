import { Component, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { PhoneClickTrackingService } from '../services/phone-click-tracking.service';
import { StickyCtaService } from '../services/sticky-cta.service';

@Component({
  selector: 'app-sticky-mobile-cta',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './sticky-mobile-cta.component.html',
  styleUrl: './sticky-mobile-cta.component.scss'
})
export class StickyMobileCtaComponent {
  isVisible = false;
  private isBrowser: boolean;

  constructor(
    private router: Router,
    private phoneTracking: PhoneClickTrackingService,
    private stickyCtaService: StickyCtaService,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  ngOnInit() {
    if (this.isBrowser) {
      this.updateVisibility();
      window.addEventListener('resize', () => this.updateVisibility());
      this.router.events.subscribe(() => this.updateVisibility());
    }
  }

  /** True if the device has a touch screen. On touch devices we always show mobile CTA regardless of width. */
  private isTouchDevice(): boolean {
    return 'ontouchstart' in window ||
      (navigator.maxTouchPoints != null && navigator.maxTouchPoints > 0);
  }

  private updateVisibility() {
    if (!this.isBrowser) return;

    const narrowScreen = window.innerWidth <= 768;
    const isMobile = narrowScreen || this.isTouchDevice();
    // Use location.pathname so we match the address bar (router.url can lack leading slash or lag)
    const path = window.location.pathname || '/';
    const hideOnRoutes = ['/booking', '/booking-confirmation', '/booking-success', '/order', '/admin', '/cleaner/cabinet'];
    const isOnExcludedRoute = hideOnRoutes.some(route =>
      path === route || path.startsWith(route + '/')
    );

    this.isVisible = isMobile && !isOnExcludedRoute;
    this.stickyCtaService.setVisible(this.isVisible);
  }

  onCallClick() {
    this.phoneTracking.trackAndCall('tel:+19299301525');
  }

}
