import { Component, OnInit, OnDestroy, ChangeDetectorRef, NgZone, Inject, PLATFORM_ID, afterNextRender, Injector, runInInjectionContext, ViewChild, ElementRef } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, FormControl, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { HttpClientModule } from '@angular/common/http';
import { BookingService, ServiceType, Service, ExtraService, Subscription, BookingCalculation, BlockedTimeSlot } from '../services/booking.service';
import { AuthService } from '../services/auth.service';
import { AuthModalService } from '../services/auth-modal.service';
import { ProfileService } from '../services/profile.service';
import { LocationService } from '../services/location.service';
import { BookingDataService } from '../services/booking-data.service';
import { DurationUtils } from '../utils/duration.utils';
import { SpecialOfferService, UserSpecialOffer, PublicSpecialOffer } from '../services/special-offer.service';
import { FormPersistenceService, BookingFormData } from '../services/form-persistence.service';
import { OrderService, OrderList, Order } from '../services/order.service';
import { Subject, takeUntil, debounceTime, startWith } from 'rxjs';
import { PollService, PollQuestion, PollAnswer, PollSubmission } from '../services/poll.service';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { DurationSelectorComponent } from './duration-selector/duration-selector.component';
import { TimeSelectorComponent } from './time-selector/time-selector.component';
import { DateSelectorComponent } from './date-selector/date-selector.component';
import { AdminService, UserAdmin } from '../services/admin.service';
import { ShimmerDirective } from '../shared/directives/shimmer.directive';
import { GoogleMapsLoaderService } from '../services/google-maps-loader.service';
import { FloorTypeSelectorComponent, FloorTypeSelection } from '../shared/components/floor-type-selector/floor-type-selector.component';
import { BubbleRewardsService, RedemptionOption } from '../services/bubble-rewards.service';

interface SelectedService {
  service: Service;
  quantity: number;
}

interface SelectedExtraService {
  extraService: ExtraService;
  quantity: number;
  hours: number;
}

