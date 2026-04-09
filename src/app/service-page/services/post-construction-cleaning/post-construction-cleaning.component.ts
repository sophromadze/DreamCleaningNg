import { Component, OnInit, OnDestroy, Inject } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-post-construction-cleaning',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './post-construction-cleaning.component.html',
  styleUrl: './post-construction-cleaning.component.scss'
})
export class PostConstructionCleaningComponent implements OnInit, OnDestroy {
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
      'name': 'Post Construction Cleaning Service in NYC',
      'description': "Dream Cleaning's post construction cleaning service removes fine construction dust, debris, and residue from every surface in your newly renovated NYC apartment or house.",
      'dateModified': '2026-03-22',
      'provider': { '@type': 'LocalBusiness', 'name': 'Dream Cleaning', '@id': 'https://dreamcleaningnearme.com/#business' },
      'areaServed': { '@type': 'City', 'name': 'New York' },
      'serviceType': 'Post Construction Cleaning'
    };
    this.schemaElement = this.document.createElement('script');
    this.schemaElement.type = 'application/ld+json';
    this.schemaElement.textContent = JSON.stringify(schema);
    this.document.head.appendChild(this.schemaElement);
  }
}
