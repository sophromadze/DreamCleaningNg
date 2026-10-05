import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { MarketingPricingService } from '../../../shared/pricing/marketing-pricing.service';
import { priceFragment, startingPriceOffer } from '../../../shared/pricing/marketing-price-format';
import { PhoneNumberService } from '../../../services/phone-number.service';
import { IconComponent } from '../../../shared/icons/icon.component';
import { faBan } from '../../../shared/icons/glyphs/faBan';
import { faCircleInfo } from '../../../shared/icons/glyphs/faCircleInfo';
import { faTriangleExclamation } from '../../../shared/icons/glyphs/faTriangleExclamation';
import { CardImageDirective } from '../../../shared/images/card-image.directive';
import { StructuredDataService } from '../../../services/structured-data.service';

@Component({
  selector: 'app-move-in-out-cleaning',
  standalone: true,
  imports: [RouterModule, IconComponent, CardImageDirective],
  templateUrl: './move-in-out-cleaning.component.html',
  styleUrl: './move-in-out-cleaning.component.scss'
})
export class MoveInOutCleaningComponent implements OnInit, OnDestroy {
  protected readonly icons = { faBan, faCircleInfo, faTriangleExclamation };

  private readonly marketingPricing = inject(MarketingPricingService);
  /** Prices from the booking catalogue; null = fragment left out (MarketingPricingService). */
  readonly pricing = this.marketingPricing.text;
  protected readonly phoneNumber = inject(PhoneNumberService);
  private readonly structuredData = inject(StructuredDataService);

  ngOnInit(): void {
    this.injectSchema();
  }

  ngOnDestroy(): void {
    this.structuredData.remove('ld-move-in-out-cleaning');
  }

  private injectSchema(): void {
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'Service',
      'name': 'Move In/Out Cleaning Service in NYC',
      'description': `Dream Cleaning's move in/out cleaning service prepares your NYC apartment or house for a seamless transition${priceFragment(this.pricing().moveInOutFrom, ', starting from ')}. We handle cabinet interiors, appliance deep cleaning, wall spot cleaning, scuff mark removal, and thorough sanitization.`,
      'dateModified': '2026-03-22',
      'provider': {
        '@type': 'LocalBusiness',
        'name': 'Dream Cleaning',
        '@id': 'https://dreamcleaningnyc.com/#business'
      },
      'areaServed': {
        '@type': 'City',
        'name': 'New York'
      },
      'serviceType': 'Move In/Out Cleaning',
      ...startingPriceOffer(this.marketingPricing.prices().moveInOutFrom)
    };

    this.structuredData.set('ld-move-in-out-cleaning', schema);
  }
}
