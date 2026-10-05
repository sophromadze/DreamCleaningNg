import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { IconComponent } from '../../../../shared/icons/icon.component';
import { faBan } from '../../../../shared/icons/glyphs/faBan';
import { faTriangleExclamation } from '../../../../shared/icons/glyphs/faTriangleExclamation';
import { StructuredDataService } from '../../../../services/structured-data.service';

@Component({
  selector: 'app-kitchen-cleaning',
  standalone: true,
  imports: [CommonModule, RouterModule, IconComponent],
  templateUrl: './kitchen-cleaning.component.html',
  styleUrl: './kitchen-cleaning.component.scss'
})
export class KitchenCleaningComponent implements OnInit, OnDestroy {
  protected readonly icons = { faBan, faTriangleExclamation };

  private readonly structuredData = inject(StructuredDataService);

  ngOnInit(): void { this.injectSchema(); }

  ngOnDestroy(): void {
    this.structuredData.remove('ld-kitchen-cleaning');
  }

  private injectSchema(): void {
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'Service',
      'name': 'Kitchen Cleaning Service in NYC',
      'description': "Dream Cleaning's kitchen cleaning service provides thorough degreasing and sanitization for NYC kitchens — covering stovetops, countertops, sinks, cabinet exteriors, appliance surfaces, and floor mopping.",
      'dateModified': '2026-03-22',
      'provider': { '@type': 'LocalBusiness', 'name': 'Dream Cleaning', '@id': 'https://dreamcleaningnyc.com/#business' },
      'areaServed': { '@type': 'City', 'name': 'New York' },
      'serviceType': 'Kitchen Cleaning'
    };
    this.structuredData.set('ld-kitchen-cleaning', schema);
  }
}
