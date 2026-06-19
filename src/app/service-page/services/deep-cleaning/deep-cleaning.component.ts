import { Component, OnInit, OnDestroy, Inject } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { SERVICE_PRICING } from '../../../shared/service-pricing.data';
import { TestimonialSectionComponent } from '../../../shared/components/testimonial-section/testimonial-section.component';
import { SpecialOfferService, PublicSpecialOffer } from '../../../services/special-offer.service';

@Component({
  selector: 'app-deep-cleaning',
  standalone: true,
  imports: [CommonModule, RouterModule, TestimonialSectionComponent],
  templateUrl: './deep-cleaning.component.html',
  styleUrl: './deep-cleaning.component.scss'
})
export class DeepCleaningComponent implements OnInit, OnDestroy {
  readonly pricing = SERVICE_PRICING;
  private schemaElement: HTMLScriptElement | null = null;

  /** First-time customer offer from public special offers. The percentage is
   *  admin-configurable (never hardcoded) — the hero line only renders once it loads. */
  specialOffers: PublicSpecialOffer[] = [];
  private subscription = new Subscription();

  constructor(
    @Inject(DOCUMENT) private document: Document,
    private specialOfferService: SpecialOfferService
  ) {}

  ngOnInit(): void {
    this.injectSchema();
    this.loadFirstTimeOffer();
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
    if (this.schemaElement && this.schemaElement.parentNode) {
      this.schemaElement.parentNode.removeChild(this.schemaElement);
    }
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
    return this.specialOffers?.find(o =>
      o.requiresFirstTimeCustomer ||
      o.type === 'FirstTime' ||
      (o.name?.toLowerCase().includes('first time') ?? false) ||
      (o.name?.toLowerCase().includes('first-time') ?? false)
    );
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
      'description': `Dream Cleaning's deep cleaning service is a detailed, top-to-bottom cleaning solution for apartments, condos, brownstones, and family homes in Brooklyn, Manhattan, Queens, and across NYC — targeting stubborn buildup, kitchen grease, soap scum, hidden dust, baseboards, door frames, light switches, and other hard-to-reach areas often missed during regular cleanings. Starting from $${SERVICE_PRICING.deepFrom}.`,
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
      'offers': {
        '@type': 'AggregateOffer',
        'lowPrice': String(SERVICE_PRICING.deepFrom),
        'highPrice': String(SERVICE_PRICING.deepHigh),
        'priceCurrency': 'USD'
      }
    };

    this.schemaElement = this.document.createElement('script');
    this.schemaElement.type = 'application/ld+json';
    this.schemaElement.textContent = JSON.stringify(schema);
    this.document.head.appendChild(this.schemaElement);
  }
}
