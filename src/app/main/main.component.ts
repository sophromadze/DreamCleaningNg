import { Component, OnInit, OnDestroy, Inject, PLATFORM_ID, ChangeDetectorRef } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { RouterLink, Router } from '@angular/router';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule, ReactiveFormsModule, FormControl, Validators } from '@angular/forms';
import { environment } from '../../environments/environment';
import { GooglePlacesService, Review } from '../services/google-reviews.service';
import { SpecialOfferService, PublicSpecialOffer, UserSpecialOffer } from '../services/special-offer.service';
import { AuthService } from '../services/auth.service';
import { AuthModalService } from '../services/auth-modal.service';
import { BookingService, ServiceType, Service, BlockedTimeSlot } from '../services/booking.service';
import { BeforeAfterPhotoService } from '../services/before-after-photo.service';
import { FormPersistenceService } from '../services/form-persistence.service';
import { ShimmerDirective } from '../shared/directives/shimmer.directive';
import { SERVICE_PRICING } from '../shared/service-pricing.data';
import { Subscription } from 'rxjs';

interface ExtendedReview extends Review {
  isExpanded?: boolean;
}

/** Public-facing before/after photo card — populated from BeforeAfterPhotosController. */
export interface BeforeAfterPhoto {
  id: number;
  title: string;
  subtitle?: string | null;
  beforePhotoUrl: string;
  afterPhotoUrl: string;
  linkUrl?: string | null;
  displayOrder: number;
}

@Component({
  selector: 'app-main',
  standalone: true,
  imports: [CommonModule, RouterLink, HttpClientModule, FormsModule, ReactiveFormsModule, ShimmerDirective],
  templateUrl: './main.component.html',
  styleUrl: './main.component.scss'
})
export class MainComponent implements OnInit, OnDestroy {
  reviews: ExtendedReview[] = [];
  overallRating: number = 0;
  totalReviews: number = 0;
  specialOffers: PublicSpecialOffer[] = [];
  userOffers: UserSpecialOffer[] = [];
  isLoggedIn: boolean = false;
  isLoadingOffers: boolean = false;
  private subscription: Subscription = new Subscription();
  private isBrowser: boolean;
  /** Google Reviews only shown in production (API has IP restrictions for hosting only). */
  showGoogleReviews = environment.production;

  // Booking form properties
  serviceTypes: ServiceType[] = [];
  selectedServiceType: ServiceType | null = null;
  selectedServices: Array<{ service: Service; quantity: number }> = [];
  serviceTypeDropdownOpen = false;
  
  // Form controls
  serviceTypeControl = new FormControl('', [Validators.required]);
  bedroomsControl = new FormControl(0);
  bathroomsControl = new FormControl(1);
  squareFeetControl = new FormControl(400);
  cleaningTypeControl = new FormControl('normal', [Validators.required]);
  firstNameControl = new FormControl('');
  lastNameControl = new FormControl('');
  emailControl = new FormControl('');
  phoneControl = new FormControl('');

  // Start true so card shows full shimmer skeleton immediately on refresh until service types load
  isLoadingServiceTypes = true;

  /** Marketing-copy prices (centralized in shared/service-pricing.data.ts). */
  readonly pricing = SERVICE_PRICING;

  /** Index of the currently visible review in the testimonial slider. */
  currentReviewIndex: number = 0;
  private reviewSliderTimer: any = null;
  private reviewSliderPaused: boolean = false;
  private static readonly REVIEW_SLIDER_INTERVAL_MS = 6000;

  /** Photos rendered in the "See the difference" gallery. Empty until the
   *  admin uploads pairs in Admin → Before & After. */
  beforeAfterPhotos: BeforeAfterPhoto[] = [];

  // ============================================================================
  // DEV-ONLY PREVIEW DATA — never reaches production builds.
  //
  // Wrapped in `!environment.production` checks so production builds always go
  // through the real Google Reviews backend endpoint (cached, IP-restricted).
  // These exist purely so the testimonial slider has something to render while
  // working on the homepage locally — the Google API rejects calls from any
  // non-hosting IP, so dev would otherwise see an empty slider.
  // ============================================================================
  private static readonly DEV_PREVIEW_REVIEWS: ExtendedReview[] = [
    {
      authorName: '[Dev Preview] Sample Reviewer A',
      profilePhotoUrl: '',
      rating: 5,
      text: '[Local dev placeholder] Booking flow felt clean and quick. Replace with the real Google review text once production data is verified.',
      time: new Date('2026-04-15')
    },
    {
      authorName: '[Dev Preview] Sample Reviewer B',
      profilePhotoUrl: '',
      rating: 5,
      text: '[Local dev placeholder] Use this slot to validate slider auto-advance and dot navigation. Hidden in production via the !environment.production gate.',
      time: new Date('2026-04-02')
    },
    {
      authorName: '[Dev Preview] Sample Reviewer C',
      profilePhotoUrl: '',
      rating: 5,
      text: '[Local dev placeholder] Long-text variant: this string is here to confirm the 5-line clamp keeps the testimonial card from blowing out the surrounding grid layout when a reviewer writes a longer comment.',
      time: new Date('2026-03-20')
    }
  ];

