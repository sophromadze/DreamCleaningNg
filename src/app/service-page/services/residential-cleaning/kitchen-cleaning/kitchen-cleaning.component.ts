import { Component, OnInit, OnDestroy, Inject } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-kitchen-cleaning',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './kitchen-cleaning.component.html',
  styleUrl: './kitchen-cleaning.component.scss'
})
export class KitchenCleaningComponent implements OnInit, OnDestroy {
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
      'name': 'Kitchen Cleaning Service in NYC',
      'description': "Dream Cleaning's kitchen cleaning service provides thorough degreasing and sanitization for NYC kitchens — covering stovetops, countertops, sinks, cabinet exteriors, appliance surfaces, and floor mopping.",
      'dateModified': '2026-03-22',
      'provider': { '@type': 'LocalBusiness', 'name': 'Dream Cleaning', '@id': 'https://dreamcleaningnearme.com/#business' },
      'areaServed': { '@type': 'City', 'name': 'New York' },
      'serviceType': 'Kitchen Cleaning'
    };
    this.schemaElement = this.document.createElement('script');
    this.schemaElement.type = 'application/ld+json';
    this.schemaElement.textContent = JSON.stringify(schema);
    this.document.head.appendChild(this.schemaElement);
  }
}
