import {
  Component,
  OnInit,
  OnDestroy,
  Inject,
  PLATFORM_ID,
  ChangeDetectorRef,
  ViewChild,
  ElementRef
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HomeHeroComponent } from '../shared/components/home-hero/home-hero.component';
import { TestimonialSectionComponent } from '../shared/components/testimonial-section/testimonial-section.component';
import { SpecialOfferService, PublicSpecialOffer } from '../services/special-offer.service';
import { AuthService } from '../services/auth.service';
import { AuthModalService } from '../services/auth-modal.service';
import { BeforeAfterPhotoService } from '../services/before-after-photo.service';
import { SERVICE_PRICING } from '../shared/service-pricing.data';
import { Subscription } from 'rxjs';

/** Public-facing before/after photo card — populated from BeforeAfterPhotosController. */
export interface BeforeAfterPhoto {
  id: number;
  title: string;
  subtitle?: string | null;
  beforePhotoUrl: string;
  afterPhotoUrl: string;
  linkUrl?: string | null;
  displayOrder: number;
}

@Component({
  selector: 'app-main',
  standalone: true,
  imports: [CommonModule, RouterLink, HomeHeroComponent, TestimonialSectionComponent],
  templateUrl: './main.component.html',
  styleUrl: './main.component.scss'
})
export class MainComponent implements OnInit, OnDestroy {
  specialOffers: PublicSpecialOffer[] = [];
  isLoggedIn: boolean = false;
  private subscription: Subscription = new Subscription();
  /** Protected (not private) so the template can gate auth-dependent content to the
   *  browser only — see the rewards login note. Prerendered HTML must not contain
   *  auth-dependent branches or hydration leaves a stale node behind (duplicate notes). */
  protected isBrowser: boolean;

  /** Marketing-copy prices (centralized in shared/service-pricing.data.ts). */
  readonly pricing = SERVICE_PRICING;

  /** Photos rendered in the "See the difference" gallery. Empty until the
   *  admin uploads pairs in Admin → Before & After. */
  beforeAfterPhotos: BeforeAfterPhoto[] = [];

  /** Padded to at least 3 items so the 3-across track math is stable. */
  beforeAfterBasePhotos: BeforeAfterPhoto[] = [];
  /** Triple of {@link beforeAfterBasePhotos} for seamless infinite scrolling. */
  beforeAfterCarouselSlides: BeforeAfterPhoto[] = [];
  /** Length of {@link beforeAfterBasePhotos}. */
  beforeAfterBaseLength = 0;
  /** Index in {@link beforeAfterCarouselSlides} of the leftmost visible slide (middle copy at init). */
  beforeAfterOffset = 0;
  beforeAfterTranslatePx = 0;
  beforeAfterStepPx = 0;
  beforeAfterSkipTransition = false;
  /** How many before/after cards fit across — driven by window width (see breakpoints below). */
  beforeAfterVisibleCount: 1 | 2 | 3 = 3;

  @ViewChild('beforeAfterViewport') beforeAfterViewport?: ElementRef<HTMLElement>;

  private beforeAfterViewDisposed = false;
  private beforeAfterLayoutRaf = 0;
  private beforeAfterResizeObserver: ResizeObserver | null = null;
  private beforeAfterAutoplayTimer: ReturnType<typeof setInterval> | null = null;
  private beforeAfterRecenterTimer: ReturnType<typeof setTimeout> | null = null;
  private beforeAfterMotionOk = true;
  private static readonly BEFORE_AFTER_AUTO_MS = 5000;
  private static readonly BEFORE_AFTER_TRANSITION_MS = 320;
  /** Match carousel columns to window width (not the inner viewport — container is narrower). */
  private static readonly BEFORE_AFTER_WIN_WIDE = 1200;
  private static readonly BEFORE_AFTER_WIN_NARROW = 768;