  /** Hero "Next available" pill — populated from /api/booking/blocked-time-slots,
   *  respects admin-blocked dates and whole-day/per-hour blocks. */
  nextAvailableLabel: string = '';

  /** "X bookings completed this week" — deterministic per day, grows through the week.
   *  Same number all day; flips at midnight (and at noon on Mondays). */
  bookingsThisWeek: number = 0;

  /** All-time cleanings counter — baseline + daily deltas accumulated across every
   *  past week. Weekly resets in `bookingsThisWeek` are absorbed by adding only
   *  day-over-day differences (Tue=14, Wed=26 ⇒ adds 12, not 26). Carries across
   *  weeks so it never restarts on Monday. */
  overallJobs: number = 0;
  /** Anchor for the all-time counter. Today (Sat 2026-05-09) starts at 723; every
   *  subsequent day adds that day's delta over the prior day. Deliberately
   *  baked into source so the number is consistent across visitors. */
  private static readonly OVERALL_JOBS_BASELINE = 723;
  private static readonly OVERALL_JOBS_BASELINE_YEAR = 2026;
  private static readonly OVERALL_JOBS_BASELINE_MONTH = 4; // May (0-indexed)
  private static readonly OVERALL_JOBS_BASELINE_DAY = 9;

  /** Standard booking schedule (mirrors backend BookingController.GetAvailableTimeSlots). */
  private static readonly TIME_SLOTS_WEEKDAY: string[] = [
    '08:00','08:30','09:00','09:30','10:00','10:30','11:00','11:30',
    '12:00','12:30','13:00','13:30','14:00','14:30','15:00','15:30',
    '16:00','16:30','17:00','17:30','18:00'
  ];
  private static readonly TIME_SLOTS_WEEKEND: string[] = [
    '09:30','10:00','10:30','11:00','11:30',
    '12:00','12:30','13:00','13:30','14:00','14:30','15:00','15:30',
    '16:00','16:30','17:00','17:30','18:00'
  ];

