import { Component, OnInit, OnDestroy, Inject, inject } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { RouterModule } from '@angular/router';
import { PhoneNumberService } from '../../../services/phone-number.service';

@Component({
  selector: 'app-post-construction-cleaning',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './post-construction-cleaning.component.html',
  styleUrl: './post-construction-cleaning.component.scss'
})
export class PostConstructionCleaningComponent implements OnInit, OnDestroy {
  protected readonly phoneNumber = inject(PhoneNumberService);
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
      'name': 'Commercial Post Construction Cleaning Service in NYC',
      'description': "Dream Cleaning's commercial post construction cleaning service removes fine construction dust, debris, and residue from offices, retail spaces, restaurants, and commercial build-outs across Manhattan, Brooklyn, and Queens — preparing your space for occupancy and inspection.",
      'dateModified': '2026-06-06',
      'provider': { '@type': 'LocalBusiness', 'name': 'Dream Cleaning', '@id': 'https://dreamcleaningnyc.com/#business' },
      'areaServed': { '@type': 'City', 'name': 'New York' },
      'serviceType': 'Post Construction Cleaning'
    };
    this.schemaElement = this.document.createElement('script');
    this.schemaElement.type = 'application/ld+json';
    this.schemaElement.textContent = JSON.stringify(schema);
    this.document.head.appendChild(this.schemaElement);
  }
}
