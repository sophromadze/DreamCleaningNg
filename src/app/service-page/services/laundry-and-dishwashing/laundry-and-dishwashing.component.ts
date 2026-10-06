import { Component, OnInit, OnDestroy, inject, ChangeDetectionStrategy } from '@angular/core';
import { RouterModule } from '@angular/router';
import { StructuredDataService } from '../../../services/structured-data.service';

@Component({
  selector: 'app-laundry-and-dishwashing',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './laundry-and-dishwashing.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './laundry-and-dishwashing.component.scss'
})
export class LaundryAndDishwashingComponent implements OnInit, OnDestroy {
  private readonly structuredData = inject(StructuredDataService);

  ngOnInit(): void {
    this.injectSchema();
  }

  ngOnDestroy(): void {
    this.structuredData.remove('ld-laundry-and-dishwashing');
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
            '@id': 'https://dreamcleaningnyc.com/#business'
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
            '@id': 'https://dreamcleaningnyc.com/#business'
          },
          'areaServed': { '@type': 'City', 'name': 'New York' },
          'serviceType': 'Dishwashing'
        }
      ]
    };

    this.structuredData.set('ld-laundry-and-dishwashing', schema);
  }
}
