import { Component, OnInit, OnDestroy, Inject, inject } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { RouterModule } from '@angular/router';
import { environment } from '../../environments/environment';
import { GooglePlacesService, Review } from '../services/google-reviews.service';
import { PhoneNumberService } from '../services/phone-number.service';
import { Subscription } from 'rxjs';

interface DisplayReview extends Review {
  isExpanded: boolean;
  avatarFailed: boolean;
}

@Component({
  selector: 'app-reviews',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './reviews.component.html',
  styleUrl: './reviews.component.scss'
})
export class ReviewsComponent implements OnInit, OnDestroy {
  reviews: DisplayReview[] = [];
  overallRating = 0;
  totalReviews = 0;
  isLoading = false;
  isLoadingMore = false;
  hasLoaded = false;
  hasMore = false;
  protected readonly phoneNumber = inject(PhoneNumberService);

  /**
   * Hero photo — royalty-free Unsplash image (woman reviewing on her phone), free for
   * commercial use, no attribution required. Gracefully hides if it ever fails to load.
   * To self-host instead, drop a file at /images/reviews-hero.webp and swap this URL.
   */
  readonly heroImage = 'https://images.unsplash.com/photo-1713947506367-b639b30230d5?auto=format&fit=crop&w=1200&q=70';
  heroImageFailed = false;

  private readonly pageSize = 9;
  private currentPage = 0;

  /** Google Reviews only resolve in production (API has IP restrictions for hosting only). */
  showGoogleReviews = environment.production;

  private schemaElement: HTMLScriptElement | null = null;
  private subscription = new Subscription();

  // Local-dev preview only. In production the backend endpoint (7-day cache) supplies
  // real reviews; locally the Google API is IP-restricted to the hosting box so it
  // returns nothing. These let the page be previewed during `ng serve`.
  private static readonly DEV_PREVIEW_REVIEWS: Review[] = [
    {
      authorName: 'Jessica M.',
      profilePhotoUrl: '',
      rating: 5,
      text: 'Absolutely thrilled with Dream Cleaning. The team was on time, professional, and my apartment has never looked better. The deep clean got into every corner — highly recommend to anyone in Brooklyn.',
      time: new Date('2026-05-12')
    },
    {
      authorName: 'David R.',
      profilePhotoUrl: '',
      rating: 5,
      text: 'Booked a move-out cleaning and got my full deposit back. Spotless work and very easy to schedule online.',
      time: new Date('2026-04-28')
    },
    {
      authorName: 'Amara O.',
      profilePhotoUrl: '',
      rating: 5,
      text: 'I have a recurring weekly cleaning now and it has been a game changer. Same friendly cleaner every time, always reliable.',
      time: new Date('2026-04-15')
    },
    {
      authorName: 'Michael T.',
      profilePhotoUrl: '',
      rating: 5,
      text: 'Post-construction cleanup in my Manhattan office — they handled the dust and debris perfectly. Will use again.',
      time: new Date('2026-03-30')
    }
  ];

  constructor(
    @Inject(DOCUMENT) private document: Document,
    private googlePlacesService: GooglePlacesService
  ) {}

  ngOnInit(): void {
    this.injectSchema();
    this.loadReviews();
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
    if (this.schemaElement && this.schemaElement.parentNode) {
      this.schemaElement.parentNode.removeChild(this.schemaElement);
    }
  }

  private loadReviews(): void {
    if (!this.showGoogleReviews) {
      // Dev preview seed (see DEV_PREVIEW_REVIEWS note above).
      this.reviews = ReviewsComponent.DEV_PREVIEW_REVIEWS.map(r => this.toDisplay(r));
      this.overallRating = 5;
      this.totalReviews = this.reviews.length;
      this.hasLoaded = true;
      return;
    }

    this.isLoading = true;
    this.loadPage(1, () => {
      this.isLoading = false;
      this.hasLoaded = true;
    });
  }

  loadMore(): void {
    if (this.isLoadingMore || !this.hasMore) {
      return;
    }
    this.isLoadingMore = true;
    this.loadPage(this.currentPage + 1, () => {
      this.isLoadingMore = false;
    });
  }

  /** Fetches a page from the cached backend snapshot; page 1 replaces, later pages append. */
  private loadPage(page: number, done: () => void): void {
    this.subscription.add(
      this.googlePlacesService.getAllReviewsPage(page, this.pageSize).subscribe({
        next: data => {
          const mapped = data.reviews.map(r => this.toDisplay(r));
          this.reviews = page === 1 ? mapped : [...this.reviews, ...mapped];
          this.overallRating = data.overallRating;
          this.totalReviews = data.totalReviews;
          this.hasMore = data.hasMore;
          this.currentPage = page;
          done();
        },
        error: err => {
          console.error('Error loading reviews:', err);
          done();
        }
      })
    );
  }

  private toDisplay(r: Review): DisplayReview {
    return { ...r, isExpanded: false, avatarFailed: false };
  }

  toggleExpanded(review: DisplayReview): void {
    review.isExpanded = !review.isExpanded;
  }

  onAvatarError(review: DisplayReview): void {
    review.avatarFailed = true;
  }

  onHeroImageError(): void {
    this.heroImageFailed = true;
  }

  initials(name: string): string {
    if (!name) return '?';
    return name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map(p => p[0].toUpperCase())
      .join('');
  }

  private injectSchema(): void {
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      'name': 'Dream Cleaning',
      '@id': 'https://dreamcleaningnyc.com/#business',
      'url': 'https://dreamcleaningnyc.com/reviews',
      'aggregateRating': {
        '@type': 'AggregateRating',
        'ratingValue': '5.0',
        'reviewCount': '100'
      }
    };
    this.schemaElement = this.document.createElement('script');
    this.schemaElement.type = 'application/ld+json';
    this.schemaElement.textContent = JSON.stringify(schema);
    this.document.head.appendChild(this.schemaElement);
  }
}
