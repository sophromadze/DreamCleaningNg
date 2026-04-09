import { Component, OnInit, OnDestroy, Inject } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-custom-cleaning',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './custom-cleaning.component.html',
  styleUrl: './custom-cleaning.component.scss'
})
export class CustomCleaningComponent implements OnInit, OnDestroy {
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
      'name': 'Custom Cleaning Service in NYC',
      'description': "Dream Cleaning's custom cleaning service lets you design your own cleaning plan — choose specific rooms, tasks, and duration to match your exact needs and budget across Brooklyn, Manhattan, and Queens.",
      'dateModified': '2026-03-22',
      'provider': {
        '@type': 'LocalBusiness',
        'name': 'Dream Cleaning',
        '@id': 'https://dreamcleaningnearme.com/#business'
      },
      'areaServed': { '@type': 'City', 'name': 'New York' },
      'serviceType': 'Custom Cleaning'
    };

    this.schemaElement = this.document.createElement('script');
    this.schemaElement.type = 'application/ld+json';
    this.schemaElement.textContent = JSON.stringify(schema);
    this.document.head.appendChild(this.schemaElement);
  }
}
