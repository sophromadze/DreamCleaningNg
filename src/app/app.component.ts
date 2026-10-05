import { Component, OnInit, OnDestroy, Inject, PLATFORM_ID, ChangeDetectorRef } from '@angular/core';
import { DOCUMENT, CommonModule, isPlatformBrowser } from '@angular/common';
import { PlatformLocation } from '@angular/common';
import { RouterOutlet, Router, NavigationEnd, ActivatedRoute } from '@angular/router';
import { Title, Meta } from '@angular/platform-browser';
import { HeaderComponent } from './header/header.component';
import { FooterComponent } from './footer/footer.component';
import { NotificationModalComponent } from './notification-modal/notification-modal.component';
import { OrderReminderComponent } from './order-reminder/order-reminder.component';
import { FloatingActionButtonsComponent } from './floating-action-buttons/floating-action-buttons.component';
import { StickyMobileCtaComponent } from './sticky-mobile-cta/sticky-mobile-cta.component';
import { ContinueBookingComponent } from './continue-booking/continue-booking.component';
import { AuthModalComponent } from './auth/auth-modal/auth-modal.component';
import { FirstTimeOfferPopupComponent } from './first-time-offer-popup/first-time-offer-popup.component';
import { AuthService } from './services/auth.service';
import { AuthModalService } from './services/auth-modal.service';
import { TokenRefreshService } from './services/token-refresh.service';
import { AttributionService } from './services/attribution.service';
import { MarketingPricingService } from './shared/pricing/marketing-pricing.service';
// TEMPORARILY DISABLED — Telegram bot integration is off; widget is commented out in app.component.html.
// import { LiveChatWidgetComponent } from './shared/live-chat-widget/live-chat-widget.component';
// AI chat widget (visibility is server-controlled: Disabled / AdminOnly / Public)
import { ChatWidgetComponent } from './chat-widget/chat-widget.component';
import { TelClickTrackingDirective } from './directives/tel-click-tracking.directive';
import { Subscription, combineLatest } from 'rxjs';
import { filter, map, mergeMap } from 'rxjs/operators';
import { IconComponent } from './shared/icons/icon.component';
import { faFacebookF } from './shared/icons/glyphs/faFacebookF';
import { faInstagram } from './shared/icons/glyphs/faInstagram';
import { faTiktok } from './shared/icons/glyphs/faTiktok';

/** Paths that require auth; show route-loading shimmer until we know auth (same idea as header auth slot). */
function isProtectedRoute(url: string): boolean {
  const path = (url || '').split('?')[0];
  return path === '/profile' ||
    path.startsWith('/profile/') ||
    path === '/rewards' ||
    path.startsWith('/rewards/') ||
    path === '/admin' ||
    path.startsWith('/change-password') ||
    path.startsWith('/change-email') ||
    path.startsWith('/booking-confirmation') ||
    path.startsWith('/booking-success') ||
    path.startsWith('/cleaner/cabinet') ||
    path.startsWith('/cleaners-dashboard') ||
    path.startsWith('/order/') ||
    path === '/verify-email';
}

/**
 * The cleaner portal. Named once and reused by every marketing-chrome predicate below, because it
 * is ONE fact - this page is a staff tool, not a shop window - and stating it three times is how
 * the three would end up disagreeing.
 *
 * Everything those widgets offer (book a cleaning, get a quote, call sales, follow us on TikTok)
 * is addressed to a customer. A cleaner opening their schedule on a phone in a stairwell is being
 * sold to by their own employer, over the top of the job they are trying to read.
 */
function isCleanerPortalRoute(url: string): boolean {
  const path = (url || '').split('?')[0];
  return path === '/cleaner-portal' || path.startsWith('/cleaner-portal/');
}

function isChatHiddenRoute(url: string): boolean {
  const path = (url || '').split('?')[0];
  return isCleanerPortalRoute(path) ||
    path === '/admin' ||
    path.startsWith('/admin/') ||
    path.startsWith('/cleaner/cabinet') ||
    path.startsWith('/cleaners-dashboard');
}

