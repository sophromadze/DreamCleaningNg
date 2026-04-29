import { Component, OnInit, OnDestroy, Inject } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { RouterModule } from '@angular/router';
import { SERVICE_PRICING } from '../../../shared/service-pricing.data';

@Component({
  selector: 'app-heavy-condition-cleaning',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './heavy-condition-cleaning.component.html',
  styleUrl: './heavy-condition-cleaning.component.scss'
})
export class HeavyConditionCleaningComponent implements OnInit, OnDestroy {
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
      'name': 'Heavy Condition Cleaning Service in NYC',
      'description': `Dream Cleaning's heavy condition cleaning service is designed for NYC homes that haven't been cleaned in 6+ months. Priced at $${SERVICE_PRICING.heavyConditionPerHour} per hour per cleaner, this intensive service includes wall washing, cabinet interiors, under sinks, and professional restoration.`,
      'dateModified': '2026-03-22',
      'provider': { '@type': 'LocalBusiness', 'name': 'Dream Cleaning', '@id': 'https://dreamcleaningnearme.com/#business' },
      'areaServed': { '@type': 'City', 'name': 'New York' },
      'serviceType': 'Heavy Condition Cleaning'
    };
    this.schemaElement = this.document.createElement('script');
    this.schemaElement.type = 'application/ld+json';
    this.schemaElement.textContent = JSON.stringify(schema);
    this.document.head.appendChild(this.schemaElement);
  }
}
