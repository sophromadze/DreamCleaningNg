import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, catchError, of, switchMap, shareReplay } from 'rxjs';
import { environment } from '../../environments/environment';

export interface Review {
  authorName: string;
  profilePhotoUrl: string;
  rating: number;
  text: string;
  time: Date;
}

@Injectable({
  providedIn: 'root'
})
export class GooglePlacesService {
  private apiUrl = environment.apiUrl;
  private readonly placeId = 'ChIJHSWM5PolFKIRKY3v5B2aLKg'; // Your Google Place ID

  /** Shared, session-cached reviews stream so multiple subscribers (homepage hero
   *  badge + testimonial section, service pages, etc.) trigger only one HTTP call. */
  private reviews$?: Observable<{ reviews: Review[], overallRating: number, totalReviews: number }>;

  constructor(private http: HttpClient) { }

  getReviews(): Observable<{ reviews: Review[], overallRating: number, totalReviews: number }> {
    // Skip Google Reviews API in local dev (IP restrictions on Google Cloud only allow hosting IP)
    if (!environment.production) {
      return of({ reviews: [], overallRating: 0, totalReviews: 0 });
    }
    if (this.reviews$) {
      return this.reviews$;
    }
    // THIS IS THE KEY CHANGE - calling your backend instead of Google directly
    this.reviews$ = this.http.get<any>(`${this.apiUrl}/googlereviews/${this.placeId}`).pipe(
      map(response => {
        const result = response.result;
        if (!result) {
          return {
            reviews: [],
            overallRating: 0,
            totalReviews: 0
          };
        }

        const reviews = (result.reviews || []).map((review: any) => ({
          authorName: review.author_name,
          profilePhotoUrl: review.profile_photo_url,
          rating: review.rating,
          text: review.text,
          time: new Date(review.time * 1000)
        }));

        return {
          reviews,
          overallRating: result.rating || 0,
          totalReviews: result.user_ratings_total || 0
        };
      }),
      catchError(error => {
        console.error('Error loading reviews from backend:', error);
        return of({
          reviews: [],
          overallRating: 0,
          totalReviews: 0
        });
      }),
      shareReplay(1)
    );
    return this.reviews$;
  }

  /**
   * Returns ALL reviews persisted from the Google Business Profile API (backend `/all` endpoint).
   * If none are stored yet (e.g. before Business Profile API access is set up), it falls back to
   * the 5-review Places endpoint so the page still shows something.
   */
  getAllReviews(): Observable<{ reviews: Review[], overallRating: number, totalReviews: number }> {
    if (!environment.production) {
      return of({ reviews: [], overallRating: 0, totalReviews: 0 });
    }
    return this.http.get<any>(`${this.apiUrl}/googlereviews/all`).pipe(
      map(response => this.mapPlacesResponse(response)),
      switchMap(result =>
        result.reviews.length > 0 ? of(result) : this.getReviews()
      ),
      catchError(error => {
        console.error('Error loading all reviews from backend:', error);
        // Backend `/all` failed entirely — fall back to the 5-review Places endpoint.
        return this.getReviews();
      })
    );
  }

  /**
   * Returns a single page of ALL stored Business Profile reviews (backend `/all?page&pageSize`).
   * The backend serves pages from a cached snapshot, so "Load More" never re-hits Google. On the
   * FIRST page, if nothing is stored yet (or the call fails), it falls back to the 5-review Places
   * endpoint so the page still shows something; later pages just return empty/no-more on error.
   */
  getAllReviewsPage(page: number, pageSize: number): Observable<{ reviews: Review[], overallRating: number, totalReviews: number, hasMore: boolean }> {
    if (!environment.production) {
      return of({ reviews: [], overallRating: 0, totalReviews: 0, hasMore: false });
    }
    return this.http.get<any>(`${this.apiUrl}/googlereviews/all?page=${page}&pageSize=${pageSize}`).pipe(
      map(response => this.mapPagedResponse(response)),
      switchMap(result =>
        (page === 1 && result.reviews.length === 0)
          ? this.getReviews().pipe(map(r => ({ ...r, hasMore: false })))
          : of(result)
      ),
      catchError(error => {
        console.error('Error loading reviews page from backend:', error);
        return page === 1
          ? this.getReviews().pipe(map(r => ({ ...r, hasMore: false })))
          : of({ reviews: [], overallRating: 0, totalReviews: 0, hasMore: false });
      })
    );
  }

  private mapPagedResponse(response: any): { reviews: Review[], overallRating: number, totalReviews: number, hasMore: boolean } {
    const base = this.mapPlacesResponse(response);
    return { ...base, hasMore: !!response?.result?.has_more };
  }

  /**
   * Returns every displayable review in one call (large page) for the homepage / service-page
   * testimonial slider. Reuses the paged endpoint (cached server-side) and its Places fallback.
   */
  getAllReviewsForSlider(): Observable<{ reviews: Review[], overallRating: number, totalReviews: number }> {
    return this.getAllReviewsPage(1, 500).pipe(
      map(({ reviews, overallRating, totalReviews }) => ({ reviews, overallRating, totalReviews }))
    );
  }

  private mapPlacesResponse(response: any): { reviews: Review[], overallRating: number, totalReviews: number } {
    const result = response?.result;
    if (!result) {
      return { reviews: [], overallRating: 0, totalReviews: 0 };
    }
    const reviews = (result.reviews || []).map((review: any) => ({
      authorName: review.author_name,
      profilePhotoUrl: review.profile_photo_url,
      rating: review.rating,
      text: review.text,
      time: new Date(review.time * 1000)
    }));
    return {
      reviews,
      overallRating: result.rating || 0,
      totalReviews: result.user_ratings_total || 0
    };
  }

  // These methods are not used in your app but keeping for compatibility
  searchPlaces(query: string): Observable<any> {
    return of({ results: [] });
  }

  getPlaceDetails(placeId: string): Observable<any> {
    if (!environment.production) return of(null);
    return this.http.get<any>(`${this.apiUrl}/googlereviews/${placeId}`);
  }

  getPlaceReviews(placeId: string): Observable<any> {
    if (!environment.production) return of(null);
    return this.http.get<any>(`${this.apiUrl}/googlereviews/${placeId}`);
  }
}