import { Component, OnInit, OnDestroy, Inject, inject } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { RouterModule } from '@angular/router';
import { SERVICE_PRICING } from '../../../shared/service-pricing.data';
import { PhoneNumberService } from '../../../services/phone-number.service';

@Component({
  selector: 'app-airbnb-cleaning',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './airbnb-cleaning.component.html',
  styleUrl: './airbnb-cleaning.component.scss'
})
export class AirbnbCleaningComponent implements OnInit, OnDestroy {
  readonly pricing = SERVICE_PRICING;
  protected readonly phoneNumber = inject(PhoneNumberService);
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
      'name': 'Airbnb Cleaning Service in NYC',
      'description': `Dream Cleaning's Airbnb and short-term rental turnover cleaning delivers fast, hotel-quality resets between guests across Manhattan, Brooklyn, and Queens, starting from $${SERVICE_PRICING.residentialFrom}. Same-day changeovers, linen changes, restocking, and real-time photo updates for hosts and property managers.`,
      'dateModified': '2026-06-06',
      'url': 'https://dreamcleaningnyc.com/services/airbnb-cleaning',
      'provider': {
        '@type': 'LocalBusiness',
        'name': 'Dream Cleaning',
        '@id': 'https://dreamcleaningnyc.com/#business'
      },
      'areaServed': { '@type': 'City', 'name': 'New York' },
      'serviceType': 'Airbnb Turnover Cleaning',
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