@Component({
  selector: 'app-booking',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, HttpClientModule, RouterModule, DurationSelectorComponent, TimeSelectorComponent, DateSelectorComponent, ShimmerDirective, FloorTypeSelectorComponent],
  providers: [BookingService],
  templateUrl: './booking.component.html',
  styleUrl: './booking.component.scss'
})
export class BookingComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private isBrowser: boolean;
  /** Set true when navigating to confirmation or clearing form so ngOnDestroy does not overwrite storage. */
  private skipSaveOnDestroy = false;
  
  // Make Math available in template
  Math = Math;

  // Custom pricing properties - initialized with default values
  showCustomPricing = false;
  customAmount: FormControl = new FormControl('', [Validators.required, Validators.min(0.01)]);
  customCleaners: FormControl = new FormControl(1, [Validators.required, Validators.min(1), Validators.max(10)]);
  customDuration: FormControl = new FormControl(60, [Validators.required, Validators.min(60), Validators.max(480)]);
  bedroomsQuantityControl: FormControl = new FormControl(0, [Validators.required, Validators.min(0), Validators.max(10)]);
  bathroomsQuantityControl: FormControl = new FormControl(1, [Validators.required, Validators.min(0), Validators.max(10)]);

  // Service Type Form Control
  serviceTypeControl: FormControl = new FormControl('', [Validators.required]);

  // Data
  serviceTypes: ServiceType[] = [];
  /** Service types to show in the dropdown: Custom only for Admin/SuperAdmin. */
  get visibleServiceTypes(): ServiceType[] {
    const isAdminOrSuperAdmin = this.authService.currentUserValue?.role === 'Admin' || this.authService.currentUserValue?.role === 'SuperAdmin';
    return this.serviceTypes.filter(st => !st.isCustom || isAdminOrSuperAdmin);
  }
  subscriptions: Subscription[] = [];
  currentUser: any = null;
  userApartments: any[] = [];
  adminOriginalApartments: any[] = []; // Store admin's apartments when selecting a user
  
  // Selected values
  selectedServiceType: ServiceType | null = null;
  selectedServices: SelectedService[] = [];
  selectedExtraServices: SelectedExtraService[] = [];
  selectedSubscription: Subscription | null = null;

  // Special offers
  userSpecialOffers: UserSpecialOffer[] = [];
  firstTimeDiscountPercentage: number = 0; 
  hasFirstTimeDiscountOffer: boolean = false;
  selectedSpecialOffer: UserSpecialOffer | null = null;
  specialOfferApplied = false;
  
  // Form
  bookingForm: FormGroup;
  
  // Calculation
  calculation: BookingCalculation = {
    subTotal: 0,
    tax: 0,
    discountAmount: 0,
    tips: 0,
    total: 0,
    totalDuration: 0
  };
  
  // UI state
  /** Granular loading flags for per-section shimmer (SSR: all start true so placeholders render). */
  loading = {
    previousOrders: true,
    promoBanner: true,
    serviceTypes: true,
    serviceDetails: true,
    partnership: true,
    availableDates: true,
    timeSlots: true,
    cleaningTypes: true,
    extras: true,
    summary: true,
    pricing: true,
  };

  // Step 1 confirmation: user didn't select Cleaning Supplies
  showCleaningSuppliesConfirm = false;
  /** Used for extra-services shimmer placeholder count (matches card layout). */
  readonly shimmerExtraCardCount = [1, 2, 3, 4, 5];
  /** Number of service field shimmers to show (matches selected type, saved form, or default). */
  get serviceShimmerPlaceholderCount(): number[] {
    if (this.selectedServiceType?.services?.length) {
      const n = this.selectedServiceType.services.length;
      return Array.from({ length: Math.min(Math.max(n, 1), 5) });
    }
    const saved = this.formPersistenceService.getFormData();
    if (saved?.selectedServices?.length) {
      const n = saved.selectedServices.length;
      return Array.from({ length: Math.min(Math.max(n, 1), 5) });
    }
    const type = this.getDefaultServiceTypeForShimmer();
    const n = type?.services?.length ?? 3;
    return Array.from({ length: Math.min(Math.max(n, 1), 5) });
  }

  /** Default service type used for shimmer count when none selected yet (e.g. initial load → residential). */
  private getDefaultServiceTypeForShimmer(): ServiceType | null {
    if (!this.serviceTypes?.length) return null;
    const saved = this.formPersistenceService.getFormData();
    if (saved?.selectedServiceTypeId) {
      const st = this.serviceTypes.find(st => String(st.id) === String(saved.selectedServiceTypeId));
      if (st) return st;
    }
    const residential = this.serviceTypes.find(st =>
      st.name.toLowerCase().includes('residential') && st.name.toLowerCase().includes('cleaning')
    );
    return residential ?? this.serviceTypes[0] ?? null;
  }
  isLoading = false;
  errorMessage = '';
  isSameDaySelected = false;
  serviceTypeDropdownOpen = false;
  entryMethodDropdownOpen = false;
  hasFirstTimeDiscount = false;
  firstTimeDiscountApplied = false;
  promoCodeApplied = false;
  promoDiscount = 0;
  promoIsPercentage = true;
  calculatedMaidsCount = 1;
  actualTotalDuration: number = 0;
  
  // Form step tracking
  currentStep = 1;
  totalSteps = 3;

  // Google Places Autocomplete (step 3 address)
  @ViewChild('addressAutocompleteContainer') addressContainer!: ElementRef;
  autocompleteLoaded = false;
  autocompleteError = false;
  showAddressFallbackAfterDelay = false;
  private addressFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private autocompleteInitRetryCount = 0;
  private static readonly AUTOCOMPLETE_INIT_MAX_RETRIES = 3;
  private selectionCount = 0;
  private readonly MAX_SELECTIONS = 10;
  private autocompleteElement: any = null;
  private readonly VALID_CITIES = ['Manhattan', 'Brooklyn', 'Queens'];
  
  // Extra services toggle
  showAllExtraServices = false;
  extraServicesToShow = 4; // Default for desktop, will be updated based on screen size
  extraServicesContainerMaxWidth = 950; // Initial max-width in pixels (stays fixed above 1510px)
  private resizeHandler = () => {
    this.updateExtraServicesToShow();
    this.updateExtraServicesContainerMaxWidth();
    this.cdr.detectChanges();
  };
  
  // Debug flags to prevent duplicate logs


  uploadedPhotos: Array<{
    file: File;
    preview: SafeUrl;
    base64: string;
  }> = [];
  maxPhotos = 12;
  maxFileSize = 15 * 1024 * 1024; // 15MB per photo
  acceptedFormats = 'image/jpeg,image/jpg,image/png,image/webp,image/gif,image/bmp,image/heic,image/heif';
  isUploadingPhoto = false;
  photoUploadError = '';
  isMobileDevice = false; // Will be updated in ngOnInit
  
  // Subscription-related properties
  userSubscription: any = null;
  hasActiveSubscription = false;
  nextOrderDiscount = 0;
  nextOrderTotal = 0;
  subscriptionDiscountAmount = 0;
  promoOrFirstTimeDiscountAmount = 0;

  // Gift card specific properties
  giftCardApplied = false;
  giftCardBalance = 0;
  giftCardAmountToUse = 0;
  isGiftCard = false;

  // Bubble Points redemption
  bubblePointsOptions: RedemptionOption[] = [];
  selectedPointsToRedeem = 0;
  pointsDiscountAmount = 0;
  userBubblePoints = 0;
  userBubbleCredits = 0;
  useCredits = false;
  bubblePointsPerDollar = 0;
  bubblePointsEnabled = false;
  
  // Mobile tooltip management
  mobileTooltipTimeouts: { [key: number]: any } = {};
  mobileTooltipStates: { [key: number]: boolean } = {};
  
  // Tip dropdown state
  tipDropdownOpen = false;

  // Address name: show as text until user clicks Edit; auto-fill from address fields unless user customized
  addressNameEditing = false;
  addressNameIsCustomized = false;
  
  // Booking summary collapse state
  isSummaryCollapsed = true;
  /** When true, scroll handler won't close summary (avoids closing on open-button scrollIntoView). */
  private summaryJustOpened = false;
  /** When true, scroll handler won't close summary (avoids closing on promo/gift card apply/remove layout shift). */
  private summaryCodeActionInProgress = false;
  
  
  // Extra info expansion state
  isExtraInfoExpanded = false;
  
  // Saved data for restoration
  savedCustomPricingData: any = null;
  savedPollData: any = null;
  
  // Constants
  salesTaxRate = 0.08875; // 8.875%
  minDate = new Date();
  minTipAmount = 10; 
  minCompanyTipAmount = 10;
  
  // Entry methods
  entryMethods = [
    'I will be home',
    'Doorman',
    'Office reception',
    'Other'
  ];

  // Floor types
  floorTypes: string[] = [];
  floorTypeOther: string = '';

  pollQuestions: PollQuestion[] = [];
  pollAnswers: { [key: number]: string } = {};
  showPollForm = false;
  pollFormSubmitted = false;
  formSubmitted = false;
  
  // States and Cities - will be loaded from backend
  states: string[] = [];
  cities: string[] = [];

  // Same Day Service availability properties
  isSameDayServiceAvailable = true;
  sameDayServiceDisabledReason = '';

  // Reorder functionality
  previousOrders: OrderList[] = [];
  showReorderModal = false;
  isLoadingOrders = false;
  reorderingOrderId: number | null = null;

  // Blocked time slots (scheduling restrictions for non-admin users)
  blockedTimeSlots: BlockedTimeSlot[] = [];
  blockedFullDays: Set<string> = new Set();     // YYYY-MM-DD strings
  blockedHoursMap: Map<string, Set<string>> = new Map(); // date -> set of "HH:mm"

  // Admin functionality
  isAdmin = false;
  isSuperAdmin = false;
  isModerator = false;
  isAdminMode = false;
  selectedTargetUser: UserAdmin | null = null;
  userSearchTerm = '';
  availableUsers: UserAdmin[] = [];
  filteredUsers: UserAdmin[] = [];
  showUserSelector = false;
  isLoadingUsers = false;

  constructor(
    private fb: FormBuilder,
    private bookingService: BookingService,
    private authService: AuthService,
    private authModalService: AuthModalService,
    private profileService: ProfileService,
    private locationService: LocationService,
    private router: Router,
    private route: ActivatedRoute,
    private bookingDataService: BookingDataService,
    private specialOfferService: SpecialOfferService,
    public formPersistenceService: FormPersistenceService,
    private pollService: PollService,
    private sanitizer: DomSanitizer,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone,
    private orderService: OrderService,
    private adminService: AdminService,
    @Inject(PLATFORM_ID) private platformId: Object,
    private injector: Injector,
    private googleMapsLoader: GoogleMapsLoaderService,
    private bubbleRewardsService: BubbleRewardsService
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
    
    this.bookingForm = this.fb.group({
      serviceDate: [{value: '', disabled: false}, Validators.required],
      serviceTime: ['', Validators.required],
      entryMethod: ['I will be home', Validators.required],
      customEntryMethod: [''],
      specialInstructions: [''],
      contactFirstName: ['', Validators.required],
      contactLastName: ['', Validators.required],
      contactEmail: ['', [Validators.required, Validators.email]],
      contactPhone: ['', [Validators.required, Validators.pattern(/^\d{10}$/)]],
      useApartmentAddress: [false],
      selectedApartmentId: [''],
      serviceAddress: ['', Validators.required],
      apartmentName: ['', Validators.required],
      aptSuite: [''],
      city: ['', Validators.required],
      state: ['', Validators.required],
      zipCode: ['', [Validators.required, Validators.pattern(/^\d{5}$/)]],
      promoCode: [''],
      tips: [0, [
        Validators.min(0),
        (control: AbstractControl): ValidationErrors | null => {
          const value = control.value;
          if (value === 0) return null; // Allow 0 as default
          return value >= this.minTipAmount ? null : { minTipAmount: true };
        }
      ]],
      companyDevelopmentTips: [0, [
        Validators.min(0),
        (control: AbstractControl): ValidationErrors | null => {
          const value = control.value;
          if (value === 0) return null; // Allow 0 as default
          return value >= this.minCompanyTipAmount ? null : { minCompanyTipAmount: true };
        }
      ]],
      cleaningType: ['normal', Validators.required], // Add new form control for cleaning type
      smsConsent: [false, [Validators.requiredTrue]],
      cancellationConsent: [false, [Validators.requiredTrue]]
    });
  }

  ngOnInit() {
    // Restore step from URL BEFORE the browser guard so SSR renders the correct step
    // (prevents hydration mismatch that shows the wrong navigation buttons on refresh)
    const stepParam = this.route.snapshot.queryParamMap.get('step');
    const stepNum = stepParam ? parseInt(stepParam, 10) : NaN;
    if (stepNum >= 1 && stepNum <= this.totalSteps) {
      this.currentStep = stepNum;
      // Clear all loading flags on step 2/3 so SSR HTML matches client state
      if (this.currentStep === 2 || this.currentStep === 3) {
        this.loading.previousOrders = false;
        this.loading.promoBanner = false;
        this.loading.serviceTypes = false;
        this.loading.serviceDetails = false;
        this.loading.partnership = false;
        this.loading.availableDates = false;
        this.loading.timeSlots = false;
        this.loading.cleaningTypes = false;
        this.loading.extras = false;
        this.loading.summary = false;
        this.loading.pricing = false;
      }
      if (this.isBrowser && this.currentStep === 3) {
        runInInjectionContext(this.injector, () => {
          afterNextRender(() => {
            this.autocompleteInitRetryCount = 0;
            this.initAddressAutocomplete();
          });
        });
      }
    }

    // Only run initialization in browser environment
    if (!this.isBrowser) return;
    
    // Check same day service availability
    this.checkSameDayServiceAvailability();
    
    // Update extra services to show based on screen size
    this.updateExtraServicesToShow();
    this.updateExtraServicesContainerMaxWidth();
    
    // Set up periodic check for same day service availability (every minute)
    const intervalId = setInterval(() => {
      this.checkSameDayServiceAvailability();
    }, 60000); // Check every minute
    
    // Store interval ID for cleanup
    this.destroy$.subscribe(() => {
      clearInterval(intervalId);
    });
    
    // Add window resize listener for responsive extra services
    window.addEventListener('resize', this.resizeHandler);
    // Close expanded booking summary when user scrolls on mobile/tablet
    window.addEventListener('scroll', this.summaryScrollCloseHandler, { passive: true });
    
    // Set minimum date to tomorrow (not 2 days from now)
    this.minDate = new Date();
    this.minDate.setDate(this.minDate.getDate() + 1); // Changed from +2 to +1
    this.minDate.setHours(0, 0, 0, 0);
    
    // Set default date to tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const year = tomorrow.getFullYear();
    const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const day = String(tomorrow.getDate()).padStart(2, '0');
    const formattedDate = `${year}-${month}-${day}`;
    
    // Set default values
    this.serviceDate.setValue(formattedDate);
    this.serviceTime.setValue('08:00');
    this.ensureValidServiceTimeForSelectedDate();

    // Ensure custom pricing FormControls have proper default values
    this.initializeCustomPricingDefaults();
    
    // Subscribe to promo code value changes to keep both input fields synchronized
    this.promoCode.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        // Force change detection to update both input fields
        this.cdr.detectChanges();
      });
    
    // Load saved form data if exists
    this.loadSavedFormData();
    this.ensureValidServiceTimeForSelectedDate();
    
    // Do NOT sync URL here: calling updateBookingStepUrl() on init caused a navigation that
    // could reset the component or overwrite restored form data. Step is only updated when
    // user clicks Next/Previous (nextStep/previousStep).
    
    // Mark booking as started if we have any saved data
    if (this.formPersistenceService.hasSavedData()) {
      this.formPersistenceService.markBookingStarted();
    }
    
    // Initialize entry method to "I will be home" only if no saved data exists
    if (!this.entryMethod.value) {
      this.entryMethod.setValue('I will be home');
    }
    
    // Wait for auth service to be initialized before proceeding; run loaders after next render (SSR-safe)
    this.authService.isInitialized$.pipe(
      takeUntil(this.destroy$)
    ).subscribe(isInitialized => {
      if (isInitialized) {
        this.checkAdminStatus();
        const runLoaders = () => {
          this.loadInitialData();
          this.loadBlockedTimeSlots();
          this.setupFormListeners();
          this.loadSpecialOffers();
          this.loadOrders();
          this.loading.partnership = false;
          this.cdr.markForCheck();
        };
        if (this.isBrowser) {
          runInInjectionContext(this.injector, () => {
            afterNextRender(() => {
              if (this.authService.isLoggedIn()) {
                this.authService.refreshUserProfile().pipe(
                  takeUntil(this.destroy$)
                ).subscribe({
                  next: runLoaders,
                  error: runLoaders
                });
              } else {
                runLoaders();
              }
            });
          });
        }
      }
    });

    if (this.customAmount) {
      this.customAmount.valueChanges
        .pipe(
          takeUntil(this.destroy$)
        )
        .subscribe(() => {
          if (this.showCustomPricing) {
            this.calculateTotal();
            this.saveFormData(); // Save form data when custom amount changes
          }
        });
    }
    
    // Listen to custom cleaners changes
    this.customCleaners.valueChanges
      .pipe(
        takeUntil(this.destroy$)
      )
      .subscribe(() => {
        if (this.showCustomPricing) {
          this.calculateTotal();
          this.saveFormData(); // Save form data when custom cleaners changes
        }
      });
    
    // Listen to custom duration changes
    this.customDuration.valueChanges
      .pipe(
        takeUntil(this.destroy$)
      )
      .subscribe(() => {
        if (this.showCustomPricing) {
          this.calculateTotal();
          this.saveFormData(); // Save form data when custom duration changes
        }
      });
    
    // Setup click outside handler for dropdown
    this.setupDropdownClickOutside();
  }

  ngOnDestroy() {
    // Persist current form state when leaving so returning to booking restores it (unless we just cleared / went to confirmation)
    if (this.isBrowser && !this.skipSaveOnDestroy && this.selectedServiceType) {
      this.saveFormData();
    }
    // Clean up window listeners
    if (this.isBrowser) {
      window.removeEventListener('resize', this.resizeHandler);
      window.removeEventListener('scroll', this.summaryScrollCloseHandler);
    }
    if (this.addressFallbackTimer) {
      clearTimeout(this.addressFallbackTimer);
      this.addressFallbackTimer = null;
    }
    this.destroy$.next();
    this.destroy$.complete();
  }

  private setupDropdownClickOutside() {
    if (!this.isBrowser) return;
    
    document.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.service-type-dropdown')) {
        this.serviceTypeDropdownOpen = false;
      }
      if (!target.closest('.entry-method-dropdown')) {
        this.entryMethodDropdownOpen = false;
      }
      if (!target.closest('.tip-dropdown')) {
        this.tipDropdownOpen = false;
      }
    });
  }

  private initializeCustomPricingDefaults() {
    // Ensure custom pricing FormControls have proper default values
    if (!this.customAmount.value) {
      this.customAmount.patchValue('');
    }
    if (!this.customCleaners.value) {
      this.customCleaners.patchValue(1);
    }
    if (!this.customDuration.value) {
      this.customDuration.patchValue(60);
    }
  }

  private loadSavedFormData() {
    // Re-hydrate from sessionStorage so we always restore from persisted state (not stale in-memory subject)
    this.formPersistenceService.loadFormData();
    const savedData = this.formPersistenceService.getFormData();
    if (!savedData) return;
  
    // Restore form fields
    const formValues: any = {};
    if (savedData.serviceDate) formValues.serviceDate = savedData.serviceDate;
    if (savedData.serviceTime) formValues.serviceTime = savedData.serviceTime;
    if (savedData.entryMethod) formValues.entryMethod = savedData.entryMethod;
    if (savedData.customEntryMethod) formValues.customEntryMethod = savedData.customEntryMethod;
    if (savedData.specialInstructions) formValues.specialInstructions = savedData.specialInstructions;
    if (savedData.contactFirstName) formValues.contactFirstName = savedData.contactFirstName;
    if (savedData.contactLastName) formValues.contactLastName = savedData.contactLastName;
    if (savedData.contactEmail) formValues.contactEmail = savedData.contactEmail;
    if (savedData.contactPhone) formValues.contactPhone = savedData.contactPhone;
    if (savedData.selectedApartmentId) formValues.selectedApartmentId = savedData.selectedApartmentId;
    if (savedData.serviceAddress) formValues.serviceAddress = savedData.serviceAddress;
    if (savedData.apartmentName) formValues.apartmentName = savedData.apartmentName;
    if (savedData.aptSuite) formValues.aptSuite = savedData.aptSuite;
    if (savedData.city) formValues.city = savedData.city;
    if (savedData.state) formValues.state = savedData.state;
    if (savedData.zipCode) formValues.zipCode = savedData.zipCode;
    if (savedData.promoCode) formValues.promoCode = savedData.promoCode;
    if (savedData.tips !== undefined) formValues.tips = savedData.tips;
    if (savedData.companyDevelopmentTips !== undefined) formValues.companyDevelopmentTips = savedData.companyDevelopmentTips;
    if (savedData.cleaningType) formValues.cleaningType = savedData.cleaningType;
    if (savedData.smsConsent !== undefined) formValues.smsConsent = savedData.smsConsent;
    if (savedData.cancellationConsent !== undefined) formValues.cancellationConsent = savedData.cancellationConsent;
    if (savedData.bedroomsQuantity !== undefined) this.bedroomsQuantityControl.setValue(savedData.bedroomsQuantity);
    if (savedData.bathroomsQuantity !== undefined) this.bathroomsQuantityControl.setValue(savedData.bathroomsQuantity);
  
    this.bookingForm.patchValue(formValues);
    
    // Restore service type control value
    if (savedData.selectedServiceTypeId) {
      this.serviceTypeControl.setValue(savedData.selectedServiceTypeId);
    }
    
    // Store custom pricing and poll data for restoration after service type is loaded
    this.savedCustomPricingData = {
      customAmount: savedData.customAmount,
      customCleaners: savedData.customCleaners,
      customDuration: savedData.customDuration,
      bedroomsQuantity: savedData.bedroomsQuantity,
      bathroomsQuantity: savedData.bathroomsQuantity
    };
    
    this.savedPollData = savedData.pollAnswers;

    // Restore floor types
    if (savedData.floorTypes && savedData.floorTypes.length > 0) {
      this.floorTypes = [...savedData.floorTypes];
      this.floorTypeOther = savedData.floorTypeOther || '';
    }
  }

  /** Apply loaded service types: sort, restore saved selection or default. */
  private applyServiceTypes(serviceTypes: ServiceType[]) {
    this.serviceTypes = serviceTypes.sort((a, b) => {
      const orderA = a.displayOrder || 999;
      const orderB = b.displayOrder || 999;
      return orderA - orderB;
    });
    this.serviceTypes.forEach(serviceType => {
      if (serviceType.services) {
        serviceType.services.sort((a, b) => {
          const orderA = a.displayOrder || 999;
          const orderB = b.displayOrder || 999;
          return orderA - orderB;
        });
      }
      if (serviceType.extraServices) {
        serviceType.extraServices.sort((a, b) => {
          const orderA = a.displayOrder || 999;
          const orderB = b.displayOrder || 999;
          return orderA - orderB;
        });
      }
    });
    if (this.errorMessage === 'Failed to load service types') this.errorMessage = '';
    // Re-hydrate from sessionStorage so we use persisted state (user may have come from main or returned to booking)
    this.formPersistenceService.loadFormData();
    const savedData = this.formPersistenceService.getFormData();
    const savedServiceType = savedData?.selectedServiceTypeId ? this.serviceTypes.find(st => String(st.id) === String(savedData.selectedServiceTypeId)) : null;
    if (savedData?.selectedServiceTypeId && savedServiceType) {
        this.serviceTypeControl.setValue(savedServiceType.id);
        const savedServices = savedData.selectedServices || [];
        const savedExtraServices = savedData.selectedExtraServices || [];
        this.selectServiceType(savedServiceType, true); // skipSave: we'll save after restoring quantities and deep extra
        if (savedServices.length > 0) {
          savedServices.forEach(ss => {
            const service = savedServiceType.services.find(s => String(s.id) === String(ss.serviceId));
            if (service) {
              const existingIndex = this.selectedServices.findIndex(s => String(s.service.id) === String(service.id));
              if (existingIndex >= 0) {
                this.selectedServices[existingIndex].quantity = ss.quantity;
                if (service.serviceKey === 'bedrooms') {
                  const sqftService = this.selectedServices.find(s => s.service.serviceKey === 'sqft');
                  if (sqftService) sqftService.quantity = this.getSquareFeetForBedrooms(ss.quantity);
                }
              }
            }
          });
        }
        if (savedExtraServices.length > 0) {
          this.selectedExtraServices = [];
          savedExtraServices.forEach(ses => {
            const extraService = savedServiceType.extraServices.find(es => String(es.id) === String(ses.extraServiceId));
            if (extraService) {
              this.selectedExtraServices.push({
                extraService,
                quantity: ses.quantity || 1,
                hours: ses.hours || (extraService.hasHours ? 0.5 : 0)
              });
            }
          });
          this.cleaningType.setValue(this.getCurrentCleaningType());
        } else if (savedData.cleaningType === 'deep' && this.canSelectDeepCleaning) {
          // Main page only saves cleaningType, not selectedExtraServices. Add deep cleaning extra
          // so the booking price uses the correct multiplier.
          const hasDeep = this.selectedExtraServices.some(s => s.extraService.isDeepCleaning);
          if (!hasDeep) {
            const deepExtra = this.getActiveDeepCleaningExtraService();
            if (deepExtra) {
              this.selectedExtraServices.push({
                extraService: deepExtra,
                quantity: 1,
                hours: deepExtra.hasHours ? 0.5 : 0
              });
            }
          }
          this.cleaningType.setValue(this.getCurrentCleaningType());
        }
        this.normalizeCleaningTypeForSelectedServiceType();
        this.calculateTotal();
        this.saveFormData(); // Persist restored state (quantities + deep extra) so it's not overwritten by defaults
    } else {
      const residentialCleaning = this.serviceTypes.find(st =>
        st.name.toLowerCase().includes('residential') && st.name.toLowerCase().includes('cleaning')
      );
      if (residentialCleaning) {
        this.serviceTypeControl.setValue(residentialCleaning.id);
        this.selectServiceType(residentialCleaning);
        this.calculateTotal();
      }
    }
  }

  private loadInitialData() {
    if (!this.isBrowser) return;
    this.errorMessage = '';

    this.bookingService.getServiceTypes().pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (serviceTypes) => {
        this.applyServiceTypes(serviceTypes);
        this.loading.serviceTypes = false;
        this.loading.serviceDetails = false;
        this.loading.cleaningTypes = false;
        this.loading.extras = false;
        this.loading.availableDates = false;
        this.loading.timeSlots = false;
        this.loading.summary = false;
        this.loading.pricing = false;
        this.cdr.markForCheck();
      },
      error: (error) => {
        console.error('Failed to load service types:', error);
        this.errorMessage = 'Failed to load service types';
        this.loading.serviceTypes = false;
        this.loading.serviceDetails = false;
        this.loading.extras = false;
        this.loading.cleaningTypes = false;
        this.loading.availableDates = false;
        this.loading.timeSlots = false;
        this.cdr.markForCheck();
      }
    });

    this.locationService.getStates().pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (states) => {
        this.states = states;
        const savedState = this.bookingForm.get('state')?.value;
        if (savedState && states.includes(savedState)) {
          this.loadCities(savedState);
        } else if (states.length > 0 && !savedState) {
          this.bookingForm.patchValue({ state: states[0] });
          this.loadCities(states[0]);
        }
      },
      error: () => {}
    });

    this.bookingService.getSubscriptions().pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (subscriptions) => {
        this.subscriptions = subscriptions.sort((a, b) => {
          const orderA = a.displayOrder || 999;
          const orderB = b.displayOrder || 999;
          return orderA - orderB;
        });
        if (this.errorMessage === 'Failed to load subscriptions') this.errorMessage = '';
        if (this.isAdminMode && this.selectedTargetUser) {
          this.loadUserSubscription(this.selectedTargetUser.id);
          return;
        }
        if (this.hasActiveSubscription && this.userSubscription) {
          this.updateSelectedSubscription();
          return;
        }
        const savedData = this.formPersistenceService.getFormData();
        if (savedData?.selectedSubscriptionId) {
          const savedSubscription = this.subscriptions.find(s => String(s.id) === String(savedData.selectedSubscriptionId));
          if (savedSubscription) {
            this.selectedSubscription = savedSubscription;
            return;
          }
        }
        if (this.subscriptions.length > 0) {
          const oneTimeSubscription = this.subscriptions.find(s => s.name === 'One Time') || this.subscriptions[0];
          this.selectedSubscription = oneTimeSubscription;
        }
      },
      error: (error) => {
        console.error('Failed to load subscriptions:', error);
        this.errorMessage = 'Failed to load subscriptions';
      }
    });
    
    // Load current user data
    this.authService.currentUser.pipe(
      takeUntil(this.destroy$)
    ).subscribe(user => {
      this.currentUser = user;
      if (user) {
        this.hasFirstTimeDiscount = user.firstTimeOrder;
        if (this.isBrowser) this.loadBubblePointsOptions();
        
        // Check if we have saved form data
        const savedData = this.formPersistenceService.getFormData();
        const returnedFromLoginStep3 = this.route.snapshot.queryParamMap.get('step') === '3';
        
        // If user just logged in from Book Now (step=3 in URL), use their real account email/name
        if (user && savedData && returnedFromLoginStep3) {
          this.bookingForm.patchValue({
            contactFirstName: user.firstName || '',
            contactLastName: user.lastName || '',
            contactEmail: user.email || ''
          });
        } else if (!savedData || !savedData.contactFirstName) {
          // Only pre-fill contact info if there's no saved data
          this.bookingForm.patchValue({
            contactFirstName: user.firstName,
            contactLastName: user.lastName,
            contactEmail: user.email,
            contactPhone: user.phone || ''
          });
        }
        
        // Load user apartments
        this.profileService.getApartments().pipe(
          takeUntil(this.destroy$)
        ).subscribe({
          next: (apartments) => {
            this.userApartments = apartments;
            
            // Only auto-fill with first apartment if no saved apartment selection
            if (apartments.length > 0 && !savedData?.selectedApartmentId) {
              const firstApartment = apartments[0];
              this.bookingForm.patchValue({
                selectedApartmentId: firstApartment.id.toString()
              });
              this.fillApartmentAddress(firstApartment.id.toString());
            } else if (savedData?.selectedApartmentId) {
              // Restore saved apartment selection
              this.fillApartmentAddress(savedData.selectedApartmentId);
            }
          }
        });
        
        // Load user subscription after loading user data
        this.loadUserSubscription();
      }
    });
  }

  loadCities(state: string) {
    this.locationService.getCities(state).subscribe({
      next: (cities) => {
        this.cities = cities;
      }
    });
  }

  onStateChange(state: string) {
    this.loadCities(state);
    this.bookingForm.patchValue({ city: '' });
  }

  private setupFormListeners() {
    // Listen to apartment selection changes: address name is always required; when saved apartment selected, set name from it
    this.bookingForm.get('selectedApartmentId')?.valueChanges.subscribe(apartmentId => {
      const apartmentNameControl = this.bookingForm.get('apartmentName');
      if (!apartmentNameControl) return;
      if (apartmentId) {
        const apartment = this.userApartments.find(a => a.id === +apartmentId);
        apartmentNameControl.setValue(apartment?.name ?? '');
        this.addressNameIsCustomized = true; // saved address name is custom
      } else {
        apartmentNameControl.setValue('');
        this.addressNameIsCustomized = false; // new address: auto-fill from fields
      }
      apartmentNameControl.updateValueAndValidity();
    });

    // Auto-fill address name from address field only; clear when address is fully deleted
    this.bookingForm.get('serviceAddress')?.valueChanges
      .pipe(startWith(this.bookingForm.get('serviceAddress')?.value), takeUntil(this.destroy$))
      .subscribe(() => this.syncAddressNameFromFields());
    
    // Listen to tips changes
    this.bookingForm.get('tips')?.valueChanges.subscribe(() => {
      this.calculateTotal();
    });

    // Listen to company development tips changes
    this.bookingForm.get('companyDevelopmentTips')?.valueChanges.subscribe(() => {
      this.calculateTotal();
    });
    
    // Listen to service date changes
    this.bookingForm.get('serviceDate')?.valueChanges.subscribe(newDate => {
      if (this.isSameDaySelected && newDate) {
        const today = new Date();
        
        // Parse the selected date without timezone issues
        const [year, month, day] = newDate.split('-').map(Number);
        const selectedDate = new Date(year, month - 1, day);
        
        // Compare dates using YYYY-MM-DD format to avoid timezone issues
        const todayFormatted = today.getFullYear() + '-' + 
          String(today.getMonth() + 1).padStart(2, '0') + '-' + 
          String(today.getDate()).padStart(2, '0');
        
        // Check if the selected date is not today
        if (newDate !== todayFormatted) {
          
          // Find and remove the same day service
          const sameDayService = this.selectedExtraServices.find(s => s.extraService.isSameDayService);
          if (sameDayService) {
            // Use skipDateChange=true to preserve the user's selected date
            this.toggleExtraService(sameDayService.extraService, true);
          }
        }
      }
    });
    
    // Add auto-save functionality with debounce
    this.bookingForm.valueChanges
      .pipe(
        debounceTime(1000), // Wait 1 second after user stops typing
        takeUntil(this.destroy$)
      )
      .subscribe(() => {
        this.saveFormData();
      });
  }
  
  private saveFormData() {
    // Never overwrite storage with empty state: selectedServiceType is only set after
    // applyServiceTypes() runs (when API returns). If we save before that (e.g. after
    // loadSavedFormData() patched the form and valueChanges fired), we'd wipe good data.
    if (!this.selectedServiceType) return;

    const formData: BookingFormData = {
      // Service Type and Services
      selectedServiceTypeId: this.selectedServiceType.id ? String(this.selectedServiceType.id) : undefined,
      selectedServices: this.selectedServices.map(s => ({
        serviceId: String(s.service.id),
        quantity: s.quantity
      })),
      selectedExtraServices: this.selectedExtraServices.map(es => ({
        extraServiceId: String(es.extraService.id),
        quantity: es.quantity,
        hours: es.hours
      })),
      
      // Form Values
      ...this.bookingForm.value,
      
      // Selected Subscription
      selectedSubscriptionId: this.selectedSubscription?.id ? String(this.selectedSubscription.id) : undefined,
      
      // Consent checkboxes
      smsConsent: this.smsConsent.value,
      cancellationConsent: this.cancellationConsent.value,
      
      // Custom Pricing Data
      customAmount: this.showCustomPricing ? this.customAmount.value : undefined,
      customCleaners: this.showCustomPricing ? this.customCleaners.value : undefined,
      customDuration: this.showCustomPricing ? this.customDuration.value : undefined,
      bedroomsQuantity: this.getSelectedBedroomsQuantity(),
      bathroomsQuantity: this.getSelectedBathroomsQuantity(),
      
      // Poll Data
      pollAnswers: this.showPollForm ? this.pollAnswers : undefined,

      // Floor Types
      floorTypes: this.floorTypes.length > 0 ? this.floorTypes : undefined,
      floorTypeOther: this.floorTypeOther || undefined
    };
  
    this.formPersistenceService.saveFormData(formData);
    
    // Mark booking as in progress if user is making changes
    if (this.selectedServiceType) {
      this.formPersistenceService.markBookingInProgress();
    }
    
    // Also save the service type control value
    if (this.selectedServiceType) {
      this.serviceTypeControl.setValue(this.selectedServiceType.id);
    }
  }

  clearAllFormData() {
    if (confirm('Are you sure you want to clear all form data?')) {
      this.skipSaveOnDestroy = true;
      this.formPersistenceService.clearFormData();
      
      // Reset service type selection
      this.serviceTypeControl.setValue('');
      this.selectedServiceType = null;
      this.selectedServices = [];
      this.selectedExtraServices = [];
      
      // Reset form to default values
      this.bookingForm.reset();
      
      // Reset floor types
      this.floorTypes = [];
      this.floorTypeOther = '';

      // Reset custom pricing
      this.showCustomPricing = false;
      this.customAmount.setValue('');
      this.customCleaners.setValue(1);
      this.customDuration.setValue(60);
      
      // Reset special offers and discounts
      this.selectedSpecialOffer = null;
      this.specialOfferApplied = false;
      this.promoCodeApplied = false;
      this.promoDiscount = 0;
      this.promoIsPercentage = true;
      this.selectedPointsToRedeem = 0;
      this.pointsDiscountAmount = 0;
      this.useCredits = false;
      this.userBubbleCredits = 0;

      // Reset calculation
      this.calculation = {
        subTotal: 0,
        tax: 0,
        discountAmount: 0,
        tips: 0,
        total: 0,
        totalDuration: 0
      };
      
      // Reset UI state
      this.serviceTypeDropdownOpen = false;
      this.entryMethodDropdownOpen = false;
      this.isSummaryCollapsed = false;
      
      // Set default date and time
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const year = tomorrow.getFullYear();
      const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
      const day = String(tomorrow.getDate()).padStart(2, '0');
      const formattedDate = `${year}-${month}-${day}`;
      
      this.serviceDate.setValue(formattedDate);
      this.serviceTime.setValue('08:00');
      this.cleaningType.setValue('normal');
      this.tips.setValue(0);
      this.companyDevelopmentTips.setValue(0);
      this.smsConsent.setValue(false);
      this.cancellationConsent.setValue(false);
    }
  }

  private parseServiceDate(dateInput: unknown): Date | null {
    if (!dateInput) return null;
    if (dateInput instanceof Date) {
      // Normalize to local Y/M/D (no timezone shifting)
      return new Date(dateInput.getFullYear(), dateInput.getMonth(), dateInput.getDate());
    }
    if (typeof dateInput === 'string') {
      // Expect YYYY-MM-DD (or ISO). Parse without timezone issues.
      const dateString = dateInput.includes('T') ? dateInput.split('T')[0] : dateInput;
      const [year, month, day] = dateString.split('-').map(Number);
      if (!year || !month || !day) return null;
      return new Date(year, month - 1, day);
    }
    return null;
  }

  private getMinimumStartTimeForDate(date: Date): string {
    // JS getDay(): 0 = Sunday, 6 = Saturday
    const dayOfWeek = date.getDay();
    return dayOfWeek === 0 || dayOfWeek === 6 ? '09:30' : '08:00';
  }

  private ensureValidServiceTimeForSelectedDate(): void {
    const slots = this.getAvailableTimeSlots();
    const current = this.serviceTime.value;
    const blockedHours = this.getBlockedHoursForSelectedDate();
    const blockedSet = new Set(blockedHours);

    // If current time is available and not blocked, keep it
    if (current && slots.includes(current) && !blockedSet.has(current)) {
      return;
    }

    // Find the closest available non-blocked slot to the current time
    const availableSlots = slots.filter(slot => !blockedSet.has(slot));
    if (availableSlots.length > 0) {
      if (current) {
        // Pick the closest available slot to the previously selected time
        let closest = availableSlots[0];
        let minDiff = Math.abs(this.timeToMinutes(availableSlots[0]) - this.timeToMinutes(current));
        for (const slot of availableSlots) {
          const diff = Math.abs(this.timeToMinutes(slot) - this.timeToMinutes(current));
          if (diff < minDiff) {
            minDiff = diff;
            closest = slot;
          }
        }
        this.serviceTime.setValue(closest);
      } else {
        this.serviceTime.setValue(availableSlots[0]);
      }
    }
  }

  private timeToMinutes(time: string): number {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
  }

  onApartmentSelect(event: any) {
    const apartmentId = event.target.value;
    if (apartmentId) {
      this.fillApartmentAddress(apartmentId);
    }
  }

  clearApartmentSelection() {
    this.addressNameIsCustomized = false; // allow auto-fill from new address
    this.bookingForm.patchValue({
      selectedApartmentId: '',
      serviceAddress: '',
      aptSuite: '',
      city: '',
      state: this.states.length > 0 ? this.states[0] : '',
      zipCode: ''
    });
    
    // Load cities for the default state
    if (this.states.length > 0) {
      this.loadCities(this.states[0]);
    }

    // Re-enable Google Places Autocomplete when switching to "new address"
    if (this.isBrowser && this.currentStep === 3) {
      this.autocompleteLoaded = false;
      this.autocompleteError = false;
      this.autocompleteInitRetryCount = 0;
      const container = this.addressContainer?.nativeElement;
      if (container) {
        container.innerHTML = '';
      }
      this.autocompleteElement = null;
      setTimeout(() => this.initAddressAutocomplete(), 100);
    }
  }

  /** Monkey-patch attachShadow so gmp-place-autocomplete uses open Shadow DOM and we can inject styles. Must run before creating the element. */
  private setupShadowDOMStyling(): void {
    if (typeof window === 'undefined' || (window as any).__gmpShadowPatched) return;

    // Approach 3: intercept matchMedia so Google thinks viewport is always wide (no mobile full-screen)
    if (!(window as any).__gmpMatchMediaPatched) {
      const originalMatchMedia = window.matchMedia.bind(window);
      window.matchMedia = function(query: string): MediaQueryList {
        if (query.includes('max-width') && query.includes('px')) {
          const match = query.match(/max-width:\s*(\d+)px/);
          if (match && parseInt(match[1], 10) <= 600) {
            return originalMatchMedia('(max-width: 0px)');
          }
        }
        return originalMatchMedia(query);
      };
      (window as any).__gmpMatchMediaPatched = true;
    }

    const originalAttachShadow = Element.prototype.attachShadow;

    Element.prototype.attachShadow = function(init: ShadowRootInit): ShadowRoot {
      if (this.localName === 'gmp-place-autocomplete') {
        const shadow = originalAttachShadow.call(this, { ...init, mode: 'open' });
        const style = document.createElement('style');
        style.textContent = `
          :host {
            background: transparent !important;
            border: none !important;
            box-shadow: none !important;
            color-scheme: var(--gmp-color-scheme, light) !important;
          }
          .widget-container {
            width: 100% !important;
            display: block !important;
            background: transparent !important;
            border: none !important;
            box-shadow: none !important;
          }
          .input-container {
            background-color: var(--surface-elevated) !important;
            border: var(--address-field-border, 1px solid var(--border-color)) !important;
            outline: none !important;
            border-radius: 58px !important;
            box-shadow: none !important;
            min-height: 44px !important;
            height: 44px !important;
            transition: border-color 0.3s ease, box-shadow 0.3s ease !important;
            box-sizing: border-box !important;
            width: 100% !important;
            display: flex !important;
            align-items: center !important;
            justify-content: flex-start !important;
            text-align: left !important;
          }
          .input-container * {
            text-align: left !important;
          }
          .widget-container:focus-within .input-container,
          .input-container:focus-within {
            border-color: var(--primary-color) !important;
            box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25) !important;
            outline: none !important;
          }
          .input-container input,
          input {
            border: none !important;
            outline: none !important;
            font-size: 1rem !important;
            font-family: 'Poppins', sans-serif !important;
            font-weight: 400 !important;
            line-height: 1.5 !important;
            background: transparent !important;
            color: var(--text-primary) !important;
            text-align: left !important;
            min-height: 44px !important;
            height: 44px !important;
            padding: 10px 12px !important;
            padding-left: 0px !important;
            padding-right: 5px !important;
            width: 100% !important;
            min-width: 0 !important;
            box-sizing: border-box !important;
          }
          input::placeholder {
            color: var(--text-muted) !important;
            text-align: left !important;
          }
          .focus-ring {
            display: none !important;
          }
          .autocomplete-icon svg,
          .clear-button svg {
            fill: var(--text-muted) !important;
          }
          /* Dropdown list: day = white bg + black text, dark = via --gmp-dropdown-* */
          [part="prediction-list"],
          [role="listbox"],
          .list {
            background: var(--gmp-dropdown-bg, #ffffff) !important;
            color: var(--gmp-dropdown-text, #1a1a1a) !important;
          }
          [part="prediction-item"],
          [role="option"] {
            color: var(--gmp-dropdown-text, #1a1a1a) !important;
          }
          [part="prediction-item"]:hover,
          [part="prediction-item-selected"],
          [role="option"]:hover {
            background: var(--gmp-dropdown-hover, #f0f0f0) !important;
            color: var(--gmp-dropdown-text, #1a1a1a) !important;
          }
        `;
        shadow.appendChild(style);
        return shadow;
      }
      return originalAttachShadow.call(this, init);
    };
    (window as any).__gmpShadowPatched = true;
  }

  async initAddressAutocomplete(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;
    const container = this.addressContainer?.nativeElement;
    if (container && !container.querySelector('gmp-place-autocomplete')) {
      this.autocompleteLoaded = false;
    }
    if (this.autocompleteLoaded) return;

    if (this.addressFallbackTimer) {
      clearTimeout(this.addressFallbackTimer);
      this.addressFallbackTimer = null;
    }
    this.addressFallbackTimer = setTimeout(() => {
      if (!this.autocompleteLoaded && !this.autocompleteError) {
        this.showAddressFallbackAfterDelay = true;
        this.cdr.markForCheck();
      }
      this.addressFallbackTimer = null;
    }, 2500);

    try {
      this.setupShadowDOMStyling();
      const places = await this.googleMapsLoader.getPlacesLibrary();
      const PlaceAutocompleteElement = places?.PlaceAutocompleteElement;
      if (!PlaceAutocompleteElement) {
        throw new Error('PlaceAutocompleteElement not available');
      }
      const placeAutocomplete = new PlaceAutocompleteElement({
        componentRestrictions: { country: 'us' },
        types: ['address'],
      });

      placeAutocomplete.style.width = '100%';
      placeAutocomplete.style.display = 'block';
      placeAutocomplete.setAttribute('placeholder', 'Address *');

      const containerEl = this.addressContainer?.nativeElement;
      if (containerEl) {
        containerEl.innerHTML = '';
        containerEl.appendChild(placeAutocomplete);
        this.autocompleteElement = placeAutocomplete;
        this.autocompleteLoaded = true;
        this.autocompleteInitRetryCount = 0;
        this.showAddressFallbackAfterDelay = false;
        if (this.addressFallbackTimer) {
          clearTimeout(this.addressFallbackTimer);
          this.addressFallbackTimer = null;
        }

        placeAutocomplete.addEventListener('gmp-select', async ({ placePrediction }: any) => {
          await this.handlePlaceSelect(placePrediction);
        });
      } else {
        this.scheduleAddressAutocompleteRetry();
      }
    } catch (error) {
      console.warn('Google Places Autocomplete failed to load:', error);
      this.autocompleteError = true;
    }
  }

  private scheduleAddressAutocompleteRetry(): void {
    if (this.autocompleteInitRetryCount >= BookingComponent.AUTOCOMPLETE_INIT_MAX_RETRIES) return;
    if (this.currentStep !== 3 || this.selectedApartmentId?.value) return;
    this.autocompleteInitRetryCount++;
    setTimeout(() => this.initAddressAutocomplete(), 400);
  }

  private async handlePlaceSelect(placePrediction: any): Promise<void> {
    this.selectionCount++;
    if (this.selectionCount > this.MAX_SELECTIONS) return;

    const place = placePrediction.toPlace();
    await place.fetchFields({ fields: ['addressComponents', 'formattedAddress'] });

    const components = place.addressComponents;
    if (!components || components.length === 0) {
      console.warn('No address components returned');
      return;
    }

    let streetNumber = '';
    let route = '';
    let city = '';
    let state = '';
    let zipCode = '';

    for (const component of components) {
      const types: string[] = component.types;
      if (types.includes('street_number')) streetNumber = component.longText;
      if (types.includes('route')) route = component.longText;
      if (types.includes('sublocality_level_1')) city = component.longText;
      if (types.includes('locality') && !city) city = component.longText;
      if (types.includes('administrative_area_level_1')) state = component.longText;
      if (types.includes('postal_code')) zipCode = component.longText;
    }

    const fullAddress = streetNumber ? `${streetNumber} ${route}` : route;
    const matchedCity = this.VALID_CITIES.find(vc => vc.toLowerCase() === city.toLowerCase());

    this.ngZone.run(() => {
      if (fullAddress) {
        this.bookingForm.patchValue({ serviceAddress: fullAddress });
      } else if (place.formattedAddress) {
        this.bookingForm.patchValue({ serviceAddress: place.formattedAddress });
      }
      if (matchedCity) {
        this.bookingForm.patchValue({ city: matchedCity });
      } else if (city) {
        console.warn(`"${city}" is outside our service area`);
      }
      if (state) this.bookingForm.patchValue({ state: state });
      if (zipCode) this.bookingForm.patchValue({ zipCode: zipCode });

      ['serviceAddress', 'city', 'state', 'zipCode'].forEach(field => {
        this.bookingForm.get(field)?.markAsTouched();
        this.bookingForm.get(field)?.markAsDirty();
      });

      setTimeout(() => {
        const aptField = document.querySelector('[formControlName="aptSuite"]') as HTMLElement
          || document.getElementById('aptSuite');
        aptField?.focus();
      }, 100);
    });
  }

  /** Build address name from address field only (no apt/suite, city, state, zip). */
  getBuiltAddressString(): string {
    return (this.serviceAddress.value ?? '').trim();
  }

  /** Sync address name from address field when user has not customized it. Clear name when address is fully deleted. */
  private syncAddressNameFromFields() {
    if (this.addressNameIsCustomized) return;
    const built = this.getBuiltAddressString();
    const nameControl = this.bookingForm.get('apartmentName');
    if (!nameControl) return;
    const newValue = built || '';
    if (nameControl.value !== newValue) {
      nameControl.setValue(newValue);
      nameControl.updateValueAndValidity();
    }
  }

  startEditAddressName() {
    this.addressNameEditing = true;
    this.cdr.markForCheck();
  }

  finishEditAddressName() {
    this.addressNameEditing = false;
    const built = this.getBuiltAddressString();
    const newName = (this.apartmentName.value ?? '').trim();
    if (newName && newName !== built) this.addressNameIsCustomized = true;
    this.apartmentName.updateValueAndValidity();
    this.cdr.markForCheck();

    // If user has a saved address selected, persist the new address name to the database
    const selectedId = this.bookingForm.get('selectedApartmentId')?.value;
    if (!selectedId || !newName) return;
    const apartment = this.userApartments.find((a: { id: number }) => a.id === +selectedId);
    if (!apartment || apartment.name === newName) return;
    const updated = { ...apartment, name: newName };
    const update$ = this.selectedTargetUser
      ? this.adminService.updateUserApartment(this.selectedTargetUser.id, apartment.id, updated)
      : this.profileService.updateApartment(apartment.id, updated);
    update$.subscribe({
      next: (saved) => {
        const idx = this.userApartments.findIndex((a: { id: number }) => a.id === saved.id);
        if (idx !== -1) this.userApartments[idx] = saved;
        this.errorMessage = '';
        this.cdr.markForCheck();
      },
      error: () => {
        this.errorMessage = 'Could not save address name. Please try again.';
        this.cdr.markForCheck();
      }
    });
  }

  toggleServiceTypeDropdown() {
    this.serviceTypeDropdownOpen = !this.serviceTypeDropdownOpen;
  }

  /** @param skipSave When true, do not persist to storage (e.g. when restoring from main page). Caller should save after restoring. */
  selectServiceType(serviceType: ServiceType, skipSave?: boolean) {
    // Don't show shimmer when restoring saved data on step 2/3 — shimmers are already off there
    if (this.currentStep === 1) {
      this.loading.serviceDetails = true;
      this.loading.extras = true;
      this.loading.pricing = true;
      this.cdr.markForCheck();
    }
    this.selectedServiceType = serviceType;
    this.serviceTypeControl.setValue(serviceType.id);
    this.serviceTypeDropdownOpen = false;
    this.selectedServices = [];
    this.selectedExtraServices = [];
    this.showPollForm = false;
    this.showCustomPricing = false;

    // Check if this service type has custom pricing
    if (serviceType.isCustom) {
      this.showCustomPricing = true;

      // Restore saved custom pricing data if available
      if (this.savedCustomPricingData) {
        this.customAmount.setValue(this.savedCustomPricingData.customAmount || serviceType.basePrice);
        this.customCleaners.setValue(this.savedCustomPricingData.customCleaners || 1);
        this.customDuration.patchValue(this.savedCustomPricingData.customDuration || 60);
        this.bedroomsQuantityControl.setValue(this.savedCustomPricingData.bedroomsQuantity ?? 0);
        this.bathroomsQuantityControl.setValue(this.savedCustomPricingData.bathroomsQuantity ?? 1);
        
        // Clear saved data after restoration
        this.savedCustomPricingData = null;
      } else {
        // Set defaults for custom fields
        this.customAmount.setValue(serviceType.basePrice);
        this.customCleaners.setValue(1);
        // Always set duration to 60 (1 hour) as default for custom pricing
        this.customDuration.patchValue(60);
        this.bedroomsQuantityControl.setValue(0);
        this.bathroomsQuantityControl.setValue(1);
      }

      // Force Angular to detect changes for the duration dropdown
      setTimeout(() => {
        this.customDuration.patchValue(this.customDuration.value);
      }, 0);

      // Ensure entry method is required for custom pricing
      this.entryMethod.setValidators([Validators.required]);
      this.entryMethod.updateValueAndValidity();
      
      // Reset entry method to empty only if no saved value exists
      if (!this.entryMethod.value) {
        this.entryMethod.setValue('I will be home');
      }

      // Trigger calculation
      this.calculateTotal();
    }
    
    // Check if this service type has poll functionality
   else if (serviceType.hasPoll) {
      this.showPollForm = true;
      this.loadPollQuestions(serviceType.id);
      
      // DISABLE validation for fields not needed in poll forms
      this.entryMethod.clearValidators();
      this.entryMethod.updateValueAndValidity();
      
      // Clear validators for fields not required in poll forms
      this.contactLastName.clearValidators();
      this.contactLastName.updateValueAndValidity();
      
      this.contactEmail.clearValidators();
      this.contactEmail.updateValueAndValidity();
      
      this.smsConsent.clearValidators();
      this.smsConsent.updateValueAndValidity();
      
      this.cancellationConsent.clearValidators();
      this.cancellationConsent.updateValueAndValidity();
      
      // Set default values to prevent validation errors but disable validators
      // Only set to 'I will be home' if no saved value exists
      if (!this.entryMethod.value) {
        this.entryMethod.setValue('I will be home');
      }
      
      // Initialize subscription and cleaning type for consistency
      if (!this.selectedSubscription && this.subscriptions && this.subscriptions.length > 0) {
        if (!this.hasActiveSubscription) {
          this.selectedSubscription = this.subscriptions[0];
        } else {
          this.updateSelectedSubscription();
        }
      }
      
      if (!this.cleaningType.value) {
        this.cleaningType.setValue('normal');
      }
    } else {
      this.showPollForm = false;
      
      // RESTORE validation for regular booking forms
      this.entryMethod.setValidators([Validators.required]);
      this.entryMethod.updateValueAndValidity();
      
      // Restore validators for regular booking forms
      this.contactLastName.setValidators([Validators.required]);
      this.contactLastName.updateValueAndValidity();
      
      this.contactEmail.setValidators([Validators.required, Validators.email]);
      this.contactEmail.updateValueAndValidity();
      
      this.smsConsent.setValidators([Validators.requiredTrue]);
      this.smsConsent.updateValueAndValidity();
      
      this.cancellationConsent.setValidators([Validators.requiredTrue]);
      this.cancellationConsent.updateValueAndValidity();
      
      // Reset entry method value when switching back to regular booking only if no saved value exists
      if (!this.entryMethod.value || this.entryMethod.value === 'N/A') {
        this.entryMethod.setValue('I will be home');
      }
      
      // Initialize services based on type (your existing logic)
      if (serviceType.services) {
        const sortedServices = [...serviceType.services].sort((a, b) => 
          (a.displayOrder || 999) - (b.displayOrder || 999)
        );
        
        let bedroomsQuantity = 0; // Default to Studio
        
        sortedServices.forEach(service => {
          if (service.isActive !== false) {
            let defaultQuantity = service.minValue ?? 0;
            
            // Set defaults based on service key
            if (service.serviceKey === 'bedrooms') {
              defaultQuantity = 0; // Studio
              bedroomsQuantity = defaultQuantity;
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
        const sqftService = this.selectedServices.find(s => s.service.serviceKey === 'sqft');
        if (sqftService) {
          sqftService.quantity = this.getSquareFeetForBedrooms(bedroomsQuantity);
        }
        this.syncStandaloneBedroomBathroomFromServices();
        const persisted = this.formPersistenceService.getFormData();
        if (persisted?.bedroomsQuantity !== undefined) this.bedroomsQuantityControl.setValue(persisted.bedroomsQuantity);
        if (persisted?.bathroomsQuantity !== undefined) this.bathroomsQuantityControl.setValue(persisted.bathroomsQuantity);
      }
      
      this.selectedExtraServices = [];
      
      if (!this.selectedSubscription && this.subscriptions && this.subscriptions.length > 0) {
        if (!this.hasActiveSubscription) {
          this.selectedSubscription = this.subscriptions[0];
        } else {
          this.updateSelectedSubscription();
        }
      }
      
      if (!this.cleaningType.value) {
        this.cleaningType.setValue('normal');
      }
    }
    
    this.normalizeCleaningTypeForSelectedServiceType();
    this.calculateTotal();
    if (!skipSave) {
      this.saveFormData();
    }
    this.loading.serviceDetails = false;
    this.loading.extras = false;
    this.loading.pricing = false;
    this.loading.summary = false;
    this.cdr.markForCheck();
  }

  onServiceTypeChange(event: any) {
    const serviceTypeId = event.target.value;
    if (serviceTypeId) {
      const selectedType = this.serviceTypes.find(type => type.id === parseInt(serviceTypeId));
      if (selectedType) {
        this.selectServiceType(selectedType);
      }
    } else {
      // Reset when no service type is selected
      this.selectedServiceType = null;
      this.selectedServices = [];
      this.selectedExtraServices = [];
      this.showPollForm = false;
      this.showCustomPricing = false;
      this.calculateTotal();
      this.saveFormData();
    }
  }

  toggleEntryMethodDropdown() {
    this.entryMethodDropdownOpen = !this.entryMethodDropdownOpen;
  }

  selectEntryMethod(method: string) {
    this.entryMethod.setValue(method);
    this.entryMethodDropdownOpen = false; // Close dropdown after selection
    this.saveFormData(); // Save the selection
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

  updateServiceQuantity(service: Service, quantity: number) {
    const selectedService = this.selectedServices.find(s => s.service.id === service.id);
    if (selectedService) {
      selectedService.quantity = quantity;
      
      // Update square feet when bedrooms change
      if (service.serviceKey === 'bedrooms') {
        const sqftService = this.selectedServices.find(s => s.service.serviceKey === 'sqft');
        if (sqftService) {
          sqftService.quantity = this.getSquareFeetForBedrooms(quantity);
        }
      }
      
      // If updating square feet, ensure it's not below minimum for current bedrooms
      if (service.serviceKey === 'sqft') {
        const minSquareFeet = this.getSquareFeetMinForBedrooms();
        if (quantity < minSquareFeet) {
          selectedService.quantity = minSquareFeet;
          quantity = minSquareFeet;
        }
      }
      
      // When cleaners or hours change, update the display for both
      if (service.serviceKey === 'cleaners' || service.serviceKey === 'hours') {
        // Force Angular to detect changes
        this.selectedServices = [...this.selectedServices];
      }
      this.calculateTotal();
    }
    this.saveFormData();
  }

  incrementServiceQuantity(service: Service) {
    const selectedService = this.selectedServices.find(s => s.service.id === service.id);
    if (selectedService) {
      const maxValue = service.maxValue || 10;
      const stepValue = service.stepValue || 1;
      const newQuantity = Math.min(selectedService.quantity + stepValue, maxValue);
      this.updateServiceQuantity(service, newQuantity);
    }
  }

  decrementServiceQuantity(service: Service) {
    const selectedService = this.selectedServices.find(s => s.service.id === service.id);
    if (selectedService) {
      const minValue = service.minValue || 0;
      const stepValue = service.stepValue || 1;
      const newQuantity = Math.max(selectedService.quantity - stepValue, minValue);
      this.updateServiceQuantity(service, newQuantity);
    }
  }

  // New click handler for extra service card
  onExtraServiceCardClick(extraService: ExtraService) {
    // If it's a disabled same day service and on mobile, show tooltip
    if (extraService.isSameDayService && !this.isSameDayServiceAvailable && this.isCurrentlyMobile()) {
      this.clearAllMobileTooltips();
      this.showMobileTooltip(extraService.id);
      return;
    }
    // Otherwise, toggle the service normally
    this.toggleExtraService(extraService);
  }

  toggleExtraService(extraService: ExtraService, skipDateChange: boolean = false) {
    
    // Prevent selecting same day service if it's not available
    if (extraService.isSameDayService && !this.isSameDayServiceAvailable) {
      return;
    }
    
    const index = this.selectedExtraServices.findIndex(s => s.extraService.id === extraService.id);
    
    if (index > -1) {
      // Remove if already selected
      this.selectedExtraServices.splice(index, 1);
      
      // Clear mobile tooltip for this service immediately
      this.clearMobileTooltip(extraService.id);
      
      if (extraService.isSameDayService) {
        this.isSameDaySelected = false;
        // Only set date to tomorrow if this is a manual uncheck (not from date selection)
        if (!skipDateChange) {
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          const year = tomorrow.getFullYear();
          const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
          const day = String(tomorrow.getDate()).padStart(2, '0');
          const formattedDate = `${year}-${month}-${day}`;

          this.serviceDate.setValue(formattedDate);
          // Pick the nearest available time for the new date
          setTimeout(() => this.ensureValidServiceTimeForSelectedDate(), 100);
        }
      }
    } else {
      // Clear all existing tooltips first
      this.clearAllMobileTooltips();
      
      // If selecting a cleaning type, remove other cleaning types
      if (extraService.isDeepCleaning || extraService.isSuperDeepCleaning) {
        // Remove any existing deep cleaning or super deep cleaning
        this.selectedExtraServices = this.selectedExtraServices.filter(
          s => !s.extraService.isDeepCleaning && !s.extraService.isSuperDeepCleaning
        );
      }
      
      // Add new selection
      this.selectedExtraServices.push({
        extraService: extraService,
        quantity: 1,
        hours: extraService.hasHours ? 0.5 : 0
      });
      
      // Show mobile tooltip for this service
      this.showMobileTooltip(extraService.id);
      
      if (extraService.isSameDayService) {
        this.isSameDaySelected = true;
        this.updateDateRestrictions();
      }
    }
    
    this.calculateTotal();
    this.saveFormData();
  }

  // Mobile tooltip management methods
  showMobileTooltip(extraServiceId: number) {
    // Only show tooltip on mobile devices
    if (!this.isCurrentlyMobile()) return;
    
    // Clear any existing timeout for this service
    this.clearMobileTooltip(extraServiceId);
    
    // Set tooltip state to visible
    this.mobileTooltipStates[extraServiceId] = true;
    
    // Set timeout to hide tooltip after 5 seconds
    this.mobileTooltipTimeouts[extraServiceId] = setTimeout(() => {
      this.clearMobileTooltip(extraServiceId);
    }, 5000);
  }

  clearMobileTooltip(extraServiceId: number) {
    // Clear the timeout
    if (this.mobileTooltipTimeouts[extraServiceId]) {
      clearTimeout(this.mobileTooltipTimeouts[extraServiceId]);
      delete this.mobileTooltipTimeouts[extraServiceId];
    }
    
    // Set tooltip state to hidden
    this.mobileTooltipStates[extraServiceId] = false;
  }

  // Clear all mobile tooltips
  clearAllMobileTooltips() {
    // Clear all timeouts
    Object.keys(this.mobileTooltipTimeouts).forEach(key => {
      const id = parseInt(key);
      if (this.mobileTooltipTimeouts[id]) {
        clearTimeout(this.mobileTooltipTimeouts[id]);
      }
    });
    
    // Reset all tooltip states
    this.mobileTooltipTimeouts = {};
    this.mobileTooltipStates = {};
  }

  isMobileTooltipVisible(extraServiceId: number): boolean {
    return this.mobileTooltipStates[extraServiceId] || false;
  }

  // Check if currently on mobile
  isCurrentlyMobile(): boolean {
    return this.isBrowser ? window.innerWidth <= 768 : false;
  }

  updateExtraServiceQuantity(extraService: ExtraService, quantity: number) {
    const selected = this.selectedExtraServices.find(s => s.extraService.id === extraService.id);
    if (selected && quantity >= 1) {
      selected.quantity = quantity;
      this.calculateTotal();
      this.saveFormData(); // Save form data immediately when quantity changes
    }
  }

  updateExtraServiceHours(extraService: ExtraService, hours: number) {
    const selected = this.selectedExtraServices.find(s => s.extraService.id === extraService.id);
    if (selected && hours >= 0.5) {
      selected.hours = hours;
      this.calculateTotal();
      this.saveFormData(); // Save form data immediately when hours change
    }
  }

  isExtraServiceSelected(extraService: ExtraService): boolean {
    return this.selectedExtraServices.some(s => s.extraService.id === extraService.id);
  }

  getExtraServiceQuantity(extraService: ExtraService): number {
    const selected = this.selectedExtraServices.find(s => s.extraService.id === extraService.id);
    return selected ? selected.quantity : 1;
  }

  getExtraServiceHours(extraService: ExtraService): number {
    const selected = this.selectedExtraServices.find(s => s.extraService.id === extraService.id);
    return selected ? selected.hours : 0.5;
  }

  getExtraServicePrice(extraService: ExtraService): number {
    const selected = this.selectedExtraServices.find(s => s.extraService.id === extraService.id);
    
    // Get price multiplier based on cleaning type
    let priceMultiplier = 1;
    const deepCleaning = this.selectedExtraServices.find(s => s.extraService.isDeepCleaning);
    const superDeepCleaning = this.selectedExtraServices.find(s => s.extraService.isSuperDeepCleaning);

    if (superDeepCleaning) {
      priceMultiplier = superDeepCleaning.extraService.priceMultiplier;
    } else if (deepCleaning) {
      priceMultiplier = deepCleaning.extraService.priceMultiplier;
    }

    // Apply multiplier (except for same day service)
    const currentMultiplier = extraService.isSameDayService ? 1 : priceMultiplier;

    // Calculate price based on type
    if (extraService.hasHours) {
      // For hours-based services, use selected hours or default to 0.5
      const hours = selected ? selected.hours : 0.5;
      return extraService.price * hours * currentMultiplier;
    } else if (extraService.hasQuantity) {
      // For quantity-based services, use selected quantity or default to 1
      const quantity = selected ? selected.quantity : 1;
      return extraService.price * quantity * currentMultiplier;
    } else {
      return extraService.price * currentMultiplier;
    }
  }

  getExtraServiceDuration(extraService: ExtraService): number {
    const selected = this.selectedExtraServices.find(s => s.extraService.id === extraService.id);
    
    // Calculate duration based on type
    if (extraService.hasHours) {
      // For hours-based services, use selected hours or default to 0.5
      const hours = selected ? selected.hours : 0.5;
      return extraService.duration * hours;
    } else if (extraService.hasQuantity) {
      // For quantity-based services, use selected quantity or default to 1
      const quantity = selected ? selected.quantity : 1;
      return extraService.duration * quantity;
    } else {
      return extraService.duration;
    }
  }

  getServicePrice(service: Service, quantity: number): number {
    // Get price multiplier based on cleaning type
    let priceMultiplier = 1;
    const deepCleaning = this.selectedExtraServices.find(s => s.extraService.isDeepCleaning);
    const superDeepCleaning = this.selectedExtraServices.find(s => s.extraService.isSuperDeepCleaning);

    if (superDeepCleaning) {
      priceMultiplier = superDeepCleaning.extraService.priceMultiplier;
    } else if (deepCleaning) {
      priceMultiplier = deepCleaning.extraService.priceMultiplier;
    }

    // Special handling for studio apartment (bedrooms = 0)
    if (service.serviceKey === 'bedrooms' && quantity === 0) {
      return 10 * priceMultiplier; // $10 base price for studio, adjusted by cleaning type
    }

    // Apply multiplier to service cost
    return service.cost * quantity * priceMultiplier;
  }



  selectSubscription(subscription: Subscription) {
    this.selectedSubscription = subscription;
    this.calculateTotal();
    this.saveFormData(); // Persist selected subscription
    
    // Show mobile tooltip for subscription
    this.showMobileTooltip(subscription.id);
  }

  applyPromoCode() {
    // Check if the control is disabled
    if (this.promoCode.disabled) {
      return;
    }

    const code = this.promoCode.value;
    if (!code) return;

    this.summaryCodeActionInProgress = true;
    setTimeout(() => { this.summaryCodeActionInProgress = false; }, 1500);

    // If special offer is already applied, show error
    if (this.specialOfferApplied) {
      this.errorMessage = 'Cannot apply promo code when a special offer is already applied. Please remove the special offer first.';
      return;
    }

    // Keep your existing first-time discount check as is
    if (this.firstTimeDiscountApplied) {
      this.errorMessage = 'Cannot apply promo code when first-time discount is already applied. Please remove the first-time discount first.';
      return;
    }

    // Clear any previous error
    this.errorMessage = '';

    this.bookingService.validatePromoCode(code).subscribe({
      next: (validation) => {
        if (validation.isValid) {
          // Ensure the promo code value is preserved in the FormControl
          if (this.promoCode.value !== code) {
            this.promoCode.setValue(code, { emitEvent: false });
          }
          
          if (validation.isGiftCard) {
            // Handle gift card
            this.isGiftCard = true;
            this.giftCardApplied = true;
            this.giftCardBalance = validation.availableBalance || 0;
            this.promoCodeApplied = false; // Gift cards don't use promo system
          } else {
            // Your existing promo code logic stays exactly the same
            this.isGiftCard = false;
            this.giftCardApplied = false;
            this.promoCodeApplied = true;
            this.promoDiscount = validation.discountValue;
            this.promoIsPercentage = validation.isPercentage;
          }
          
          this.calculateTotal();
        } else {
          this.errorMessage = validation.message || 'Invalid promo code';
        }
      },
      error: () => {
        this.errorMessage = 'Failed to validate promo code';
      }
    });
  }

  applyFirstTimeDiscount() {
    // If promo code is already applied, show error
    if (this.promoCodeApplied) {
      this.errorMessage = 'Cannot apply first-time discount when a promo code is already applied. Please remove the promo code first.';
      return;
    }
    
    this.firstTimeDiscountApplied = true;
    // Disable the promo code input
    this.promoCode.disable();
    this.errorMessage = '';
    this.calculateTotal();
  }

  private updateDateRestrictions() {
    if (this.isSameDaySelected) {
      const today = this.getNowInNewYork();

      // Format date properly for HTML date input (YYYY-MM-DD)
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      const day = String(today.getDate()).padStart(2, '0');
      const formattedDate = `${year}-${month}-${day}`;

      // Always set date to today when same-day is selected,
      // even if fully booked — so user sees the "fully booked" warning
      this.serviceDate.setValue(formattedDate);

      // Update time to earliest available non-blocked time for same day service
      setTimeout(() => {
        const availableSlots = this.getAvailableTimeSlots();
        const blockedHours = this.getBlockedHoursForSelectedDate();
        const blockedSet = new Set(blockedHours);
        // Find first available slot that is not blocked
        const firstAvailable = availableSlots.find(slot => !blockedSet.has(slot));
        if (firstAvailable) {
          this.serviceTime.setValue(firstAvailable);
        } else if (availableSlots.length > 0) {
          this.serviceTime.setValue(availableSlots[0]);
        }
      }, 100); // Small delay to ensure date change is processed first
    }
    // Don't automatically change the date when same day service is unchecked
    // Let the user manually select a date or uncheck the service
  }

  private fillApartmentAddress(apartmentId: string) {
    const apartment = this.userApartments.find(a => a.id === +apartmentId);
    if (apartment) {
      // First set the state and load cities
      this.bookingForm.patchValue({
        state: apartment.state
      });
      
      // Load cities for the state, then set the rest of the address
      this.locationService.getCities(apartment.state).subscribe({
        next: (cities) => {
          this.cities = cities;
          
          // Now set all address fields including city and address name (required)
          this.bookingForm.patchValue({
            serviceAddress: apartment.address,
            apartmentName: apartment.name || '',
            aptSuite: apartment.aptSuite || '',
            city: apartment.city,
            zipCode: apartment.postalCode
          });
          this.addressNameIsCustomized = true; // saved address uses its stored name
        }
      });
    }
  }

  calculateTotal() {
    let subTotal = 0;
    let totalDuration = 0;
    let actualTotalDuration = 0;
    let deepCleaningFee = 0;
    let displayDuration = 0;
    let useExplicitHours = false;

    // ADD THIS BLOCK FOR CUSTOM PRICING
    if (this.showCustomPricing && this.customAmount.value) {
      // For custom pricing, use the custom values directly
      subTotal = parseFloat(this.customAmount.value) || 0;

      // Parse and log duration
      const parsedDuration = parseInt(this.customDuration.value);

      // IMPORTANT: Parse duration as integer
      actualTotalDuration = parsedDuration || 90;
      totalDuration = actualTotalDuration; // Add this line
      displayDuration = actualTotalDuration;
      
      
      // Parse cleaners as integer
      this.calculatedMaidsCount = parseInt(this.customCleaners.value) || 1;
    
      // Store the actual total duration for backend
      this.actualTotalDuration = actualTotalDuration;
    
      // Skip all the complex calculations for custom pricing
      // Jump straight to discount calculations
    
      // Reset discount amounts
      this.subscriptionDiscountAmount = 0;
      this.promoOrFirstTimeDiscountAmount = 0;
    
      // Calculate subscription discount if applicable
      // Use selectedSubscription's discountPercentage if user has active subscription and selected subscription matches
      if (this.hasActiveSubscription && this.userSubscription && this.selectedSubscription) {
        // Check if selected subscription matches user's active subscription
        const userSubscriptionDays = this.getSubscriptionDaysForSubscription(this.userSubscription.subscriptionName);
        const selectedSubscriptionDays = this.selectedSubscription.subscriptionDays || 0;
        
        if (userSubscriptionDays === selectedSubscriptionDays && selectedSubscriptionDays > 0) {
          // User has active subscription and selected subscription matches - use selected subscription's discount
          this.subscriptionDiscountAmount = Math.round(subTotal * (this.selectedSubscription.discountPercentage / 100) * 100) / 100;
        } else {
          // Selected subscription doesn't match user's active subscription - no discount
          this.subscriptionDiscountAmount = 0;
        }
      } else {
        this.subscriptionDiscountAmount = 0;
      }
    
      // Calculate promo or first-time discount
      if (this.specialOfferApplied && this.selectedSpecialOffer) {
        const offer = this.selectedSpecialOffer;
        if (offer.isPercentage) {
          this.promoOrFirstTimeDiscountAmount = Math.round(subTotal * (offer.discountValue / 100) * 100) / 100;
        } else {
          this.promoOrFirstTimeDiscountAmount = Math.min(offer.discountValue, subTotal);
        }
      } else if (this.hasFirstTimeDiscount && this.currentUser?.firstTimeOrder && this.firstTimeDiscountApplied) {
        this.promoOrFirstTimeDiscountAmount = Math.round(subTotal * (this.firstTimeDiscountPercentage / 100) * 100) / 100;
      } else if (this.promoCodeApplied && !this.giftCardApplied) {
        if (this.promoIsPercentage) {
          this.promoOrFirstTimeDiscountAmount = Math.round(subTotal * (this.promoDiscount / 100) * 100) / 100;
        } else {
          this.promoOrFirstTimeDiscountAmount = this.promoDiscount;
        }
      }
    
      // Total discount is the sum of both
      const totalDiscountAmount = this.subscriptionDiscountAmount + this.promoOrFirstTimeDiscountAmount;    
    
      // Calculate tax on discounted subtotal
      const discountedSubTotal = subTotal - totalDiscountAmount;
      const tax = Math.round(discountedSubTotal * this.salesTaxRate * 100) / 100;
    
      // Get tips
      const tips = this.tips.value || 0;
      const companyDevelopmentTips = this.companyDevelopmentTips.value || 0;
      const totalTips = tips + companyDevelopmentTips;
    
      // Calculate total
      const total = discountedSubTotal + tax + totalTips;

      // Apply gift card if applicable
      let finalTotal = total;
      if (this.giftCardApplied && this.isGiftCard) {
        this.giftCardAmountToUse = Math.min(this.giftCardBalance, total);
        finalTotal = Math.max(0, total - this.giftCardAmountToUse);
      }

      // Apply bubble points discount
      if (this.selectedPointsToRedeem > 0 && this.pointsDiscountAmount > 0) {
        finalTotal = Math.max(0, finalTotal - this.pointsDiscountAmount);
      }

      // Apply bubble credits
      if (this.useCredits && this.userBubbleCredits > 0) {
        finalTotal = Math.max(0, finalTotal - this.userBubbleCredits);
      }

      this.calculation = {
        subTotal: Math.round(subTotal * 100) / 100,
        tax,
        discountAmount: totalDiscountAmount,
        tips: totalTips,
        total: Math.round(finalTotal * 100) / 100,
        totalDuration: displayDuration
      };

      // Calculate next order's total if needed
      if (this.selectedSubscription && this.selectedSubscription.subscriptionDays > 0 && !this.hasActiveSubscription) {
        const nextOrderDiscountPercentage = this.selectedSubscription.discountPercentage;
        this.nextOrderDiscount = Math.round(subTotal * (nextOrderDiscountPercentage / 100) * 100) / 100;
        const nextOrderDiscountedSubTotal = subTotal - this.nextOrderDiscount;
        const nextOrderTax = Math.round(nextOrderDiscountedSubTotal * this.salesTaxRate * 100) / 100;
        this.nextOrderTotal = nextOrderDiscountedSubTotal + nextOrderTax;
      } else {
        this.nextOrderDiscount = 0;
        this.nextOrderTotal = 0;
      }
    
      return; // Exit early for custom pricing
    }

    // Check for deep cleaning multipliers FIRST
    let priceMultiplier = 1;

    const deepCleaning = this.selectedExtraServices.find(s => s.extraService.isDeepCleaning);
    const superDeepCleaning = this.selectedExtraServices.find(s => s.extraService.isSuperDeepCleaning);

    if (superDeepCleaning) {
      priceMultiplier = superDeepCleaning.extraService.priceMultiplier;
      deepCleaningFee = superDeepCleaning.extraService.price;
    } else if (deepCleaning) {
      priceMultiplier = deepCleaning.extraService.priceMultiplier;
      deepCleaningFee = deepCleaning.extraService.price;
    }

    // Calculate base price with multiplier
    if (this.selectedServiceType) {
      subTotal += this.selectedServiceType.basePrice * priceMultiplier;

      // ADD THIS LINE - Add service type's base duration
      if (!useExplicitHours) {
        totalDuration += this.selectedServiceType.timeDuration || 0;
        actualTotalDuration += this.selectedServiceType.timeDuration || 0;
      }
    }

    // Check if we have cleaner-hours relationship
    const hasCleanerService = this.selectedServices.some(s => 
      s.service.serviceRelationType === 'cleaner'
    );
    const hoursService = this.selectedServices.find(s => 
      s.service.serviceRelationType === 'hours'
    );

    // If we have both cleaner and hours services, use hours as the duration
    if (hasCleanerService && hoursService) {
      useExplicitHours = true;
      actualTotalDuration = hoursService.quantity * 60;
      totalDuration = actualTotalDuration;
    }

    // Calculate service costs
    this.selectedServices.forEach(selected => {
      if (selected.service.serviceRelationType === 'cleaner') {
        if (hoursService) {
          const hours = hoursService.quantity;
          const cleaners = selected.quantity;
          const costPerCleanerPerHour = selected.service.cost * priceMultiplier;
          const cost = costPerCleanerPerHour * cleaners * hours;
          subTotal += cost;
        }
      } else if (selected.service.serviceKey === 'bedrooms' && selected.quantity === 0) {
        const cost = this.getServicePrice(selected.service, 0);
        subTotal += cost;
        if (!useExplicitHours) {
          const studioDuration = this.getServiceDuration(selected.service);
          totalDuration += studioDuration;
          actualTotalDuration += studioDuration;
        }
      } else if (selected.service.serviceRelationType !== 'hours') {
        const cost = selected.service.cost * selected.quantity * priceMultiplier;
        subTotal += cost;
        if (!useExplicitHours) {
          const serviceDuration = selected.service.timeDuration * selected.quantity;
          totalDuration += serviceDuration;
          actualTotalDuration += serviceDuration;
        }
      }
    });

    // Calculate extra service costs
    this.selectedExtraServices.forEach(selected => {
      if (!selected.extraService.isDeepCleaning && !selected.extraService.isSuperDeepCleaning) {
        const currentMultiplier = selected.extraService.isSameDayService ? 1 : priceMultiplier;
        
        if (selected.extraService.hasHours) {
          subTotal += selected.extraService.price * selected.hours * currentMultiplier;
          if (!useExplicitHours) {
            const extraDuration = selected.extraService.duration * selected.hours;
            totalDuration += extraDuration;
            actualTotalDuration += extraDuration;
          }
        } else if (selected.extraService.hasQuantity) {
          subTotal += selected.extraService.price * selected.quantity * currentMultiplier;
          if (!useExplicitHours) {
            const extraDuration = selected.extraService.duration * selected.quantity;
            totalDuration += extraDuration;
            actualTotalDuration += extraDuration;
          }
        } else {
          subTotal += selected.extraService.price * currentMultiplier;
          if (!useExplicitHours) {
            totalDuration += selected.extraService.duration;
            actualTotalDuration += selected.extraService.duration;
          }
        }
      } else {
        if (!useExplicitHours) {
          totalDuration += selected.extraService.duration;
          actualTotalDuration += selected.extraService.duration;
        }
      }
    });

    // Calculate extra cleaners FIRST
    const extraCleaners = this.getExtraCleanersCount();

    // Calculate base maids count (without extra cleaners)
    let baseMaidsCount = 1;

    if (hasCleanerService) {
      const cleanerService = this.selectedServices.find(s => 
        s.service.serviceRelationType === 'cleaner'
      );
      if (cleanerService) {
        baseMaidsCount = cleanerService.quantity;
      }
      // When cleaners are explicitly selected, use actual duration without division initially
      displayDuration = actualTotalDuration;
    } else {
      const totalHours = totalDuration / 60;
      if (totalHours <= 6) {
        baseMaidsCount = 1;
        displayDuration = totalDuration;
      } else {
        baseMaidsCount = Math.ceil(totalHours / 6);
        displayDuration = totalDuration; // Don't divide yet
      }
    }

    // NOW add extra cleaners to get total maid count
    this.calculatedMaidsCount = baseMaidsCount + extraCleaners;
      
    // FINALLY divide duration by TOTAL maid count (including extra cleaners)
    if (this.calculatedMaidsCount > 1 && !hasCleanerService) {
      // Only divide duration when we have multiple maids and no explicit cleaner service
      displayDuration = Math.ceil(totalDuration / this.calculatedMaidsCount);
    } else if (hasCleanerService && this.calculatedMaidsCount > baseMaidsCount) {
      // If we have explicit cleaners AND extra cleaners, divide by total count
      displayDuration = Math.ceil(actualTotalDuration / this.calculatedMaidsCount);
    }
    
    // Ensure display duration never goes below 1 hour (60 minutes)
    displayDuration = Math.max(displayDuration, 60);

    // Store the actual total duration for backend - ensure minimum 1 hour
    this.actualTotalDuration = Math.max(actualTotalDuration, 60);

    // Add deep cleaning fee AFTER discounts are calculated
    subTotal += deepCleaningFee;

    // Reset discount amounts
    this.subscriptionDiscountAmount = 0;
    this.promoOrFirstTimeDiscountAmount = 0;

    // Calculate subscription discount if applicable
    // Use selectedSubscription's discountPercentage if user has active subscription and selected subscription matches
    if (this.hasActiveSubscription && this.userSubscription && this.selectedSubscription) {
      // Check if selected subscription matches user's active subscription
      const userSubscriptionDays = this.getSubscriptionDaysForSubscription(this.userSubscription.subscriptionName);
      const selectedSubscriptionDays = this.selectedSubscription.subscriptionDays || 0;
      
      if (userSubscriptionDays === selectedSubscriptionDays && selectedSubscriptionDays > 0) {
        // User has active subscription and selected subscription matches - use selected subscription's discount
        this.subscriptionDiscountAmount = Math.round(subTotal * (this.selectedSubscription.discountPercentage / 100) * 100) / 100;
      } else {
        // Selected subscription doesn't match user's active subscription - no discount
        this.subscriptionDiscountAmount = 0;
      }
    } else {
      this.subscriptionDiscountAmount = 0;
    }

    // Calculate promo or first-time discount (can stack with subscription)
    if (this.specialOfferApplied && this.selectedSpecialOffer) {
      // Use selected special offer
      const offer = this.selectedSpecialOffer;
      if (offer.isPercentage) {
        this.promoOrFirstTimeDiscountAmount = Math.round(subTotal * (offer.discountValue / 100) * 100) / 100;
      } else {
        this.promoOrFirstTimeDiscountAmount = Math.min(offer.discountValue, subTotal);
      }
    } else if (this.hasFirstTimeDiscount && this.currentUser?.firstTimeOrder && this.firstTimeDiscountApplied) {
      // Old logic for backward compatibility
      this.promoOrFirstTimeDiscountAmount = Math.round(subTotal * (this.firstTimeDiscountPercentage / 100) * 100) / 100;
    } else if (this.promoCodeApplied && !this.giftCardApplied) {
      if (this.promoIsPercentage) {
        this.promoOrFirstTimeDiscountAmount = Math.round(subTotal * (this.promoDiscount / 100) * 100) / 100;
      } else {
        this.promoOrFirstTimeDiscountAmount = this.promoDiscount;
      }
    }

    // Total discount is the sum of both
    const totalDiscountAmount = this.subscriptionDiscountAmount + this.promoOrFirstTimeDiscountAmount;    

    // Calculate tax on discounted subtotal
    const discountedSubTotal = subTotal - totalDiscountAmount;
    const tax = Math.round(discountedSubTotal * this.salesTaxRate * 100) / 100;

    // Get tips
    const tips = this.tips.value || 0;
    const companyDevelopmentTips = this.companyDevelopmentTips.value || 0;
    const totalTips = tips + companyDevelopmentTips;
      
    // Calculate total
    const total = discountedSubTotal + tax + totalTips;

    // Apply gift card if applicable
    let finalTotal = total;
    if (this.giftCardApplied && this.isGiftCard) {
      this.giftCardAmountToUse = Math.min(this.giftCardBalance, total);
      finalTotal = Math.max(0, total - this.giftCardAmountToUse);
    }

    // Apply bubble points discount
    if (this.selectedPointsToRedeem > 0 && this.pointsDiscountAmount > 0) {
      finalTotal = Math.max(0, finalTotal - this.pointsDiscountAmount);
    }

    // Apply bubble credits
    if (this.useCredits && this.userBubbleCredits > 0) {
      finalTotal = Math.max(0, finalTotal - this.userBubbleCredits);
    }

    // For display, when using explicit hours, show the hours directly
    if (useExplicitHours && hoursService) {
      displayDuration = hoursService.quantity * 60;
    }

    this.calculation = {
      subTotal: Math.round(subTotal * 100) / 100,
      tax,
      discountAmount: totalDiscountAmount,
      tips: totalTips,
      total: Math.round(finalTotal * 100) / 100,
      totalDuration: displayDuration
    };

    // Calculate next order's total with subscription discount
    if (this.selectedSubscription && this.selectedSubscription.subscriptionDays > 0 && !this.hasActiveSubscription) {
    const nextOrderDiscountPercentage = this.selectedSubscription.discountPercentage;
    this.nextOrderDiscount = Math.round(subTotal * (nextOrderDiscountPercentage / 100) * 100) / 100;
    
    // Calculate tax on the discounted subtotal for next order
    const nextOrderDiscountedSubTotal = subTotal - this.nextOrderDiscount;
    const nextOrderTax = Math.round(nextOrderDiscountedSubTotal * this.salesTaxRate * 100) / 100;
    
    this.nextOrderTotal = nextOrderDiscountedSubTotal + nextOrderTax;
    } else {
      this.nextOrderDiscount = 0;
      this.nextOrderTotal = 0;
    }
  }

  // Get cleaner pricing text
  getCleanerPricingText(): string {
    const deepCleaning = this.selectedExtraServices.find(s => s.extraService.isDeepCleaning);
    const superDeepCleaning = this.selectedExtraServices.find(s => s.extraService.isSuperDeepCleaning);
    const pricePerHour = this.getCleanerPricePerHour();
    
    if (superDeepCleaning) {
      return `Hourly Service: $${pricePerHour} per hour/per cleaner <span class="cleaning-type-red">(Super Deep Cleaning)</span>`;
    } else if (deepCleaning) {
      return `Hourly Service: $${pricePerHour} per hour/per cleaner <span class="cleaning-type-red">(Deep Cleaning)</span>`;
    }
    return `Hourly Service: $${pricePerHour} per hour/per cleaner`;
  }

  // Get cleaner cost display
  getCleanerCostDisplay(cleanerCount: number): string {
    const pricePerHour = this.getCleanerPricePerHour();
    const hoursService = this.selectedServices.find(s => s.service.serviceRelationType === 'hours');
    const hours = hoursService ? hoursService.quantity : 0;
    
    if (hours === 0) {
      return `${cleanerCount} cleaner${cleanerCount > 1 ? 's' : ''} × ${pricePerHour}/hour`;
    } else {
      const totalCost = cleanerCount * hours * pricePerHour;
      return `${cleanerCount} × ${hours}h × ${pricePerHour} = ${totalCost}`;
    }
  }

  // Get hours cost display
  getHoursCostDisplay(hours: number): string {
    const pricePerHour = this.getCleanerPricePerHour();
    const cleanersService = this.selectedServices.find(s => s.service.serviceRelationType === 'cleaner');
    const cleaners = cleanersService ? cleanersService.quantity : 0;
    
    if (cleaners === 0) {
      return `${hours} hour${hours > 1 ? 's' : ''}`;
    } else {
      const totalCost = cleaners * hours * pricePerHour;
      return `${cleaners} cleaner${cleaners > 1 ? 's' : ''} × ${hours}h = ${totalCost}`;
    }
  }

  // Check if we have cleaner services
  hasCleanerServices(): boolean {
    return this.selectedServices.some(s => s.service.serviceRelationType === 'cleaner');
  }

  hasBedroomsService(): boolean {
    return this.selectedServices.some(s => s.service.serviceKey === 'bedrooms');
  }

  hasBathroomsService(): boolean {
    return this.selectedServices.some(s => s.service.serviceKey === 'bathrooms');
  }

  shouldShowStandaloneBedroomBathroom(): boolean {
    if (!this.selectedServiceType || this.showPollForm || this.showCustomPricing) return false;
    const hasCleaner = this.selectedServices.some(s => s.service.serviceRelationType === 'cleaner');
    const hasHours = this.selectedServices.some(s => s.service.serviceRelationType === 'hours');
    return hasCleaner && hasHours && !this.hasBedroomsService() && !this.hasBathroomsService();
  }

  private syncStandaloneBedroomBathroomFromServices(): void {
    const bedrooms = this.selectedServices.find(s => s.service.serviceKey === 'bedrooms');
    const bathrooms = this.selectedServices.find(s => s.service.serviceKey === 'bathrooms');
    if (bedrooms) this.bedroomsQuantityControl.setValue(bedrooms.quantity, { emitEvent: false });
    if (bathrooms) this.bathroomsQuantityControl.setValue(bathrooms.quantity, { emitEvent: false });
  }

  getSelectedBedroomsQuantity(): number | undefined {
    if (this.showPollForm) return undefined;
    if (this.showCustomPricing || this.shouldShowStandaloneBedroomBathroom()) {
      return Number(this.bedroomsQuantityControl.value);
    }
    const bedrooms = this.selectedServices.find(s => s.service.serviceKey === 'bedrooms');
    return bedrooms ? bedrooms.quantity : undefined;
  }

  getSelectedBathroomsQuantity(): number | undefined {
    if (this.showPollForm) return undefined;
    if (this.showCustomPricing || this.shouldShowStandaloneBedroomBathroom()) {
      return Number(this.bathroomsQuantityControl.value);
    }
    const bathrooms = this.selectedServices.find(s => s.service.serviceKey === 'bathrooms');
    return bathrooms ? bathrooms.quantity : undefined;
  }

  onStandaloneQuantityChange(): void {
    this.saveFormData();
  }

  // Get cleaner price per hour based on cleaning type
  getCleanerPricePerHour(): number {
    // Get the actual cleaner service cost from the selected services
    const cleanerService = this.selectedServices.find(s => s.service.serviceRelationType === 'cleaner');
    const basePrice = cleanerService ? cleanerService.service.cost : 40; // fallback to 40 if no cleaner service found
    
    const deepCleaning = this.selectedExtraServices.find(s => s.extraService.isDeepCleaning);
    const superDeepCleaning = this.selectedExtraServices.find(s => s.extraService.isSuperDeepCleaning);
    
    if (superDeepCleaning) {
      return basePrice * superDeepCleaning.extraService.priceMultiplier;
    } else if (deepCleaning) {
      return basePrice * deepCleaning.extraService.priceMultiplier;
    }
    
    return basePrice; // regular cleaning - no multiplier
  }

  getExtraCleanersCount(): number {
    const extraCleanersService = this.selectedExtraServices.find(s => 
      s.extraService.name === 'Extra Cleaners' && s.extraService.hasQuantity
    );
    return extraCleanersService ? extraCleanersService.quantity : 0;
  }

  formatDuration(minutes: number): string {
    // Use rounded duration
    const baseFormat = DurationUtils.formatDurationRounded(minutes);
    
    // Preserve your "per maid" logic
    if (this.calculatedMaidsCount > 1) {
      return `${baseFormat} per maid`;
    }
    return baseFormat;
  }
  
  formatServiceDuration(minutes: number): string {
    // Use actual duration for individual services
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    
    if (hours === 0) {
      return `${mins}m`;
    } else if (mins === 0) {
      return `${hours}h`;
    } else {
      return `${hours}h ${mins}m`;
    }
  }

  formatTime(time: string): string {
    if (!time) return '';
    const [hours, minutes] = time.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    const formatted = `${hour12}:${minutes} ${ampm}`;
    return formatted;
  }

  getServiceDuration(service: Service): number {
    const quantity = this.getServiceQuantity(service);
    
    // Get duration multiplier based on cleaning type
    let durationMultiplier = 1;
    const deepCleaning = this.selectedExtraServices.find(s => s.extraService.isDeepCleaning);
    const superDeepCleaning = this.selectedExtraServices.find(s => s.extraService.isSuperDeepCleaning);

    if (superDeepCleaning) {
      durationMultiplier = superDeepCleaning.extraService.priceMultiplier;
    } else if (deepCleaning) {
      durationMultiplier = deepCleaning.extraService.priceMultiplier;
    }
    
    if (service.serviceKey === 'bedrooms' && quantity === 0) {
      return Math.round(20 * durationMultiplier); // 20 minutes base for studio, adjusted by cleaning type
    }
    
    // For most services, duration should be multiplied by quantity
    // But for cleaner and hours services, we don't multiply as they have special logic
    if (service.serviceRelationType === 'cleaner' || service.serviceRelationType === 'hours') {
      return Math.round(service.timeDuration * durationMultiplier);
    }
    
    return Math.round(service.timeDuration * quantity * durationMultiplier);
  }

  getServiceQuantity(service: Service): number {
    const selected = this.selectedServices.find(s => s.service.id === service.id);
    return selected ? selected.quantity : (service.minValue || 0);
  }

  isFormValid(): boolean {
    if (this.showPollForm) {
      return this.isPollFormValid();
    }
    
    // Check custom pricing validation if applicable
    if (this.showCustomPricing) {
      return this.bookingForm.valid && 
             this.serviceTypeControl.valid &&
             this.selectedServiceType !== null && 
             this.selectedSubscription !== null && 
             this.cleaningType.value !== null &&
             this.smsConsent.value === true &&
             this.cancellationConsent.value === true &&
             this.customAmount.valid &&
             this.customCleaners.valid &&
             this.customDuration.valid &&
             this.entryMethod.value;
    }
    
    return this.bookingForm.valid && 
           this.serviceTypeControl.valid &&
           this.selectedServiceType !== null && 
           this.selectedSubscription !== null && 
           this.cleaningType.value !== null &&
           this.smsConsent.value === true &&
           this.cancellationConsent.value === true;
  }

  onSubmit() {
    if (this.showPollForm) {
      this.submitPollForm();
      return;
    }

    // Check if admin mode is enabled and user is selected
    if (this.isAdminMode) {
      if (!this.selectedTargetUser) {
        this.errorMessage = 'Please select a user to create booking for';
        this.scrollToFirstError();
        return;
      }
      // Admins/Moderators don't need to be logged in as themselves, but they need to be authenticated
      if (!this.authService.isLoggedIn() || !this.isAdmin) {
        this.errorMessage = 'You must be logged in as an admin or moderator to create bookings for users';
        return;
      }
    }

    // Set form submitted flag
    this.formSubmitted = true;
    
    // Check if the form is valid
    if (!this.bookingForm.valid || !this.selectedServiceType || !this.selectedSubscription || !this.cleaningType.value) {
      this.scrollToFirstError();
      return;
    }
    
    // Also check custom pricing fields if applicable
    if (this.showCustomPricing && (!this.customAmount.valid || !this.customCleaners.valid || !this.customDuration.valid || !this.entryMethod.value)) {
      this.scrollToFirstError();
      return;
    }
  
    this.isLoading = true;
    
    // Get form values, including disabled fields
    const formValue = this.bookingForm.getRawValue();
    
    // Check if serviceDate exists
    if (!formValue.serviceDate) {
      this.errorMessage = 'Please select a service date';
      this.isLoading = false;
      return;
    }
    
    // Parse the date string and create a proper Date object
    let serviceDate: Date;
    
    if (typeof formValue.serviceDate === 'string') {
      const dateParts = formValue.serviceDate.split('-');
      if (dateParts.length === 3) {
        const [year, month, day] = dateParts.map(Number);
        serviceDate = new Date(year, month - 1, day); // month is 0-indexed in JS Date
      } else {
        this.errorMessage = 'Invalid date format';
        this.isLoading = false;
        return;
      }
    } else if (formValue.serviceDate instanceof Date) {
      serviceDate = formValue.serviceDate;
    } else {
      this.errorMessage = 'Invalid date format';
      this.isLoading = false;
      return;
    }
    
    // Determine apartmentId and apartmentName based on whether using saved apartment
    let apartmentId: number | null = null;
    let apartmentName: string | undefined = undefined;
    
    if (formValue.selectedApartmentId) {
      // Using a saved apartment
      apartmentId = Number(formValue.selectedApartmentId);
      // Find the apartment name from the selected apartment
      const selectedApartment = this.userApartments.find(a => a.id === apartmentId);
      if (selectedApartment) {
        apartmentName = selectedApartment.name;
      }
    } else if (formValue.apartmentName) {
      // Entering a new apartment
      apartmentName = formValue.apartmentName;
      // apartmentId remains null for new apartments
    }

    const shouldApplySubscriptionDiscount = this.hasActiveSubscription && 
    this.userSubscription && 
    this.userSubscription.discountPercentage > 0;

    
    const bookingData = {
      serviceTypeId: this.selectedServiceType.id,
      orderDate: new Date(), 
      services: this.selectedServices.map(s => ({
        serviceId: s.service.id,
        quantity: s.quantity
      })),
      extraServices: this.selectedExtraServices.map(s => ({
        extraServiceId: s.extraService.id,
        quantity: s.quantity,
        hours: s.hours
      })),
      subscriptionId: this.selectedSubscription.id,
      serviceDate: formValue.serviceDate,
      serviceTime: formValue.serviceTime,
      entryMethod: formValue.entryMethod === 'Other' 
        ? formValue.customEntryMethod 
        : formValue.entryMethod,
      specialInstructions: formValue.specialInstructions,
      contactFirstName: formValue.contactFirstName,
      contactLastName: formValue.contactLastName,
      contactEmail: formValue.contactEmail,
      contactPhone: formValue.contactPhone,
      serviceAddress: formValue.serviceAddress,
      aptSuite: formValue.aptSuite,
      city: formValue.city,
      state: formValue.state,
      zipCode: formValue.zipCode,
      apartmentId: apartmentId,
      apartmentName: apartmentName,
      promoCode: this.giftCardApplied && this.isGiftCard ? null : 
         (this.specialOfferApplied && this.selectedSpecialOffer ? null :
         (this.firstTimeDiscountApplied && !formValue.promoCode ? 'firstUse' : formValue.promoCode)),
      specialOfferId: this.specialOfferApplied ? this.selectedSpecialOffer?.specialOfferId : undefined,
      userSpecialOfferId: this.specialOfferApplied && this.selectedSpecialOffer && this.authService.isLoggedIn() ? this.selectedSpecialOffer.id : undefined,
      tips: formValue.tips,
      companyDevelopmentTips: formValue.companyDevelopmentTips,
      maidsCount: this.showCustomPricing ? parseInt(this.customCleaners.value) : this.calculatedMaidsCount,
      discountAmount: this.promoOrFirstTimeDiscountAmount,
      subscriptionDiscountAmount: shouldApplySubscriptionDiscount ? this.subscriptionDiscountAmount : 0,
      subTotal: this.calculation.subTotal,
      // ADD THESE FIELDS TO FIX THE ISSUE:
      tax: this.calculation.tax,
      total: this.calculation.total,
      calculation: this.calculation, // Add the full calculation object
      // For custom pricing, store TotalDuration as TOTAL cleaner-minutes (per-cleaner duration × cleaners),
      // matching the convention used by non-custom orders. Booking summary still shows per-cleaner via
      // calculation.totalDuration / formatDuration which appends "per maid".
      totalDuration: this.showCustomPricing
        ? Math.max(parseInt(this.customDuration.value) * (parseInt(this.customCleaners.value) || 1), 60)
        : this.actualTotalDuration,
      hasActiveSubscription: this.hasActiveSubscription,
      userSubscriptionId: this.userSubscription?.subscriptionId,
      giftCardCode: this.giftCardApplied && this.isGiftCard ? this.promoCode.value : null,
      giftCardAmountToUse: this.giftCardApplied ? this.giftCardAmountToUse : 0,
      isCustomPricing: this.showCustomPricing,
      customAmount: this.showCustomPricing ? parseFloat(this.customAmount.value) : undefined,
      customCleaners: this.showCustomPricing ? parseInt(this.customCleaners.value) : undefined,
      customDuration: this.showCustomPricing ? parseInt(this.customDuration.value) : undefined,
      bedroomsQuantity: this.getSelectedBedroomsQuantity(),
      bathroomsQuantity: this.getSelectedBathroomsQuantity(),
      smsConsent: formValue.smsConsent,
      cancellationConsent: formValue.cancellationConsent,
      uploadedPhotos: this.preparePhotosForSubmission(),
      floorTypes: this.buildFloorTypesString(),
      floorTypeOther: this.floorTypeOther || null,
      pointsToRedeem: this.selectedPointsToRedeem,
      useCredits: this.useCredits && this.userBubbleCredits > 0,
      creditsToApply: this.useCredits ? Math.min(this.userBubbleCredits, this.calculation.total + this.userBubbleCredits) : 0,
      referralCode: this.isBrowser
        ? (localStorage.getItem('dreamcleaning_referral') ?? undefined)
        : undefined,
    };

    // If admin mode, create booking for target user (unpaid)
    if (this.isAdminMode && this.selectedTargetUser) {
      this.bookingService.createBookingForUser(this.selectedTargetUser.id, bookingData).subscribe({
        next: (response) => {
          this.isLoading = false;
          this.errorMessage = '';
          
          // Show success message
          alert(`Booking created successfully for ${this.selectedTargetUser?.firstName} ${this.selectedTargetUser?.lastName}. Order ID: ${response.orderId}. The user will see this order in their profile and can pay for it.`);
          
          // Reset form
          this.skipSaveOnDestroy = true;
          this.formPersistenceService.markBookingCompleted();
          this.formPersistenceService.clearFormData();
          this.bookingForm.reset();
          this.selectedTargetUser = null;
          this.userSearchTerm = '';
          this.isAdminMode = false;
          
          // Reload page or navigate
          this.router.navigate(['/booking']).then(() => {
            window.location.reload();
          });
        },
        error: (error) => {
          this.isLoading = false;
          this.errorMessage = error.error?.message || 'Failed to create booking for user';
          console.error('Error creating booking for user:', error);
        }
      });
      return;
    }

    // If the user changed their phone number during booking, update their profile
    if (this.currentUser && formValue.contactPhone) {
      const currentPhone = (this.currentUser.phone || '').replace(/\D/g, '').slice(0, 10);
      const newPhone = formValue.contactPhone.replace(/\D/g, '').slice(0, 10);
      if (newPhone && newPhone !== currentPhone) {
        this.profileService.updateProfile({
          firstName: this.currentUser.firstName,
          lastName: this.currentUser.lastName,
          email: this.currentUser.email,
          phone: newPhone
        }).pipe(takeUntil(this.destroy$)).subscribe();
      }
    }

    // Regular flow: Store booking data in service instead of creating order immediately
    this.bookingDataService.setBookingData(bookingData);
    this.isLoading = false;

    // Mark booking as completed and clear form data
    this.skipSaveOnDestroy = true;
    this.formPersistenceService.markBookingCompleted();
    this.formPersistenceService.clearFormData();

    // Navigate to booking confirmation without creating the order yet
    this.router.navigate(['/booking-confirmation']);

    // Clear referral code after guest booking so it isn't re-sent on subsequent bookings
    if (this.isBrowser) {
      localStorage.removeItem('dreamcleaning_referral');
    }
  }

  private scrollToFirstError() {
    // Mark all form controls as touched to trigger validation
    this.markFormGroupTouched(this.bookingForm);
    
    // Mark service type control as touched
    this.serviceTypeControl.markAsTouched();
    
    // Also mark custom pricing controls if applicable
    if (this.showCustomPricing) {
      this.customAmount.markAsTouched();
      this.customCleaners.markAsTouched();
      this.customDuration.markAsTouched();
    }

    // Find the first invalid field and scroll to it
    if (!this.isBrowser) return;
    
    setTimeout(() => {
      // Try multiple selectors to find the first error
      let firstErrorElement = document.querySelector('.ng-invalid.ng-touched');
      
      if (!firstErrorElement) {
        // If no touched invalid elements, look for any invalid elements
        firstErrorElement = document.querySelector('.ng-invalid');
      }
      
      if (!firstErrorElement) {
        // If still no invalid elements, look for required fields that are empty
        const requiredInputs = document.querySelectorAll('input[required], select[required], textarea[required]');
        for (let input of requiredInputs) {
          if (!(input as HTMLInputElement).value) {
            firstErrorElement = input;
            break;
          }
        }
      }
      
      if (firstErrorElement) {
        firstErrorElement.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center' 
        });
        
        // Focus the element if it's an input
        if (firstErrorElement instanceof HTMLInputElement || 
            firstErrorElement instanceof HTMLSelectElement || 
            firstErrorElement instanceof HTMLTextAreaElement) {
          firstErrorElement.focus();
        }
      }
    }, 100);
  }

  private scrollToFirstErrorInCurrentStep() {
    // For poll step 1: show which questions are missing so error messages and styling appear
    if (this.showPollForm && this.currentStep === 1) {
      this.pollFormSubmitted = true;
    }

    // Mark all form controls as touched to trigger validation
    this.markFormGroupTouched(this.bookingForm);
    
    // Mark service type control as touched
    this.serviceTypeControl.markAsTouched();
    
    // Also mark custom pricing controls if applicable
    if (this.showCustomPricing) {
      this.customAmount.markAsTouched();
      this.customCleaners.markAsTouched();
      this.customDuration.markAsTouched();
    }

    // Find the first invalid field in the current step and scroll to it
    if (!this.isBrowser) return;
    
    setTimeout(() => {
      let firstErrorElement: Element | null = null;
      // Poll step 1: scroll to first unanswered required question (error message or its input)
      if (this.showPollForm && this.currentStep === 1) {
        firstErrorElement = document.querySelector('.form-step.active .poll-error-message');
        if (firstErrorElement) {
          firstErrorElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const questionBlock = firstErrorElement.closest('.poll-question');
          const input = questionBlock?.querySelector('input, select, textarea');
          if (input && (input instanceof HTMLInputElement || input instanceof HTMLSelectElement || input instanceof HTMLTextAreaElement)) {
            input.focus();
          }
        }
      }
      if (firstErrorElement) return;

      // Try multiple selectors to find the first error in current step
      firstErrorElement = document.querySelector('.form-step.active .ng-invalid.ng-touched');
      
      if (!firstErrorElement) {
        // If no touched invalid elements, look for any invalid elements in current step
        firstErrorElement = document.querySelector('.form-step.active .ng-invalid');
      }
      
      if (!firstErrorElement) {
        // If still no invalid elements, look for required fields that are empty in current step
        const requiredInputs = document.querySelectorAll('.form-step.active input[required], .form-step.active select[required], .form-step.active textarea[required]');
        for (let input of requiredInputs) {
          if (!(input as HTMLInputElement).value) {
            firstErrorElement = input;
            break;
          }
        }
      }
      
      if (firstErrorElement) {
        firstErrorElement.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center' 
        });
        
        // Focus the element if it's an input
        if (firstErrorElement instanceof HTMLInputElement || 
            firstErrorElement instanceof HTMLSelectElement || 
            firstErrorElement instanceof HTMLTextAreaElement) {
          firstErrorElement.focus();
        }
      }
    }, 100);
  }

  private markFormGroupTouched(formGroup: FormGroup) {
    Object.keys(formGroup.controls).forEach(key => {
      const control = formGroup.get(key);
      if (control instanceof FormGroup) {
        this.markFormGroupTouched(control);
      } else {
        control?.markAsTouched();
      }
    });
  }

  private markFormGroupUntouched(formGroup: FormGroup) {
    Object.keys(formGroup.controls).forEach(key => {
      const control = formGroup.get(key);
      if (control instanceof FormGroup) {
        this.markFormGroupUntouched(control);
      } else {
        control?.markAsUntouched();
      }
    });
  }

  getServiceOptions(service: Service): number[] {
    const options: number[] = [];
    const min = service.minValue || 0;
    const max = service.maxValue || 10;
    const step = service.stepValue || 1;
    
    for (let i = min; i <= max; i += step) {
      options.push(i);
    }
    
    return options;
  }



  getMinDateString(): string {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate() + 1).padStart(2, '0'); // Tomorrow
    return `${year}-${month}-${day}`;
  }

  get apartmentName() { return this.bookingForm.get('apartmentName') as FormControl; }

  onPromoCodeInput(event: Event) {
    const target = event.target as HTMLInputElement;
    const value = target.value;
    // Update the FormControl value - this will sync both fields
    this.promoCode.setValue(value, { emitEvent: true });
  }

  removePromoCode() {
    this.summaryCodeActionInProgress = true;
    setTimeout(() => { this.summaryCodeActionInProgress = false; }, 1500);

    this.promoCodeApplied = false;
    this.promoDiscount = 0;
    this.promoCode.setValue('');
    this.errorMessage = ''; // Clear any error messages
    this.giftCardApplied = false;
    this.isGiftCard = false;
    this.giftCardBalance = 0;
    this.giftCardAmountToUse = 0;
    this.calculateTotal();
  }

  getGiftCardDisplayInfo(): { amountToUse: number; remainingBalance: number } {
    if (!this.giftCardApplied) {
      return { amountToUse: 0, remainingBalance: 0 };
    }
    return { 
      amountToUse: this.giftCardAmountToUse, 
      remainingBalance: this.giftCardBalance - this.giftCardAmountToUse 
    };
  }
  
  removeFirstTimeDiscount() {
    this.firstTimeDiscountApplied = false;
    // Re-enable the promo code input
    this.promoCode.enable();
    this.errorMessage = '';
    this.calculateTotal();
  }

  loadBubblePointsOptions(): void {
    if (this.isAdminMode && this.selectedTargetUser) {
      // Load target user's points, not admin's
      this.bubbleRewardsService.getAdminUserSummary(this.selectedTargetUser.id).subscribe({
        next: (summary: any) => {
          this.bubblePointsEnabled = !!summary.pointsSystemEnabled;
          this.bubblePointsPerDollar = summary.guide?.pointsPerDollar ?? 0;
          if (!summary.pointsSystemEnabled) { this.bubblePointsOptions = []; return; }
          this.userBubblePoints = summary.currentPoints;
          this.userBubbleCredits = summary.bubbleCredits ?? 0;
          this.bubblePointsOptions = summary.availableRedemptions ?? [];
        },
        error: () => { this.bubblePointsOptions = []; }
      });
    } else {
      this.bubbleRewardsService.getSummary().subscribe({
        next: (summary) => {
          this.bubblePointsEnabled = !!summary.pointsSystemEnabled;
          this.bubblePointsPerDollar = summary.guide?.pointsPerDollar ?? 0;
          if (!summary.pointsSystemEnabled) return;
          this.userBubblePoints = summary.currentPoints;
          this.userBubbleCredits = summary.bubbleCredits ?? 0;
          this.bubblePointsOptions = summary.availableRedemptions;
        },
        error: () => {}
      });
    }
  }

  selectPointsToRedeem(points: number): void {
    if (this.selectedPointsToRedeem === points) {
      // toggle off
      this.selectedPointsToRedeem = 0;
      this.pointsDiscountAmount = 0;
    } else {
      const opt = this.bubblePointsOptions.find(o => o.points === points);
      if (!opt || !opt.available) return;
      this.selectedPointsToRedeem = points;
      this.pointsDiscountAmount = opt.dollarValue;
    }
    this.calculateTotal();
  }

  /** Estimated points for this booking: (total - tax - tips - companyTips) * pointsPerDollar */
  get estimatedPoints(): number {
    if (!this.bubblePointsEnabled || this.bubblePointsPerDollar <= 0) return 0;
    const base = (this.calculation?.total ?? 0)
      - (this.calculation?.tax ?? 0)
      - (this.tips?.value ?? 0)
      - (this.companyDevelopmentTips?.value ?? 0);
    return Math.floor(Math.max(0, base) * this.bubblePointsPerDollar);
  }

  loadSpecialOffers() {
    const setPromoLoaded = () => {
      this.loading.promoBanner = false;
      this.cdr.markForCheck();
    };
    if (this.isAdminMode && this.selectedTargetUser) {
      this.adminService.getUserSpecialOffers(this.selectedTargetUser.id).subscribe({
        next: (offers) => {
          this.userSpecialOffers = offers;
          const firstTimeOffer = offers.find(o => o.name.includes('First Time'));
          if (firstTimeOffer) {
            this.firstTimeDiscountPercentage = firstTimeOffer.discountValue;
            this.hasFirstTimeDiscountOffer = true;
          } else {
            this.hasFirstTimeDiscountOffer = false;
          }
          this.hasFirstTimeDiscount = offers.some(o => o.name.toLowerCase().includes('first time'));
          setPromoLoaded();
        },
        error: (error) => {
          console.error('Error loading user special offers:', error);
          this.hasFirstTimeDiscountOffer = false;
          this.userSpecialOffers = [];
          setPromoLoaded();
        }
      });
    } else if (this.authService.isLoggedIn()) {
      this.specialOfferService.getMySpecialOffers().subscribe({
        next: (offers) => {
          this.userSpecialOffers = offers;
          const firstTimeOffer = offers.find(o => o.name.includes('First Time'));
          if (firstTimeOffer) {
            this.firstTimeDiscountPercentage = firstTimeOffer.discountValue;
            this.hasFirstTimeDiscountOffer = true;
          } else {
            this.hasFirstTimeDiscountOffer = false;
          }
          this.hasFirstTimeDiscount = offers.some(o => o.name.toLowerCase().includes('first time'));
          setPromoLoaded();
        },
        error: (error) => {
          console.error('Error loading special offers:', error);
          this.hasFirstTimeDiscountOffer = false;
          this.userSpecialOffers = [];
          setPromoLoaded();
        }
      });
    } else {
      this.specialOfferService.getPublicSpecialOffers().subscribe({
        next: (offers) => {
          if (offers && offers.length > 0) {
            const randomIndex = Math.floor(Math.random() * offers.length);
            const randomOffer = offers[randomIndex];
            this.userSpecialOffers = [{
              id: randomOffer.id,
              specialOfferId: randomOffer.id,
              name: randomOffer.name,
              description: randomOffer.description,
              isPercentage: randomOffer.isPercentage,
              discountValue: randomOffer.discountValue,
              expiresAt: undefined,
              isUsed: false,
              icon: randomOffer.icon,
              badgeColor: randomOffer.badgeColor,
              minimumOrderAmount: randomOffer.minimumOrderAmount
            }];
          } else {
            this.userSpecialOffers = [];
          }
          setPromoLoaded();
        },
        error: (error) => {
          console.error('Error loading public special offers:', error);
          this.userSpecialOffers = [];
          setPromoLoaded();
        }
      });
    }
  }

  loadOrders() {
    if (!this.authService.isLoggedIn()) {
      this.previousOrders = [];
      this.loading.previousOrders = false;
      this.cdr.markForCheck();
      return;
    }
    this.isLoadingOrders = true;

    // In admin mode with a selected user, load that user's orders instead of admin's
    const orders$ = this.isAdminMode && this.selectedTargetUser
      ? this.adminService.getUserOrders(this.selectedTargetUser.id)
      : this.orderService.getUserOrders();

    orders$.subscribe({
      next: (orders) => {
        this.previousOrders = orders.filter(order => !order.isCustomServiceType);
        this.isLoadingOrders = false;
        this.loading.previousOrders = false;
        this.cdr.markForCheck();
      },
      error: (error) => {
        console.error('Error loading orders:', error);
        this.previousOrders = [];
        this.isLoadingOrders = false;
        this.loading.previousOrders = false;
        this.cdr.markForCheck();
      }
    });
  }

  toggleReorderModal() {
    this.showReorderModal = !this.showReorderModal;
    if (this.showReorderModal && this.previousOrders.length === 0) {
      this.loadOrders();
    }
  }

  // Admin methods
  checkAdminStatus() {
    if (this.authService.isLoggedIn()) {
      const user = this.authService.currentUserValue;
      this.isAdmin = user?.role === 'Admin' || user?.role === 'SuperAdmin' || user?.role === 'Moderator';
      this.isSuperAdmin = user?.role === 'SuperAdmin';
      this.isModerator = user?.role === 'Moderator';
    } else {
      this.isAdmin = false;
      this.isSuperAdmin = false;
      this.isModerator = false;
    }
  }

  toggleAdminMode() {
    this.isAdminMode = !this.isAdminMode;
    if (this.isAdminMode) {
      if (this.availableUsers.length === 0) {
        this.loadUsers();
      } else {
        // Users already loaded, just refresh the filtered list
        this.filterUsers();
      }
    }
    if (!this.isAdminMode) {
      // Restore admin's apartments if a user was selected
      if (this.selectedTargetUser) {
        this.userApartments = [...this.adminOriginalApartments];
        this.adminOriginalApartments = [];
        
        // Restore admin's address if they have apartments
        if (this.userApartments.length > 0) {
          const firstApartment = this.userApartments[0];
          this.bookingForm.patchValue({
            selectedApartmentId: firstApartment.id.toString()
          });
          this.fillApartmentAddress(firstApartment.id.toString());
        }
      }
      
      this.selectedTargetUser = null;
      this.userSearchTerm = '';

      // Reload admin's subscription when admin mode is turned off
      this.loadUserSubscription();

      // Reload admin's own previous orders
      this.previousOrders = [];
      this.loadOrders();
    }
  }

  loadUsers() {
    this.isLoadingUsers = true;
    this.adminService.getUsers().subscribe({
      next: (response: any) => {
        // Handle both response formats
        if (response && response.users) {
          this.availableUsers = response.users.filter((u: UserAdmin) => 
            u.role === 'Customer' && u.isActive
          );
        } else if (Array.isArray(response)) {
          this.availableUsers = response.filter((u: UserAdmin) => 
            u.role === 'Customer' && u.isActive
          );
        } else {
          this.availableUsers = [];
        }
        this.filterUsers();
        this.isLoadingUsers = false;
      },
      error: (error) => {
        console.error('Error loading users:', error);
        this.availableUsers = [];
        this.isLoadingUsers = false;
      }
    });
  }

  filterUsers() {
    if (!this.userSearchTerm.trim()) {
      this.filteredUsers = this.availableUsers; // Show all users
      return;
    }

    const search = this.userSearchTerm.toLowerCase().trim();
    this.filteredUsers = this.availableUsers.filter(user =>
      user.email.toLowerCase().includes(search) ||
      user.firstName.toLowerCase().includes(search) ||
      user.lastName.toLowerCase().includes(search) ||
      user.id.toString().includes(search)
    ); // Show all filtered results
  }

  onUserSearchChange() {
    this.filterUsers();
  }

  selectUser(user: UserAdmin) {
    this.selectedTargetUser = user;
    this.userSearchTerm = `${user.firstName} ${user.lastName} (${user.email})`;
    
    // Store admin's original apartments before loading user's apartments
    this.adminOriginalApartments = [...this.userApartments];
    
    // Pre-fill form with selected user's contact information
    if (user.firstName) {
      this.contactFirstName.setValue(user.firstName);
    }
    if (user.lastName) {
      this.contactLastName.setValue(user.lastName);
    }
    if (user.email) {
      this.contactEmail.setValue(user.email);
    }
    if (user.phone) {
      this.contactPhone.setValue(user.phone.replace(/\D/g, '').slice(0, 10));
    }
    
    // Load and populate user's address information
    this.loadUserAddress(user.id);

    // Load the selected user's subscription (not admin's subscription)
    this.loadUserSubscription(user.id);

    // Load the selected user's special offers
    this.loadSpecialOffers();

    // Load target user's bubble points
    if (this.isBrowser) this.loadBubblePointsOptions();

    // Reload previous orders for the selected user (so reorder modal shows their orders)
    this.previousOrders = [];
    this.loadOrders();
  }
  
  private loadUserAddress(userId: number) {
    this.adminService.getUserApartments(userId).subscribe({
      next: (apartments) => {
        // Update userApartments with selected user's apartments
        this.userApartments = apartments;
        
        if (apartments && apartments.length > 0) {
          // User has apartments - select the first one and fill address
          const firstApartment = apartments[0];
          this.bookingForm.patchValue({
            selectedApartmentId: firstApartment.id.toString()
          });
          this.fillApartmentAddress(firstApartment.id.toString());
        } else {
          // User has no apartments - clear address fields
          this.clearAddressFields();
        }
      },
      error: (error) => {
        console.error('Error loading user apartments:', error);
        // On error, clear address fields
        this.clearAddressFields();
      }
    });
  }
  
  private clearAddressFields() {
    this.bookingForm.patchValue({
      selectedApartmentId: '',
      serviceAddress: '',
      apartmentName: '',
      aptSuite: '',
      city: '',
      state: this.states.length > 0 ? this.states[0] : '',
      zipCode: ''
    });
    
    // Load cities for the default state
    if (this.states.length > 0) {
      this.loadCities(this.states[0]);
    }
  }

  clearSelectedUser() {
    this.selectedTargetUser = null;
    this.userSearchTerm = '';
    this.filterUsers(); // Refresh the filtered users list
    
    // Restore admin's apartments
    this.userApartments = [...this.adminOriginalApartments];
    this.adminOriginalApartments = [];
    
    // Clear contact information and restore admin's info if available
    if (this.currentUser) {
      this.bookingForm.patchValue({
        contactFirstName: this.currentUser.firstName || '',
        contactLastName: this.currentUser.lastName || '',
        contactEmail: this.currentUser.email || '',
        contactPhone: this.currentUser.phone ? this.currentUser.phone.replace(/\D/g, '').slice(0, 10) : ''
      });
      
      // Restore admin's address if they have apartments
      if (this.userApartments.length > 0) {
        const firstApartment = this.userApartments[0];
        this.bookingForm.patchValue({
          selectedApartmentId: firstApartment.id.toString()
        });
        this.fillApartmentAddress(firstApartment.id.toString());
      } else {
        // Clear address fields if admin has no apartments
        this.clearAddressFields();
      }
    } else {
      // Clear all contact fields
      this.contactFirstName.setValue('');
      this.contactLastName.setValue('');
      this.contactEmail.setValue('');
      this.contactPhone.setValue('');
      // Clear address fields
      this.clearAddressFields();
    }
    
    // Reload admin's subscription (not the selected user's)
    this.loadUserSubscription();
    
    // Reload special offers (will load admin's offers now that selectedTargetUser is null)
    this.loadSpecialOffers();

    // Reset points selection and reload admin's own points
    this.selectedPointsToRedeem = 0;
    this.pointsDiscountAmount = 0;
    this.bubblePointsOptions = [];
    if (this.isBrowser) this.loadBubblePointsOptions();
  }

  selectOrderToReorder(orderId: number) {
    this.reorderingOrderId = orderId;
    this.showReorderModal = false;

    // In admin mode, use admin endpoint to fetch order details
    const order$ = this.isAdminMode && this.selectedTargetUser
      ? this.adminService.getOrderDetails(orderId)
      : this.orderService.getOrderById(orderId);

    order$.subscribe({
      next: (order: Order) => {
        // Make sure service types are loaded before proceeding
        if (this.serviceTypes.length === 0) {
          this.errorMessage = 'Service types are still loading. Please try again in a moment.';
          this.reorderingOrderId = null;
          return;
        }

        // Find the service type
        const serviceType = this.serviceTypes.find(st => st.id === order.serviceTypeId);
        if (!serviceType) {
          this.errorMessage = 'Service type not found. Please try again.';
          this.reorderingOrderId = null;
          return;
        }

        // Map order data to booking form format
        const formData = {
          selectedServiceTypeId: order.serviceTypeId.toString(),
          selectedServices: order.services.map(service => ({
            serviceId: service.serviceId.toString(),
            quantity: service.quantity
          })),
          selectedExtraServices: order.extraServices.map(extraService => ({
            extraServiceId: extraService.extraServiceId.toString(),
            quantity: extraService.quantity,
            hours: extraService.hours
          })),
          cleaningType: 'normal', // Default to normal as cleaning type is not stored in order
          contactFirstName: order.contactFirstName || '',
          contactLastName: order.contactLastName || '',
          contactEmail: order.contactEmail || '',
          contactPhone: order.contactPhone || '',
          serviceAddress: order.serviceAddress || '',
          aptSuite: order.aptSuite || '',
          apartmentName: '',
          city: order.city || '',
          state: order.state || '',
          zipCode: order.zipCode || '',
          entryMethod: order.entryMethod || '',
          specialInstructions: order.specialInstructions || '',
          // Copy tips from previous order but not promo codes, gift cards, or special offers
          tips: order.tips || 0,
          companyDevelopmentTips: order.companyDevelopmentTips || 0,
          hasStartedBooking: true,
          bookingProgress: 'started' as const
        };

        // Save form data
        this.formPersistenceService.saveFormData(formData);
        this.formPersistenceService.markBookingStarted();

        // Clear photos, promo codes, gift cards, and special offers before restoring
        this.uploadedPhotos = [];
        this.promoCodeApplied = false;
        this.giftCardApplied = false;
        this.specialOfferApplied = false;
        this.selectedSpecialOffer = null;
        if (this.promoCode) {
          this.promoCode.setValue('');
        }

        // Manually restore the service type and services
        this.serviceTypeControl.setValue(serviceType.id);
        this.selectServiceType(serviceType);

        // Restore selected services
        if (order.services && order.services.length > 0) {
          order.services.forEach(orderService => {
            const service = serviceType.services.find(s => s.id === orderService.serviceId);
            if (service) {
              const existingIndex = this.selectedServices.findIndex(s => s.service.id === service.id);
              if (existingIndex >= 0) {
                this.selectedServices[existingIndex].quantity = orderService.quantity;
                
                // Update square feet when bedrooms are restored
                if (service.serviceKey === 'bedrooms') {
                  const sqftService = this.selectedServices.find(s => s.service.serviceKey === 'sqft');
                  if (sqftService) {
                    sqftService.quantity = this.getSquareFeetForBedrooms(orderService.quantity);
                  }
                }
              }
            }
          });
        }

        // Restore selected extra services
        if (order.extraServices && order.extraServices.length > 0) {
          // Clear any extra services that might have been added by selectServiceType
          this.selectedExtraServices = [];
          
          order.extraServices.forEach(orderExtraService => {
            const extraService = serviceType.extraServices.find(es => es.id === orderExtraService.extraServiceId);
            if (extraService) {
              this.selectedExtraServices.push({
                extraService,
                quantity: orderExtraService.quantity || 1,
                hours: orderExtraService.hours || (extraService.hasHours ? 0.5 : 0)
              });
            }
          });
        }

        // Sync cleaning type with restored extra services (deep vs normal) so UI matches price
        const cleaningTypeToApply = this.getCurrentCleaningType();
        this.cleaningType.setValue(cleaningTypeToApply);

        // Patch form values (don't set serviceDate/serviceTime - let user pick new date)
        this.bookingForm.patchValue({
          entryMethod: order.entryMethod || '',
          specialInstructions: order.specialInstructions || '',
          contactFirstName: order.contactFirstName || '',
          contactLastName: order.contactLastName || '',
          contactEmail: order.contactEmail || '',
          contactPhone: order.contactPhone || '',
          serviceAddress: order.serviceAddress || '',
          aptSuite: order.aptSuite || '',
          city: order.city || '',
          state: order.state || '',
          zipCode: order.zipCode || '',
          // Don't copy promo codes or gift cards from previous order, but keep tips
          promoCode: '',
          tips: order.tips || 0,
          companyDevelopmentTips: order.companyDevelopmentTips || 0,
          cleaningType: cleaningTypeToApply
        });

        // Load cities if state is set
        if (order.state) {
          this.loadCities(order.state);
        }

        // Calculate total
        this.calculateTotal();
        
        this.reorderingOrderId = null;
        this.errorMessage = '';
      },
      error: (error) => {
        console.error('Error loading order details:', error);
        this.errorMessage = 'Failed to load order details. Please try again.';
        this.reorderingOrderId = null;
      }
    });
  }

  formatOrderDate(date: any): string {
    return new Date(date).toLocaleDateString();
  }

  isFirstTimeOffer(offer: UserSpecialOffer): boolean {
    return offer.name.toLowerCase().includes('first time');
  }

  applySpecialOffer(offer: UserSpecialOffer) {
    // Check if promo code is already applied (but NOT gift card)
    if (this.promoCodeApplied && !this.isGiftCard) {
      this.errorMessage = 'Cannot apply special offer when a promo code is already applied. Please remove the promo code first.';
      return;
    }
  
    // Check if another special offer is already applied
    if (this.specialOfferApplied && this.selectedSpecialOffer?.id !== offer.id) {
      this.errorMessage = 'Only one special offer can be applied at a time. Please remove the current offer first.';
      return;
    }
  
    // Clear any previous error
    this.errorMessage = '';
  
    // Apply the special offer
    this.selectedSpecialOffer = offer;
    this.specialOfferApplied = true;
    
    // Update promo code disabled state
    this.updatePromoCodeDisabledState();
    
    // For backward compatibility with first-time discount
    if (offer.name.toLowerCase().includes('first time')) {
      this.firstTimeDiscountApplied = true;
    }
    
    this.calculateTotal();
  }
  
  removeSpecialOffer() {
    this.selectedSpecialOffer = null;
    this.specialOfferApplied = false;
    this.firstTimeDiscountApplied = false;
    
    // Update promo code disabled state
    this.updatePromoCodeDisabledState();
    this.errorMessage = '';
    
    this.calculateTotal();
  }

  /** Called when user clicks anywhere on a special offer card: apply or remove the offer. */
  onSpecialOfferCardClick(offer: UserSpecialOffer) {
    const isThisOfferApplied = this.specialOfferApplied && this.selectedSpecialOffer?.id === offer.id;
    if (isThisOfferApplied) {
      this.removeSpecialOffer();
    } else {
      this.applySpecialOffer(offer);
    }
  }
  
  loadPollQuestions(serviceTypeId: number) {
    this.pollService.getPollQuestions(serviceTypeId).subscribe({
      next: (questions) => {
        this.pollQuestions = questions;
        
        // Initialize poll answers
        if (this.savedPollData) {
          // Restore saved poll answers
          this.pollAnswers = { ...this.savedPollData };
          // Clear saved data after restoration
          this.savedPollData = null;
        } else {
          // Initialize with empty answers
          this.pollAnswers = {};
          
          // Initialize dropdown and checkbox questions with empty string
          questions.forEach(question => {
            if (question.questionType === 'dropdown' || question.questionType === 'checkbox') {
              this.pollAnswers[question.id] = '';
            }
          });
        }
      },
      error: (error) => {
        console.error('Error loading poll questions:', error);
      }
    });
  }

  initializeRegularServices(serviceType: ServiceType) {
    // Initialize services based on type
    if (serviceType.services) {
      // Sort services by displayOrder before processing
      const sortedServices = [...serviceType.services].sort((a, b) => 
        (a.displayOrder || 999) - (b.displayOrder || 999)
      );
      
      let bedroomsQuantity = 0; // Default to Studio
      
      sortedServices.forEach(service => {
        if (service.isActive !== false) {
          let defaultQuantity = service.minValue ?? 0;
          
          // Set defaults based on service key
          if (service.serviceKey === 'bedrooms') {
            defaultQuantity = 0; // Studio
            bedroomsQuantity = defaultQuantity;
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
      const sqftService = this.selectedServices.find(s => s.service.serviceKey === 'sqft');
      if (sqftService) {
        sqftService.quantity = this.getSquareFeetForBedrooms(bedroomsQuantity);
      }
    }
    
    // Clear any previously selected extra services
    this.selectedExtraServices = [];
  }
  
  isPollFormValid(): boolean {
    if (!this.showPollForm) return true;
    
    // Check required questions
    for (const question of this.pollQuestions) {
      if (question.isRequired && (!this.pollAnswers[question.id] || this.pollAnswers[question.id].trim() === '')) {
        return false;
      }
    }
    
    // For poll forms, only require: first name and phone (no address fields needed)
    if (!this.contactFirstName.valid || !this.contactPhone.valid) {
      return false;
    }
    
    return true;
  }

  submitPollForm() {
    this.pollFormSubmitted = true;
    
    if (!this.isPollFormValid()) {
      this.scrollToFirstError();
      return;
    }
  
    this.isLoading = true;
    const formValue = this.bookingForm.getRawValue();
  
    const answers: PollAnswer[] = this.pollQuestions.map(question => ({
      pollQuestionId: question.id,
      answer: this.pollAnswers[question.id] || ''
    })).filter(answer => answer.answer.trim() !== '');
  
    const submission: PollSubmission = {
      serviceTypeId: this.selectedServiceType!.id,
      contactFirstName: formValue.contactFirstName,
      contactLastName: formValue.contactLastName,
      contactEmail: formValue.contactEmail,
      contactPhone: formValue.contactPhone,
      serviceAddress: formValue.serviceAddress,
      aptSuite: formValue.aptSuite,
      city: formValue.city,
      state: formValue.state,
      postalCode: formValue.zipCode,
      answers: answers,
      uploadedPhotos: this.preparePhotosForSubmission()
    };
  
    this.pollService.submitPoll(submission).subscribe({
      next: (response) => {
        this.isLoading = false;
        this.router.navigate(['/poll-success'], { 
          queryParams: { serviceType: this.selectedServiceType!.name } 
        });
      },
      error: (error) => {
        this.isLoading = false;
        this.errorMessage = error.error?.message || 'Failed to submit poll. Please try again.';
      }
    });
  }

  // Form control getters for type safety
  get serviceDate() { return this.bookingForm.get('serviceDate') as FormControl; }
  get serviceTime() { return this.bookingForm.get('serviceTime') as FormControl; }
  get entryMethod() { return this.bookingForm.get('entryMethod') as FormControl; }
  get customEntryMethod() { return this.bookingForm.get('customEntryMethod') as FormControl; }
  get specialInstructions() { return this.bookingForm.get('specialInstructions') as FormControl; }
  get contactFirstName() { return this.bookingForm.get('contactFirstName') as FormControl; }
  get contactLastName() { return this.bookingForm.get('contactLastName') as FormControl; }
  get contactEmail() { return this.bookingForm.get('contactEmail') as FormControl; }
  get contactPhone() { return this.bookingForm.get('contactPhone') as FormControl; }
  get useApartmentAddress() { return this.bookingForm.get('useApartmentAddress') as FormControl; }
  get selectedApartmentId() { return this.bookingForm.get('selectedApartmentId') as FormControl; }
  get serviceAddress() { return this.bookingForm.get('serviceAddress') as FormControl; }
  get aptSuite() { return this.bookingForm.get('aptSuite') as FormControl; }
  get city() { return this.bookingForm.get('city') as FormControl; }
  get state() { return this.bookingForm.get('state') as FormControl; }
  get zipCode() { return this.bookingForm.get('zipCode') as FormControl; }
  get promoCode() { return this.bookingForm.get('promoCode') as FormControl; }
  get tips() { return this.bookingForm.get('tips') as FormControl; }
  get companyDevelopmentTips() { return this.bookingForm.get('companyDevelopmentTips') as FormControl; }
  get cleaningType() { return this.bookingForm.get('cleaningType') as FormControl; }
  get smsConsent() { return this.bookingForm.get('smsConsent') as FormControl; }
  get cancellationConsent() { return this.bookingForm.get('cancellationConsent') as FormControl; }

  onFloorTypeSelectionChange(selection: FloorTypeSelection): void {
    this.floorTypes = selection.types;
    this.floorTypeOther = selection.otherText;
    this.saveFormData();
  }

  private buildFloorTypesString(): string | null {
    if (!this.floorTypes.length) return null;
    return this.floorTypes.map(t => {
      if (t === 'other' && this.floorTypeOther) {
        return `other:${this.floorTypeOther}`;
      }
      return t;
    }).join(',');
  }

  // Check if promo code should be disabled
  isPromoCodeDisabled(): boolean {
    return this.specialOfferApplied || this.promoCode.disabled;
  }

  // Update promo code disabled state based on special offer
  updatePromoCodeDisabledState() {
    if (this.specialOfferApplied) {
      this.promoCode.disable();
    } else {
      this.promoCode.enable();
    }
  }

  private loadUserSubscription(userId?: number) {
    // If userId is provided (admin mode), load that user's subscription
    if (userId && this.isAdminMode) {
      this.adminService.getUserProfile(userId).subscribe({
        next: (userProfile) => {
          const rawExpiry = userProfile?.subscriptionExpiryDate;
          const expiryMs = rawExpiry ? new Date(rawExpiry).getTime() : NaN;
          const isExpired = rawExpiry && !Number.isNaN(expiryMs) && expiryMs <= Date.now();

          if (userProfile?.subscriptionId && !isExpired) {
            this.hasActiveSubscription = true;
            this.userSubscription = {
              hasSubscription: true,
              subscriptionId: userProfile.subscriptionId,
              subscriptionName: userProfile.subscriptionName,
              discountPercentage: 0, // Will be set from subscription list
              expiryDate: userProfile.subscriptionExpiryDate
            };
            
            // If subscription is already loaded, update the selection
            if (this.subscriptions && this.subscriptions.length > 0) {
              this.updateSelectedSubscription();
            }
          } else {
            this.hasActiveSubscription = false;
            this.userSubscription = null;
            // Set default subscription if user has no active subscription
            if (this.subscriptions && this.subscriptions.length > 0) {
              const oneTimeSubscription = this.subscriptions.find(s => s.name === 'One Time') || this.subscriptions[0];
              this.selectedSubscription = oneTimeSubscription;
              // Recalculate total to clear any previous discount
              this.calculateTotal();
            } else {
              this.selectedSubscription = null;
            }
          }
        },
        error: (error) => {
          console.error('Error loading user subscription:', error);
          this.hasActiveSubscription = false;
          this.userSubscription = null;
          // Set default subscription on error
          if (this.subscriptions && this.subscriptions.length > 0) {
            const oneTimeSubscription = this.subscriptions.find(s => s.name === 'One Time') || this.subscriptions[0];
            this.selectedSubscription = oneTimeSubscription;
            // Recalculate total to clear any previous discount
            this.calculateTotal();
          } else {
            this.selectedSubscription = null;
          }
        }
      });
      return;
    }

    // Regular flow: load subscription for logged-in user
    // Only call getUserSubscription if user is logged in
    if (!this.authService.isLoggedIn()) {
      this.hasActiveSubscription = false;
      this.userSubscription = null;
      return;
    }
  
    this.bookingService.getUserSubscription().subscribe({
      next: (data) => {
        const rawExpiry =
          data?.subscriptionExpiryDate ??
          data?.expiryDate ??
          data?.expiresAt ??
          data?.subscriptionExpiresAt;

        const expiryMs = rawExpiry ? new Date(rawExpiry).getTime() : NaN;
        const isExpired = rawExpiry && !Number.isNaN(expiryMs) && expiryMs <= Date.now();

        if (data?.hasSubscription && !isExpired) {
          this.hasActiveSubscription = true;
          this.userSubscription = data;
          
          // If subscription is already loaded, update the selection
          if (this.subscriptions && this.subscriptions.length > 0) {
            this.updateSelectedSubscription();
          }
        } else {
          this.hasActiveSubscription = false;
          this.userSubscription = null;
        }
      },
      error: (error) => {
        // Only log error if it's not a 401 (which is expected for logged out users)
        if (error.status !== 401) {
          console.error('Error loading subscription:', error);
        }
        this.hasActiveSubscription = false;
        this.userSubscription = null;
      }
    });
  }
  
  private updateSelectedSubscription() {
    if (this.userSubscription && this.subscriptions) {
      const matchingSubscription = this.subscriptions.find(s => s.id === this.userSubscription.subscriptionId);

      if (matchingSubscription) {
        this.selectedSubscription = matchingSubscription;
        // Update discount percentage from subscription list
        if (this.userSubscription) {
          this.userSubscription.discountPercentage = matchingSubscription.discountPercentage;
        }
        // Trigger calculation when subscription is updated
        this.calculateTotal();
        this.saveFormData(); // Persist updated selection so it doesn't revert to "One Time"
      } else {
        // If subscription not found in list, clear selection
        this.selectedSubscription = null;
      }
    }
  }

  // Helper method to map subscription name to subscription days
  getSubscriptionDaysForSubscription(subscriptionName: string | undefined): number {
    if (!subscriptionName) return 0;
    
    const mapping: { [key: string]: number } = {
      'Weekly': 7,
      'Bi-Weekly': 14,
      'Monthly': 30
    };
    return mapping[subscriptionName] || 0;
  }

  // Get filtered extra services (excluding deep cleaning and super deep cleaning)
  getFilteredExtraServices(): ExtraService[] {
    if (!this.selectedServiceType) return [];
    
    return this.selectedServiceType.extraServices.filter(extra => {
      // Show all extra services except deep cleaning and super deep cleaning
      if (extra.isDeepCleaning || extra.isSuperDeepCleaning) {
        return false;
      }
      
      // Always show same day service (it will be disabled when not available)
      return true;
    });
  }

  // Get extra services to display (all services, CSS handles hiding overflow)
  getExtraServicesToDisplay(): ExtraService[] {
    return this.getFilteredExtraServices();
  }

  // Toggle extra services display
  toggleExtraServicesDisplay() {
    this.showAllExtraServices = !this.showAllExtraServices;
  }

  // Check if there are more services to show (check if would overflow one row)
  hasMoreExtraServices(): boolean {
    const filteredServices = this.getFilteredExtraServices();
    // Always show toggle if there are more than a few cards (likely to wrap)
    return filteredServices.length > 4;
  }

  // Update number of services to show based on screen size
  updateExtraServicesToShow() {
    if (!this.isBrowser) return;
    
    const width = window.innerWidth;
    
    if (width <= 534) {
      // Mobile: 3 cards per row (120px + gap)
      this.extraServicesToShow = 3;
    } else if (width <= 768) {
      // Tablet: 5 cards per row (120px + gap)
      this.extraServicesToShow = 5;
    } else {
      // Desktop: 7-8 cards per row (150px + gap)
      this.extraServicesToShow = 7;
    }
  }

  updateExtraServicesContainerMaxWidth() {
    if (!this.isBrowser) return;
    
    const windowWidth = window.innerWidth;
    
    if (windowWidth >= 1510) {
      // If window width is 1510px or MORE, keep max-width at 950px (fixed)
      this.extraServicesContainerMaxWidth = 950;
    } else if (windowWidth >= 1200) {
      // Between 1200px and 1510px: proportional reduction
      // At 1510px → 950px
      // At 1201px → 758px
      // Linear interpolation
      const ratio = (windowWidth - 1510) / (1201 - 1510); // ratio from 0 at 1510px to 1 at 1201px
      this.extraServicesContainerMaxWidth = 950 + (697 - 950) * ratio;
      
      // At exactly 1200px, jump to 1140px
      if (windowWidth >= 1200 && windowWidth < 1201) {
        this.extraServicesContainerMaxWidth = 1140;
      }
    } else {
      // Below 1200px: resize reducing by 1px for each 1px window reduction
      // At 1200px → 1140px
      // For each 1px decrease in window width, reduce container max-width by 1px (but keep min at 300px)
      const widthDifference = 1200 - windowWidth; // How much smaller than 1200px
      this.extraServicesContainerMaxWidth = Math.max(1140 - widthDifference, 300);
    }
  }

  getExtraServiceTooltip(extra: ExtraService): string {
    let tooltip = extra.description || '';
    
    // Add additional info for Extra Cleaners
    if (extra.name === 'Extra Cleaners') {
      tooltip += '\n\nEach extra cleaner reduces service duration.';
    }
    
    // Add disabled reason for same day service
    if (extra.isSameDayService && !this.isSameDayServiceAvailable) {
      tooltip = this.sameDayServiceDisabledReason;
    }
    
    return tooltip;
  }

  getSubscriptionTooltip(subscription: Subscription): string {
    return subscription.description || '';
  }

  private getActiveDeepCleaningExtraService(): ExtraService | null {
    if (!this.selectedServiceType?.extraServices) return null;
    return (
      this.selectedServiceType.extraServices.find(
        (extra) => extra.isDeepCleaning && extra.isActive !== false
      ) || null
    );
  }

  get canSelectDeepCleaning(): boolean {
    return !!this.getActiveDeepCleaningExtraService();
  }

  private normalizeCleaningTypeForSelectedServiceType(): void {
    // If deep cleaning is not available for this service type, force the form to "normal"
    // and remove any deep-cleaning extra that might have been restored from saved data.
    if (this.canSelectDeepCleaning) return;

    this.selectedExtraServices = this.selectedExtraServices.filter(
      (s) => !s.extraService.isDeepCleaning
    );

    if (this.cleaningType.value === 'deep') {
      this.cleaningType.setValue('normal');
    }
  }

  // Handle cleaning type selection
  onCleaningTypeChange(cleaningType: string) {
    // Remove any existing deep cleaning services
    this.selectedExtraServices = this.selectedExtraServices.filter(
      s => !s.extraService.isDeepCleaning
    );

    // Add the selected cleaning type if not normal
    if (cleaningType !== 'normal') {
      const cleaningService = this.getActiveDeepCleaningExtraService();

      // If deep cleaning isn't available for this service type, fall back to normal.
      if (!cleaningService) {
        if (this.cleaningType.value !== 'normal') {
          this.cleaningType.setValue('normal');
        }
        this.calculateTotal();
        this.saveFormData();
        return;
      }

      if (cleaningService) {
        this.selectedExtraServices.push({
          extraService: cleaningService,
          quantity: 1,
          hours: cleaningService.hasHours ? 0.5 : 0
        });
      }
    }

    this.calculateTotal();
    this.saveFormData();
  }

  selectCleaningType(cleaningType: string) {
    if (cleaningType === 'deep' && !this.canSelectDeepCleaning) {
      cleaningType = 'normal';
    }
    this.cleaningType.setValue(cleaningType);
    this.cleaningType.markAsTouched();
    this.onCleaningTypeChange(cleaningType);
  }

  onDurationChange(duration: number) {
    this.customDuration.setValue(duration);
    this.calculateTotal();
    this.saveFormData();
  }

  toggleTipDropdown() {
    this.tipDropdownOpen = !this.tipDropdownOpen;
  }

  selectTipPreset(amount: number) {
    this.tips.setValue(amount);
    this.tipDropdownOpen = false;
    this.calculateTotal();
    this.saveFormData();
  }


  
  onPollAnswerChange() {
    // Save form data when poll answers change
    if (this.showPollForm) {
      this.saveFormData();
    }
  }

  /** Whether the given option is selected for a checkbox-type poll question (comma-separated stored value). */
  isPollCheckboxChecked(questionId: number, option: string): boolean {
    const value = (this.pollAnswers[questionId] || '').trim();
    if (!value) return false;
    const selected = value.split(',').map(s => s.trim()).filter(Boolean);
    return selected.includes(option);
  }

  /** Toggle an option for a checkbox-type poll question. Stores selected values as comma-separated. */
  togglePollCheckbox(questionId: number, option: string): void {
    const value = (this.pollAnswers[questionId] || '').trim();
    const selected = value ? value.split(',').map(s => s.trim()).filter(Boolean) : [];
    const idx = selected.indexOf(option);
    if (idx >= 0) {
      selected.splice(idx, 1);
    } else {
      selected.push(option);
    }
    this.pollAnswers[questionId] = selected.join(', ');
  }

  loadBlockedTimeSlots() {
    this.bookingService.getBlockedTimeSlots().pipe(takeUntil(this.destroy$)).subscribe({
      next: (slots) => {
        this.blockedTimeSlots = slots;
        this.blockedFullDays = new Set<string>();
        this.blockedHoursMap = new Map<string, Set<string>>();
        for (const slot of slots) {
          if (slot.isFullDay) {
            this.blockedFullDays.add(slot.date);
          } else if (slot.blockedHours) {
            this.blockedHoursMap.set(slot.date, new Set(slot.blockedHours.split(',')));
          }
        }
        // After loading blocked slots, adjust default date/time if currently on a blocked slot
        this.adjustDefaultDateIfBlocked();
      }
    });
  }

  /** If the current default date is fully blocked, advance to the next available date.
   *  Also ensure the selected time is not blocked. */
  private adjustDefaultDateIfBlocked() {
    if (this.isAdminMode) return;
    const currentDate = this.serviceDate.value;
    if (!currentDate) return;

    let dateStr = typeof currentDate === 'string' ? currentDate.split('T')[0] : currentDate;

    // If current date is fully blocked, find the next available date (up to 60 days out)
    if (this.blockedFullDays.has(dateStr)) {
      const [y, m, d] = dateStr.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      for (let i = 0; i < 60; i++) {
        date.setDate(date.getDate() + 1);
        const nextStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        if (!this.blockedFullDays.has(nextStr)) {
          dateStr = nextStr;
          this.serviceDate.setValue(nextStr);
          break;
        }
      }
    }

    // If selected time is blocked on this date, pick the first non-blocked time
    const blockedHours = this.getBlockedHoursForDate(dateStr);
    if (blockedHours.size > 0 && this.serviceTime.value && blockedHours.has(this.serviceTime.value)) {
      const availableSlots = this.getAvailableTimeSlots();
      const firstAvailable = availableSlots.find(slot => !blockedHours.has(slot));
      if (firstAvailable) {
        this.serviceTime.setValue(firstAvailable);
      }
    }
  }

  /** Get the blocked-slot reason for a given date (if any). */
  getBlockedReasonForDate(dateStr: string): string | null {
    const slot = this.blockedTimeSlots.find(s => s.date === dateStr);
    return slot?.reason || null;
  }

  /** Returns list of fully blocked date strings (YYYY-MM-DD) for the date-selector. */
  getBlockedDates(): string[] {
    if (this.isAdminMode) return [];
    return Array.from(this.blockedFullDays);
  }

  /** Returns list of partially blocked date strings (YYYY-MM-DD) for the date-selector. */
  getPartiallyBlockedDates(): string[] {
    if (this.isAdminMode) return [];
    return Array.from(this.blockedHoursMap.keys());
  }

  /** Returns set of blocked hours for a specific date (empty if admin mode). */
  getBlockedHoursForDate(dateStr: string): Set<string> {
    if (this.isAdminMode) return new Set();
    return this.blockedHoursMap.get(dateStr) || new Set();
  }

  /** Returns blocked hours array for the currently selected date (for time-selector input). */
  getBlockedHoursForSelectedDate(): string[] {
    if (this.isAdminMode) return [];
    const dateStr = this.serviceDate.value;
    if (!dateStr) return [];
    const cleanDate = typeof dateStr === 'string' ? dateStr.split('T')[0] : dateStr;
    // If the date is fully blocked, all hours are blocked
    if (this.blockedFullDays.has(cleanDate)) {
      return [
        '08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
        '12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30',
        '16:00', '16:30', '17:00', '17:30', '18:00'
      ];
    }
    return Array.from(this.getBlockedHoursForDate(cleanDate));
  }

  /** Check if the currently selected date + time is blocked. */
  isSelectedDateTimeBlocked(): boolean {
    if (this.isAdminMode) return false;
    const dateStr = this.serviceDate.value;
    if (!dateStr) return false;
    const cleanDate = typeof dateStr === 'string' ? dateStr.split('T')[0] : dateStr;
    // Fully blocked day
    if (this.blockedFullDays.has(cleanDate)) return true;
    // Partially blocked - check the specific time
    const blockedHours = this.blockedHoursMap.get(cleanDate);
    if (blockedHours && this.serviceTime.value) {
      return blockedHours.has(this.serviceTime.value);
    }
    return false;
  }

  getAvailableTimeSlots(): string[] {
    const selectedDate = this.serviceDate.value;
    if (!selectedDate) return [];

    const selectedDateObj = this.parseServiceDate(selectedDate);
    const minStartTime = selectedDateObj
      ? this.getMinimumStartTimeForDate(selectedDateObj)
      : '08:00';

    // Time slots from 8:00 AM to 6:00 PM (30-minute intervals) for all days
    const timeSlots = [
      '08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
      '12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30',
      '16:00', '16:30', '17:00', '17:30', '18:00'
    ];

    // Weekend rule: for Saturday/Sunday, earliest start is 9:30 AM.
    let filteredSlots = timeSlots.filter(timeSlot => timeSlot >= minStartTime);

    // If same day service is selected, filter time slots based on current time
    if (this.isSameDaySelected) {
      const today = this.getNowInNewYork();

      // Check if selected date is today (in NY time)
      if (selectedDateObj && selectedDateObj.toDateString() === today.toDateString()) {
        const earliestTime = this.getEarliestSameDayServiceTime();
        // Filter time slots to only include times after the earliest available time
        filteredSlots = filteredSlots.filter(timeSlot => timeSlot >= earliestTime);
      }
    }

    return filteredSlots;
  }

  formatTimeSlot(timeSlot: string): string {
    const [hour, minute] = timeSlot.split(':').map(Number);
    const period = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return `${displayHour}:${minute.toString().padStart(2, '0')} ${period}`;
  }

  onDateChange() {
    // Don't automatically reset time selection to avoid change detection error
    // Let user manually select time from available slots
    
    // If same day service is selected, check availability again
    if (this.isSameDaySelected) {
      this.checkSameDayServiceAvailability();
    }

    // Ensure selected time is valid for the chosen date (e.g. weekend minimum).
    this.ensureValidServiceTimeForSelectedDate();
    
    this.saveFormData();
  }

  onTimeChange(time: string) {
    this.serviceTime.setValue(time);
    this.saveFormData();
  }

  onDateSelectorChange(date: string) {
    this.serviceDate.setValue(date);
    
    // Check if the selected date is not today (same day service)
    const today = new Date();
    
    // Compare dates using YYYY-MM-DD format to avoid timezone issues
    const todayFormatted = today.getFullYear() + '-' + 
      String(today.getMonth() + 1).padStart(2, '0') + '-' + 
      String(today.getDate()).padStart(2, '0');
    
    // If user selected a date that's not today, uncheck same day service
    if (date !== todayFormatted) {
      // Find and uncheck the same day service
      const sameDayService = this.selectedExtraServices.find(s => s.extraService.isSameDayService);
      if (sameDayService) {
        this.toggleExtraService(sameDayService.extraService, true); // Skip date change since user selected a specific date
      }
    }
    
    this.onDateChange();
  }

  // Get current cleaning type from form
  getCurrentCleaningType(): string {
    const deepCleaning = this.selectedExtraServices.find(s => s.extraService.isDeepCleaning);
    
    if (deepCleaning) {
      return 'deep';
    }
    return 'normal';
  }

  // Photo upload methods
  async onPhotoSelect(event: any) {
    this.photoUploadError = '';
    const files = event.target.files;
    
    if (!files || files.length === 0) return;
    
    // Check if adding these files would exceed the limit
    if (this.uploadedPhotos.length + files.length > this.maxPhotos) {
      this.photoUploadError = `You can upload a maximum of ${this.maxPhotos} photos`;
      return;
    }
    
    this.isUploadingPhoto = true;
    
    const fileList = Array.from(files as FileList);
    for (const file of fileList) {
      try {
        // Validate file type
        if (!file.type.startsWith('image/') && !file.name.toLowerCase().match(/\.(heic|heif)$/)) {
          this.photoUploadError = 'Only image files are allowed';
          this.isUploadingPhoto = false;
          return;
        }
        
        // Validate file size (15MB limit)
        if (file.size > this.maxFileSize) {
          this.photoUploadError = `File ${file.name} is too large. Maximum size is 15MB`;
          this.isUploadingPhoto = false;
          return;
        }
        
        // Compress and convert to base64
        const result = await this.compressAndConvertToBase64(file);
        this.uploadedPhotos.push({
          file: file,
          preview: this.sanitizer.bypassSecurityTrustUrl(result.preview),
          base64: result.base64
        });
        
        this.isUploadingPhoto = false;
        
        // Clear the input to allow re-selection of the same file
        event.target.value = '';
      } catch (error) {
        console.error('Error processing photo:', error);
        this.photoUploadError = 'Error processing photo';
        this.isUploadingPhoto = false;
      }
    }
  }

  private compressAndConvertToBase64(file: File): Promise<{preview: string, base64: string}> {
    if (!this.isBrowser) {
      return Promise.reject(new Error('Image compression not available in server environment'));
    }
    
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (e: any) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d')!;
          
          // Calculate new dimensions
          let width = img.width;
          let height = img.height;
          const maxDimension = 1200;
          
          // Only resize if image is larger than maxDimension
          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = (height * maxDimension) / width;
              width = maxDimension;
            } else {
              width = (width * maxDimension) / height;
              height = maxDimension;
            }
          }
          
          canvas.width = width;
          canvas.height = height;
          
          // Enable image smoothing for better quality
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          
          // Draw and compress
          ctx.drawImage(img, 0, 0, width, height);
          
          // Convert to base64 with good quality
          const base64 = canvas.toDataURL('image/jpeg', 0.85);
          const base64Data = base64.split(',')[1];
          
          resolve({
            preview: base64,
            base64: base64Data
          });
        };
        
        img.onerror = () => {
          reject(new Error('Failed to load image'));
        };
        img.src = e.target.result;
      };
      
      reader.onerror = () => {
        reject(new Error('Failed to read file'));
      };
      reader.readAsDataURL(file);
    });
  }

  removePhoto(index: number) {
    this.uploadedPhotos.splice(index, 1);
  }

  private preparePhotosForSubmission(): any[] {
    return this.uploadedPhotos.map(photo => ({
      fileName: photo.file.name,
      base64Data: photo.base64,
      contentType: photo.file.type
    }));
  }

  getExtraServiceIcon(extraService: ExtraService): string {
    const serviceName = extraService.name.toLowerCase();
    
    if (serviceName.includes('same day')) return 'fas fa-bolt';
    if (serviceName.includes('extra cleaners')) return 'fas fa-users';
    if (serviceName.includes('extra minutes')) return 'fas fa-clock';
    if (serviceName.includes('cleaning supplies')) return 'fas fa-spray-can';
    if (serviceName.includes('vacuum cleaner')) return 'fas fa-stethoscope fa-flip-vertical';
    if (serviceName.includes('pets')) return 'fas fa-paw';
    if (serviceName.includes('fridge')) return 'fas fa-toilet-portable';
    if (serviceName.includes('oven')) return 'fas fa-pager fa-flip-vertical';
    if (serviceName.includes('kitchen cabinets')) return 'fas fa-box-archive';
    if (serviceName.includes('closets')) return 'fas fa-calendar-week fa-flip-vertical';
    if (serviceName.includes('dishes')) return 'fas fa-utensils';
    if (serviceName.includes('baseboards')) return 'fas fa-ruler-horizontal';
    if (serviceName.includes('windows')) return 'fas fa-table';
    if (serviceName.includes('walls')) return 'fas fa-clapperboard fa-flip-vertical';
    if (serviceName.includes('stairs')) return 'fas fa-stairs';
    if (serviceName.includes('folding') || serviceName.includes('folding / organizing')) return 'fas fa-layer-group';
    if (serviceName.includes('laundry')) return 'fas fa-camera-retro';
    if (serviceName.includes('balcony')) return 'fas fa-store';
    if (serviceName.includes('office')) return 'fas fa-desktop';
    if (serviceName.includes('couches')) return 'fas fa-couch';
    
    // Default icon for unknown services
    return 'fas fa-plus';
  }

  getExtraServiceImage(extraService: ExtraService, isSelected: boolean): string {
    const serviceName = extraService.name.toLowerCase();
    const suffix = isSelected ? '' : '_disabled';
    
    // Map service names to PNG image paths
    if (serviceName.includes('same day')) return `/images/same_day${suffix}.png`;
    if (serviceName.includes('extra cleaners')) return `/images/extra_cleaners${suffix}.png`;
    if (serviceName.includes('extra minutes')) return `/images/extra_minutes${suffix}.png`;
    if (serviceName.includes('cleaning supplies')) return `/images/cleaning_supplies${suffix}.png`;
    if (serviceName.includes('vacuum cleaner')) return `/images/vacuum_cleaner${suffix}.png`;
    if (serviceName.includes('pets')) return `/images/pets${suffix}.png`;
    if (serviceName.includes('fridge')) return `/images/fridge${suffix}.png`;
    if (serviceName.includes('oven')) return `/images/oven${suffix}.png`;
    if (serviceName.includes('kitchen cabinets')) return `/images/kitchen_cabinets${suffix}.png`;
    if (serviceName.includes('closets')) return `/images/closets${suffix}.png`;
    if (serviceName.includes('dishes')) return `/images/dishes${suffix}.png`;
    if (serviceName.includes('baseboards')) return `/images/baseboards${suffix}.png`;
    if (serviceName.includes('windows')) return `/images/windows${suffix}.png`;
    if (serviceName.includes('walls')) return `/images/walls${suffix}.png`;
    if (serviceName.includes('stairs')) return `/images/stairs${suffix}.png`;
    if (serviceName.includes('folding') || serviceName.includes('folding / organizing')) return `/images/folding${suffix}.png`;
    if (serviceName.includes('laundry')) return `/images/laundry${suffix}.png`;
    if (serviceName.includes('balcony')) return `/images/balcony${suffix}.png`;
    if (serviceName.includes('office')) return `/images/office${suffix}.png`;
    if (serviceName.includes('couches')) return `/images/couches${suffix}.png`;
    if (serviceName.includes('chandelier')) return `/images/chandelier${suffix}.png`;
    if (serviceName.includes('ceiling fan')) return `/images/ceiling_fan${suffix}.png`;
    
    // Default image for unknown services
    return `/images/default_icon${suffix}.png`;
  }

  toggleBookingSummary() {
    this.isSummaryCollapsed = !this.isSummaryCollapsed;
    
    if (!this.isBrowser) return;
    
    // When opening, ignore scroll events briefly so scrollIntoView doesn't trigger close
    if (!this.isSummaryCollapsed) {
      this.summaryJustOpened = true;
      const clearFlag = () => { this.summaryJustOpened = false; };
      setTimeout(clearFlag, 900); // Slightly longer than smooth scroll
    }
    
    // Scroll to the booking summary
    setTimeout(() => {
      const summaryElement = document.querySelector('.booking-summary');
      if (summaryElement) {
        summaryElement.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'start' 
        });
      }
    }, 100);
  }

  /**
   * Close expanded booking summary when user scrolls (mobile/tablet).
   * Users often don't notice the close button; scroll-to-close improves UX.
   */
  private summaryScrollCloseHandler = () => {
    if (!this.isBrowser || this.isSummaryCollapsed) return;
    if (this.summaryJustOpened) return; // Don't close on scroll from open-button scrollIntoView
    if (this.summaryCodeActionInProgress) return; // Don't close on layout shift from promo/gift card apply/remove
    if (typeof window === 'undefined' || window.innerWidth > 1200) return;
    this.ngZone.run(() => {
      this.isSummaryCollapsed = true;
      this.cdr.detectChanges();
    });
  };

  /**
   * Returns the current date/time in New York timezone.
   * All same-day service logic uses NY time, not the user's local time.
   */
  private getNowInNewYork(): Date {
    const nowUtc = new Date();
    const nyString = nowUtc.toLocaleString('en-US', { timeZone: 'America/New_York' });
    return new Date(nyString);
  }

  /**
   * Check if same day service should be available based on current time
   * Cleaners need at least 4 hours to prepare, so same day service should be disabled
   * if current time + 4 hours would be after 6:00 PM (18:00)
   */
  private checkSameDayServiceAvailability(): void {
    const now = this.getNowInNewYork();
    
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    
    // Calculate current time in minutes since midnight
    const currentTimeInMinutes = currentHour * 60 + currentMinute;
    
    // Latest possible start time is 6:00 PM (18:00) = 1080 minutes
    const latestStartTimeInMinutes = 18 * 60; // 6:00 PM
    
    // Minimum preparation time needed (4 hours = 240 minutes)
    const minPreparationTimeInMinutes = 4 * 60;
    
    // Check if current time + preparation time would exceed latest start time
    if (currentTimeInMinutes + minPreparationTimeInMinutes > latestStartTimeInMinutes) {
      this.isSameDayServiceAvailable = false;
      
      // Calculate when same day service will be available again (next day)
      const tomorrow = this.getNowInNewYork();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowString = tomorrow.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric'
      });

      const minStartTimeTomorrow = this.getMinimumStartTimeForDate(tomorrow);
      const minStartTimeTomorrowLabel = this.formatTimeSlot(minStartTimeTomorrow);
      this.sameDayServiceDisabledReason = `Requires 4 hours notice. Available again on ${tomorrowString} at ${minStartTimeTomorrowLabel}.`;
    } else {
      this.isSameDayServiceAvailable = true;
      this.sameDayServiceDisabledReason = '';
    }
  }

  /** Returns true when same-day service is selected but today has no available (non-blocked) time slots. */
  isSameDayFullyBooked(): boolean {
    if (!this.isSameDaySelected) return false;
    const dateStr = this.serviceDate.value;
    if (!dateStr) return false;
    const cleanDate = typeof dateStr === 'string' ? dateStr.split('T')[0] : dateStr;
    // Fully blocked day
    if (this.blockedFullDays.has(cleanDate)) return true;
    // Check if all available time slots are blocked
    const slots = this.getAvailableTimeSlots();
    const blockedSet = new Set(this.getBlockedHoursForSelectedDate());
    return slots.length === 0 || slots.every(slot => blockedSet.has(slot));
  }

  /**
   * Get the earliest available time for same day service
   * Returns the time that gives cleaners at least 4 hours to prepare
   */
  private getEarliestSameDayServiceTime(): string {
    const now = this.getNowInNewYork();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    
    // Calculate current time in minutes since midnight
    const currentTimeInMinutes = currentHour * 60 + currentMinute;
    
    // Minimum preparation time needed (4 hours = 240 minutes)
    const minPreparationTimeInMinutes = 4 * 60;
    
    // Calculate earliest possible start time
    const earliestStartTimeInMinutes = currentTimeInMinutes + minPreparationTimeInMinutes;
    
    // Convert back to hours and minutes
    const earliestHour = Math.floor(earliestStartTimeInMinutes / 60);
    const earliestMinute = earliestStartTimeInMinutes % 60;
    
    // Round up to the next 30-minute slot
    let roundedHour = earliestHour;
    let roundedMinute = earliestMinute <= 30 ? 30 : 0;
    
    if (roundedMinute === 0) {
      roundedHour += 1;
    }
    
    // Ensure we don't exceed 6:00 PM (18:00)
    if (roundedHour >= 18) {
      return '18:00'; // 6:00 PM
    }

    // Ensure we don't go earlier than the day-specific minimum start time.
    const minStartTime = this.getMinimumStartTimeForDate(now); // 08:00 or 09:30
    const [minHour, minMinute] = minStartTime.split(':').map(Number);
    const earliestTotalMinutes = roundedHour * 60 + roundedMinute;
    const minTotalMinutes = minHour * 60 + minMinute;
    if (earliestTotalMinutes < minTotalMinutes) {
      roundedHour = minHour;
      roundedMinute = minMinute;
    }

    return `${roundedHour.toString().padStart(2, '0')}:${roundedMinute.toString().padStart(2, '0')}`;
  }


  toggleExtraInfoExpansion() {
    this.isExtraInfoExpanded = !this.isExtraInfoExpanded;
  }


  getServiceSpecificInfo(): string {
    if (!this.selectedServiceType) return '';
    
    const serviceName = this.selectedServiceType.name.toLowerCase();
    
    if (serviceName.includes('move in') || serviceName.includes('move out') || serviceName.includes('move-in') || serviceName.includes('move-out')) {
      return 'move-in-out';
    } else if (serviceName.includes('heavy condition') || serviceName.includes('heavy-condition')) {
      return 'heavy-condition';
    } else {
      return 'standard';
    }
  }

  isDeepCleaningSelected(): boolean {
    return this.selectedExtraServices.some(service => service.extraService.isDeepCleaning);
  }

  // Form step navigation methods
  nextStep() {
    if (this.currentStep < this.totalSteps) {
      // Check if current step is valid before proceeding
      if (this.canProceedToNextStep()) {
        // Clear validation errors from current step before moving to next
        this.clearCurrentStepValidationErrors();
        this.currentStep++;
        if (this.currentStep === 3) {
          this.autocompleteInitRetryCount = 0;
          setTimeout(() => this.initAddressAutocomplete(), 100);
        }
        this.updateBookingStepUrl();
        // Scroll to top when navigating to next step
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        // If step is invalid, scroll to first error
        this.scrollToFirstErrorInCurrentStep();
      }
    }
  }

  // Handle next button click (works like onSubmit)
  onNextButtonClick() {
    // Check if current step is valid before proceeding
    if (this.canProceedToNextStep()) {
      if (this.shouldConfirmCleaningSuppliesBeforeContinuing()) {
        this.showCleaningSuppliesConfirm = true;
        return;
      }
      this.nextStep();
    } else {
      // If step is invalid, scroll to first error in current step
      this.scrollToFirstErrorInCurrentStep();
    }
  }

  closeCleaningSuppliesConfirm(): void {
    this.showCleaningSuppliesConfirm = false;
  }

  selectCleaningSuppliesAndContinue(): void {
    const extra = this.getCleaningSuppliesExtraService();
    if (extra && !this.isExtraServiceSelected(extra)) {
      this.toggleExtraService(extra);
    }
    this.showCleaningSuppliesConfirm = false;
    this.nextStep();
  }

  continueWithoutCleaningSupplies(): void {
    this.showCleaningSuppliesConfirm = false;
    this.nextStep();
  }

  get cleaningSuppliesCleaningTypeLabel(): string {
    return this.cleaningType?.value === 'deep' ? 'Deep Cleaning' : 'Standard Cleaning';
  }

  get cleaningSuppliesExtraCost(): number | null {
    const extra = this.getCleaningSuppliesExtraService();
    const price = extra?.price;
    return typeof price === 'number' && !Number.isNaN(price) ? price : null;
  }

  private shouldConfirmCleaningSuppliesBeforeContinuing(): boolean {
    // Only applies to regular bookings on step 1 (not poll, not custom pricing)
    if (this.currentStep !== 1) return false;
    if (this.showPollForm || this.showCustomPricing) return false;
    if (!this.selectedServiceType) return false;

    const cleaningSuppliesExtra = this.getCleaningSuppliesExtraService();
    if (!cleaningSuppliesExtra) return false; // If service type doesn't offer it, don't block
    return !this.isExtraServiceSelected(cleaningSuppliesExtra);
  }

  private getCleaningSuppliesExtraService(): ExtraService | null {
    const extras = this.selectedServiceType?.extraServices || [];
    const match = extras.find(e => (e?.name || '').toLowerCase().includes('cleaning supplies'));
    return match || null;
  }

  previousStep() {
    if (this.currentStep > 1) {
      this.currentStep--;
      this.updateBookingStepUrl();
      // Scroll to top when navigating to previous step
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  /** Update URL query param ?step=N so refresh and return-from-login keep user on same tab. */
  private updateBookingStepUrl(): void {
    if (!this.isBrowser) return;
    const currentStepInUrl = this.route.snapshot.queryParamMap.get('step');
    if (currentStepInUrl === String(this.currentStep)) return; // already in sync, avoid extra navigation
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { step: this.currentStep },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  // Validation methods for each step
  isStep1Valid(): boolean {
    if (!this.selectedServiceType) return false;

    if (this.showPollForm) {
      // For step 1, only check poll questions
      // Contact info, address, and consent will be checked on step 3
      for (const question of this.pollQuestions) {
        if (question.isRequired && (!this.pollAnswers[question.id] || this.pollAnswers[question.id].trim() === '')) {
          return false;
        }
      }
      return true;
    }

    if (this.showCustomPricing) {
      return this.serviceTypeControl.valid &&
             this.customAmount.valid &&
             this.customCleaners.valid &&
             this.customDuration.valid;
    }

    // Block continue if same-day service is selected but today is fully booked
    if (this.isSameDaySelected && this.isSameDayFullyBooked()) {
      return false;
    }

    // Block continue if selected date/time is blocked (for non-admin users)
    if (this.isSelectedDateTimeBlocked()) {
      return false;
    }

    // For regular booking, check service type and cleaning type
    return this.serviceTypeControl.valid &&
           this.cleaningType.value !== null;
  }

  isStep2Valid(): boolean {
    if (!this.selectedServiceType) return false;
    
    if (this.showPollForm) {
      // For poll forms on step 2, check contact info (name and phone)
      return this.contactFirstName.valid && this.contactPhone.valid;
    }
    
    // Block continue if selected date/time is blocked (for non-admin users)
    if (this.isSelectedDateTimeBlocked()) return false;

    return this.selectedSubscription !== null &&
           this.serviceDate.valid &&
           this.serviceTime.valid &&
           this.entryMethod.valid;
  }

  isStep3Valid(): boolean {
    if (!this.selectedServiceType) return false;
    
    if (this.showPollForm) {
      // For poll forms on step 3, check everything including contact info, address, and consent
      return this.isPollFormValid();
    }
    
    return this.contactFirstName.valid &&
           this.contactLastName.valid &&
           this.contactEmail.valid &&
           this.contactPhone.valid &&
           this.serviceAddress.valid &&
           this.city.valid &&
           this.state.valid &&
           this.zipCode.valid &&
           this.smsConsent.value === true &&
           this.cancellationConsent.value === true;
  }

  // Check if we can proceed to next step
  canProceedToNextStep(): boolean {
    switch (this.currentStep) {
      case 1:
        return this.isStep1Valid();
      case 2:
        return this.isStep2Valid();
      case 3:
        return this.isStep3Valid();
      default:
        return false;
    }
  }

  // Clear validation errors from current step
  private clearCurrentStepValidationErrors() {
    // Mark all form controls as untouched to clear error states
    this.markFormGroupUntouched(this.bookingForm);
    
    // Mark service type control as untouched
    this.serviceTypeControl.markAsUntouched();
    
    // Mark custom pricing controls as untouched if applicable
    if (this.showCustomPricing) {
      this.customAmount.markAsUntouched();
      this.customCleaners.markAsUntouched();
      this.customDuration.markAsUntouched();
    }
    
    // Reset form submitted flag
    this.formSubmitted = false;
  }

}