import { PLATFORM_ID, TransferState, inject, makeStateKey, Service } from '@angular/core';
import { isPlatformServer, isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable, map, catchError, of, shareReplay, tap } from 'rxjs';
import { environment } from '../../environments/environment';

export interface Review {
  authorName: string;
  profilePhotoUrl: string;
  rating: number;
  text: string;
  time: Date;
}

/**
 * Google's own review count and average rating (Business Profile totalReviewCount /
 * averageRating, stored by the backend sync). The ONLY source for any review count or rating
 * shown on the site — never derive one from the number of loaded reviews.
 */
export interface ReviewStats {
  rating: number;
  total: number;
}

/** Shared wording for every review count on the site, e.g. "153 Google reviews". */
export function formatReviewCount(total: number): string {
  return `${total} Google ${total === 1 ? 'review' : 'reviews'}`;
}

/** Shared rating display, e.g. "5.0". */
export function formatRating(rating: number): string {
  return rating.toFixed(1);
}

/** schema.org AggregateRating built from the stats, or undefined when there are none to show. */
export function aggregateRatingSchema(stats: ReviewStats | null): Record<string, string> | undefined {
  if (!stats || stats.total <= 0) {
    return undefined;
  }
  return {
    '@type': 'AggregateRating',
    'ratingValue': formatRating(stats.rating),
    'reviewCount': String(stats.total),
    'bestRating': '5'
  };
}

/**
 * Pixel size requested for Google reviewer avatars. They are drawn at 28px (testimonial slider)
 * and 44px (/reviews), so 96px stays sharp up to 3x / 2x screens; the API hands out =s120.
 */
export const REVIEW_AVATAR_SIZE = 96;

/**
 * Rewrites the size option of a Google profile-photo URL, e.g.
 *   .../a/ACg8oc...=s120-c-rp-mo-ba12-br100  ->  .../a/ACg8oc...=s96-c-rp-mo-ba12-br100
 * Only the `s<N>` token of the trailing `=` option list changes; the others (crop, border,
 * rounding...) are kept. A URL without an option list gets `=s<N>` appended; anything that isn't
 * a googleusercontent.com URL is returned untouched.
 */
export function googleAvatarUrl(url: string, size: number = REVIEW_AVATAR_SIZE): string {
  if (!url || !/^https:\/\/[^/]*googleusercontent\.com\//.test(url)) {
    return url;
  }
  const eq = url.lastIndexOf('=');
  if (eq === -1 || eq < url.lastIndexOf('/')) {
    return `${url}=s${size}`;
  }
  const options = url.slice(eq + 1).split('-');
  const sizeIndex = options.findIndex(o => /^s\d+$/.test(o));
  if (sizeIndex === -1) {
    options.unshift(`s${size}`);
  } else {
    options[sizeIndex] = `s${size}`;
  }
  return `${url.slice(0, eq + 1)}${options.join('-')}`;
}

@Service()
export class GooglePlacesService {
  private http = inject(HttpClient);

  private apiUrl = environment.apiUrl;

  /** Shared, session-cached stats stream so every badge / counter / schema block on a page
   *  triggers only one HTTP call. */
  private stats$?: Observable<ReviewStats | null>;
  /** The slider's full review list once loaded in this tab - see {@link cachedSliderReviews}. */
  private sliderReviews: Review[] | null = null;
  private readonly transferState = inject(TransferState);
  private readonly platformId = inject(PLATFORM_ID);

  /**
   * Google review count + rating from the backend `/stats` endpoint. Emits null when there is
   * nothing to show (local dev — the endpoint is only populated in production — or on error),
   * so callers hide the count instead of showing 0.
   */
  getStats(): Observable<ReviewStats | null> {
    if (!environment.production) {
      return of(null);
    }
    if (this.stats$) {
      return this.stats$;
    }
    this.stats$ = this.http.get<any>(`${this.apiUrl}/googlereviews/stats`).pipe(
      map(response => {
        const total = Number(response?.total) || 0;
        return total > 0 ? { rating: Number(response?.rating) || 0, total } : null;
      }),
      catchError(error => {
        console.error('Error loading review stats from backend:', error);
        return of(null);
      }),
      shareReplay(1)
    );
    return this.stats$;
  }

