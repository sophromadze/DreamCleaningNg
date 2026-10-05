import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import {
  GooglePlacesService,
  ReviewStats,
  aggregateRatingSchema,
  formatRating,
  formatReviewCount
} from '../../../services/google-reviews.service';
import { ServiceAreaMapComponent } from '../../../service-area-map/service-area-map.component';
import { HomeHeroComponent } from '../../../shared/components/home-hero/home-hero.component';
import { QUEENS_ZIPS } from '../../../data/zip-code-data';
import { MarketingPricingService } from '../../../shared/pricing/marketing-pricing.service';
import { listStartingPrices, priceFragment } from '../../../shared/pricing/marketing-price-format';
import { environment } from '../../../../environments/environment';
import { CardImageDirective } from '../../../shared/images/card-image.directive';
import { StructuredDataService } from '../../../services/structured-data.service';

@Component({
  selector: 'app-queens-cleaning',
  standalone: true,
  imports: [RouterModule, ServiceAreaMapComponent, HomeHeroComponent, CardImageDirective],
  templateUrl: './queens-cleaning.component.html',
  styleUrls: ['./queens-cleaning.component.scss']
})
export class QueensCleaningComponent implements OnInit, OnDestroy {
  /** Google review count/rating (shared /stats endpoint); null until loaded or in local dev. */
  stats: ReviewStats | null = null;
  showGoogleReviews = environment.production;
  queensZips = Object.keys(QUEENS_ZIPS);
  queensMapCenter: [number, number] = [40.72, -73.8365];
  queensZoom = 11;
  private readonly marketingPricing = inject(MarketingPricingService);
  /** Prices from the booking catalogue; null = fragment left out (MarketingPricingService). */
  readonly pricing = this.marketingPricing.text;
  private readonly structuredData = inject(StructuredDataService);

  constructor(
    private googlePlacesService: GooglePlacesService
  ) {}

  ngOnInit() {
    if (this.showGoogleReviews) {
      this.googlePlacesService.getStats().subscribe(stats => {
        this.stats = stats;
        this.injectSchema();
      });
    } else {
      this.injectSchema();
    }
  }

  get ratingLabel(): string {
    return this.stats ? formatRating(this.stats.rating) : '';
  }

  get reviewCountLabel(): string {
    return this.stats ? formatReviewCount(this.stats.total) : '';
  }

  ngOnDestroy(): void {
    this.structuredData.remove('ld-queens-cleaning');
  }

  private injectSchema(): void {
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      'name': 'Dream Cleaning - Queens',
      'description': `Dream Cleaning provides professional cleaning services across 58 ZIP codes in Queens, New York — including Astoria, Long Island City, Forest Hills, Flushing, Jamaica, and Rego Park.${priceFragment(listStartingPrices([['Standard cleaning', this.pricing().standardFrom], ['deep cleaning', this.pricing().deepFrom]], 'from'), ' ', '.')}`,
      'url': 'https://dreamcleaningnyc.com/services/queens-cleaning',
      'telephone': '+1-929-930-1525',
      'dateModified': '2026-03-22',
      'parentOrganization': { '@id': 'https://dreamcleaningnyc.com/#business' },
      'areaServed': {
        '@type': 'City',
        'name': 'Queens',
        'containedInPlace': { '@type': 'City', 'name': 'New York' }
      },
      'aggregateRating': aggregateRatingSchema(this.stats)
    };

    this.structuredData.set('ld-queens-cleaning', schema);
  }
}