  constructor(
    private googlePlacesService: GooglePlacesService,
    private specialOfferService: SpecialOfferService,
    private authService: AuthService,
    private authModalService: AuthModalService,
    private cdr: ChangeDetectorRef,
    private bookingService: BookingService,
    private formPersistenceService: FormPersistenceService,
    private beforeAfterPhotoService: BeforeAfterPhotoService,
    private router: Router,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  ngOnInit() {
    this.loadReviews();
    this.loadSpecialOffers();
    this.checkAuthStatus();
    this.loadServiceTypes();
    // Deterministic-per-day counter (safe on SSR — pure date math, no API).
    this.bookingsThisWeek = this.computeBookingsThisWeek();
    this.overallJobs = this.computeOverallJobs();
    // Fetch admin-blocked slots and pick the next free date+time.
    this.loadNextAvailableSlot();
    // Fetch admin-uploaded before/after photos.
    this.loadBeforeAfterPhotos();
  }

  ngOnDestroy() {
    this.subscription.unsubscribe();
    if (this.reviewSliderTimer) {
      clearInterval(this.reviewSliderTimer);
      this.reviewSliderTimer = null;
    }
  }

  private loadReviews() {
    // Local dev preview only — see DEV_PREVIEW_REVIEWS comment above.
    // The `!environment.production` gate guarantees this branch is never
    // taken in production builds, so the placeholder copy below stays out
    // of the live site. To remove dev previews entirely, delete the array
    // and this `if` block.
    if (!environment.production) {
      this.reviews = MainComponent.DEV_PREVIEW_REVIEWS.map(r => ({ ...r, isExpanded: false }));
      this.totalReviews = this.reviews.length;
      this.overallRating = 5;
      this.startReviewSlider();
      return;
    }

    // Production path: cached Google Reviews backend endpoint (7-day IMemoryCache).
    if (!this.showGoogleReviews) return;
    this.subscription.add(
      this.googlePlacesService.getReviews().subscribe({
        next: (data) => {
          this.reviews = data.reviews.map(review => ({
            ...review,
            isExpanded: false
          }));
          this.overallRating = data.overallRating;
          this.totalReviews = data.totalReviews;
          this.startReviewSlider();
        },
        error: (error) => {
          console.error('Error loading reviews:', error);
        }
      })
    );
  }

  // ---------- Testimonial slider ----------
  private startReviewSlider() {
    if (!this.isBrowser) return;
    if (this.reviewSliderTimer) clearInterval(this.reviewSliderTimer);
    if (this.reviews.length <= 1) return;
    this.reviewSliderTimer = setInterval(() => {
      if (this.reviewSliderPaused || this.reviews.length === 0) return;
      this.currentReviewIndex = (this.currentReviewIndex + 1) % this.reviews.length;
      this.cdr.detectChanges();
    }, MainComponent.REVIEW_SLIDER_INTERVAL_MS);
  }

  goToReview(index: number) {
    if (index < 0 || index >= this.reviews.length) return;
    this.currentReviewIndex = index;
    // Reset the auto-advance window so the user gets a full interval to read
    // the slide they just clicked into.
    this.startReviewSlider();
  }

  pauseReviewSlider()  { this.reviewSliderPaused = true; }
  resumeReviewSlider() { this.reviewSliderPaused = false; }

  // ---------- Before/After photos ----------
  private loadBeforeAfterPhotos() {
    if (!this.isBrowser) return;
    this.subscription.add(
      this.beforeAfterPhotoService.getPublic().subscribe({
        next: (photos) => {
          this.beforeAfterPhotos = (photos || []).map(p => ({
            id: p.id,
            title: p.title,
            subtitle: p.subtitle,
            beforePhotoUrl: p.beforePhotoUrl,
            afterPhotoUrl: p.afterPhotoUrl,
            linkUrl: p.linkUrl,
            displayOrder: p.displayOrder
          }));
          this.cdr.detectChanges();
        },
        error: () => {
          // Endpoint not available yet (backend not deployed) — section just stays hidden.
          this.beforeAfterPhotos = [];
        }
      })
    );
  }

  private loadSpecialOffers() {
    this.isLoadingOffers = true;
    this.subscription.add(
      this.specialOfferService.getPublicSpecialOffers().subscribe({
        next: (offers) => {
          this.specialOffers = offers;
          this.isLoadingOffers = false;
        },
        error: (error) => {
          console.error('Error loading special offers:', error);
          this.isLoadingOffers = false;
        }
      })
    );
  }

  private checkAuthStatus() {
    // Set initial auth state
    this.isLoggedIn = this.authService.isLoggedIn();
    
    // Subscribe to authentication state changes
    this.subscription.add(
      this.authService.currentUser.subscribe(user => {
        this.isLoggedIn = !!user;
        if (this.isLoggedIn) {
          this.loadUserOffers();
        } else {
          this.userOffers = [];
        }
        // Force change detection
        this.cdr.detectChanges();
      })
    );
  }

  private loadUserOffers() {
    this.subscription.add(
      this.specialOfferService.getMySpecialOffers().subscribe({
        next: (offers) => {
          this.userOffers = offers;
        },
        error: (error) => {
          console.error('Error loading user offers:', error);
        }
      })
    );
  }

  getDisplayOffers(): PublicSpecialOffer[] {
    if (this.isLoggedIn) {
      // For logged users, show only their available offers
      return this.specialOffers.filter(offer => 
        this.userOffers.some(userOffer => userOffer.specialOfferId === offer.id)
      );
    } else {
      // For non-logged users, show all public offers
      return this.specialOffers;
    }
  }

  onOfferClick() {
    if (this.isLoggedIn) {
      // Redirect to booking page if logged in
      if (this.isBrowser) {
        window.location.href = '/booking';
      }
    } else {
      // Open login modal if not logged in
      this.authModalService.open('login', '/booking');
    }
  }

  /** Mirrors booking.component.ts:getNowInNewYork — keeps day-of-week / hour
   *  semantics anchored to NY business hours regardless of the visitor's TZ. */
  private getNowInNewYork(): Date {
    const nowUtc = new Date();
    const nyString = nowUtc.toLocaleString('en-US', { timeZone: 'America/New_York' });
    return new Date(nyString);
  }

  // ---------- Next-available slot (admin-block aware) ----------
  /**
   * Fetches the next ~14 days of admin block records and picks the first
   * future date+time that is not blocked, mirroring the booking flow's
   * earliest = tomorrow rule and the weekend 09:30 start.
   */
  private loadNextAvailableSlot() {
    if (!this.isBrowser) return;

    const now = this.getNowInNewYork();
    const fromDate = new Date(now);
    fromDate.setDate(fromDate.getDate() + 1); // earliest is tomorrow (matches booking page)
    const toDate = new Date(now);
    toDate.setDate(toDate.getDate() + 14);    // look 2 weeks ahead — plenty in practice

    const fmt = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    this.subscription.add(
      this.bookingService.getBlockedTimeSlots(fmt(fromDate), fmt(toDate)).subscribe({
        next: (blocked) => {
          this.nextAvailableLabel = this.findFirstAvailableSlot(fromDate, blocked);
          this.cdr.detectChanges();
        },
        error: () => {
          // Backend unreachable — fall back to a sensible default so the panel still has copy.
          this.nextAvailableLabel = this.formatSlotLabel(fromDate, '10:00');
        }
      })
    );
  }

  private findFirstAvailableSlot(start: Date, blocked: BlockedTimeSlot[]): string {
    // Index blocks by date string for O(1) lookup.
    const blocksByDate = new Map<string, BlockedTimeSlot>();
    for (const b of blocked) {
      blocksByDate.set(b.date, b);
    }

    const cursor = new Date(start);
    cursor.setHours(0, 0, 0, 0);

    // Iterate up to 14 days; if everything's blocked we silently leave the label empty.
    for (let i = 0; i < 14; i++) {
      const dateKey = (() => {
        const y = cursor.getFullYear();
        const m = String(cursor.getMonth() + 1).padStart(2, '0');
        const d = String(cursor.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
      })();

      const block = blocksByDate.get(dateKey);
      if (!block || !block.isFullDay) {
        // Day is bookable. Now find earliest non-blocked time.
        const isWeekend = cursor.getDay() === 0 || cursor.getDay() === 6;
        const slots = isWeekend
          ? MainComponent.TIME_SLOTS_WEEKEND
          : MainComponent.TIME_SLOTS_WEEKDAY;

        const blockedHours = new Set<string>(
          (block?.blockedHours ?? '').split(',').map(s => s.trim()).filter(Boolean)
        );
        const firstFree = slots.find(t => !blockedHours.has(t));
        if (firstFree) {
          return this.formatSlotLabel(cursor, firstFree);
        }
      }

      cursor.setDate(cursor.getDate() + 1);
    }

    return '';
  }

  private formatSlotLabel(date: Date, time24: string): string {
    // "Tomorrow 10:00 AM" if the date is exactly tomorrow, else "Mon, Mar 4 at 9:30 AM".
    const tomorrow = this.getNowInNewYork();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const target = new Date(date);
    target.setHours(0, 0, 0, 0);

    const [hh, mm] = time24.split(':').map(Number);
    const period = hh >= 12 ? 'PM' : 'AM';
    const hour12 = ((hh + 11) % 12) + 1;
    const timeLabel = `${hour12}:${String(mm).padStart(2, '0')} ${period}`;

    if (target.getTime() === tomorrow.getTime()) {
      return `Tomorrow ${timeLabel}`;
    }
    const dayLabel = target.toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric'
    });
    return `${dayLabel} at ${timeLabel}`;
  }

