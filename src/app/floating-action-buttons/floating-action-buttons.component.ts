import { Component, HostListener, ElementRef, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { PhoneClickTrackingService } from '../services/phone-click-tracking.service';
import { PhoneNumberService } from '../services/phone-number.service';

@Component({
  selector: 'app-floating-action-buttons',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './floating-action-buttons.component.html',
  styleUrl: './floating-action-buttons.component.scss'
})
export class FloatingActionButtonsComponent {
  isExpanded = false;
  contactLetters = 'CONTACT'.split('');
  private isBrowser: boolean;
  
  constructor(
    private router: Router, 
    private elementRef: ElementRef,
    private phoneTracking: PhoneClickTrackingService,
    private phoneNumber: PhoneNumberService,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }
  
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event) {
    if (!this.elementRef.nativeElement.contains(event.target)) {
      this.isExpanded = false;
    }
  }
  
  toggleExpanded() {
    this.isExpanded = !this.isExpanded;
  }

  closeExpanded() {
    this.isExpanded = false;
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