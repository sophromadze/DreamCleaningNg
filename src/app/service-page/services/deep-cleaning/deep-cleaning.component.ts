import { Component, OnInit, OnDestroy, Inject } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-deep-cleaning',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './deep-cleaning.component.html',
  styleUrl: './deep-cleaning.component.scss'
})
export class DeepCleaningComponent implements OnInit, OnDestroy {
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
      'description': "Dream Cleaning's deep cleaning service provides intensive top-to-bottom cleaning for apartments and homes in Brooklyn, Manhattan, and Queens — covering baseboards, inside appliances, behind furniture, and hard-to-reach areas. Starting from $190.",
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
        'lowPrice': '190',
        'highPrice': '460',
        'priceCurrency': 'USD'
      }
    };

    this.schemaElement = this.document.createElement('script');
    this.schemaElement.type = 'application/ld+json';
    this.schemaElement.textContent = JSON.stringify(schema);
    this.document.head.appendChild(this.schemaElement);
  }
}
