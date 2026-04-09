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
import { BookingService, ServiceType, Service } from '../services/booking.service';
import { FormPersistenceService } from '../services/form-persistence.service';
import { ShimmerDirective } from '../shared/directives/shimmer.directive';
import { Subscription } from 'rxjs';

interface ExtendedReview extends Review {
  isExpanded?: boolean;
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

  constructor(
    private googlePlacesService: GooglePlacesService,
    private specialOfferService: SpecialOfferService,
    private authService: AuthService,
    private authModalService: AuthModalService,
    private cdr: ChangeDetectorRef,
    private bookingService: BookingService,
    private formPersistenceService: FormPersistenceService,
    private router: Router,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  ngOnInit() {
    // Preload the main hero image for this component only in browser
    if (this.isBrowser) {
      this.preloadMainImage();
    }
    this.loadReviews();
    this.loadSpecialOffers();
    this.checkAuthStatus();
    this.loadServiceTypes();
  }

  ngOnDestroy() {
    this.subscription.unsubscribe();
    // Clean up any preload links created by this component only in browser
    if (this.isBrowser) {
      const mainImagePreloadLinks = document.querySelectorAll('link[rel="preload"][data-main-image="true"]');
      mainImagePreloadLinks.forEach(link => link.remove());
    }
  }

  private loadReviews() {
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
        },
        error: (error) => {
          console.error('Error loading reviews:', error);
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

  private preloadMainImage() {
    // Only execute in browser environment
    if (!this.isBrowser) return;
    
    // Create a link element to preload the main image
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = '/images/mainImage.webp';
    link.fetchPriority = 'high';
    link.setAttribute('data-main-image', 'true'); // Mark it for easy removal
    document.head.appendChild(link);
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
