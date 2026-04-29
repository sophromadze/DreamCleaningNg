import { Component, OnInit, OnDestroy, Inject } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { RouterModule } from '@angular/router';
import { GooglePlacesService } from '../../../services/google-reviews.service';
import { ServiceAreaMapComponent } from '../../../service-area-map/service-area-map.component';
import { MANHATTAN_ZIPS } from '../../../data/zip-code-data';
import { SERVICE_PRICING } from '../../../shared/service-pricing.data';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-manhattan-cleaning',
  standalone: true,
  imports: [CommonModule, RouterModule, ServiceAreaMapComponent],
  templateUrl: './manhattan-cleaning.component.html',
  styleUrls: ['./manhattan-cleaning.component.scss']
})
export class ManhattanCleaningComponent implements OnInit, OnDestroy {
  totalReviews: number = 0;
  showGoogleReviews = environment.production;
  manhattanZips = Object.keys(MANHATTAN_ZIPS);
  manhattanMapCenter: [number, number] = [40.738, -73.9855];
  manhattanZoom = 12;
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
      'name': 'Dream Cleaning - Manhattan',
      'description': `Dream Cleaning provides professional cleaning services across 24 ZIP codes in Manhattan, New York — including Midtown, Chelsea, Lower East Side, Upper West Side, Financial District, and SoHo. Standard cleaning from $${SERVICE_PRICING.residentialFrom}, deep cleaning from $${SERVICE_PRICING.deepFrom}.`,
      'url': 'https://dreamcleaningnearme.com/services/manhattan-cleaning',
      'telephone': '+1-929-930-1525',
      'dateModified': '2026-03-22',
      'parentOrganization': { '@id': 'https://dreamcleaningnearme.com/#business' },
      'areaServed': {
        '@type': 'City',
        'name': 'Manhattan',
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
