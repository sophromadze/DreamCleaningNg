import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MarketingPricingService } from '../../../shared/pricing/marketing-pricing.service';
import { priceFragment, startingPriceOffer } from '../../../shared/pricing/marketing-price-format';
import { PhoneNumberService } from '../../../services/phone-number.service';
import { CardImageDirective } from '../../../shared/images/card-image.directive';
import { StructuredDataService } from '../../../services/structured-data.service';

@Component({
  selector: 'app-condo-cleaning',
  standalone: true,
  imports: [CommonModule, RouterModule, CardImageDirective],
  templateUrl: './condo-cleaning.component.html',
  styleUrl: './condo-cleaning.component.scss'
})
export class CondoCleaningComponent implements OnInit, OnDestroy {
  private readonly marketingPricing = inject(MarketingPricingService);
  /** Prices from the booking catalogue; null = fragment left out (MarketingPricingService). */
  readonly pricing = this.marketingPricing.text;
  protected readonly phoneNumber = inject(PhoneNumberService);
  private readonly structuredData = inject(StructuredDataService);

  ngOnInit(): void {
    this.injectSchema();
  }

  ngOnDestroy(): void {
    this.structuredData.remove('ld-condo-cleaning');
  }

  private injectSchema(): void {
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'Service',
      'name': 'Condo Cleaning Service in NYC',
      'description': `Dream Cleaning's premium condo cleaning service keeps luxury NYC condominiums immaculate across Manhattan, Brooklyn, and Queens${priceFragment(this.pricing().standardFrom, ', starting from ')}. Fully insured cleaners experienced with high-rise buildings, doorman access, and delicate finishes.`,
      'dateModified': '2026-06-06',
      'url': 'https://dreamcleaningnyc.com/services/condo-cleaning',
      'provider': {
        '@type': 'LocalBusiness',
        'name': 'Dream Cleaning',
        '@id': 'https://dreamcleaningnyc.com/#business'
      },
      'areaServed': { '@type': 'City', 'name': 'New York' },
      'serviceType': 'Condo Cleaning',
      ...startingPriceOffer(this.marketingPricing.prices().standardFrom)
    };

    this.structuredData.set('ld-condo-cleaning', schema);
  }
}
