import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { PhoneNumberService } from '../../../services/phone-number.service';
import { CardImageDirective } from '../../../shared/images/card-image.directive';
import { StructuredDataService } from '../../../services/structured-data.service';

@Component({
  selector: 'app-post-renovation-cleaning',
  standalone: true,
  imports: [RouterModule, CardImageDirective],
  templateUrl: './post-renovation-cleaning.component.html',
  styleUrl: './post-renovation-cleaning.component.scss'
})
export class PostRenovationCleaningComponent implements OnInit, OnDestroy {
  protected readonly phoneNumber = inject(PhoneNumberService);
  private readonly structuredData = inject(StructuredDataService);

  ngOnInit(): void { this.injectSchema(); }

  ngOnDestroy(): void {
    this.structuredData.remove('ld-post-renovation-cleaning');
  }

  private injectSchema(): void {
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'Service',
      'name': 'Post Renovation Cleaning Service in NYC',
      'description': "Dream Cleaning's post renovation cleaning service clears fine renovation dust, paint specks, and debris after home remodels — kitchen and bathroom renovations, room additions, and apartment refreshes across Manhattan, Brooklyn, and Queens.",
      'dateModified': '2026-06-06',
      'url': 'https://dreamcleaningnyc.com/services/post-renovation-cleaning',
      'provider': { '@type': 'LocalBusiness', 'name': 'Dream Cleaning', '@id': 'https://dreamcleaningnyc.com/#business' },
      'areaServed': { '@type': 'City', 'name': 'New York' },
      'serviceType': 'Post Renovation Cleaning'
    };
    this.structuredData.set('ld-post-renovation-cleaning', schema);
  }
}
