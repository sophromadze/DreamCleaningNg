import { Component, OnInit, OnDestroy, Inject } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { RouterModule } from '@angular/router';
import { SERVICE_PRICING } from '../../../shared/service-pricing.data';

@Component({
  selector: 'app-house-cleaning',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './house-cleaning.component.html',
  styleUrl: './house-cleaning.component.scss'
})
export class HouseCleaningComponent implements OnInit, OnDestroy {
  readonly pricing = SERVICE_PRICING;
  private schemaElement: HTMLScriptElement | null = null;

  constructor(@Inject(DOCUMENT) private document: Document) {}

  ngOnInit(): void {
    this.injectSchema();
  }

  ngOnDestroy(): void {
    if (this.schemaElement && this.schemaElement.parentNode) {
      this.schemaElement.parentNode.removeChild(this.schemaElement);
    }
  }

  private injectSchema(): void {
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'Service',
      'name': 'House Cleaning Service in NYC',
      'description': `Dream Cleaning's professional house cleaning service keeps multi-floor homes and estates pristine across Queens, Brooklyn, and Staten Island, starting from $${SERVICE_PRICING.residentialFrom}. Trained, fully insured local cleaners for large layouts, staircases, and high-traffic family spaces.`,
      'dateModified': '2026-06-06',
      'url': 'https://dreamcleaningnyc.com/services/house-cleaning',
      'provider': {
        '@type': 'LocalBusiness',
        'name': 'Dream Cleaning',
        '@id': 'https://dreamcleaningnyc.com/#business'
      },
      'areaServed': { '@type': 'City', 'name': 'New York' },
      'serviceType': 'House Cleaning',
      'offers': {
        '@type': 'AggregateOffer',
        'lowPrice': String(SERVICE_PRICING.residentialFrom),
        'highPrice': String(SERVICE_PRICING.residentialHigh),
        'priceCurrency': 'USD'
      }
    };

    this.schemaElement = this.document.createElement('script');
    this.schemaElement.type = 'application/ld+json';
    this.schemaElement.textContent = JSON.stringify(schema);
    this.document.head.appendChild(this.schemaElement);
  }
}
