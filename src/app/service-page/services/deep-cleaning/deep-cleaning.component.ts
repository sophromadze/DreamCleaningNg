import { Component, OnInit, OnDestroy, inject, ChangeDetectionStrategy } from '@angular/core';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { MarketingPricingService } from '../../../shared/pricing/marketing-pricing.service';
import { priceFragment, startingPriceOffer } from '../../../shared/pricing/marketing-price-format';
import { TestimonialSectionComponent } from '../../../shared/components/testimonial-section/testimonial-section.component';
import { SpecialOfferService, PublicSpecialOffer } from '../../../services/special-offer.service';
import { IconComponent } from '../../../shared/icons/icon.component';
import { faBed } from '../../../shared/icons/glyphs/faBed';
import { faHouse } from '../../../shared/icons/glyphs/faHouse';
import { faListCheck } from '../../../shared/icons/glyphs/faListCheck';
import { faMagnifyingGlass } from '../../../shared/icons/glyphs/faMagnifyingGlass';
import { faTags } from '../../../shared/icons/glyphs/faTags';
import { faTriangleExclamation } from '../../../shared/icons/glyphs/faTriangleExclamation';
import { CardImageDirective } from '../../../shared/images/card-image.directive';
import { StructuredDataService } from '../../../services/structured-data.service';
import { findAdvertisedFirstTimeOffer } from '../../../shared/booking/special-offer-keys';

@Component({
  selector: 'app-deep-cleaning',
  standalone: true,
  imports: [RouterModule, TestimonialSectionComponent, IconComponent, CardImageDirective],
  templateUrl: './deep-cleaning.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './deep-cleaning.component.scss'
})
export class DeepCleaningComponent implements OnInit, OnDestroy {
  protected readonly icons = { faBed, faHouse, faListCheck, faMagnifyingGlass, faTags, faTriangleExclamation };

  private readonly marketingPricing = inject(MarketingPricingService);
  /** Prices from the booking catalogue; null = fragment left out (MarketingPricingService). */
  readonly pricing = this.marketingPricing.text;
  private readonly structuredData = inject(StructuredDataService);

  /** First-time customer offer from public special offers. The percentage is
   *  admin-configurable (never hardcoded) — the hero line only renders once it loads. */
  specialOffers: PublicSpecialOffer[] = [];
  private subscription = new Subscription();

  constructor(
    private specialOfferService: SpecialOfferService
  ) {}

  ngOnInit(): void {
    this.injectSchema();
    this.loadFirstTimeOffer();
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
    this.structuredData.remove('ld-deep-cleaning');
  }

  private loadFirstTimeOffer(): void {
    this.subscription.add(
      this.specialOfferService.getPublicSpecialOffers().subscribe({
        next: (offers) => { this.specialOffers = offers; },
        error: (error) => { console.error('Error loading special offers:', error); }
      })
    );
  }

  /** Mirrors MainComponent.firstTimeOffer — finds the first-time customer offer. */
  get firstTimeOffer(): PublicSpecialOffer | undefined {
    return findAdvertisedFirstTimeOffer(this.specialOffers);
  }

  /** Display label for the first-time discount, e.g. "10%" or "$20". Empty when no offer is loaded. */
  get firstTimeDiscountLabel(): string {
    const offer = this.firstTimeOffer;
    if (!offer) return '';
    return offer.isPercentage ? `${offer.discountValue}%` : `$${offer.discountValue}`;
  }

  private injectSchema(): void {
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'Service',
      'name': 'Deep Cleaning Service in NYC',
      'description': `Dream Cleaning's deep cleaning service is a detailed, top-to-bottom cleaning solution for apartments, condos, brownstones, and family homes in Brooklyn, Manhattan, Queens, and across NYC — targeting stubborn buildup, kitchen grease, soap scum, hidden dust, baseboards, door frames, light switches, and other hard-to-reach areas often missed during regular cleanings.${priceFragment(this.pricing().deepFrom, ' Starting from ', '.')}`,
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
      'serviceType': 'Deep Cleaning',
      ...startingPriceOffer(this.marketingPricing.prices().deepFrom)
    };

    this.structuredData.set('ld-deep-cleaning', schema);
  }
}
