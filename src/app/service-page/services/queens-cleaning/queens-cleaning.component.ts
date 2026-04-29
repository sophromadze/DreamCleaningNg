import { Component, OnInit, OnDestroy, Inject } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { RouterModule } from '@angular/router';
import { GooglePlacesService } from '../../../services/google-reviews.service';
import { ServiceAreaMapComponent } from '../../../service-area-map/service-area-map.component';
import { QUEENS_ZIPS } from '../../../data/zip-code-data';
import { SERVICE_PRICING } from '../../../shared/service-pricing.data';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-queens-cleaning',
  standalone: true,
  imports: [CommonModule, RouterModule, ServiceAreaMapComponent],
  templateUrl: './queens-cleaning.component.html',
  styleUrls: ['./queens-cleaning.component.scss']
})
export class QueensCleaningComponent implements OnInit, OnDestroy {
  totalReviews: number = 0;
  showGoogleReviews = environment.production;
  queensZips = Object.keys(QUEENS_ZIPS);
  queensMapCenter: [number, number] = [40.72, -73.8365];
  queensZoom = 11;
  readonly pricing = SERVICE_PRICING;
  private schemaElement: HTMLScriptElement | null = null;

  constructor(
    private googlePlacesService: GooglePlacesService,
    @Inject(DOCUMENT) private document: Document
  ) {}

  ngOnInit() {
    if (this.showGoogleReviews) {
      this.googlePlacesService.getReviews().subscribe({
        next: (data) => this.totalReviews = data.totalReviews,
        error: (err) => console.error('Error loading reviews:', err)
      });
    }
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
      '@type': 'LocalBusiness',
      'name': 'Dream Cleaning - Queens',
      'description': `Dream Cleaning provides professional cleaning services across 58 ZIP codes in Queens, New York — including Astoria, Long Island City, Forest Hills, Flushing, Jamaica, and Rego Park. Standard cleaning from $${SERVICE_PRICING.residentialFrom}, deep cleaning from $${SERVICE_PRICING.deepFrom}.`,
      'url': 'https://dreamcleaningnearme.com/services/queens-cleaning',
      'telephone': '+1-929-930-1525',
      'dateModified': '2026-03-22',
      'parentOrganization': { '@id': 'https://dreamcleaningnearme.com/#business' },
      'areaServed': {
        '@type': 'City',
        'name': 'Queens',
        'containedInPlace': { '@type': 'City', 'name': 'New York' }
      },
      'aggregateRating': {
        '@type': 'AggregateRating',
        'ratingValue': '5.0',
        'reviewCount': '100'
      }
    };

    this.schemaElement = this.document.createElement('script');
    this.schemaElement.type = 'application/ld+json';
    this.schemaElement.textContent = JSON.stringify(schema);
    this.document.head.appendChild(this.schemaElement);
  }
}
