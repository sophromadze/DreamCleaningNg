import {
  Component,
  OnInit,
  OnDestroy,
  Input,
  Inject,
  PLATFORM_ID,
  inject
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { RouterLink, Router } from '@angular/router';
import { FormsModule, ReactiveFormsModule, FormControl, Validators } from '@angular/forms';
import { Subscription } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { GooglePlacesService } from '../../../services/google-reviews.service';
import { SpecialOfferService, PublicSpecialOffer } from '../../../services/special-offer.service';
import { BookingService, ServiceType, Service } from '../../../services/booking.service';
import { FormPersistenceService } from '../../../services/form-persistence.service';
import { ShimmerDirective } from '../../directives/shimmer.directive';
import {
  calculateQuote, QuoteInput, ExtraServiceLineInput,
  mapSelectedServiceInput, getSquareFeetForBedrooms
} from '../../pricing/order-pricing.calculator';
import { PhoneNumberService } from '../../../services/phone-number.service';

/**
 * Homepage hero — trust badge, headline, optional location pills, hero image with
 * the welcome-offer coupon/trust bar, and the live "Book Your Cleaning" form card.
 *
 * Extracted from the homepage so service pages (Manhattan/Brooklyn/Queens) can reuse
 * the exact same hero + booking widget. The headline location, subtitle, and the
 * location pills are configurable via inputs so each page can localize the copy.
 */
@Component({
  selector: 'app-home-hero',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule, ReactiveFormsModule, ShimmerDirective],
  templateUrl: './home-hero.component.html',
  styleUrl: './home-hero.component.scss'
})
export class HomeHeroComponent implements OnInit, OnDestroy {
  /** Location shown in the H1 accent ("Professional Cleaning Services in <accent>"). */
  @Input() locationName = 'NYC';
  /** Hero subtitle paragraph copy. */
  @Input() heroSubtitle =
    'Trusted home & apartment cleaning in Brooklyn, Manhattan and Queens. ' +
    'Transparent pricing, trained cleaners, and a simple online booking experience.';
  /** Borough pill row — shown on the homepage, hidden on the borough service pages. */
  @Input() showLocations = true;

  protected readonly phoneNumber = inject(PhoneNumberService);

  totalReviews = 0;
  specialOffers: PublicSpecialOffer[] = [];
  protected isBrowser: boolean;
  /** Google Reviews only shown in production (API has IP restrictions for hosting only). */
  showGoogleReviews = environment.production;

  private subscription = new Subscription();

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
    private bookingService: BookingService,
    private formPersistenceService: FormPersistenceService,
    private router: Router,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  ngOnInit() {
    this.loadReviews();
    this.loadSpecialOffers();
    this.loadServiceTypes();
  }

  ngOnDestroy() {
    this.subscription.unsubscribe();
  }

  /** Fetches the review count for the hero badge ("{{ totalReviews }}+ Google Reviews"). */
  private loadReviews() {
    if (!this.showGoogleReviews) return;
    this.subscription.add(
      this.googlePlacesService.getReviews().subscribe({
        next: (data) => { this.totalReviews = data.totalReviews; },
        error: (error) => { console.error('Error loading reviews:', error); }
      })
    );
  }

  private loadSpecialOffers() {
    this.subscription.add(
      this.specialOfferService.getPublicSpecialOffers().subscribe({
        next: (offers) => { this.specialOffers = offers; },
        error: (error) => { console.error('Error loading special offers:', error); }
      })
    );
  }

  /** First-time customer offer from the public special offers (percentage is admin-configurable, never hardcoded). */
  get firstTimeOffer(): PublicSpecialOffer | undefined {
    return this.specialOffers?.find(o =>
      o.requiresFirstTimeCustomer ||
      o.type === 'FirstTime' ||
      (o.name?.toLowerCase().includes('first time') ?? false) ||
      (o.name?.toLowerCase().includes('first-time') ?? false)
    );
  }