  // ---------- Bookings counter (deterministic per day) ----------
  /**
   * Returns a number representing "bookings completed this week" that:
   *   – is 0 on Monday before noon (NY local time)
   *   – jumps to 2–6 on Monday afternoon
   *   – grows through the week (Sun reaches ~36–44)
   *   – stays the same all day (deterministic seed = year + day-of-year)
   *
   * `forDate` lets the all-time counter replay past days (treated as post-noon
   * so Monday's AM/PM split resolves to the settled PM value).
   */
  private computeBookingsThisWeek(forDate?: Date): number {
    const now = forDate ?? this.getNowInNewYork();
    const dow = now.getDay();   // 0 = Sun, 1 = Mon, … 6 = Sat
    // Past days have already settled — treat them as post-noon so Monday's
    // AM/PM split returns the PM (non-zero) value.
    const hour = forDate ? 12 : now.getHours();

    // Per-day [min, max] ranges. Monday is split: AM = 0, PM = 2–6.
    let range: [number, number];
    if (dow === 1 && hour < 12) range = [0, 0];
    else if (dow === 1)         range = [2, 6];
    else if (dow === 2)         range = [6, 12];
    else if (dow === 3)         range = [12, 18];
    else if (dow === 4)         range = [18, 24];
    else if (dow === 5)         range = [24, 30];
    else if (dow === 6)         range = [30, 38];
    else /* Sunday */           range = [36, 44];

    if (range[0] === range[1]) return range[0];

    // Seed = (year * 1000) + day-of-year, plus +0.5 for Monday PM so AM/PM differ.
    const start = new Date(now.getFullYear(), 0, 0);
    const dayOfYear = Math.floor((now.getTime() - start.getTime()) / 86_400_000);
    const seed = now.getFullYear() * 1000 + dayOfYear + (dow === 1 && hour >= 12 ? 0.5 : 0);
    const r = MainComponent.seededRandom(seed);
    return range[0] + Math.floor(r * (range[1] - range[0] + 1));
  }

