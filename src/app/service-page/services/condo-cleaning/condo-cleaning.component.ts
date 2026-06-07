import { Component, OnInit, OnDestroy, Inject } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { RouterModule } from '@angular/router';
import { SERVICE_PRICING } from '../../../shared/service-pricing.data';

@Component({
  selector: 'app-condo-cleaning',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './condo-cleaning.component.html',
  styleUrl: './condo-cleaning.component.scss'
})
export class CondoCleaningComponent implements OnInit, OnDestroy {
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
      'name': 'Condo Cleaning Service in NYC',
      'description': `Dream Cleaning's premium condo cleaning service keeps luxury NYC condominiums immaculate across Manhattan, Brooklyn, and Queens, starting from $${SERVICE_PRICING.residentialFrom}. Fully insured cleaners experienced with high-rise buildings, doorman access, and delicate finishes.`,
      'dateModified': '2026-06-06',
      'url': 'https://dreamcleaningnyc.com/services/condo-cleaning',
      'provider': {
        '@type': 'LocalBusiness',
        'name': 'Dream Cleaning',
        '@id': 'https://dreamcleaningnyc.com/#business'
      },
      'areaServed': { '@type': 'City', 'name': 'New York' },
      'serviceType': 'Condo Cleaning',
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
