import { Component, OnInit, OnDestroy, Inject } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { RouterModule } from '@angular/router';
import { GooglePlacesService } from '../../../services/google-reviews.service';
import { ServiceAreaMapComponent } from '../../../service-area-map/service-area-map.component';
import { BROOKLYN_ZIPS } from '../../../data/zip-code-data';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-brooklyn-cleaning',
  standalone: true,
  imports: [CommonModule, RouterModule, ServiceAreaMapComponent],
  templateUrl: './brooklyn-cleaning.component.html',
  styleUrls: ['./brooklyn-cleaning.component.scss']
})
export class BrooklynCleaningComponent implements OnInit, OnDestroy {
  totalReviews: number = 0;
  showGoogleReviews = environment.production;
  brooklynZips = Object.keys(BROOKLYN_ZIPS);
  brooklynMapCenter: [number, number] = [40.6502, -73.9496];
  brooklynZoom = 11;
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
      'name': 'Dream Cleaning - Brooklyn',
      'description': 'Dream Cleaning provides professional cleaning services across 38 ZIP codes in Brooklyn, New York — including Park Slope, Williamsburg, DUMBO, Brooklyn Heights, Bay Ridge, Sunset Park, and Bushwick. Standard cleaning from $110, deep cleaning from $190.',
      'url': 'https://dreamcleaningnearme.com/services/brooklyn-cleaning',
      'telephone': '+1-929-930-1525',
      'dateModified': '2026-03-22',
      'parentOrganization': { '@id': 'https://dreamcleaningnearme.com/#business' },
      'areaServed': {
        '@type': 'City',
        'name': 'Brooklyn',
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