  /**
   * All-time cleanings = baseline + sum of every past day's delta over the prior
   * day. Monday is treated as "fresh start" — its delta is the day's own value
   * (since the prior Sunday's value belongs to the previous, already-summed
   * week). This makes the counter grow continuously across week boundaries
   * without ever resetting.
   */
  private computeOverallJobs(): number {
    const now = this.getNowInNewYork();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const baseline = new Date(
      MainComponent.OVERALL_JOBS_BASELINE_YEAR,
      MainComponent.OVERALL_JOBS_BASELINE_MONTH,
      MainComponent.OVERALL_JOBS_BASELINE_DAY
    );

    if (today.getTime() <= baseline.getTime()) {
      return MainComponent.OVERALL_JOBS_BASELINE;
    }

    let total = MainComponent.OVERALL_JOBS_BASELINE;
    const cursor = new Date(baseline);
    cursor.setDate(cursor.getDate() + 1);

    while (cursor.getTime() <= today.getTime()) {
      total += this.computeDailyDelta(cursor);
      cursor.setDate(cursor.getDate() + 1);
    }

    return total;
  }

  /** Day-over-day completed-bookings delta. On Monday the week resets, so the
   *  delta is just that Monday's value (it doesn't subtract Sunday's). */
  private computeDailyDelta(date: Date): number {
    const todayValue = this.computeBookingsThisWeek(date);
    if (date.getDay() === 1) {
      return todayValue;
    }
    const yesterday = new Date(date);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayValue = this.computeBookingsThisWeek(yesterday);
    return Math.max(0, todayValue - yesterdayValue);
  }

  /** Deterministic 0..1 hash from a numeric seed (Mulberry-style). Pure, no Math.random(). */
  private static seededRandom(seed: number): number {
    let t = (seed * 9301 + 49297) % 233280;
    return (t / 233280 + 1) % 1; // ensure 0..1 range
  }

  // Booking form methods
  private loadServiceTypes() {
    if (!this.isBrowser) return;
    
    this.isLoadingServiceTypes = true;
    this.subscription.add(
      this.bookingService.getServiceTypes().subscribe({
        next: (serviceTypes) => {
          // Filter out poll and custom - main page only shows regular service types for everyone
          const regularServiceTypes = serviceTypes.filter(type => !type.hasPoll && !type.isCustom);
          this.serviceTypes = regularServiceTypes.sort((a, b) => {
            const orderA = a.displayOrder || 999;
            const orderB = b.displayOrder || 999;
            return orderA - orderB;
          });
          this.isLoadingServiceTypes = false;
          
          // Try to restore from saved data
          this.loadSavedFormData();
        },
        error: (error) => {
          console.error('Error loading service types:', error);
          this.isLoadingServiceTypes = false;
        }
      })
    );
  }

  private loadSavedFormData() {
    // Re-hydrate from sessionStorage so we use persisted state (e.g. after refresh)
    this.formPersistenceService.loadFormData();
    const savedData = this.formPersistenceService.getFormData();
    
    if (savedData) {
      // Set cleaning type (and contact) first so when selectServiceType() calls saveMainPageFormData()
      // we don't overwrite storage with default 'normal'
      const cleaningType = savedData.cleaningType === 'deep' || savedData.cleaningType === 'normal' ? savedData.cleaningType : 'normal';
      this.cleaningTypeControl.setValue(cleaningType);
      if (savedData.contactFirstName) this.firstNameControl.setValue(savedData.contactFirstName);
      if (savedData.contactLastName) this.lastNameControl.setValue(savedData.contactLastName);
      if (savedData.contactEmail) this.emailControl.setValue(savedData.contactEmail);
      if (savedData.contactPhone) this.phoneControl.setValue(savedData.contactPhone || '');

      // Restore service type (this calls saveMainPageFormData() at the end)
      if (savedData.selectedServiceTypeId) {
        const serviceType = this.serviceTypes.find(st => st.id.toString() === savedData.selectedServiceTypeId);
        if (serviceType) {
          this.selectServiceType(serviceType);
        }
      }

    // Restore services
    if (savedData.selectedServices && this.selectedServiceType) {
      savedData.selectedServices.forEach(savedService => {
        const service = this.selectedServiceType!.services.find(s => s.id.toString() === savedService.serviceId);
        if (service) {
          const selectedService = this.selectedServices.find(ss => ss.service.id === service.id);
          if (selectedService) {
            selectedService.quantity = savedService.quantity;
            
            // Update square feet when bedrooms are restored
            if (service.serviceKey === 'bedrooms') {
              const sqftService = this.selectedServices.find(s => s.service.serviceKey === 'sqft');
              if (sqftService) {
                sqftService.quantity = this.getSquareFeetForBedrooms(savedService.quantity);
              }
            }
          }
        }
      });
      // Sync form controls (bedrooms, bathrooms, sqft) from restored selectedServices so "Get Exact Price" reads correct values
      this.updateFormControlsFromServices();
      // Persist restored quantities; selectServiceType() already saved defaults above, so overwrite with correct values
      this.saveMainPageFormData();
    }

      this.normalizeCleaningTypeForSelectedServiceType();
    } else {
      // No saved data, set default to "Residential Cleaning"
      const residentialCleaning = this.serviceTypes.find(st => 
        st.name.toLowerCase().includes('residential') && st.name.toLowerCase().includes('cleaning')
      );
      
      if (residentialCleaning) {
        this.selectServiceType(residentialCleaning);
      }
    }
  }

