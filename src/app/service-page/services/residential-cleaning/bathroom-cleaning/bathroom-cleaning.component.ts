import { Component, OnInit, OnDestroy, inject, ChangeDetectionStrategy } from '@angular/core';
import { RouterModule } from '@angular/router';
import { IconComponent } from '../../../../shared/icons/icon.component';
import { faBan } from '../../../../shared/icons/glyphs/faBan';
import { faTriangleExclamation } from '../../../../shared/icons/glyphs/faTriangleExclamation';
import { StructuredDataService } from '../../../../services/structured-data.service';

@Component({
  selector: 'app-bathroom-cleaning',
  standalone: true,
  imports: [RouterModule, IconComponent],
  templateUrl: './bathroom-cleaning.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './bathroom-cleaning.component.scss'
})
export class BathroomCleaningComponent implements OnInit, OnDestroy {
  protected readonly icons = { faBan, faTriangleExclamation };

  private readonly structuredData = inject(StructuredDataService);

  ngOnInit(): void { this.injectSchema(); }

  ngOnDestroy(): void {
    this.structuredData.remove('ld-bathroom-cleaning');
  }

  private injectSchema(): void {
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'Service',
      'name': 'Bathroom Cleaning Service in NYC',
      'description': "Dream Cleaning's bathroom cleaning service delivers complete sanitization for NYC bathrooms — including toilet, sink, shower/bathtub scrubbing with soap scum removal, mirror polishing, tile cleaning, and fixture disinfection.",
      'dateModified': '2026-03-22',
      'provider': { '@type': 'LocalBusiness', 'name': 'Dream Cleaning', '@id': 'https://dreamcleaningnyc.com/#business' },
      'areaServed': { '@type': 'City', 'name': 'New York' },
      'serviceType': 'Bathroom Cleaning'
    };
    this.structuredData.set('ld-bathroom-cleaning', schema);
  }
}
