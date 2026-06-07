import { Component, Inject, OnDestroy, OnInit, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router, RouterModule, NavigationEnd } from '@angular/router';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { SpecialOfferService, PublicSpecialOffer } from '../services/special-offer.service';

/**
 * Desktop-only marketing popup (bottom-left) promoting the first-time customer
 * discount. Appears once the visitor scrolls down from the hero on public pages.
 * Closing it hides the popup for the rest of the visit (in-memory only), but a
 * full page refresh re-creates the component so the offer pops up again.
 *
 * Mobile is intentionally excluded — the bottom sticky CTA bar already covers
 * small/touch screens (see StickyMobileCtaComponent).
 */
@Component({
  selector: 'app-first-time-offer-popup',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './first-time-offer-popup.component.html',
  styleUrl: './first-time-offer-popup.component.scss'
})
export class FirstTimeOfferPopupComponent implements OnInit, OnDestroy {
  /** Scroll distance (px) past which we reveal the popup. */
  private static readonly SCROLL_THRESHOLD = 600;

  /** Display label for the first-time discount, e.g. "10%" or "$20". Empty until loaded. */
  firstTimeDiscountLabel = '';

  private isBrowser: boolean;
  private hasScrolled = false;
  private dismissed = false;
  private _path = '/';
  private subscriptions = new Subscription();
  private scrollHandler = () => this.onScroll();

  constructor(
    private router: Router,
    private specialOfferService: SpecialOfferService,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  /** Popup shows only when: offer loaded, scrolled past hero, on an allowed route, not dismissed, on desktop. */
  get isVisible(): boolean {
    return this.isBrowser &&
      !this.dismissed &&
      this.hasScrolled &&
      !!this.firstTimeDiscountLabel &&
      !this.isHiddenRoute(this._path) &&
      this.isDesktop();
  }

  ngOnInit() {
    if (!this.isBrowser) return;

    this._path = window.location.pathname || '/';
    this.loadFirstTimeOffer();

    window.addEventListener('scroll', this.scrollHandler, { passive: true });
    // In case the page is already scrolled (e.g. back-navigation restores position)
    this.onScroll();

    this.subscriptions.add(
      this.router.events.pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd)
      ).subscribe(() => {
        this._path = window.location.pathname || '/';
      })
    );
  }

  ngOnDestroy() {
    if (this.isBrowser) {
      window.removeEventListener('scroll', this.scrollHandler);
    }
    this.subscriptions.unsubscribe();
  }

  /**
   * Hides the popup for the rest of this visit. Kept in memory only — the component
   * lives in the app shell and survives SPA navigation, but a full page refresh
   * re-creates it, so the offer pops up again after a reload.
   */
  close() {
    this.dismissed = true;
    if (this.isBrowser) {
      window.removeEventListener('scroll', this.scrollHandler);
    }
  }

  private onScroll() {
    if (this.hasScrolled) return; // sticky once revealed
    const y = window.scrollY || document.documentElement.scrollTop || 0;
    if (y > FirstTimeOfferPopupComponent.SCROLL_THRESHOLD) {
      this.hasScrolled = true;
      // Threshold met — stop listening so scrolling no longer triggers change detection.
      window.removeEventListener('scroll', this.scrollHandler);
    }
  }

  /** Loads the admin-configurable first-time offer; the percentage is never hardcoded. */
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

  /** Desktop = wide screen AND no touch input. Mobile/tablet is handled by the sticky CTA bar. */
  private isDesktop(): boolean {
    const wideScreen = window.innerWidth > 768;
    const touch = 'ontouchstart' in window ||
      (navigator.maxTouchPoints != null && navigator.maxTouchPoints > 0);
    return wideScreen && !touch;
  }

  /** Pages where admins/clients work, the booking funnel, and auth screens — no marketing popup there. */
  private isHiddenRoute(url: string): boolean {
    const path = (url || '/').split('?')[0];
    const hiddenPrefixes = [
      '/admin',
      '/profile',
      '/cleaners-dashboard',
      '/cleaner/cabinet',
      '/order',
      '/rewards',
      '/booking',            // covers /booking, /booking-confirmation, /booking-success
      '/login',
      '/auth',
      '/change-password',
      '/change-email',
      '/set-password',
      '/setup-pin',
      '/2fa-challenge',
      '/verify-email',
      '/maintenance'
    ];
    return hiddenPrefixes.some(prefix => path === prefix || path.startsWith(prefix + '/'));
  }
}
