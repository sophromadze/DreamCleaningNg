import { Component, HostListener, ElementRef, PLATFORM_ID, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { PhoneClickTrackingService } from '../services/phone-click-tracking.service';
import { PhoneNumberService } from '../services/phone-number.service';

@Component({
  selector: 'app-floating-action-buttons',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './floating-action-buttons.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './floating-action-buttons.component.scss'
})
export class FloatingActionButtonsComponent {
  private router = inject(Router);
  private elementRef = inject(ElementRef);
  private phoneTracking = inject(PhoneClickTrackingService);
  private phoneNumber = inject(PhoneNumberService);
  private platformId = inject<Object>(PLATFORM_ID);

  readonly isExpanded = signal(false);
  contactLetters = 'CONTACT'.split('');
  private isBrowser: boolean;
  
  constructor() {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }
  
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event) {
    if (!this.elementRef.nativeElement.contains(event.target)) {
      this.isExpanded.set(false);
    }
  }
  
  toggleExpanded() {
    this.isExpanded.set(!this.isExpanded());
  }

  closeExpanded() {
    this.isExpanded.set(false);
  }
  
  callPhone() {
    this.phoneTracking.trackAndCall(this.phoneNumber.telHref());
  }

  sendEmail() {
    if (this.isBrowser) {
      window.location.href = 'mailto:hello@dreamcleaningnyc.com';
    }
  }

  bookNow() {
    this.router.navigate(['/booking']);
  }
} 