  toggleServiceTypeDropdown() {
    this.serviceTypeDropdownOpen = !this.serviceTypeDropdownOpen;
  }

  get canSelectDeepCleaning(): boolean {
    return !!this.selectedServiceType?.extraServices?.some(
      (extra) => extra.isDeepCleaning && extra.isActive !== false
    );
  }

  private normalizeCleaningTypeForSelectedServiceType(): void {
    if (this.cleaningTypeControl.value === 'deep' && !this.canSelectDeepCleaning) {
      this.cleaningTypeControl.setValue('normal');
    }
  }

  selectServiceType(serviceType: ServiceType) {
    this.selectedServiceType = serviceType;
    this.serviceTypeControl.setValue(serviceType.id.toString());
    this.serviceTypeDropdownOpen = false;
    
    // Initialize services
    this.selectedServices = [];
    if (serviceType.services) {
      const sortedServices = [...serviceType.services].sort((a, b) => 
        (a.displayOrder || 999) - (b.displayOrder || 999)
      );
      
      sortedServices.forEach(service => {
        if (service.isActive !== false) {
          let defaultQuantity = service.minValue ?? 0;
          
          // Set defaults based on service key
          if (service.serviceKey === 'bedrooms') {
            defaultQuantity = 0; // Studio
          } else if (service.serviceKey === 'bathrooms') {
            defaultQuantity = 1;
          } else if (service.serviceKey === 'sqft') {
            // Will be set based on bedrooms after all services are initialized
            defaultQuantity = 400; // Default for Studio
          }
          
          this.selectedServices.push({
            service: service,
            quantity: defaultQuantity
          });
        }
      });
      
      // Set square feet based on bedrooms after all services are initialized
      const bedroomsService = this.selectedServices.find(s => s.service.serviceKey === 'bedrooms');
      const sqftService = this.selectedServices.find(s => s.service.serviceKey === 'sqft');
      if (bedroomsService && sqftService) {
        sqftService.quantity = this.getSquareFeetForBedrooms(bedroomsService.quantity);
      }
    }

    // Update form controls based on services
    // When initializing, don't pass a service key so square feet gets set based on bedrooms
    this.updateFormControlsFromServices();

    this.normalizeCleaningTypeForSelectedServiceType();
    this.saveMainPageFormData();
  }

  private getSquareFeetForBedrooms(bedrooms: number): number {
    switch (bedrooms) {
      case 0: return 400;  // Studio
      case 1: return 650;
      case 2: return 850;
      case 3: return 1000;
      case 4: return 1500;
      case 5: return 1800;
      case 6: return 2000;
      default: return Math.max(400, bedrooms * 300); // Fallback for 7+
    }
  }

  getSquareFeetMinForBedrooms(): number {
    const bedroomsService = this.selectedServices.find(s => s.service.serviceKey === 'bedrooms');
    if (bedroomsService) {
      return this.getSquareFeetForBedrooms(bedroomsService.quantity);
    }
    return 400; // Default minimum
  }

  private updateFormControlsFromServices(updatingServiceKey?: string) {
    const bedroomsService = this.selectedServices.find(s => s.service.serviceKey === 'bedrooms');
    const bathroomsService = this.selectedServices.find(s => s.service.serviceKey === 'bathrooms');
    const sqftService = this.selectedServices.find(s => s.service.serviceKey === 'sqft');

    if (bedroomsService) {
      this.bedroomsControl.setValue(bedroomsService.quantity);
      
      // Update square feet based on bedrooms ONLY when:
      // 1. Bedrooms are being updated (updatingServiceKey === 'bedrooms')
      // 2. Initial load (updatingServiceKey is undefined)
      // Don't recalculate if square feet is being manually updated
      if (sqftService && (updatingServiceKey === 'bedrooms' || updatingServiceKey === undefined)) {
        const newSquareFeet = this.getSquareFeetForBedrooms(bedroomsService.quantity);
        sqftService.quantity = newSquareFeet;
        this.squareFeetControl.setValue(newSquareFeet);
      } else if (sqftService && updatingServiceKey === 'sqft') {
        // When square feet is being manually updated, just sync the control without recalculating
        this.squareFeetControl.setValue(sqftService.quantity);
      } else if (sqftService) {
        // For other service updates, just sync the control
        this.squareFeetControl.setValue(sqftService.quantity);
      }
    }
    if (bathroomsService) {
      this.bathroomsControl.setValue(bathroomsService.quantity);
    }
    if (sqftService && !bedroomsService) {
      // Only update if bedrooms wasn't processed (to avoid double update)
      this.squareFeetControl.setValue(sqftService.quantity);
    }
  }

