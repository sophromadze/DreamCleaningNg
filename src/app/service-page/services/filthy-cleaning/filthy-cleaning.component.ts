import { Component, OnInit, OnDestroy, Inject } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { RouterModule } from '@angular/router';
import { SERVICE_PRICING } from '../../../shared/service-pricing.data';

@Component({
  selector: 'app-filthy-cleaning',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './filthy-cleaning.component.html',
  styleUrl: './filthy-cleaning.component.scss'
})
export class FilthyCleaningComponent implements OnInit, OnDestroy {
  readonly pricing = SERVICE_PRICING;
  private schemaElement: HTMLScriptElement | null = null;

  constructor(@Inject(DOCUMENT) private document: Document) {}

  ngOnInit(): void { this.injectSchema(); }

  ngOnDestroy(): void {
    if (this.schemaElement && this.schemaElement.parentNode) {
      this.schemaElement.parentNode.removeChild(this.schemaElement);
    }
  }

  private injectSchema(): void {
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'Service',
      'name': 'Filthy Cleaning Service in NYC',
      'description': "Dream Cleaning's filthy cleaning service tackles the most extreme cleaning challenges in NYC — including hoarding situations, extended neglect, and severe accumulation of dirt and debris.",
      'dateModified': '2026-03-22',
      'provider': { '@type': 'LocalBusiness', 'name': 'Dream Cleaning', '@id': 'https://dreamcleaningnearme.com/#business' },
      'areaServed': { '@type': 'City', 'name': 'New York' },
      'serviceType': 'Filthy Cleaning'
    };
    this.schemaElement = this.document.createElement('script');
    this.schemaElement.type = 'application/ld+json';
    this.schemaElement.textContent = JSON.stringify(schema);
    this.document.head.appendChild(this.schemaElement);
  }
}
