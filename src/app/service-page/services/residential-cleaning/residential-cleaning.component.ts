import { Component, OnInit, OnDestroy, inject, ChangeDetectionStrategy } from '@angular/core';
import { RouterModule } from '@angular/router';
import { MarketingPricingService } from '../../../shared/pricing/marketing-pricing.service';
import { priceFragment, startingPriceOffer } from '../../../shared/pricing/marketing-price-format';
import { IconComponent } from '../../../shared/icons/icon.component';
import { faBan } from '../../../shared/icons/glyphs/faBan';
import { faTriangleExclamation } from '../../../shared/icons/glyphs/faTriangleExclamation';
import { CardImageDirective } from '../../../shared/images/card-image.directive';
import { StructuredDataService } from '../../../services/structured-data.service';

@Component({
  selector: 'app-residential-cleaning',
  standalone: true,
  imports: [RouterModule, IconComponent, CardImageDirective],
  templateUrl: './residential-cleaning.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './residential-cleaning.component.scss'
})
export class ResidentialCleaningComponent implements OnInit, OnDestroy {
  protected readonly icons = { faBan, faTriangleExclamation };

  private readonly marketingPricing = inject(MarketingPricingService);
  /** Prices from the booking catalogue; null = fragment left out (MarketingPricingService). */
  readonly pricing = this.marketingPricing.text;
  private readonly structuredData = inject(StructuredDataService);

  ngOnInit(): void {
    this.injectSchema();
  }

  ngOnDestroy(): void {
    this.structuredData.remove('ld-residential-cleaning');
  }

  private injectSchema(): void {
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'Service',
      'name': 'Residential Cleaning Service in NYC',
      'description': `Dream Cleaning's standard residential cleaning service keeps NYC apartments and homes consistently fresh with weekly, biweekly, or monthly maintenance${priceFragment(this.pricing().standardFrom, ', starting from ')}.`,
      'dateModified': '2026-03-22',
      'provider': {
        '@type': 'LocalBusiness',
        'name': 'Dream Cleaning',
        '@id': 'https://dreamcleaningnyc.com/#business'
      },
      'areaServed': { '@type': 'City', 'name': 'New York' },
      'serviceType': 'Residential Cleaning',
      ...startingPriceOffer(this.marketingPricing.prices().standardFrom)
    };

    this.structuredData.set('ld-residential-cleaning', schema);
  }
}
