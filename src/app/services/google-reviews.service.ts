import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, catchError, of } from 'rxjs';
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

  constructor(private http: HttpClient) { }

  getReviews(): Observable<{ reviews: Review[], overallRating: number, totalReviews: number }> {
    // Skip Google Reviews API in local dev (IP restrictions on Google Cloud only allow hosting IP)
    if (!environment.production) {
      return of({ reviews: [], overallRating: 0, totalReviews: 0 });
    }
    // THIS IS THE KEY CHANGE - calling your backend instead of Google directly
    return this.http.get<any>(`${this.apiUrl}/googlereviews/${this.placeId}`).pipe(
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
      })
    );
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