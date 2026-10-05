import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MarketingPricingService } from '../../../shared/pricing/marketing-pricing.service';
import { IconComponent } from '../../../shared/icons/icon.component';
import { faBan } from '../../../shared/icons/glyphs/faBan';
import { faGears } from '../../../shared/icons/glyphs/faGears';
import { faHeart } from '../../../shared/icons/glyphs/faHeart';
import { faScrewdriverWrench } from '../../../shared/icons/glyphs/faScrewdriverWrench';
import { faShieldHalved } from '../../../shared/icons/glyphs/faShieldHalved';
import { faTriangleExclamation } from '../../../shared/icons/glyphs/faTriangleExclamation';
import { faUsers } from '../../../shared/icons/glyphs/faUsers';
import { CardImageDirective } from '../../../shared/images/card-image.directive';
import { StructuredDataService } from '../../../services/structured-data.service';

@Component({
  selector: 'app-heavy-condition-cleaning',
  standalone: true,
  imports: [CommonModule, RouterModule, IconComponent, CardImageDirective],
  templateUrl: './heavy-condition-cleaning.component.html',
  styleUrl: './heavy-condition-cleaning.component.scss'
})
export class HeavyConditionCleaningComponent implements OnInit, OnDestroy {
  protected readonly icons = { faBan, faGears, faHeart, faScrewdriverWrench, faShieldHalved, faTriangleExclamation, faUsers };

  private readonly marketingPricing = inject(MarketingPricingService);
  /** Prices from the booking catalogue; null = fragment left out (MarketingPricingService). */
  readonly pricing = this.marketingPricing.text;
  private readonly structuredData = inject(StructuredDataService);

  ngOnInit(): void { this.injectSchema(); }

  ngOnDestroy(): void {
    this.structuredData.remove('ld-heavy-condition-cleaning');
  }

  private injectSchema(): void {
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'Service',
      'name': 'Heavy Condition Cleaning Service in NYC',
      'description': `Dream Cleaning's heavy condition cleaning service is designed for NYC homes that haven't been cleaned in 6+ months. ${this.pricing().heavyPerHour ? `Priced at ${this.pricing().heavyPerHour} per hour per cleaner, this` : 'This'} intensive service includes wall washing, cabinet interiors, under sinks, and professional restoration.`,
      'dateModified': '2026-03-22',
      'provider': { '@type': 'LocalBusiness', 'name': 'Dream Cleaning', '@id': 'https://dreamcleaningnyc.com/#business' },
      'areaServed': { '@type': 'City', 'name': 'New York' },
      'serviceType': 'Heavy Condition Cleaning'
    };
    this.structuredData.set('ld-heavy-condition-cleaning', schema);
  }
}
