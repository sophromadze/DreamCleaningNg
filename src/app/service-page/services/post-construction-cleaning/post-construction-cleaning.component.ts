import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { PhoneNumberService } from '../../../services/phone-number.service';
import { CardImageDirective } from '../../../shared/images/card-image.directive';
import { StructuredDataService } from '../../../services/structured-data.service';

@Component({
  selector: 'app-post-construction-cleaning',
  standalone: true,
  imports: [CommonModule, RouterModule, CardImageDirective],
  templateUrl: './post-construction-cleaning.component.html',
  styleUrl: './post-construction-cleaning.component.scss'
})
export class PostConstructionCleaningComponent implements OnInit, OnDestroy {
  protected readonly phoneNumber = inject(PhoneNumberService);
  private readonly structuredData = inject(StructuredDataService);

  ngOnInit(): void { this.injectSchema(); }

  ngOnDestroy(): void {
    this.structuredData.remove('ld-post-construction-cleaning');
  }

  private injectSchema(): void {
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'Service',
      'name': 'Commercial Post Construction Cleaning Service in NYC',
      'description': "Dream Cleaning's commercial post construction cleaning service removes fine construction dust, debris, and residue from offices, retail spaces, restaurants, and commercial build-outs across Manhattan, Brooklyn, and Queens — preparing your space for occupancy and inspection.",
      'dateModified': '2026-06-06',
      'provider': { '@type': 'LocalBusiness', 'name': 'Dream Cleaning', '@id': 'https://dreamcleaningnyc.com/#business' },
      'areaServed': { '@type': 'City', 'name': 'New York' },
      'serviceType': 'Post Construction Cleaning'
    };
    this.structuredData.set('ld-post-construction-cleaning', schema);
  }
}
