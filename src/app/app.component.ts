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
import { AuthService } from './services/auth.service';
import { TokenRefreshService } from './services/token-refresh.service';
import { LiveChatWidgetComponent } from './shared/live-chat-widget/live-chat-widget.component';
import { TelClickTrackingDirective } from './directives/tel-click-tracking.directive';
import { Subscription, combineLatest } from 'rxjs';
import { filter, map, mergeMap } from 'rxjs/operators';

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
    path.startsWith('/order/') ||
    path === '/verify-email';
}

function isChatHiddenRoute(url: string): boolean {
  const path = (url || '').split('?')[0];
  return path === '/admin' ||
    path.startsWith('/admin/') ||
    path.startsWith('/cleaner/cabinet');
}

function isSocialStickyHiddenRoute(url: string): boolean {
  const path = (url || '').split('?')[0];
  return path === '/admin' ||
    path.startsWith('/admin/') ||
    path.startsWith('/cleaner/cabinet') ||
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
    LiveChatWidgetComponent
  ],
  hostDirectives: [TelClickTrackingDirective],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'DreamCleaning';
  private subscriptions: Subscription = new Subscription();
  private servicesInitialized = false;

  /** Same as header: only show route content (outlet) when we have a definitive answer. */
  isAuthInitialized = false;
  isBrowser = false;
  private _path: string;

  /** Same as header showAuthUI: show loading until auth ready, then show outlet. */
  get showRouteLoading(): boolean {
    return isProtectedRoute(this._path) && !this.isAuthInitialized;
  }

  get showSocialStickyBanners(): boolean {
    return !isSocialStickyHiddenRoute(this._path);
  }

  get showLiveChat(): boolean {
    return this.isBrowser && !isChatHiddenRoute(this._path);
  }

  constructor(
    private authService: AuthService,
    private tokenRefreshService: TokenRefreshService,
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
    const url = 'https://dreamcleaningnearme.com' + (path === '/' ? '/' : path);
    let link = this.document.querySelector('link[rel="canonical"]') as HTMLLinkElement;
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
    if (!this.isBrowser) {
      return;
    }

    // Capture referral code from URL ?ref=DREAM-XXXXX and store in localStorage
    this.captureReferralCode();

    this.subscriptions.add(
      this.router.events.pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        map(() => this.getInitialPath())
      ).subscribe((path) => {
        this._path = path;
        this.cdr.detectChanges();
      })
    );

    // Update meta description and title from route data
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
        if (data['description']) {
          this.metaService.updateTag({ name: 'description', content: data['description'] });
        }
        this.updateCanonicalUrl();
      })
    );

    // Same as header: combineLatest(isInitialized$, currentUser), then when initialized hide loading (rAF + 80ms like header)
    this.subscriptions.add(
      combineLatest([
        this.authService.isInitialized$,
        this.authService.currentUser
      ]).subscribe(([initialized]) => {
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