  incrementServiceQuantity(service: Service) {
    const selectedService = this.selectedServices.find(s => s.service.id === service.id);
    if (selectedService && selectedService.quantity < (service.maxValue || 10)) {
      selectedService.quantity++;
      this.updateFormControlsFromServices(service.serviceKey);
      this.saveMainPageFormData();
    }
  }

  decrementServiceQuantity(service: Service) {
    const selectedService = this.selectedServices.find(s => s.service.id === service.id);
    if (selectedService && selectedService.quantity > (service.minValue ?? 0)) {
      selectedService.quantity--;
      this.updateFormControlsFromServices(service.serviceKey);
      this.saveMainPageFormData();
    }
  }

  updateServiceQuantity(service: Service, quantity: number) {
    const selectedService = this.selectedServices.find(s => s.service.id === service.id);
    if (selectedService) {
      selectedService.quantity = quantity;
      
      // If updating square feet, ensure it's not below minimum for current bedrooms
      if (service.serviceKey === 'sqft') {
        const minSquareFeet = this.getSquareFeetMinForBedrooms();
        if (quantity < minSquareFeet) {
          selectedService.quantity = minSquareFeet;
          quantity = minSquareFeet;
        }
      }
      
      // Pass the service key to prevent unwanted recalculation
      this.updateFormControlsFromServices(service.serviceKey);
      this.saveMainPageFormData();
    }
  }

  selectCleaningType(type: string) {
    if (type === 'deep' && !this.canSelectDeepCleaning) {
      type = 'normal';
    }
    this.cleaningTypeControl.setValue(type);
    this.saveMainPageFormData();
  }

  /** Persist main page card state so refresh and navigation to booking restore it. */
  private saveMainPageFormData() {
    if (!this.isBrowser || !this.selectedServiceType) return;
    this.formPersistenceService.updateFormData({
      selectedServiceTypeId: this.selectedServiceType.id.toString(),
      selectedServices: this.selectedServices.map(ss => ({
        serviceId: ss.service.id.toString(),
        quantity: ss.quantity
      })),
      cleaningType: this.cleaningTypeControl.value || 'normal',
      contactFirstName: this.firstNameControl.value || '',
      contactLastName: this.lastNameControl.value || '',
      contactEmail: this.emailControl.value || '',
      contactPhone: this.phoneControl.value || ''
    });
  }

  getRegularStartingPrice(): number {
    return this.calculateStartingPrice('normal');
  }

  getDeepStartingPrice(): number {
    return this.calculateStartingPrice('deep');
  }

  getStartingPriceHint(): string {
    if (!this.selectedServiceType) return '';
    const price = this.calculateStartingPrice('normal');
    return `from $${price}`;
  }

  private calculateStartingPrice(cleaningType: 'normal' | 'deep'): number {
    if (!this.selectedServiceType) return 0;
    let priceMultiplier = 1;
    let deepFee = 0;
    if (cleaningType === 'deep') {
      const deepExtra = this.selectedServiceType.extraServices?.find(e => e.isDeepCleaning && e.isActive !== false);
      if (deepExtra) {
        priceMultiplier = deepExtra.priceMultiplier || 1;
        deepFee = deepExtra.price || 0;
      }
    }
    const basePrice = this.selectedServiceType.basePrice ?? 0;
    let subTotal = basePrice * priceMultiplier + deepFee;

    const hasCleanerService = this.selectedServices.some(s => s.service.serviceRelationType === 'cleaner');
    const hoursService = this.selectedServices.find(s => s.service.serviceRelationType === 'hours');

    if (hasCleanerService && hoursService) {
      const cleanerService = this.selectedServices.find(s => s.service.serviceRelationType === 'cleaner');
      if (cleanerService) {
        const minCleaners = cleanerService.service.minValue ?? 1;
        const minHours = hoursService.service.minValue ?? 1;
        const costPerCleanerPerHour = (cleanerService.service.cost || 0) * priceMultiplier;
        subTotal += costPerCleanerPerHour * minCleaners * minHours;
      }
    }

    this.selectedServices.forEach(selected => {
      if (selected.service.serviceRelationType === 'cleaner' || selected.service.serviceRelationType === 'hours') return;
      const minQty = selected.service.serviceKey === 'bedrooms' ? 0 : (selected.service.minValue ?? 1);
      if (selected.service.serviceKey === 'bedrooms' && minQty === 0) {
        subTotal += 10 * priceMultiplier;
      } else {
        subTotal += (selected.service.cost || 0) * minQty * priceMultiplier;
      }
    });
    return Math.max(1, Math.round(subTotal));
  }

