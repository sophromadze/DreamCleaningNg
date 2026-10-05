import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MarketingPricingService } from '../../../shared/pricing/marketing-pricing.service';
import { PhoneNumberService } from '../../../services/phone-number.service';
import { CardImageDirective } from '../../../shared/images/card-image.directive';
import { StructuredDataService } from '../../../services/structured-data.service';

@Component({
  selector: 'app-custom-cleaning',
  standalone: true,
  imports: [CommonModule, RouterModule, CardImageDirective],
  templateUrl: './custom-cleaning.component.html',
  styleUrl: './custom-cleaning.component.scss'
})
export class CustomCleaningComponent implements OnInit, OnDestroy {
  private readonly marketingPricing = inject(MarketingPricingService);
  /** Prices from the booking catalogue; null = fragment left out (MarketingPricingService). */
  readonly pricing = this.marketingPricing.text;
  protected readonly phoneNumber = inject(PhoneNumberService);
  private readonly structuredData = inject(StructuredDataService);

  ngOnInit(): void {
    this.injectSchema();
  }

  ngOnDestroy(): void {
    this.structuredData.remove('ld-custom-cleaning');
  }

  private injectSchema(): void {
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'Service',
      'name': 'Custom Cleaning Service in NYC',
      'description': "Dream Cleaning's custom cleaning service lets you design your own cleaning plan — choose specific rooms, tasks, and duration to match your exact needs and budget across Brooklyn, Manhattan, and Queens.",
      'dateModified': '2026-03-22',
      'provider': {
        '@type': 'LocalBusiness',
        'name': 'Dream Cleaning',
        '@id': 'https://dreamcleaningnyc.com/#business'
      },
      'areaServed': { '@type': 'City', 'name': 'New York' },
      'serviceType': 'Custom Cleaning'
    };

    this.structuredData.set('ld-custom-cleaning', schema);
  }
}
