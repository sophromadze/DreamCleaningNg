import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { MarketingPricingService } from '../../../shared/pricing/marketing-pricing.service';
import { priceFragment, startingPriceOffer } from '../../../shared/pricing/marketing-price-format';
import { PhoneNumberService } from '../../../services/phone-number.service';
import { CardImageDirective } from '../../../shared/images/card-image.directive';
import { StructuredDataService } from '../../../services/structured-data.service';

@Component({
  selector: 'app-house-cleaning',
  standalone: true,
  imports: [RouterModule, CardImageDirective],
  templateUrl: './house-cleaning.component.html',
  styleUrl: './house-cleaning.component.scss'
})
export class HouseCleaningComponent implements OnInit, OnDestroy {
  private readonly marketingPricing = inject(MarketingPricingService);
  /** Prices from the booking catalogue; null = fragment left out (MarketingPricingService). */
  readonly pricing = this.marketingPricing.text;
  protected readonly phoneNumber = inject(PhoneNumberService);
  private readonly structuredData = inject(StructuredDataService);

  ngOnInit(): void {
    this.injectSchema();
  }

  ngOnDestroy(): void {
    this.structuredData.remove('ld-house-cleaning');
  }

  private injectSchema(): void {
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'Service',
      'name': 'House Cleaning Service in NYC',
      'description': `Dream Cleaning's professional house cleaning service keeps multi-floor homes and estates pristine across Queens and Brooklyn${priceFragment(this.pricing().standardFrom, ', starting from ')}. Trained, fully insured local cleaners for large layouts, staircases, and high-traffic family spaces.`,
      'dateModified': '2026-10-02',
      'url': 'https://dreamcleaningnyc.com/services/house-cleaning',
      'provider': {
        '@type': 'LocalBusiness',
        'name': 'Dream Cleaning',
        '@id': 'https://dreamcleaningnyc.com/#business'
      },
      'areaServed': { '@type': 'City', 'name': 'New York' },
      'serviceType': 'House Cleaning',
      ...startingPriceOffer(this.marketingPricing.prices().standardFrom)
    };

    this.structuredData.set('ld-house-cleaning', schema);
  }
}
