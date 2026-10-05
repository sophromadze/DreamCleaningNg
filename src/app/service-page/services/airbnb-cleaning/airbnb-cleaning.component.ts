import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { MarketingPricingService } from '../../../shared/pricing/marketing-pricing.service';
import { priceFragment, startingPriceOffer } from '../../../shared/pricing/marketing-price-format';
import { PhoneNumberService } from '../../../services/phone-number.service';
import { CardImageDirective } from '../../../shared/images/card-image.directive';
import { StructuredDataService } from '../../../services/structured-data.service';

@Component({
  selector: 'app-airbnb-cleaning',
  standalone: true,
  imports: [RouterModule, CardImageDirective],
  templateUrl: './airbnb-cleaning.component.html',
  styleUrl: './airbnb-cleaning.component.scss'
})
export class AirbnbCleaningComponent implements OnInit, OnDestroy {
  private readonly marketingPricing = inject(MarketingPricingService);
  /** Prices from the booking catalogue; null = fragment left out (MarketingPricingService). */
  readonly pricing = this.marketingPricing.text;
  protected readonly phoneNumber = inject(PhoneNumberService);
  private readonly structuredData = inject(StructuredDataService);

  ngOnInit(): void {
    this.injectSchema();
  }

  ngOnDestroy(): void {
    this.structuredData.remove('ld-airbnb-cleaning');
  }

  private injectSchema(): void {
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'Service',
      'name': 'Airbnb Cleaning Service in NYC',
      'description': `Dream Cleaning's Airbnb and short-term rental turnover cleaning delivers fast, hotel-quality resets between guests across Manhattan, Brooklyn, and Queens${priceFragment(this.pricing().standardFrom, ', starting from ')}. Same-day changeovers, linen changes, restocking, and real-time photo updates for hosts and property managers.`,
      'dateModified': '2026-06-06',
      'url': 'https://dreamcleaningnyc.com/services/airbnb-cleaning',
      'provider': {
        '@type': 'LocalBusiness',
        'name': 'Dream Cleaning',
        '@id': 'https://dreamcleaningnyc.com/#business'
      },
      'areaServed': { '@type': 'City', 'name': 'New York' },
      'serviceType': 'Airbnb Turnover Cleaning',
      ...startingPriceOffer(this.marketingPricing.prices().standardFrom)
    };

    this.structuredData.set('ld-airbnb-cleaning', schema);
  }
}
