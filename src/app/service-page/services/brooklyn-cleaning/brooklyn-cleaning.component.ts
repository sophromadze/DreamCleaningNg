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
import { BROOKLYN_ZIPS } from '../../../data/zip-code-data';
import { MarketingPricingService } from '../../../shared/pricing/marketing-pricing.service';
import { listStartingPrices, priceFragment } from '../../../shared/pricing/marketing-price-format';
import { environment } from '../../../../environments/environment';
import { CardImageDirective } from '../../../shared/images/card-image.directive';
import { StructuredDataService } from '../../../services/structured-data.service';

@Component({
  selector: 'app-brooklyn-cleaning',
  standalone: true,
  imports: [RouterModule, ServiceAreaMapComponent, HomeHeroComponent, CardImageDirective],
  templateUrl: './brooklyn-cleaning.component.html',
  styleUrls: ['./brooklyn-cleaning.component.scss']
})
export class BrooklynCleaningComponent implements OnInit, OnDestroy {
  /** Google review count/rating (shared /stats endpoint); null until loaded or in local dev. */
  stats: ReviewStats | null = null;
  showGoogleReviews = environment.production;
  brooklynZips = Object.keys(BROOKLYN_ZIPS);
  brooklynMapCenter: [number, number] = [40.6502, -73.9496];
  brooklynZoom = 11;
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
    this.structuredData.remove('ld-brooklyn-cleaning');
  }

  private injectSchema(): void {
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      'name': 'Dream Cleaning - Brooklyn',
      'description': `Dream Cleaning provides professional cleaning services across 38 ZIP codes in Brooklyn, New York — including Park Slope, Williamsburg, DUMBO, Brooklyn Heights, Bay Ridge, Sunset Park, and Bushwick.${priceFragment(listStartingPrices([['Standard cleaning', this.pricing().standardFrom], ['deep cleaning', this.pricing().deepFrom]], 'from'), ' ', '.')}`,
      'url': 'https://dreamcleaningnyc.com/services/brooklyn-cleaning',
      'telephone': '+1-929-930-1525',
      'dateModified': '2026-03-22',
      'parentOrganization': { '@id': 'https://dreamcleaningnyc.com/#business' },
      'areaServed': {
        '@type': 'City',
        'name': 'Brooklyn',
        'containedInPlace': { '@type': 'City', 'name': 'New York' }
      },
      'aggregateRating': aggregateRatingSchema(this.stats)
    };

    this.structuredData.set('ld-brooklyn-cleaning', schema);
  }
}
