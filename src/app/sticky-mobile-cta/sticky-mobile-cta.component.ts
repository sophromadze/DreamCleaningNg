import { Component, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { StickyCtaService } from '../services/sticky-cta.service';
import { SpecialOfferService, PublicSpecialOffer } from '../services/special-offer.service';

@Component({
  selector: 'app-sticky-mobile-cta',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './sticky-mobile-cta.component.html',
  styleUrl: './sticky-mobile-cta.component.scss'
})
export class StickyMobileCtaComponent {
  isVisible = false;
  /** Display label for the first-time discount, e.g. "10%" or "$20". Empty until loaded. */
  firstTimeDiscountLabel = '';
  private isBrowser: boolean;

  constructor(
    private router: Router,
    private stickyCtaService: StickyCtaService,
    private specialOfferService: SpecialOfferService,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  ngOnInit() {
    if (this.isBrowser) {
      this.updateVisibility();
      this.loadFirstTimeOffer();
      window.addEventListener('resize', () => this.updateVisibility());
      this.router.events.subscribe(() => this.updateVisibility());
    }
  }

  /** Loads the admin-configurable first-time offer; percentage is never hardcoded. */
  private loadFirstTimeOffer() {
    this.specialOfferService.getPublicSpecialOffers().subscribe({
      next: (offers) => {
        const offer = offers?.find(o =>
          o.requiresFirstTimeCustomer ||
          o.type === 'FirstTime' ||
          (o.name?.toLowerCase().includes('first time') ?? false) ||
          (o.name?.toLowerCase().includes('first-time') ?? false)
        );
        this.firstTimeDiscountLabel = this.buildDiscountLabel(offer);
      },
      error: () => { this.firstTimeDiscountLabel = ''; }
    });
  }

  private buildDiscountLabel(offer?: PublicSpecialOffer): string {
    if (!offer) return '';
    return offer.isPercentage ? `${offer.discountValue}%` : `$${offer.discountValue}`;
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
    // '/cleaner-portal' for the same reason as the rest of the staff pages: this bar sells a
    // cleaning, and it would sit across the bottom of a cleaner's schedule on the phone they read
    // it on.
    const hideOnRoutes = ['/booking', '/booking-confirmation', '/booking-success', '/order', '/admin', '/cleaner/cabinet', '/cleaners-dashboard', '/cleaner-portal'];
    const isOnExcludedRoute = hideOnRoutes.some(route =>
      path === route || path.startsWith(route + '/')
    );

    this.isVisible = isMobile && !isOnExcludedRoute;
    this.stickyCtaService.setVisible(this.isVisible);
  }

}
