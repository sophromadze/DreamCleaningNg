import { Component, OnInit, OnDestroy, Inject, inject } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { RouterModule } from '@angular/router';
import { PhoneNumberService } from '../../../services/phone-number.service';

@Component({
  selector: 'app-post-renovation-cleaning',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './post-renovation-cleaning.component.html',
  styleUrl: './post-renovation-cleaning.component.scss'
})
export class PostRenovationCleaningComponent implements OnInit, OnDestroy {
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
      'name': 'Post Renovation Cleaning Service in NYC',
      'description': "Dream Cleaning's post renovation cleaning service clears fine renovation dust, paint specks, and debris after home remodels — kitchen and bathroom renovations, room additions, and apartment refreshes across Manhattan, Brooklyn, and Queens.",
      'dateModified': '2026-06-06',
      'url': 'https://dreamcleaningnyc.com/services/post-renovation-cleaning',
      'provider': { '@type': 'LocalBusiness', 'name': 'Dream Cleaning', '@id': 'https://dreamcleaningnyc.com/#business' },
      'areaServed': { '@type': 'City', 'name': 'New York' },
      'serviceType': 'Post Renovation Cleaning'
    };
    this.schemaElement = this.document.createElement('script');
    this.schemaElement.type = 'application/ld+json';
    this.schemaElement.textContent = JSON.stringify(schema);
    this.document.head.appendChild(this.schemaElement);
  }
}
