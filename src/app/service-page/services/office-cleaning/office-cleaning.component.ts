import { Component, OnInit, OnDestroy, inject, ChangeDetectionStrategy } from '@angular/core';
import { RouterModule } from '@angular/router';
import { PhoneNumberService } from '../../../services/phone-number.service';
import { COMMERCIAL_FIRST_MONTH_DISCOUNT_PERCENT } from '../../../shared/commercial-offer.data';
import { StructuredDataService } from '../../../services/structured-data.service';

@Component({
  selector: 'app-office-cleaning',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './office-cleaning.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './office-cleaning.component.scss'
})
export class OfficeCleaningComponent implements OnInit, OnDestroy {
  readonly firstMonthDiscountPercent = COMMERCIAL_FIRST_MONTH_DISCOUNT_PERCENT;
  protected readonly phoneNumber = inject(PhoneNumberService);
  private readonly structuredData = inject(StructuredDataService);

  ngOnInit(): void {
    this.injectSchema();
  }

  ngOnDestroy(): void {
    this.structuredData.remove('ld-office-cleaning');
  }

  private injectSchema(): void {
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'Service',
      'name': 'Office Cleaning Service in NYC',
      'description': "Dream Cleaning provides professional office and commercial cleaning services throughout Manhattan, Brooklyn, and Queens. Flexible scheduling around business hours, background-checked and insured cleaners.",
      'dateModified': '2026-03-22',
      'provider': {
        '@type': 'LocalBusiness',
        'name': 'Dream Cleaning',
        '@id': 'https://dreamcleaningnyc.com/#business'
      },
      'areaServed': {
        '@type': 'City',
        'name': 'New York'
      },
      'serviceType': 'Office Cleaning'
    };

    this.structuredData.set('ld-office-cleaning', schema);
  }
}
