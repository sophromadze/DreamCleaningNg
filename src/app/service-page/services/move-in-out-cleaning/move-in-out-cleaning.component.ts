import { Component, OnInit, OnDestroy, Inject } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { RouterModule } from '@angular/router';
import { SERVICE_PRICING } from '../../../shared/service-pricing.data';

@Component({
  selector: 'app-move-in-out-cleaning',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './move-in-out-cleaning.component.html',
  styleUrl: './move-in-out-cleaning.component.scss'
})
export class MoveInOutCleaningComponent implements OnInit, OnDestroy {
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
      'name': 'Move In/Out Cleaning Service in NYC',
      'description': `Dream Cleaning's move in/out cleaning service prepares your NYC apartment or house for a seamless transition, starting from $${SERVICE_PRICING.moveInOutFrom}. We handle cabinet interiors, appliance deep cleaning, wall spot cleaning, scuff mark removal, and thorough sanitization.`,
      'dateModified': '2026-03-22',
      'provider': {
        '@type': 'LocalBusiness',
        'name': 'Dream Cleaning',
        '@id': 'https://dreamcleaningnearme.com/#business'
      },
      'areaServed': {
        '@type': 'City',
        'name': 'New York'
      },
      'serviceType': 'Move In/Out Cleaning',
      'offers': {
        '@type': 'AggregateOffer',
        'lowPrice': String(SERVICE_PRICING.moveInOutFrom),
        'highPrice': String(SERVICE_PRICING.moveInOutHigh),
        'priceCurrency': 'USD'
      }
    };

    this.schemaElement = this.document.createElement('script');
    this.schemaElement.type = 'application/ld+json';
    this.schemaElement.textContent = JSON.stringify(schema);
    this.document.head.appendChild(this.schemaElement);
  }
}
