import { Component, OnInit, OnDestroy, Inject } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-general-cleaning',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './general-cleaning.component.html',
  styleUrl: './general-cleaning.component.scss'
})
export class GeneralCleaningComponent implements OnInit, OnDestroy {
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
      'name': 'General Cleaning Service in NYC',
      'description': "Dream Cleaning's general cleaning service provides systematic room-by-room cleaning for NYC apartments and homes — dusting, vacuuming, mopping, and sanitizing across Brooklyn, Manhattan, and Queens.",
      'dateModified': '2026-03-22',
      'provider': { '@type': 'LocalBusiness', 'name': 'Dream Cleaning', '@id': 'https://dreamcleaningnearme.com/#business' },
      'areaServed': { '@type': 'City', 'name': 'New York' },
      'serviceType': 'General Cleaning'
    };
    this.schemaElement = this.document.createElement('script');
    this.schemaElement.type = 'application/ld+json';
    this.schemaElement.textContent = JSON.stringify(schema);
    this.document.head.appendChild(this.schemaElement);
  }
}
