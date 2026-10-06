import { Component, OnInit, OnDestroy, PLATFORM_ID, HostListener, ElementRef, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, RouterModule, NavigationEnd, ActivatedRoute } from '@angular/router';
import { FormPersistenceService, BookingFormData } from '../services/form-persistence.service';
import { Subject, takeUntil, filter } from 'rxjs';

@Component({
  selector: 'app-continue-booking',
  standalone: true,
  imports: [
    RouterModule
],
  templateUrl: './continue-booking.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './continue-booking.component.scss'
})
export class ContinueBookingComponent implements OnInit, OnDestroy {
  formPersistenceService = inject(FormPersistenceService);
  private router = inject(Router);
  private activatedRoute = inject(ActivatedRoute);
  private elementRef = inject(ElementRef);
  private platformId = inject<Object>(PLATFORM_ID);

  private destroy$ = new Subject<void>();
  public isBrowser: boolean;
  
  readonly showContinueBooking = signal(false);
  isOnBookingPage = false;
  readonly isExpanded = signal(true); // Start expanded, can be collapsed
  readonly userDismissed = signal(false); // User clicked X to fully hide
  private hasVisitedBookingPage = false; // Only true after user visits booking page in this session

  constructor() {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  ngOnInit() {
    if (!this.isBrowser) return;

    // Check if we're on the booking page
    this.checkCurrentRoute();
    
    // Listen for route changes
    this.router.events
      .pipe(
        filter(event => event instanceof NavigationEnd),
        takeUntil(this.destroy$)
      )
      .subscribe((event: NavigationEnd) => {
        this.checkCurrentRoute();
        this.updateVisibility(this.formPersistenceService.getFormData());
      });

    // Listen for form data changes
    this.formPersistenceService.formData$
      .pipe(takeUntil(this.destroy$))
      .subscribe(formData => {
        this.updateVisibility(formData);
      });

    // Initial check
    this.updateVisibility(this.formPersistenceService.getFormData());
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private readonly hideOnRoutes = ['/booking', '/booking-confirmation', '/booking-success', '/order', '/admin', '/cleaner/cabinet', '/cleaners-dashboard', '/contract', '/invoice', '/pay-invoice'];

  private checkCurrentRoute() {
    this.isOnBookingPage = this.router.url.includes('/booking');
    if (this.isOnBookingPage) {
      this.hasVisitedBookingPage = true;
    }
  }

  private isOnExcludedRoute(): boolean {
    const url = this.router.url.split('?')[0];
    return this.hideOnRoutes.some(route =>
      url === route || url.startsWith(route + '/')
    );
  }

  private updateVisibility(formData: any) {
    // Show continue booking if:
    // 1. We have saved form data
    // 2. We're not on the booking page
    // 3. We're in browser environment
    // 4. The booking hasn't been completed
    // 5. We're not on excluded routes (admin, cleaner/cabinet, etc.)
    const shouldShow = this.isBrowser &&
                      !!formData &&
                      this.hasVisitedBookingPage &&
                      !this.isOnBookingPage &&
                      !this.isOnExcludedRoute() &&
                      formData.bookingProgress !== 'completed';
    
    this.showContinueBooking.set(shouldShow);
    // Only reset dismissed state when user visits the booking page, so the card can show again
    // after they leave. Do not reset when on other pages (e.g. admin) so closing the card
    // keeps it hidden until they return to booking and navigate away again.
    if (this.isOnBookingPage) {
      this.userDismissed.set(false);
    }
  }

  onContinueBooking() {
    this.router.navigate(['/booking']);
  }

  onMinimize() {
    this.isExpanded.set(false);
  }

  onClose() {
    this.userDismissed.set(true);
  }

  toggleExpanded() {
    this.isExpanded.set(!this.isExpanded());
  }
}
