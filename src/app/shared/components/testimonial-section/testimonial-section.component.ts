import {
  Component,
  OnInit,
  OnDestroy,
  Inject,
  PLATFORM_ID,
  ChangeDetectorRef
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { GooglePlacesService, Review } from '../../../services/google-reviews.service';

interface ExtendedReview extends Review {
  isExpanded?: boolean;
}

/**
 * Self-contained testimonial section (Google reviews slider + social-proof stats).
 * Extracted from the homepage so the same block can be reused on service pages
 * (e.g. deep cleaning). Owns its own review loading, auto-advancing slider, and
 * the deterministic "bookings completed this week" counter.
 */
@Component({
  selector: 'app-testimonial-section',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './testimonial-section.component.html',
  styleUrl: './testimonial-section.component.scss'
})
export class TestimonialSectionComponent implements OnInit, OnDestroy {
  reviews: ExtendedReview[] = [];
  overallRating: number = 0;
  totalReviews: number = 0;
  private subscription: Subscription = new Subscription();
  protected isBrowser: boolean;
  /** Google Reviews only shown in production (API has IP restrictions for hosting only). */
  showGoogleReviews = environment.production;

  /** Index of the currently visible review in the testimonial slider. */
  currentReviewIndex: number = 0;
  private reviewSliderTimer: any = null;
  private reviewSliderPaused: boolean = false;
  private static readonly REVIEW_SLIDER_INTERVAL_MS = 6000;

  /** "X bookings completed this week" — deterministic per day, grows through the week. */
  bookingsThisWeek: number = 0;

  // ============================================================================
  // DEV-ONLY PREVIEW DATA — never reaches production builds.
  // Wrapped in `!environment.production` checks so production builds always go
  // through the real Google Reviews backend endpoint (cached, IP-restricted).
  // ============================================================================
  private static readonly DEV_PREVIEW_REVIEWS: ExtendedReview[] = [
    {
      authorName: '[Dev Preview] Sample Reviewer A',
      profilePhotoUrl: '',
      rating: 5,
      text: '[Local dev placeholder] Booking flow felt clean and quick. Replace with the real Google review text once production data is verified.',
      time: new Date('2026-04-15')
    },
    {
      authorName: '[Dev Preview] Sample Reviewer B',
      profilePhotoUrl: '',
      rating: 5,
      text: '[Local dev placeholder] Use this slot to validate slider auto-advance and dot navigation. Hidden in production via the !environment.production gate.',
      time: new Date('2026-04-02')
    },
    {
      authorName: '[Dev Preview] Sample Reviewer C',
      profilePhotoUrl: '',
      rating: 5,
      text: '[Local dev placeholder] Long-text variant: this string is here to confirm the 5-line clamp keeps the testimonial card from blowing out the surrounding grid layout when a reviewer writes a longer comment.',
      time: new Date('2026-03-20')
    }
  ];

  constructor(
    private googlePlacesService: GooglePlacesService,
    private cdr: ChangeDetectorRef,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  ngOnInit() {
    this.loadReviews();
    // Deterministic-per-day counter (safe on SSR — pure date math, no API).
    this.bookingsThisWeek = this.computeBookingsThisWeek();
  }

  ngOnDestroy() {
    this.subscription.unsubscribe();
    if (this.reviewSliderTimer) {
      clearInterval(this.reviewSliderTimer);
      this.reviewSliderTimer = null;
    }
  }

  private loadReviews() {
    // Local dev preview only — see DEV_PREVIEW_REVIEWS comment above. The
    // `!environment.production` gate guarantees this branch never runs in
    // production builds, so placeholder copy stays out of the live site.
    if (!environment.production) {
      this.reviews = TestimonialSectionComponent.DEV_PREVIEW_REVIEWS.map(r => ({ ...r, isExpanded: false }));
      this.totalReviews = this.reviews.length;
      this.overallRating = 5;
      this.startReviewSlider();
      return;
    }

    // Production path: cached Google Reviews backend endpoint (7-day IMemoryCache).
    // Slider cycles through ALL displayable reviews, not just the first 5.
    if (!this.showGoogleReviews) return;
    this.subscription.add(
      this.googlePlacesService.getAllReviewsForSlider().subscribe({
        next: (data) => {
          this.reviews = data.reviews.map(review => ({
            ...review,
            isExpanded: false
          }));
          this.overallRating = data.overallRating;
          this.totalReviews = data.totalReviews;
          this.startReviewSlider();
        },
        error: (error) => {
          console.error('Error loading reviews:', error);
        }
      })
    );
  }

  // ---------- Testimonial slider ----------
  private startReviewSlider() {
    if (!this.isBrowser) return;
    if (this.reviewSliderTimer) clearInterval(this.reviewSliderTimer);
    if (this.reviews.length <= 1) return;
    this.reviewSliderTimer = setInterval(() => {
      if (this.reviewSliderPaused || this.reviews.length === 0) return;
      this.currentReviewIndex = (this.currentReviewIndex + 1) % this.reviews.length;
      this.cdr.detectChanges();
    }, TestimonialSectionComponent.REVIEW_SLIDER_INTERVAL_MS);
  }

  goToReview(index: number) {
    if (index < 0 || index >= this.reviews.length) return;
    this.currentReviewIndex = index;
    // Reset the auto-advance window so the user gets a full interval to read
    // the slide they just clicked into.
    this.startReviewSlider();
  }

  prevReview() {
    if (this.reviews.length <= 1) return;
    const index = (this.currentReviewIndex - 1 + this.reviews.length) % this.reviews.length;
    this.goToReview(index);
  }

  nextReview() {
    if (this.reviews.length <= 1) return;
    const index = (this.currentReviewIndex + 1) % this.reviews.length;
    this.goToReview(index);
  }

  pauseReviewSlider()  { this.reviewSliderPaused = true; }
  resumeReviewSlider() { this.reviewSliderPaused = false; }

  /** Google's CDN occasionally rejects photo requests with referrer attached or returns 403
   *  for stale profile photos — swap to the Google "G" fallback by clearing the URL so the
   *  *ngIf flips to the inline-SVG branch. */
  onReviewAvatarError(review: ExtendedReview) {
    review.profilePhotoUrl = '';
  }

  /** Mirrors booking.component.ts:getNowInNewYork — keeps day-of-week / hour
   *  semantics anchored to NY business hours regardless of the visitor's TZ. */
  private getNowInNewYork(): Date {
    const nowUtc = new Date();
    const nyString = nowUtc.toLocaleString('en-US', { timeZone: 'America/New_York' });
    return new Date(nyString);
  }

  // ---------- Bookings counter (deterministic per day) ----------
  /**
   * Returns a number representing "bookings completed this week" that:
   *   – is 0 on Monday before noon (NY local time)
   *   – jumps to 6–18 on Monday afternoon
   *   – grows through the week (Sun reaches ~108–132)
   *   – stays the same all day (deterministic seed = year + day-of-year)
   */
  private computeBookingsThisWeek(): number {
    const now = this.getNowInNewYork();
    const dow = now.getDay();   // 0 = Sun, 1 = Mon, … 6 = Sat
    const hour = now.getHours();

    let range: [number, number];
    if (dow === 1 && hour < 12) range = [0, 0];
    else if (dow === 1)         range = [6, 18];
    else if (dow === 2)         range = [18, 36];
    else if (dow === 3)         range = [36, 54];
    else if (dow === 4)         range = [54, 72];
    else if (dow === 5)         range = [72, 90];
    else if (dow === 6)         range = [90, 114];
    else /* Sunday */           range = [108, 132];

    if (range[0] === range[1]) return range[0];

    // Seed = (year * 1000) + day-of-year, plus +0.5 for Monday PM so AM/PM differ.
    const start = new Date(now.getFullYear(), 0, 0);
    const dayOfYear = Math.floor((now.getTime() - start.getTime()) / 86_400_000);
    const seed = now.getFullYear() * 1000 + dayOfYear + (dow === 1 && hour >= 12 ? 0.5 : 0);
    const r = TestimonialSectionComponent.seededRandom(seed);
    return range[0] + Math.floor(r * (range[1] - range[0] + 1));
  }

  /** Deterministic 0..1 hash from a numeric seed (Mulberry-style). Pure, no Math.random(). */
  private static seededRandom(seed: number): number {
    let t = (seed * 9301 + 49297) % 233280;
    return (t / 233280 + 1) % 1; // ensure 0..1 range
  }
}
