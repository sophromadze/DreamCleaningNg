import { Component, OnInit, OnDestroy, inject, ChangeDetectionStrategy } from '@angular/core';
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
import { MANHATTAN_ZIPS } from '../../../data/zip-code-data';
import { MarketingPricingService } from '../../../shared/pricing/marketing-pricing.service';
import { listStartingPrices, priceFragment } from '../../../shared/pricing/marketing-price-format';
import { environment } from '../../../../environments/environment';
import { CardImageDirective } from '../../../shared/images/card-image.directive';
import { StructuredDataService } from '../../../services/structured-data.service';

@Component({
  selector: 'app-manhattan-cleaning',
  standalone: true,
  imports: [RouterModule, ServiceAreaMapComponent, HomeHeroComponent, CardImageDirective],
  templateUrl: './manhattan-cleaning.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./manhattan-cleaning.component.scss']
})
export class ManhattanCleaningComponent implements OnInit, OnDestroy {
  private googlePlacesService = inject(GooglePlacesService);

  /** Google review count/rating (shared /stats endpoint); null until loaded or in local dev. */
  stats: ReviewStats | null = null;
  showGoogleReviews = environment.production;
  manhattanZips = Object.keys(MANHATTAN_ZIPS);
  manhattanMapCenter: [number, number] = [40.738, -73.9855];
  manhattanZoom = 12;
  private readonly marketingPricing = inject(MarketingPricingService);
  /** Prices from the booking catalogue; null = fragment left out (MarketingPricingService). */
  readonly pricing = this.marketingPricing.text;
  private readonly structuredData = inject(StructuredDataService);

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
    this.structuredData.remove('ld-manhattan-cleaning');
  }

  private injectSchema(): void {
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      'name': 'Dream Cleaning - Manhattan',
      'description': `Dream Cleaning provides professional cleaning services across 24 ZIP codes in Manhattan, New York — including Midtown, Chelsea, Lower East Side, Upper West Side, Financial District, and SoHo.${priceFragment(listStartingPrices([['Standard cleaning', this.pricing().standardFrom], ['deep cleaning', this.pricing().deepFrom]], 'from'), ' ', '.')}`,
      'url': 'https://dreamcleaningnyc.com/services/manhattan-cleaning',
      'telephone': '+1-929-930-1525',
      'dateModified': '2026-03-22',
      'parentOrganization': { '@id': 'https://dreamcleaningnyc.com/#business' },
      'areaServed': {
        '@type': 'City',
        'name': 'Manhattan',
        'containedInPlace': { '@type': 'City', 'name': 'New York' }
      },
      'aggregateRating': aggregateRatingSchema(this.stats)
    };

    this.structuredData.set('ld-manhattan-cleaning', schema);
  }
}