  /** Display label for the first-time discount, e.g. "10%" or "$20". Empty when no offer is loaded. */
  get firstTimeDiscountLabel(): string {
    const offer = this.firstTimeOffer;
    if (!offer) return '';
    return offer.isPercentage ? `${offer.discountValue}%` : `$${offer.discountValue}`;
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

  /** Maps a service-type name to a FontAwesome 6 Free Solid icon class.
   *  Used purely for presentation in the service-type dropdown — does not
   *  influence selection logic or persisted data. */
  getServiceTypeIcon(name: string | null | undefined): string {
    if (!name) return 'fa-broom';
    const key = name.toLowerCase();
    if (key.includes('residential')) return 'fa-house';
    if (key.includes('move')) return 'fa-truck-moving';
    if (key.includes('office')) return 'fa-building';
    if (key.includes('custom')) return 'fa-sliders';
    if (key.includes('heavy')) return 'fa-shield-halved';
    if (key.includes('filthy')) return 'fa-spray-can-sparkles';
    if (key.includes('construction')) return 'fa-helmet-safety';
    if (key.includes('pre-arranged') || key.includes('prearranged')) return 'fa-calendar-check';
    return 'fa-broom';
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

  /**
   * Included square feet for a bedroom count, read from the Sq.ft service's configured
   * allowances rather than a hardcoded table. Falls back to the shared defaults when the
   * catalog hasn't loaded yet (first paint / prerender).
   */
  private getSquareFeetForBedrooms(bedrooms: number): number {
    const sqftService = this.selectedServices.find(s => s.service.serviceKey === 'sqft');
    const bedroomsService = this.selectedServices.find(s => s.service.serviceKey === 'bedrooms');
    return getSquareFeetForBedrooms(
      bedrooms,
      sqftService?.service?.thresholds,
      bedroomsService?.service?.id
    );
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

  /** Builds the shared-calculator input for a starting-price / live estimate.
   *  ALL price math lives in shared/pricing/order-pricing.calculator.ts. */
  private buildEstimateQuoteInput(cleaningType: 'normal' | 'deep', useMinQuantities: boolean): QuoteInput | null {
    if (!this.selectedServiceType) return null;

    const extraServices: ExtraServiceLineInput[] = [];
    if (cleaningType === 'deep') {
      const deepExtra = this.selectedServiceType.extraServices?.find(e => e.isDeepCleaning && e.isActive !== false);
      if (deepExtra) {
        extraServices.push({
          extraServiceId: deepExtra.id,
          price: deepExtra.price || 0,
          duration: deepExtra.duration || 0,
          priceMultiplier: deepExtra.priceMultiplier || 1,
          isDeepCleaning: true,
          isSuperDeepCleaning: false,
          isSameDayService: false,
          hasHours: false,
          hasQuantity: false,
          name: deepExtra.name,
          quantity: 0,
          hours: 0
        });
      }
    }

    const services = this.selectedServices.map(selected => {
      const minQty = selected.service.serviceKey === 'bedrooms' ? 0 : (selected.service.minValue ?? 1);
      // Threshold / tier / zero-quantity fields must come along or the homepage prices sqft
      // from zero at a flat rate while the booking page prices only the overage in tiers.
      return {
        ...mapSelectedServiceInput(selected),
        quantity: useMinQuantities ? minQty : (selected.quantity ?? minQty)
      };
    });

    return {
      basePrice: this.selectedServiceType.basePrice ?? 0,
      baseDuration: this.selectedServiceType.timeDuration ?? 0,
      // Without the floor the homepage advertises a "from" price below what the booking page
      // actually charges — e.g. $112.50 against $125.00.
      minimumPrice: this.selectedServiceType.minimumPrice ?? 0,
      services,
      extraServices
    };
  }

  private calculateStartingPrice(cleaningType: 'normal' | 'deep'): number {
    const input = this.buildEstimateQuoteInput(cleaningType, true);
    if (!input) return 0;
    return Math.max(1, Math.round(calculateQuote(input).subTotal));
  }

  /** Live estimate based on current bedrooms, bathrooms, square feet, and cleaning type. */
  getEstimatedPrice(): number {
    const cleaningType = (this.cleaningTypeControl.value === 'deep' ? 'deep' : 'normal') as 'normal' | 'deep';
    const input = this.buildEstimateQuoteInput(cleaningType, false);
    if (!input) return 0;
    return Math.max(1, Math.round(calculateQuote(input).subTotal));
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