function isSocialStickyHiddenRoute(url: string): boolean {
  const path = (url || '').split('?')[0];
  return isCleanerPortalRoute(path) ||
    path === '/admin' ||
    path.startsWith('/admin/') ||
    path.startsWith('/cleaner/cabinet') ||
    path.startsWith('/cleaners-dashboard') ||
    path === '/booking' ||
    path.startsWith('/booking/');
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    HeaderComponent,
    FooterComponent,
    NotificationModalComponent,
    OrderReminderComponent,
    FloatingActionButtonsComponent,
    StickyMobileCtaComponent,
    ContinueBookingComponent,
    AuthModalComponent,
    FirstTimeOfferPopupComponent,
    ChatWidgetComponent,
    IconComponent
    // LiveChatWidgetComponent  // disabled with the widget tag in app.component.html
  ],
  hostDirectives: [TelClickTrackingDirective],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit, OnDestroy {
  protected readonly icons = { faFacebookF, faInstagram, faTiktok };

  title = 'DreamCleaning';
  private subscriptions: Subscription = new Subscription();
  private servicesInitialized = false;

  /** Same as header: only show route content (outlet) when we have a definitive answer. */
  isAuthInitialized = false;
  isBrowser = false;
  private _path: string;

  /** Trigger for the deferred account-notice / order-reminder block: set once and kept. */
  hasSessionUser = false;
  /** Trigger for the deferred auth modal when it is asked for before the page went idle. */
  authModalRequested = false;

  /** Same as header showAuthUI: show loading until auth ready, then show outlet. */
  get showRouteLoading(): boolean {
    return isProtectedRoute(this._path) && !this.isAuthInitialized;
  }

  get showSocialStickyBanners(): boolean {
    return !isSocialStickyHiddenRoute(this._path);
  }

  /**
   * The Call / Email / Book Now / Free Quote tab on the right edge. It had NO route gate at all -
   * it has always rendered on every page - so this is the first one, and it is deliberately narrow:
   * hiding it anywhere else is a separate decision nobody has taken.
   */
  get showFloatingActions(): boolean {
    return !isCleanerPortalRoute(this._path);
  }

  get showLiveChat(): boolean {
    return this.isBrowser && !isChatHiddenRoute(this._path);
  }

  constructor(
    private authService: AuthService,
    private authModalService: AuthModalService,
    private tokenRefreshService: TokenRefreshService,
    private attributionService: AttributionService,
    // Injected here so every render - whatever the route - resolves the marketing prices and ships
    // them in TransferState: priced route descriptions need them, and the browser then never
    // has to fetch them on a later client-side navigation.
    private marketingPricing: MarketingPricingService,
    private router: Router,
    private activatedRoute: ActivatedRoute,
    private titleService: Title,
    private metaService: Meta,
    private cdr: ChangeDetectorRef,
    private platformLocation: PlatformLocation,
    @Inject(PLATFORM_ID) private platformId: Object,
    @Inject(DOCUMENT) private document: Document
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
    this._path = this.getInitialPath();
  }

  private updateCanonicalUrl(): void {
    const path = this.router.url.split('?')[0].split('#')[0];
    const url = 'https://dreamcleaningnyc.com' + (path === '/' ? '/' : path);
    let link = this.document.querySelector('link[rel="canonical"]') as HTMLLinkElement;
    // Missing after a page that took it out, e.g. a 404 that was the SSR landing page and so had
    // no canonical to put back on leave.
    if (!link && this.document.head) {
      link = this.document.createElement('link');
      link.setAttribute('rel', 'canonical');
      this.document.head.appendChild(link);
    }
    if (link) {
      link.setAttribute('href', url);
    }
  }

  private getInitialPath(): string {
    if (this.isBrowser && typeof window !== 'undefined' && window?.location?.pathname) {
      return (window.location.pathname || '').split('?')[0] || '';
    }
    return (this.platformLocation.pathname || this.router.url || '').split('?')[0] || '';
  }

  ngOnInit() {
    // Meta/title/canonical must run on SSR too — otherwise Google sees the
    // generic defaults from index.html instead of the route-specific copy
    // (with the live marketing prices). Router events fire during the
    // initial SSR render.
    this.subscriptions.add(
      this.router.events.pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        map(() => {
          let route = this.activatedRoute;
          while (route.firstChild) route = route.firstChild;
          return route;
        }),
        mergeMap(route => route.data)
      ).subscribe(data => {
        if (data['title']) {
          this.titleService.setTitle(data['title']);
        }
        // A description that quotes prices is a function of them (see PricedDescription in
        // app.routes.ts); the prices are already resolved here, on the server and in the browser.
        const description = typeof data['description'] === 'function'
          ? data['description'](this.marketingPricing.text())
          : data['description'];
        if (description) {
          this.metaService.updateTag({ name: 'description', content: description });
        }
        // The 404 page removes the canonical itself (a canonical to a URL that does not
        // exist contradicts the 404), so it must not be written back here.
        if (!data['noCanonical']) {
          this.updateCanonicalUrl();
        }
      })
    );

    if (!this.isBrowser) {
      return;
    }

    // Capture first-touch acquisition attribution (channel/source/medium/campaign) into the
    // dc_attribution cookie before anything rewrites the URL. No-op if already captured.
    this.attributionService.captureFirstTouch();
    // Re-evaluate the converting session (30-min window; new campaign/referrer starts a new one).
    this.attributionService.captureSession();

    // Capture referral code from URL ?ref=DREAM-XXXXX and store in localStorage
    this.captureReferralCode();

    this.subscriptions.add(
      this.authModalService.isOpen$.subscribe(isOpen => {
        if (isOpen) this.authModalRequested = true;
      })
    );

    this.subscriptions.add(
      this.router.events.pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        map(() => this.getInitialPath())
      ).subscribe((path) => {
        this._path = path;
        this.cdr.detectChanges();
      })
    );

    // Same as header: combineLatest(isInitialized$, currentUser), then when initialized hide loading (rAF + 80ms like header)
    this.subscriptions.add(
      combineLatest([
        this.authService.isInitialized$,
        this.authService.currentUser
      ]).subscribe(([initialized, user]) => {
        if (user) this.hasSessionUser = true;
        if (initialized && !this.servicesInitialized) {
          this.servicesInitialized = true;
          this.tokenRefreshService.startTokenRefresh();
          const authSub = this.authService.currentUser.subscribe(u => {
            if (u) localStorage.setItem('lastActivity', Date.now().toString());
            else this.tokenRefreshService.stopTokenRefresh();
          });
          this.subscriptions.add(authSub);
          if (this.authService.isLoggedIn()) {
            localStorage.setItem('lastActivity', Date.now().toString());
          }
        }
        // Same as header: show route content (hide loading) after auth ready; rAF + 80ms so shimmer visible at least one frame
        if (initialized && this.isBrowser) {
          const hideLoadingNow = () => {
            this.isAuthInitialized = true;
            this.cdr.detectChanges();
          };
          if (typeof requestAnimationFrame !== 'undefined') {
            requestAnimationFrame(() => {
              setTimeout(hideLoadingNow, 80);
            });
          } else {
            setTimeout(hideLoadingNow, 80);
          }
        }
      })
    );
  }

  ngOnDestroy() {
    // Clean up all subscriptions
    this.subscriptions.unsubscribe();

    // Stop token refresh
    this.tokenRefreshService.stopTokenRefresh();
  }

  private captureReferralCode(): void {
    if (!this.isBrowser) return;
    try {
      const params = new URLSearchParams(window.location.search);
      const ref = params.get('ref');
      if (ref && /^DREAM-[A-Z0-9]{5}$/i.test(ref)) {
        localStorage.setItem('dreamcleaning_referral', ref.toUpperCase());
        // Clean up the URL without reloading
        this.router.navigate([], {
          queryParams: { ref: null },
          queryParamsHandling: 'merge',
          replaceUrl: true
        });
      }
    } catch { }
  }
}