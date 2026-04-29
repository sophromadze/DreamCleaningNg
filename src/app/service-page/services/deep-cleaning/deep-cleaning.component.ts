import { Component, OnInit, OnDestroy, Inject } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { RouterModule } from '@angular/router';
import { SERVICE_PRICING } from '../../../shared/service-pricing.data';

@Component({
  selector: 'app-deep-cleaning',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './deep-cleaning.component.html',
  styleUrl: './deep-cleaning.component.scss'
})
export class DeepCleaningComponent implements OnInit, OnDestroy {
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
      'name': 'Deep Cleaning Service in NYC',
      'description': `Dream Cleaning's deep cleaning service is a detailed, top-to-bottom cleaning solution for apartments, condos, brownstones, and family homes in Brooklyn, Manhattan, Queens, and across NYC — targeting stubborn buildup, kitchen grease, soap scum, hidden dust, baseboards, door frames, light switches, and other hard-to-reach areas often missed during regular cleanings. Starting from $${SERVICE_PRICING.deepFrom}.`,
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
