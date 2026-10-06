import { Component, OnInit, OnDestroy, PLATFORM_ID, ChangeDetectorRef, ElementRef, inject, NgZone, afterNextRender, ChangeDetectionStrategy, viewChild, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { NavigationStart, Router, RouterLink } from '@angular/router';
import { GooglePlacesService, aggregateRatingSchema } from '../services/google-reviews.service';
import { StructuredDataService } from '../services/structured-data.service';
import { ScrollRestoreService, scrollInstantly } from '../services/scroll-restore.service';
import { HomeHeroComponent } from '../shared/components/home-hero/home-hero.component';
import { TestimonialSectionComponent } from '../shared/components/testimonial-section/testimonial-section.component';
import { SpecialOfferService, PublicSpecialOffer } from '../services/special-offer.service';
import { AuthService } from '../services/auth.service';
import { AuthModalService } from '../services/auth-modal.service';
import { BeforeAfterPhotoService } from '../services/before-after-photo.service';
import { MarketingPricingService } from '../shared/pricing/marketing-pricing.service';
import { PhoneNumberService } from '../services/phone-number.service';
import { Subscription, filter } from 'rxjs';
import { IconComponent } from '../shared/icons/icon.component';
import { faCircleInfo } from '../shared/icons/glyphs/faCircleInfo';
import { faStar } from '../shared/icons/glyphs/faStar';
import { faTags } from '../shared/icons/glyphs/faTags';
import { faUserGroup } from '../shared/icons/glyphs/faUserGroup';
import { responsiveImage } from '../shared/images/responsive-image.loader';
import { CardImageDirective } from '../shared/images/card-image.directive';
import { HomeLayoutMemoryService, SectionHeights } from './home-layout-memory.service';
import { findAdvertisedFirstTimeOffer } from '../shared/booking/special-offer-keys';
import { setIntervalOutsideZone } from '../shared/zone-free-timers';
import { debugTimersPaused } from '../shared/debug-timers';

/**
 * Drawn widths, measured from the rendered images. The About photo is 3:2 inside a 4:3 box with
 * object-fit: cover, so it is drawn 1.125x its box width:
 *   <= 900px   one column, box 100vw - 49px
 *   <= 1294px  two columns, box 50vw - 53px
 *   wider      box capped at 594px -> drawn 669px
 */
const ABOUT_PHOTO_SIZES =
  '(max-width: 900px) calc(112.5vw - 55px), ' +
  '(max-width: 1294px) calc(56.25vw - 60px), ' +
  '669px';

/** Before/after halves: 2 per card, cards per row by window width (see BEFORE_AFTER_WIN_*). */
const BEFORE_AFTER_HALF_SIZES =
  '(max-width: 768px) calc(50vw - 32px), ' +
  '(max-width: 1200px) calc(25vw - 22px), ' +
  '200px';

/** Carousel sizes read in one go, so the reads and the writes can happen at different times. */
interface BeforeAfterLayoutMeasure {
  vp: HTMLElement;
  gapPx: number;
  vpContentW: number;
  layoutW: number;
}

/** Public-facing before/after photo card — populated from BeforeAfterPhotosController. */
export interface BeforeAfterPhoto {
  id: number;
  title: string;
  subtitle?: string | null;
  beforePhotoUrl: string;
  afterPhotoUrl: string;
  /** Resized variants from the API; cleared by {@link MainComponent.onBeforeAfterImageError} if one fails. */
  beforeSrcset?: string | null;
  afterSrcset?: string | null;
  linkUrl?: string | null;
  displayOrder: number;
}

@Component({
  selector: 'app-main',
  standalone: true,
  imports: [RouterLink, HomeHeroComponent, TestimonialSectionComponent, IconComponent, CardImageDirective],
  templateUrl: './main.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './main.component.scss'
})
export class MainComponent implements OnInit, OnDestroy {
  private specialOfferService = inject(SpecialOfferService);
  private authService = inject(AuthService);
  private authModalService = inject(AuthModalService);
  private cdr = inject(ChangeDetectorRef);
  private beforeAfterPhotoService = inject(BeforeAfterPhotoService);
  private platformId = inject<Object>(PLATFORM_ID);

  protected readonly icons = { faCircleInfo, faStar, faTags, faUserGroup };
  protected readonly aboutPhoto = responsiveImage('/images/dream-cleaning-maids-in-nyc.webp', ABOUT_PHOTO_SIZES);
  protected readonly beforeAfterHalfSizes = BEFORE_AFTER_HALF_SIZES;

  readonly specialOffers = signal<PublicSpecialOffer[]>([]);
  readonly isLoggedIn = signal<boolean>(false);
  private readonly zone = inject(NgZone);
  protected readonly phoneNumber = inject(PhoneNumberService);
  private readonly googlePlacesService = inject(GooglePlacesService);
  private readonly structuredData = inject(StructuredDataService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly layoutMemory = inject(HomeLayoutMemoryService);
  /** Section heights from the reader's previous visit - see HomeLayoutMemoryService. */
  protected readonly rememberedHeights: SectionHeights =
    isPlatformBrowser(inject(PLATFORM_ID)) ? this.layoutMemory.recall(window.innerWidth) : { box: {}, content: {} };
  private subscription: Subscription = new Subscription();
  /** Protected (not private) so the template can gate auth-dependent content to the
   *  browser only — see the rewards login note. Prerendered HTML must not contain
   *  auth-dependent branches or hydration leaves a stale node behind (duplicate notes). */
  protected isBrowser: boolean;

  /** Marketing-copy prices from the booking catalogue; null = fragment left out (MarketingPricingService). */
  readonly pricing = inject(MarketingPricingService).text;

  /** Photos rendered in the "See the difference" gallery. Empty until the
   *  admin uploads pairs in Admin → Before & After. */
  readonly beforeAfterPhotos = signal<BeforeAfterPhoto[]>([]);

  /** Padded to at least 3 items so the 3-across track math is stable. */
  beforeAfterBasePhotos: BeforeAfterPhoto[] = [];
  /** Triple of {@link beforeAfterBasePhotos} for seamless infinite scrolling. */
  readonly beforeAfterCarouselSlides = signal<BeforeAfterPhoto[]>([]);
  /** Length of {@link beforeAfterBasePhotos}. */
  readonly beforeAfterBaseLength = signal(0);
  /** Index in {@link beforeAfterCarouselSlides} of the leftmost visible slide (middle copy at init). */
  beforeAfterOffset = 0;
  readonly beforeAfterTranslatePx = signal(0);
  readonly beforeAfterStepPx = signal(0);
  readonly beforeAfterSkipTransition = signal(false);
  /** How many before/after cards fit across — driven by window width (see breakpoints below). */
  beforeAfterVisibleCount: 1 | 2 | 3 = 3;
  /**
   * Base indices whose cards are rendered: the visible ones plus one neighbour on each side. Every
   * slide wrapper stays in the track (widths and translate math are unchanged) but the others are
   * empty, so only these cards' photos load. Held per BASE index, so all three copies of a photo
   * are rendered together and the instant recenter jump lands on cards that are already drawn.
   */
  private readonly beforeAfterRenderedBase = signal(new Set<number>());
  private beforeAfterPruneTimer: ReturnType<typeof setTimeout> | null = null;

  readonly beforeAfterViewport = viewChild<ElementRef<HTMLElement>>('beforeAfterViewport');

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

  constructor() {
    this.isBrowser = isPlatformBrowser(this.platformId);
    if (this.isBrowser && typeof matchMedia !== 'undefined') {
      this.beforeAfterMotionOk = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    // Back/Forward to the homepage: put the reader back on the spot they left before the first
    // paint, rather than on the top of the page until the router's own restore runs. The remembered
    // section heights above make the page tall enough for it in that same render.
    const restore = this.isBrowser ? inject(ScrollRestoreService).pendingRestore() : null;
    if (restore) {
      afterNextRender({ write: () => scrollInstantly(restore) });
    }
  }

  ngOnInit() {
    this.loadSpecialOffers();
    this.checkAuthStatus();
    // Fetch admin-uploaded before/after photos.
    this.loadBeforeAfterPhotos();
    this.loadRatingSchema();
    if (this.isBrowser) {
      this.subscription.add(
        this.router.events
          .pipe(filter(e => e instanceof NavigationStart))
          .subscribe(() => this.rememberSectionHeights())
      );
    }
  }

  /** `contain-intrinsic-size` for a content-visibility section: its remembered height, if any. */
  protected rememberedIntrinsicSize(section: string): string | null {
    const height = this.rememberedHeights.content[section];
    return height ? `auto ${height}px` : null;
  }

  /** Taken on NavigationStart, while the page is still on screen - by ngOnDestroy it is gone. */
  private rememberSectionHeights(): void {
    const box: Record<string, number> = {};
    const content: Record<string, number> = {};
    this.host.nativeElement
      .querySelectorAll<HTMLElement>('.home-main > section, .home-main > app-testimonial-section')
      .forEach(el => {
        const key = el.localName === 'section' ? el.classList[0] : el.localName;
        const s = getComputedStyle(el);
        const edges = parseFloat(s.paddingTop) + parseFloat(s.paddingBottom)
          + parseFloat(s.borderTopWidth) + parseFloat(s.borderBottomWidth);
        // Unrounded: offsetHeight drops the fraction, and ten sections of it add up to a visible pixel.
        const height = el.getBoundingClientRect().height;
        box[key] = height;
        content[key] = Math.max(0, height - (edges || 0));
      });
    this.layoutMemory.save(window.innerWidth, { box, content });
  }

  ngOnDestroy() {
    this.subscription.unsubscribe();
    this.disposeBeforeAfterCarouselView();
    this.structuredData.setBusinessRating(undefined);
  }

  /**
   * Homepage AggregateRating, from the shared review stats, written onto the #business node of
   * index.html's @graph - the page's one LocalBusiness node. index.html carries no hardcoded
   * rating/count; ngOnDestroy takes it off again, since the @graph block stays for the next page.
   */
  private loadRatingSchema() {
    this.subscription.add(
      this.googlePlacesService.getStats().subscribe(stats =>
        this.structuredData.setBusinessRating(aggregateRatingSchema(stats)))
    );
  }

  // ---------- Before/After photos ----------
  private loadBeforeAfterPhotos() {
    if (!this.isBrowser) return;
    this.subscription.add(
      this.beforeAfterPhotoService.getPublic().subscribe({
        next: (photos) => {
          this.beforeAfterPhotos.set((photos || []).map(p => ({
            id: p.id,
            title: p.title,
            subtitle: p.subtitle,
            beforePhotoUrl: p.beforePhotoUrl,
            afterPhotoUrl: p.afterPhotoUrl,
            beforeSrcset: p.beforeSrcset ?? null,
            afterSrcset: p.afterSrcset ?? null,
            linkUrl: p.linkUrl,
            displayOrder: p.displayOrder
          })));
          this.rebuildBeforeAfterCarousel();
          this.cdr.detectChanges();
          setTimeout(() => {
            // No measuring here: right after the DOM writes above, reading sizes forced a
            // synchronous layout. The observer's first notification does it instead - it is
            // delivered after the browser's own layout, when the reads cost nothing.
            this.attachBeforeAfterResizeObserver();
            this.startBeforeAfterAutoplay();
          }, 0);
        },
        error: () => {
          // Endpoint not available yet (backend not deployed) — section just stays hidden.
          this.beforeAfterPhotos.set([]);
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

  isBeforeAfterSlideRendered(index: number): boolean {
    return this.beforeAfterBaseLength() > 0 && this.beforeAfterRenderedBase().has(index % this.beforeAfterBaseLength());
  }

  /** A variant that fails to load (e.g. deleted from disk) falls back to the original URL. */
  onBeforeAfterImageError(photo: BeforeAfterPhoto, side: 'before' | 'after'): void {
    if (side === 'before' && photo.beforeSrcset) photo.beforeSrcset = null;
    else if (side === 'after' && photo.afterSrcset) photo.afterSrcset = null;
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
    const src = this.beforeAfterPhotos();
    if (src.length === 0) {
      this.beforeAfterBasePhotos = [];
      this.beforeAfterCarouselSlides.set([]);
      this.beforeAfterBaseLength.set(0);
      this.beforeAfterOffset = 0;
      this.beforeAfterTranslatePx.set(0);
      this.beforeAfterStepPx.set(0);
      return;
    }
    const base = this.buildBeforeAfterBase(src);
    this.beforeAfterBasePhotos = base;
    this.beforeAfterBaseLength.set(base.length);
    this.beforeAfterStepPx.set(0);
    this.beforeAfterCarouselSlides.set([...base, ...base, ...base]);
    this.beforeAfterOffset = this.beforeAfterBaseLength();
    this.beforeAfterRenderedBase.set(new Set<number>());
    this.beforeAfterSkipTransition.set(true);
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
    const el = this.beforeAfterViewport()?.nativeElement;
    if (!el || this.beforeAfterCarouselSlides().length === 0) return;
    this.beforeAfterResizeObserver?.disconnect();
    this.beforeAfterResizeObserver = new ResizeObserver(() => {
      // Read now (layout is clean inside the callback), write on the next frame.
      this.scheduleBeforeAfterLayoutFromResize(this.measureBeforeAfterLayout());
    });
    this.beforeAfterResizeObserver.observe(el);
  }

  /** Batches the ResizeObserver's writes to the next frame to avoid re-entrant CD / SES issues. */
  private scheduleBeforeAfterLayoutFromResize(measured: BeforeAfterLayoutMeasure | null): void {
    if (!this.isBrowser || this.beforeAfterViewDisposed) return;
    if (this.beforeAfterLayoutRaf !== 0) {
      cancelAnimationFrame(this.beforeAfterLayoutRaf);
    }
    this.beforeAfterLayoutRaf = requestAnimationFrame(() => {
      this.beforeAfterLayoutRaf = 0;
      if (this.beforeAfterViewDisposed) return;
      this.applyBeforeAfterLayout(measured);
      this.cdr.detectChanges();
    });
  }

  private resolveBeforeAfterVisibleCount(windowWidth: number): 1 | 2 | 3 {
    if (windowWidth <= MainComponent.BEFORE_AFTER_WIN_NARROW) return 1;
    if (windowWidth <= MainComponent.BEFORE_AFTER_WIN_WIDE) return 2;
    return 3;
  }

  private updateBeforeAfterLayoutMetrics(): void {
    this.applyBeforeAfterLayout(this.measureBeforeAfterLayout());
  }

  /** Layout READS only, so callers can take them where layout is already clean. */
  private measureBeforeAfterLayout(): BeforeAfterLayoutMeasure | null {
    if (this.beforeAfterViewDisposed) return null;
    const vp = this.beforeAfterViewport()?.nativeElement;
    if (!vp || this.beforeAfterCarouselSlides().length === 0) return null;
    const track = vp.querySelector('.before-after-carousel__track') as HTMLElement | null;
    if (!track) return null;

    const gapStr = getComputedStyle(track).gap || '0px';
    let gapPx = parseFloat(gapStr);
    if (!Number.isFinite(gapPx)) gapPx = 0;

    const vpStyle = getComputedStyle(vp);
    const vpPadH =
      (parseFloat(vpStyle.paddingLeft) || 0) + (parseFloat(vpStyle.paddingRight) || 0);
    const vpContentW = Math.max(0, vp.clientWidth - vpPadH);
    if (vp.clientWidth <= 0 || vpContentW <= 0) return null;

    const layoutW =
      this.isBrowser && typeof window !== 'undefined' ? window.innerWidth : vpContentW;
    return { vp, gapPx, vpContentW, layoutW };
  }

  /** Layout WRITES only, from a {@link measureBeforeAfterLayout} result. */
  private applyBeforeAfterLayout(measured: BeforeAfterLayoutMeasure | null): void {
    if (!measured || this.beforeAfterViewDisposed) return;
    const { vp, gapPx, vpContentW, layoutW } = measured;
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

    const stepChanged = Math.abs(nextStep - this.beforeAfterStepPx()) > 0.25;
    if (stepChanged || visibleChanged) {
      this.beforeAfterStepPx.set(nextStep);
      this.beforeAfterSkipTransition.set(true);
      this.syncBeforeAfterTranslate();
      requestAnimationFrame(() => {
        if (this.beforeAfterViewDisposed) return;
        this.beforeAfterSkipTransition.set(false);
        this.cdr.detectChanges();
      });
    } else {
      this.beforeAfterStepPx.set(nextStep);
      this.syncBeforeAfterTranslate();
    }
  }

  private syncBeforeAfterTranslate(): void {
    const t = this.beforeAfterOffset * this.beforeAfterStepPx();
    this.beforeAfterTranslatePx.set(Number.isFinite(t) ? t : 0);
    this.updateBeforeAfterRenderedWindow();
  }

  private beforeAfterWindow(): Set<number> {
    const m = this.beforeAfterBaseLength();
    const window = new Set<number>();
    if (m === 0) return window;
    for (let k = this.beforeAfterOffset - 1; k <= this.beforeAfterOffset + this.beforeAfterVisibleCount; k++) {
      window.add(((k % m) + m) % m);
    }
    return window;
  }

  /**
   * Adds the new window at once but drops the old one only after the slide transition, so a card
   * still sliding out (rapid clicks move several steps inside one transition) is never emptied
   * mid-animation.
   */
  private updateBeforeAfterRenderedWindow(): void {
    const next = this.beforeAfterWindow();
    this.beforeAfterRenderedBase().forEach(i => next.add(i));
    this.beforeAfterRenderedBase.set(next);
    if (!this.isBrowser) return;
    if (this.beforeAfterPruneTimer) clearTimeout(this.beforeAfterPruneTimer);
    this.beforeAfterPruneTimer = setTimeout(() => {
      this.beforeAfterPruneTimer = null;
      if (this.beforeAfterViewDisposed) return;
      this.beforeAfterRenderedBase.set(this.beforeAfterWindow());
      this.cdr.detectChanges();
    }, MainComponent.BEFORE_AFTER_TRANSITION_MS + 50);
  }

  private advanceBeforeAfter(delta: 1 | -1): void {
    if (!this.isBrowser || this.beforeAfterBaseLength() === 0) return;
    if (this.beforeAfterStepPx() <= 0) {
      this.updateBeforeAfterLayoutMetrics();
    }
    if (this.beforeAfterStepPx() <= 0) return;

    this.beforeAfterSkipTransition.set(false);
    const m = this.beforeAfterBaseLength();
    this.beforeAfterOffset += delta;
    this.syncBeforeAfterTranslate();
    this.cdr.detectChanges();

    if (delta > 0 && this.beforeAfterOffset >= 2 * m) {
      this.scheduleBeforeAfterRecenter(() => {
        // Preserve overshoot: rapid clicks/auto-ticks during the recenter timer can leave
        // offset at 2m+k. Snapping to a hardcoded `m` would rewind the visible content by
        // k positions (offset 2m+k shows the same slides as m+k, but resetting to m shows
        // m). Subtracting one base length keeps the visual position stable.
        this.beforeAfterSkipTransition.set(true);
        this.beforeAfterOffset = this.beforeAfterOffset - m;
        this.syncBeforeAfterTranslate();
        requestAnimationFrame(() => {
          this.beforeAfterSkipTransition.set(false);
          this.cdr.detectChanges();
        });
      });
    } else if (delta < 0 && this.beforeAfterOffset < m) {
      this.scheduleBeforeAfterRecenter(() => {
        // Symmetric overshoot preservation for the back-button path: offset m-1-k maps to
        // 2m-1-k (same content), not the hardcoded 2m-1.
        this.beforeAfterSkipTransition.set(true);
        this.beforeAfterOffset = this.beforeAfterOffset + m;
        this.syncBeforeAfterTranslate();
        requestAnimationFrame(() => {
          this.beforeAfterSkipTransition.set(false);
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
    if (this.beforeAfterBaseLength() === 0) return;
    if (debugTimersPaused()) return;
    this.beforeAfterAutoplayTimer = setIntervalOutsideZone(this.zone, () => {
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
    if (this.beforeAfterPruneTimer) {
      clearTimeout(this.beforeAfterPruneTimer);
      this.beforeAfterPruneTimer = null;
    }
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
          this.specialOffers.set(offers);
        },
        error: (error) => {
          console.error('Error loading special offers:', error);
        }
      })
    );
  }

  private checkAuthStatus() {
    // Set initial auth state
    this.isLoggedIn.set(this.authService.isLoggedIn());

    // Subscribe to authentication state changes
    this.subscription.add(
      this.authService.currentUser.subscribe(user => {
        this.isLoggedIn.set(!!user);
        // Force change detection
        this.cdr.detectChanges();
      })
    );
  }

  /** First-time customer offer from the public special offers (percentage is admin-configurable, never hardcoded). */
  get firstTimeOffer(): PublicSpecialOffer | undefined {
    return findAdvertisedFirstTimeOffer(this.specialOffers());
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