  /**
   * Returns a single page of the stored Business Profile reviews (backend `/all?page&pageSize`).
   * The backend serves pages from a cached snapshot, so "Load More" never re-hits Google.
   * The headline count/rating do NOT come from here — use {@link getStats}.
   */
  getAllReviewsPage(page: number, pageSize: number): Observable<{ reviews: Review[], hasMore: boolean }> {
    return this.fetchReviewsPage(page, pageSize, true);
  }

  /**
   * {@link getAllReviewsPage} for a page the server render already drew: the server stores the
   * result in TransferState and the browser reads it back synchronously, once.
   *
   * The HTTP transfer cache can't cover this. It switches itself off as soon as the app is
   * stable, and the testimonial section is hydrated after that (incremental hydration, when it
   * scrolls into view) - its request would go back to the network and the server-rendered
   * slides would be emptied until the answer came back.
   */
  getAllReviewsPageForHydration(page: number, pageSize: number): Observable<{ reviews: Review[], hasMore: boolean }> {
    const key = makeStateKey<{ reviews: Review[], hasMore: boolean }>(`google-reviews-page:${page}:${pageSize}`);
    const transferred = this.transferState.get(key, null);
    if (transferred) {
      this.transferState.remove(key);
      // Dates travel as ISO strings.
      return of({ hasMore: transferred.hasMore, reviews: transferred.reviews.map(r => ({ ...r, time: new Date(r.time) })) });
    }
    if (!isPlatformServer(this.platformId)) {
      return this.getAllReviewsPage(page, pageSize);
    }
    // transferCache off: the page travels in the state key above, not a second time as an HTTP entry.
    return this.fetchReviewsPage(page, pageSize, false).pipe(
      tap(result => this.transferState.set(key, result))
    );
  }

  private fetchReviewsPage(page: number, pageSize: number, transferCache: boolean): Observable<{ reviews: Review[], hasMore: boolean }> {
    if (!environment.production) {
      return of({ reviews: [], hasMore: false });
    }
    return this.http.get<any>(`${this.apiUrl}/googlereviews/all?page=${page}&pageSize=${pageSize}`, { transferCache }).pipe(
      map(response => ({
        reviews: this.mapReviews(response),
        hasMore: !!response?.result?.has_more
      })),
      catchError(error => {
        console.error('Error loading reviews page from backend:', error);
        return of({ reviews: [], hasMore: false });
      })
    );
  }

  /**
   * Returns every displayable review in one call (large page) for the homepage / service-page
   * testimonial slider. Reuses the paged endpoint (cached server-side).
   */
  getAllReviewsForSlider(): Observable<Review[]> {
    return this.getAllReviewsPage(1, 500).pipe(
      map(({ reviews }) => reviews),
      tap(reviews => { if (reviews.length > 0 && isPlatformBrowser(this.platformId)) this.sliderReviews = reviews; })
    );
  }

  /**
   * The slider list already loaded in this tab, or null. A testimonial section created again
   * (Back to the homepage, another service page) draws it straight away instead of starting from
   * an empty slider: drawn empty, the section is shorter until the request returns, and its
   * `content-visibility` placeholder keeps that shorter height while it is off screen - so the
   * scroll position restored by Back landed on the wrong part of the page.
   */
  cachedSliderReviews(): Review[] | null {
    return this.sliderReviews;
  }

  private mapReviews(response: any): Review[] {
    return (response?.result?.reviews || []).map((review: any) => ({
      authorName: review.author_name,
      profilePhotoUrl: googleAvatarUrl(review.profile_photo_url),
      rating: review.rating,
      text: review.text,
      time: new Date(review.time * 1000)
    }));
  }
}
