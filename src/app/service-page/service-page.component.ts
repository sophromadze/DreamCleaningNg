import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { RouterModule } from '@angular/router';
import { MarketingPricingService } from '../shared/pricing/marketing-pricing.service';
import { CardImageDirective } from '../shared/images/card-image.directive';

@Component({
  selector: 'app-service-page',
  standalone: true,
  imports: [RouterModule, CardImageDirective],
  templateUrl: './service-page.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './service-page.component.scss'
})
export class ServicePageComponent {
  private readonly marketingPricing = inject(MarketingPricingService);
  /** Prices from the booking catalogue; null = fragment left out (MarketingPricingService). */
  readonly pricing = this.marketingPricing.text;

  constructor() {}
}
