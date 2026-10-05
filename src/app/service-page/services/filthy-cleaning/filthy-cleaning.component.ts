import { Component, OnInit, OnDestroy, inject, ChangeDetectionStrategy } from '@angular/core';
import { RouterModule } from '@angular/router';
import { MarketingPricingService } from '../../../shared/pricing/marketing-pricing.service';
import { PhoneNumberService } from '../../../services/phone-number.service';
import { CardImageDirective } from '../../../shared/images/card-image.directive';
import { StructuredDataService } from '../../../services/structured-data.service';

@Component({
  selector: 'app-filthy-cleaning',
  standalone: true,
  imports: [RouterModule, CardImageDirective],
  templateUrl: './filthy-cleaning.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './filthy-cleaning.component.scss'
})
export class FilthyCleaningComponent implements OnInit, OnDestroy {
  private readonly marketingPricing = inject(MarketingPricingService);
  /** Prices from the booking catalogue; null = fragment left out (MarketingPricingService). */
  readonly pricing = this.marketingPricing.text;
  protected readonly phoneNumber = inject(PhoneNumberService);
  private readonly structuredData = inject(StructuredDataService);

  ngOnInit(): void { this.injectSchema(); }

  ngOnDestroy(): void {
    this.structuredData.remove('ld-filthy-cleaning');
  }

  private injectSchema(): void {
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'Service',
      'name': 'Filthy Cleaning Service in NYC',
      'description': "Dream Cleaning's filthy cleaning service tackles the most extreme cleaning challenges in NYC — including hoarding situations, extended neglect, and severe accumulation of dirt and debris.",
      'dateModified': '2026-03-22',
      'provider': { '@type': 'LocalBusiness', 'name': 'Dream Cleaning', '@id': 'https://dreamcleaningnyc.com/#business' },
      'areaServed': { '@type': 'City', 'name': 'New York' },
      'serviceType': 'Filthy Cleaning'
    };
    this.structuredData.set('ld-filthy-cleaning', schema);
  }
}
