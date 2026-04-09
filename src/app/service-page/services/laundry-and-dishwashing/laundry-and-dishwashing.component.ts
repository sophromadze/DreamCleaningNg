import { Component, OnInit, OnDestroy, Inject } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-laundry-and-dishwashing',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './laundry-and-dishwashing.component.html',
  styleUrl: './laundry-and-dishwashing.component.scss'
})
export class LaundryAndDishwashingComponent implements OnInit, OnDestroy {
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
      '@graph': [
        {
          '@type': 'Service',
          'name': 'Laundry & Folding Service in NYC',
          'description': 'Dream Cleaning offers professional laundry, folding, and dishwashing services across Brooklyn, Manhattan, and Queens. We handle washing, drying, and folding using your building\'s facilities or in-unit machines.',
          'dateModified': '2026-03-22',
          'provider': {
            '@type': 'LocalBusiness',
            'name': 'Dream Cleaning',
            '@id': 'https://dreamcleaningnearme.com/#business'
          },
          'areaServed': { '@type': 'City', 'name': 'New York' },
          'serviceType': 'Laundry & Folding'
        },
        {
          '@type': 'Service',
          'name': 'Dishwashing Service in NYC',
          'description': 'Professional dishwashing service in NYC — we wash all dishes, pots, pans, and glassware, then dry and put everything away. Available as add-on or standalone service.',
          'dateModified': '2026-03-22',
          'provider': {
            '@type': 'LocalBusiness',
            'name': 'Dream Cleaning',
            '@id': 'https://dreamcleaningnearme.com/#business'
          },
          'areaServed': { '@type': 'City', 'name': 'New York' },
          'serviceType': 'Dishwashing'
        }
      ]
    };

    this.schemaElement = this.document.createElement('script');
    this.schemaElement.type = 'application/ld+json';
    this.schemaElement.textContent = JSON.stringify(schema);
    this.document.head.appendChild(this.schemaElement);
  }
}
