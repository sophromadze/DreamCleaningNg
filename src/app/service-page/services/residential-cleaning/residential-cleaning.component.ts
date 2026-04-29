import { Component, OnInit, OnDestroy, Inject } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { RouterModule } from '@angular/router';
import { SERVICE_PRICING } from '../../../shared/service-pricing.data';

@Component({
  selector: 'app-residential-cleaning',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './residential-cleaning.component.html',
  styleUrl: './residential-cleaning.component.scss'
})
export class ResidentialCleaningComponent implements OnInit, OnDestroy {
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
      'name': 'Residential Cleaning Service in NYC',
      'description': `Dream Cleaning's standard residential cleaning service keeps NYC apartments and homes consistently fresh with weekly, biweekly, or monthly maintenance, starting from $${SERVICE_PRICING.residentialFrom}.`,
      'dateModified': '2026-03-22',
      'provider': {
        '@type': 'LocalBusiness',
        'name': 'Dream Cleaning',
        '@id': 'https://dreamcleaningnearme.com/#business'
      },
      'areaServed': { '@type': 'City', 'name': 'New York' },
      'serviceType': 'Residential Cleaning',
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