  constructor(
    private specialOfferService: SpecialOfferService,
    private authService: AuthService,
    private authModalService: AuthModalService,
    private cdr: ChangeDetectorRef,
    private beforeAfterPhotoService: BeforeAfterPhotoService,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
    if (this.isBrowser && typeof matchMedia !== 'undefined') {
      this.beforeAfterMotionOk = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
  }

  ngOnInit() {
    this.loadSpecialOffers();
    this.checkAuthStatus();
    // Fetch admin-uploaded before/after photos.
    this.loadBeforeAfterPhotos();
  }

  ngOnDestroy() {
    this.subscription.unsubscribe();
    this.disposeBeforeAfterCarouselView();
  }

  // ---------- Before/After photos ----------
  private loadBeforeAfterPhotos() {
    if (!this.isBrowser) return;
    this.subscription.add(
      this.beforeAfterPhotoService.getPublic().subscribe({
        next: (photos) => {
          this.beforeAfterPhotos = (photos || []).map(p => ({
            id: p.id,
            title: p.title,
            subtitle: p.subtitle,
            beforePhotoUrl: p.beforePhotoUrl,
            afterPhotoUrl: p.afterPhotoUrl,
            linkUrl: p.linkUrl,
            displayOrder: p.displayOrder
          }));
          this.rebuildBeforeAfterCarousel();
          this.cdr.detectChanges();
          setTimeout(() => {
            this.updateBeforeAfterLayoutMetrics();
            this.attachBeforeAfterResizeObserver();
            this.startBeforeAfterAutoplay();
          }, 0);
        },
        error: () => {
          // Endpoint not available yet (backend not deployed) — section just stays hidden.
          this.beforeAfterPhotos = [];
          this.rebuildBeforeAfterCarousel();
          this.teardownBeforeAfterCarousel();
          this.cdr.detectChanges();
        }
      })
    );
  }

  trackBeforeAfterSlideIndex(index: number): number {
    return index;
  }

  onBeforeAfterPrev(): void {
    this.restartBeforeAfterAutoplay();
    this.advanceBeforeAfter(-1);
  }

  onBeforeAfterNext(): void {
    this.restartBeforeAfterAutoplay();
    this.advanceBeforeAfter(1);
  }

  private rebuildBeforeAfterCarousel(): void {
    this.teardownBeforeAfterCarouselTimersOnly();
    const src = this.beforeAfterPhotos;
    if (src.length === 0) {
      this.beforeAfterBasePhotos = [];
      this.beforeAfterCarouselSlides = [];
      this.beforeAfterBaseLength = 0;
      this.beforeAfterOffset = 0;
      this.beforeAfterTranslatePx = 0;
      this.beforeAfterStepPx = 0;
      return;
    }
    const base = this.buildBeforeAfterBase(src);
    this.beforeAfterBasePhotos = base;
    this.beforeAfterBaseLength = base.length;
    this.beforeAfterStepPx = 0;
    this.beforeAfterCarouselSlides = [...base, ...base, ...base];
    this.beforeAfterOffset = this.beforeAfterBaseLength;
    this.beforeAfterSkipTransition = true;
    this.syncBeforeAfterTranslate();
  }

  private buildBeforeAfterBase(photos: BeforeAfterPhoto[]): BeforeAfterPhoto[] {
    const base = [...photos];
    let i = 0;
    while (base.length < 3) {
      base.push(photos[i % photos.length]);
      i++;
    }
    return base;
  }

  private attachBeforeAfterResizeObserver(): void {
    if (!this.isBrowser) return;
    const el = this.beforeAfterViewport?.nativeElement;
    if (!el || this.beforeAfterCarouselSlides.length === 0) return;
    this.beforeAfterResizeObserver?.disconnect();
    this.beforeAfterResizeObserver = new ResizeObserver(() => {
      this.scheduleBeforeAfterLayoutFromResize();
    });
    this.beforeAfterResizeObserver.observe(el);
  }

  /** Batches ResizeObserver + layout reads to the next frame to avoid re-entrant CD / SES issues. */
  private scheduleBeforeAfterLayoutFromResize(): void {
    if (!this.isBrowser || this.beforeAfterViewDisposed) return;
    if (this.beforeAfterLayoutRaf !== 0) {
      cancelAnimationFrame(this.beforeAfterLayoutRaf);
    }
    this.beforeAfterLayoutRaf = requestAnimationFrame(() => {
      this.beforeAfterLayoutRaf = 0;
      if (this.beforeAfterViewDisposed) return;
      this.updateBeforeAfterLayoutMetrics();
      this.cdr.detectChanges();
    });
  }

  private resolveBeforeAfterVisibleCount(windowWidth: number): 1 | 2 | 3 {
    if (windowWidth <= MainComponent.BEFORE_AFTER_WIN_NARROW) return 1;
    if (windowWidth <= MainComponent.BEFORE_AFTER_WIN_WIDE) return 2;
    return 3;
  }

  private updateBeforeAfterLayoutMetrics(): void {
    if (this.beforeAfterViewDisposed) return;
    const vp = this.beforeAfterViewport?.nativeElement;
    if (!vp || this.beforeAfterCarouselSlides.length === 0) return;
    const track = vp.querySelector('.before-after-carousel__track') as HTMLElement | null;
    if (!track) return;

    const gapStr = getComputedStyle(track).gap || '0px';
    let gapPx = parseFloat(gapStr);
    if (!Number.isFinite(gapPx)) gapPx = 0;

    const vpStyle = getComputedStyle(vp);
    const vpPadH =
      (parseFloat(vpStyle.paddingLeft) || 0) + (parseFloat(vpStyle.paddingRight) || 0);
    const vpContentW = Math.max(0, vp.clientWidth - vpPadH);
    if (vp.clientWidth <= 0 || vpContentW <= 0) return;

    const layoutW =
      this.isBrowser && typeof window !== 'undefined' ? window.innerWidth : vpContentW;
    const nextVisible = this.resolveBeforeAfterVisibleCount(layoutW);
    const visibleChanged = nextVisible !== this.beforeAfterVisibleCount;
    this.beforeAfterVisibleCount = nextVisible;

    const gapsBetween = Math.max(0, this.beforeAfterVisibleCount - 1);
    const slideW = Math.max(
      1,
      (vpContentW - gapsBetween * gapPx) / this.beforeAfterVisibleCount
    );
    vp.style.setProperty('--ba-slide-w', `${slideW}px`);

    const nextStep = slideW + gapPx;
    if (!Number.isFinite(nextStep) || nextStep <= 0) return;

    const stepChanged = Math.abs(nextStep - this.beforeAfterStepPx) > 0.25;
    if (stepChanged || visibleChanged) {
      this.beforeAfterStepPx = nextStep;
      this.beforeAfterSkipTransition = true;
      this.syncBeforeAfterTranslate();
      requestAnimationFrame(() => {
        if (this.beforeAfterViewDisposed) return;
        this.beforeAfterSkipTransition = false;
        this.cdr.detectChanges();
      });
    } else {
      this.beforeAfterStepPx = nextStep;
      this.syncBeforeAfterTranslate();
    }
  }

  private syncBeforeAfterTranslate(): void {
    const t = this.beforeAfterOffset * this.beforeAfterStepPx;
    this.beforeAfterTranslatePx = Number.isFinite(t) ? t : 0;
  }

  private advanceBeforeAfter(delta: 1 | -1): void {
    if (!this.isBrowser || this.beforeAfterBaseLength === 0) return;
    if (this.beforeAfterStepPx <= 0) {
      this.updateBeforeAfterLayoutMetrics();
    }
    if (this.beforeAfterStepPx <= 0) return;

    this.beforeAfterSkipTransition = false;
    const m = this.beforeAfterBaseLength;
    this.beforeAfterOffset += delta;
    this.syncBeforeAfterTranslate();
    this.cdr.detectChanges();

    if (delta > 0 && this.beforeAfterOffset >= 2 * m) {
      this.scheduleBeforeAfterRecenter(() => {
        // Preserve overshoot: rapid clicks/auto-ticks during the recenter timer can leave
        // offset at 2m+k. Snapping to a hardcoded `m` would rewind the visible content by
        // k positions (offset 2m+k shows the same slides as m+k, but resetting to m shows
        // m). Subtracting one base length keeps the visual position stable.
        this.beforeAfterSkipTransition = true;
        this.beforeAfterOffset = this.beforeAfterOffset - m;
        this.syncBeforeAfterTranslate();
        requestAnimationFrame(() => {
          this.beforeAfterSkipTransition = false;
          this.cdr.detectChanges();
        });
      });
    } else if (delta < 0 && this.beforeAfterOffset < m) {
      this.scheduleBeforeAfterRecenter(() => {
        // Symmetric overshoot preservation for the back-button path: offset m-1-k maps to
        // 2m-1-k (same content), not the hardcoded 2m-1.
        this.beforeAfterSkipTransition = true;
        this.beforeAfterOffset = this.beforeAfterOffset + m;
        this.syncBeforeAfterTranslate();
        requestAnimationFrame(() => {
          this.beforeAfterSkipTransition = false;
          this.cdr.detectChanges();
        });
      });
    }
  }

  private scheduleBeforeAfterRecenter(cb: () => void): void {
    if (this.beforeAfterRecenterTimer) {
      clearTimeout(this.beforeAfterRecenterTimer);
      this.beforeAfterRecenterTimer = null;
    }
    this.beforeAfterRecenterTimer = setTimeout(() => {
      this.beforeAfterRecenterTimer = null;
      cb();
      this.cdr.detectChanges();
    }, MainComponent.BEFORE_AFTER_TRANSITION_MS);
  }

  private startBeforeAfterAutoplay(): void {
    this.stopBeforeAfterAutoplay();
    if (!this.isBrowser || !this.beforeAfterMotionOk) return;
    if (this.beforeAfterBaseLength === 0) return;
    this.beforeAfterAutoplayTimer = setInterval(() => {
      this.advanceBeforeAfter(1);
      this.cdr.detectChanges();
    }, MainComponent.BEFORE_AFTER_AUTO_MS);
  }

  private restartBeforeAfterAutoplay(): void {
    this.startBeforeAfterAutoplay();
  }

  private stopBeforeAfterAutoplay(): void {
    if (this.beforeAfterAutoplayTimer) {
      clearInterval(this.beforeAfterAutoplayTimer);
      this.beforeAfterAutoplayTimer = null;
    }
  }

  private teardownBeforeAfterCarouselTimersOnly(): void {
    this.stopBeforeAfterAutoplay();
    if (this.beforeAfterRecenterTimer) {
      clearTimeout(this.beforeAfterRecenterTimer);
      this.beforeAfterRecenterTimer = null;
    }
  }

  private cancelBeforeAfterLayoutRaf(): void {
    if (this.beforeAfterLayoutRaf !== 0) {
      cancelAnimationFrame(this.beforeAfterLayoutRaf);
      this.beforeAfterLayoutRaf = 0;
    }
  }

  private teardownBeforeAfterCarousel(): void {
    this.cancelBeforeAfterLayoutRaf();
    this.teardownBeforeAfterCarouselTimersOnly();
    this.beforeAfterResizeObserver?.disconnect();
    this.beforeAfterResizeObserver = null;
  }

  private disposeBeforeAfterCarouselView(): void {
    this.beforeAfterViewDisposed = true;
    this.teardownBeforeAfterCarousel();
  }

  // ---------- Special offers / auth ----------
  private loadSpecialOffers() {
    this.subscription.add(
      this.specialOfferService.getPublicSpecialOffers().subscribe({
        next: (offers) => {
          this.specialOffers = offers;
        },
        error: (error) => {
          console.error('Error loading special offers:', error);
        }
      })
    );
  }

  private checkAuthStatus() {
    // Set initial auth state
    this.isLoggedIn = this.authService.isLoggedIn();

    // Subscribe to authentication state changes
    this.subscription.add(
      this.authService.currentUser.subscribe(user => {
        this.isLoggedIn = !!user;
        // Force change detection
        this.cdr.detectChanges();
      })
    );
  }

  /** First-time customer offer from the public special offers (percentage is admin-configurable, never hardcoded). */
  get firstTimeOffer(): PublicSpecialOffer | undefined {
    return this.specialOffers?.find(o =>
      o.requiresFirstTimeCustomer ||
      o.type === 'FirstTime' ||
      (o.name?.toLowerCase().includes('first time') ?? false) ||
      (o.name?.toLowerCase().includes('first-time') ?? false)
    );
  }

  /** Display label for the first-time discount, e.g. "10%" or "$20". Empty when no offer is loaded. */
  get firstTimeDiscountLabel(): string {
    const offer = this.firstTimeOffer;
    if (!offer) return '';
    return offer.isPercentage ? `${offer.discountValue}%` : `$${offer.discountValue}`;
  }

  /** Opens the login modal (with register toggle) for logged-out visitors who want
   *  to access Bubble Rewards points and their referral link. Returns them to /rewards. */
  openRewardsLogin(): void {
    this.authModalService.open('login', '/rewards');
  }
}