  /** Live estimate based on current bedrooms, bathrooms, square feet, and cleaning type. */
  getEstimatedPrice(): number {
    const cleaningType = (this.cleaningTypeControl.value === 'deep' ? 'deep' : 'normal') as 'normal' | 'deep';
    if (!this.selectedServiceType) return 0;
    let priceMultiplier = 1;
    let deepFee = 0;
    if (cleaningType === 'deep') {
      const deepExtra = this.selectedServiceType.extraServices?.find(e => e.isDeepCleaning && e.isActive !== false);
      if (deepExtra) {
        priceMultiplier = deepExtra.priceMultiplier || 1;
        deepFee = deepExtra.price || 0;
      }
    }
    const basePrice = this.selectedServiceType.basePrice ?? 0;
    let subTotal = basePrice * priceMultiplier + deepFee;

    const hasCleanerService = this.selectedServices.some(s => s.service.serviceRelationType === 'cleaner');
    const hoursService = this.selectedServices.find(s => s.service.serviceRelationType === 'hours');

    if (hasCleanerService && hoursService) {
      const cleanerService = this.selectedServices.find(s => s.service.serviceRelationType === 'cleaner');
      if (cleanerService) {
        const cleanerQty = cleanerService.quantity ?? (cleanerService.service.minValue ?? 1);
        const hoursQty = hoursService.quantity ?? (hoursService.service.minValue ?? 1);
        const costPerCleanerPerHour = (cleanerService.service.cost || 0) * priceMultiplier;
        subTotal += costPerCleanerPerHour * cleanerQty * hoursQty;
      }
    }

    this.selectedServices.forEach(selected => {
      if (selected.service.serviceRelationType === 'cleaner' || selected.service.serviceRelationType === 'hours') return;
      const qty = selected.quantity ?? (selected.service.serviceKey === 'bedrooms' ? 0 : (selected.service.minValue ?? 1));
      if (selected.service.serviceKey === 'bedrooms' && qty === 0) {
        subTotal += 10 * priceMultiplier;
      } else {
        subTotal += (selected.service.cost || 0) * qty * priceMultiplier;
      }
    });
    return Math.max(1, Math.round(subTotal));
  }

  // Helper methods for template
  hasBedroomsService(): boolean {
    return !!this.selectedServices.find(s => s.service.serviceKey === 'bedrooms');
  }

  hasBathroomsService(): boolean {
    return !!this.selectedServices.find(s => s.service.serviceKey === 'bathrooms');
  }

  hasSquareFeetService(): boolean {
    return !!this.selectedServices.find(s => s.service.serviceKey === 'sqft');
  }

  getSquareFeetService() {
    return this.selectedServices.find(s => s.service.serviceKey === 'sqft');
  }

  getSquareFeetMin(): number {
    const service = this.getSquareFeetService();
    return service?.service.minValue || 400;
  }

  getSquareFeetMax(): number {
    const service = this.getSquareFeetService();
    return service?.service.maxValue || 5000;
  }

  getSquareFeetStep(): number {
    const service = this.getSquareFeetService();
    return service?.service.stepValue || 100;
  }

  private setupDropdownClickOutside() {
    if (!this.isBrowser) return;
    
    document.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.service-type-dropdown')) {
        this.serviceTypeDropdownOpen = false;
      }
    });
  }

  continueBooking() {
    // Mark all controls as touched to show validation errors
    this.serviceTypeControl.markAsTouched();
    this.cleaningTypeControl.markAsTouched();

    // Check if form is valid
    if (!this.serviceTypeControl.valid || !this.cleaningTypeControl.valid) {
      return;
    }

    if (!this.selectedServiceType) {
      return;
    }

    // Update services from form controls
    const bedroomsService = this.selectedServices.find(s => s.service.serviceKey === 'bedrooms');
    const bathroomsService = this.selectedServices.find(s => s.service.serviceKey === 'bathrooms');
    const sqftService = this.selectedServices.find(s => s.service.serviceKey === 'sqft');

    if (bedroomsService) {
      bedroomsService.quantity = this.bedroomsControl.value ?? 0;
    }
    if (bathroomsService) {
      bathroomsService.quantity = this.bathroomsControl.value ?? 1;
    }
    if (sqftService) {
      sqftService.quantity = this.squareFeetControl.value ?? 400;
    }

    // Save form data
    const formData = {
      selectedServiceTypeId: this.selectedServiceType.id.toString(),
      selectedServices: this.selectedServices.map(ss => ({
        serviceId: ss.service.id.toString(),
        quantity: ss.quantity
      })),
      cleaningType: this.cleaningTypeControl.value || 'normal',
      contactFirstName: this.firstNameControl.value || '',
      contactLastName: this.lastNameControl.value || '',
      contactEmail: this.emailControl.value || '',
      contactPhone: this.phoneControl.value || '',
      hasStartedBooking: true,
      bookingProgress: 'started' as const
    };

    this.formPersistenceService.saveFormData(formData);
    this.formPersistenceService.markBookingStarted();

    // Navigate to booking page with step=1 so URL matches and no second navigation overwrites state
    this.router.navigate(['/booking'], { queryParams: { step: 1 } });
  }
}
