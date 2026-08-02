import { Component, OnInit, OnDestroy, ChangeDetectorRef, NgZone, Inject, PLATFORM_ID, afterNextRender, Injector, runInInjectionContext, ViewChild, ElementRef } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, FormControl, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { HttpClientModule } from '@angular/common/http';
import { BookingService, ServiceType, Service, ExtraService, Subscription, BookingCalculation, BlockedTimeSlot } from '../services/booking.service';
import { PAYMENT_METHOD_OPTIONS, PaymentMethodValue } from '../shared/payment-method';
import { CARD_ON_FILE_ENABLED } from '../shared/card-on-file.flag';
import { AuthService } from '../services/auth.service';
import { AuthModalService } from '../services/auth-modal.service';
import { ProfileService } from '../services/profile.service';
import { LocationService } from '../services/location.service';
import { BookingDataService } from '../services/booking-data.service';
import { DurationUtils } from '../utils/duration.utils';
import { SpecialOfferService, UserSpecialOffer, PublicSpecialOffer } from '../services/special-offer.service';
import { FormPersistenceService, BookingFormData } from '../services/form-persistence.service';
import { OrderService, OrderList, Order } from '../services/order.service';
import { Subject, takeUntil, debounceTime, startWith, distinctUntilChanged, map, skip } from 'rxjs';
import { PollService, PollQuestion, PollAnswer, PollSubmission } from '../services/poll.service';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { DurationSelectorComponent } from './duration-selector/duration-selector.component';
import { TimeSelectorComponent } from './time-selector/time-selector.component';
import { DateSelectorComponent } from './date-selector/date-selector.component';
import { AdminService, UserAdmin } from '../services/admin.service';
import { ShimmerDirective } from '../shared/directives/shimmer.directive';
import { GoogleMapsLoaderService } from '../services/google-maps-loader.service';
import { FloorTypeSelectorComponent, FloorTypeSelection } from '../shared/components/floor-type-selector/floor-type-selector.component';
import { AdminUserSearchComponent } from './admin-user-search/admin-user-search.component';
import { ReorderSectionComponent } from './reorder-section/reorder-section.component';
import { CleaningTypeDetailsExpandableComponent } from '../shared/components/cleaning-type-details-expandable/cleaning-type-details-expandable.component';
import { MoveInOutChecklistComponent } from '../shared/components/move-in-out-checklist/move-in-out-checklist.component';
import { QuantityControlComponent } from '../shared/components/quantity-control/quantity-control.component';
import { ExtraServicesGridComponent } from '../shared/components/extra-services-grid/extra-services-grid.component';
import { OrderSummaryCardComponent, SummaryLine } from '../shared/components/order-summary-card/order-summary-card.component';
import { formatDate, formatNumber } from '@angular/common';
import { BubbleRewardsService, RedemptionOption } from '../services/bubble-rewards.service';
import { normalizePhone10, sanitizePhoneInput } from '../utils/phone.utils';
import {
  getExtraServiceImage,
  getExtraServiceTooltip,
  formatTime12h,
  MobileTooltipManager
} from '../shared/booking/extra-service-display.utils';
import {
  calculateQuote,
  calculateTotals,
  resolveLoyaltyStacking,
  resolveGiftCardAmountToUse,
  resolvePriceMultiplier,
  getServiceDisplayPrice,
  getExtraServiceDisplayPrice,
  getServiceDisplayDuration,
  getSquareFeetForBedrooms,
  getSquareFeetOptions,
  buildQuoteInputFromSelections,
  mapSelectedExtraInputs,
  round2,
  SALES_TAX_RATE,
  EXTRA_CLEANERS_NAME,
  QuoteInput
} from '../shared/pricing/order-pricing.calculator';
import { buildCustomServiceTypeNameOptions } from '../shared/booking/custom-service-type.util';

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
  imports: [CommonModule, FormsModule, ReactiveFormsModule, HttpClientModule, RouterModule, DurationSelectorComponent, TimeSelectorComponent, DateSelectorComponent, ShimmerDirective, FloorTypeSelectorComponent, CleaningTypeDetailsExpandableComponent, MoveInOutChecklistComponent, AdminUserSearchComponent, ReorderSectionComponent, QuantityControlComponent, ExtraServicesGridComponent, OrderSummaryCardComponent],
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
  // Admin-chosen display name for the custom ("Pre-Arranged") service type. Required while custom
  // pricing is shown. Options are built from the live DB service types (Residential -> Regular/Deep).
  customServiceName: FormControl = new FormControl('', [Validators.required]);
  customServiceNameOptions: string[] = [];
  bedroomsQuantityControl: FormControl = new FormControl(0, [Validators.required, Validators.min(0), Validators.max(10)]);
  bathroomsQuantityControl: FormControl = new FormControl(1, [Validators.required, Validators.min(0), Validators.max(10)]);

  // Service Type Form Control
  serviceTypeControl: FormControl = new FormControl('', [Validators.required]);

  // Data
  serviceTypes: ServiceType[] = [];
  /** Service types to show in the dropdown: Custom only for Admin/SuperAdmin. */
  get visibleServiceTypes(): ServiceType[] {
    return this.serviceTypes.filter(st => !st.isCustom || this.isAdminOrSuperAdmin);
  }

  /**
   * Admin or SuperAdmin (NOT Moderator). These two roles may select the Same Day Service
   * extra without the 4-hour-notice / time-of-day restrictions that apply to customers.
   */
  get isAdminOrSuperAdmin(): boolean {
    const role = this.authService.currentUserValue?.role;
    return role === 'Admin' || role === 'SuperAdmin';
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
  // Card-on-file opt-in: saves the card used to pay this booking for faster checkout later.
  // Saving only — future charges always require an explicit customer/admin action.
  saveCardForFutureUse = false;
  cardOnFileEnabled = CARD_ON_FILE_ENABLED;

  // Special offers
  userSpecialOffers: UserSpecialOffer[] = [];
  firstTimeDiscountPercentage: number = 0; 
  hasFirstTimeDiscountOffer: boolean = false;
  selectedSpecialOffer: UserSpecialOffer | null = null;
  specialOfferApplied = false;
  showGuestOfferLoginModal = false;

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

  // When arriving via ?cleaningType=deep (e.g. "most requested service" CTAs), preselect Deep Cleaning
  preselectDeepCleaning = false;

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
  readonly specialInstructionsMaxLength = 2000;
  // Must match Order.EntryMethod / CreateBookingDto.EntryMethod (500) on the backend.
  readonly entryMethodMaxLength = 500;
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

  // Loyalty Discount (re-engagement). Source-of-truth percentage lives on the user's account;
  // we fetch it once per user-context change (self login OR admin target switch). The booking
  // page never tells the customer WHY they have it — spec section 2.6 framing rules.
  loyaltyDiscountPercentage = 0;
  // Computed each calculateTotal() pass after stacking. Zero when subscription/promo/special
  // beats it.
  loyaltyDiscountAmount = 0;

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
  // Mobile tooltip state — shared machinery in shared/booking/extra-service-display.utils
  // Public: passed into ExtraServicesGridComponent, which reads visibility from it.
  mobileTooltips = new MobileTooltipManager(() => this.isCurrentlyMobile(), 3000);
  
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
  salesTaxRate = SALES_TAX_RATE;
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

  // Reorder functionality (widget UI lives in ReorderSectionComponent)
  previousOrders: OrderList[] = [];
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
  // Search box UI lives in AdminUserSearchComponent; the page owns the selection.
  selectedTargetUser: UserAdmin | null = null;

  // Phase 1 manual payment tracking — admin-only. Reset to defaults whenever admin mode is
  // toggled off or the target user changes so a previous selection doesn't leak across users.
  // PAYMENT_METHOD_OPTIONS is imported below.
  paymentMethodOptions = PAYMENT_METHOD_OPTIONS;
  adminPaymentMethod: PaymentMethodValue = 'Normal';
  adminPaymentReference = '';
  adminPaymentNotes = '';

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
      customEntryMethod: ['', Validators.maxLength(500)],
      specialInstructions: ['', Validators.maxLength(2000)],
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
      cancellationConsent: [false, [Validators.requiredTrue]],
      termsConsent: [false, [Validators.requiredTrue]]
    });
  }

  ngOnInit() {
    // Restore step from URL BEFORE the browser guard so SSR renders the correct step
    // (prevents hydration mismatch that shows the wrong navigation buttons on refresh)
    // Deep-cleaning preselect from CTAs like the homepage "most requested service" button
    this.preselectDeepCleaning = this.route.snapshot.queryParamMap.get('cleaningType') === 'deep';

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
    
    // Refresh special offers when the user logs in or out so guest "first-time" offers
    // are replaced with the user's actual personalized offers after login.
    this.authService.currentUser
      .pipe(
        map(u => u?.id || null),
        distinctUntilChanged(),
        skip(1),
        takeUntil(this.destroy$)
      )
      .subscribe(() => {
        this.loadSpecialOffers();
      });

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
    // Ensure body scroll lock is released if the component is destroyed while a modal is open
    this.setBodyScrollLock(false);
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Locks/unlocks page scrolling while a dc-modal is open. On mobile, without this the
   * background booking form scrolls instead of the modal body when the user drags.
   */
  private setBodyScrollLock(locked: boolean): void {
    if (!this.isBrowser) return;
    document.body.style.overflow = locked ? 'hidden' : '';
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
    if (savedData.termsConsent !== undefined) formValues.termsConsent = savedData.termsConsent;
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
      customServiceName: savedData.customServiceName,
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
            // Extra Cleaners is admin-only now — drop it from restored drafts so an
            // invisible (filtered-out) extra can't keep charging the customer.
            if (extraService && extraService.name === EXTRA_CLEANERS_NAME && extraService.hasQuantity) {
              return;
            }
            if (extraService) {
              this.selectedExtraServices.push({
                extraService,
                quantity: ses.quantity || 1,
                hours: ses.hours || (extraService.hasHours ? 0.5 : 0)
              });
            }
          });
          this.cleaningType.setValue(this.getCurrentCleaningType());
        } else if ((savedData.cleaningType === 'deep' || this.preselectDeepCleaning) && this.canSelectDeepCleaning) {
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
        // Honor ?cleaningType=deep (e.g. "most requested service" CTA) on a fresh booking
        if (this.preselectDeepCleaning && this.canSelectDeepCleaning) {
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
          this.normalizeCleaningTypeForSelectedServiceType();
          this.saveFormData();
        }
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
          this.loadLoyaltyDiscount(this.selectedTargetUser.id);
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
      // Re-evaluate same-day availability once we know the role — Admin/SuperAdmin are exempt
      // from the time restriction, so the flag must reflect the user even if it was set before
      // the user resolved during early init.
      this.checkSameDayServiceAvailability();
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
        // Same trigger fans out to the loyalty discount loader — both are user-context state
        // that needs to refresh whenever the booking page sees a new effective user.
        this.loadLoyaltyDiscount();
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
      // Admins / SuperAdmins may keep Same Day Service on any date — never auto-remove it for them.
      // (Customer flow/timing below is unchanged.)
      if (this.isSameDaySelected && newDate && !this.isAdminOrSuperAdmin) {
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
      termsConsent: this.termsConsent.value,

      // Custom Pricing Data
      customAmount: this.showCustomPricing ? this.customAmount.value : undefined,
      customCleaners: this.showCustomPricing ? this.customCleaners.value : undefined,
      customDuration: this.showCustomPricing ? this.customDuration.value : undefined,
      customServiceName: this.showCustomPricing ? this.customServiceName.value : undefined,
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
      this.termsConsent.setValue(false);
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

      // Build the name options from the live service types (Residential -> Regular/Deep) and
      // restore any previously chosen name.
      this.customServiceNameOptions = buildCustomServiceTypeNameOptions(this.serviceTypes);
      this.customServiceName.setValue(this.savedCustomPricingData?.customServiceName || '');

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

      this.termsConsent.clearValidators();
      this.termsConsent.updateValueAndValidity();

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
      
      this.applyContactEmailValidators();

      this.smsConsent.setValidators([Validators.requiredTrue]);
      this.smsConsent.updateValueAndValidity();
      
      this.cancellationConsent.setValidators([Validators.requiredTrue]);
      this.cancellationConsent.updateValueAndValidity();

      this.termsConsent.setValidators([Validators.requiredTrue]);
      this.termsConsent.updateValueAndValidity();

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

  // Single definition shared with the order edits (user + admin) so the bedrooms→sqft linkage
  // prices identically everywhere. Reads the Sq.ft service's configured allowances so the
  // slider minimum and the billing allowance are the SAME data — a customer can never sit
  // below their included amount. Falls back to the shared defaults before the catalog loads.
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

  // ===== Sq.ft slider =====
  // The slider runs over an INDEX into the allowed values rather than over raw
  // square feet: a range input steps from its `min`, which made round values
  // unreachable whenever the bedroom minimum ended in 50 (650 → 750 → 850…).
  // See getSquareFeetOptions — the minimum is the only off-round value in the list.
  private sqftOptionsCache: { key: string; options: number[] } | null = null;

  private getSquareFeetOptionsFor(service: Service): number[] {
    const min = this.getSquareFeetMinForBedrooms();
    const max = service.maxValue || 5000;
    const step = service.stepValue || 100;
    const key = `${min}|${max}|${step}`;
    if (this.sqftOptionsCache?.key !== key) {
      this.sqftOptionsCache = { key, options: getSquareFeetOptions(min, max, step) };
    }
    return this.sqftOptionsCache.options;
  }

  getSquareFeetSliderMaxIndex(service: Service): number {
    return this.getSquareFeetOptionsFor(service).length - 1;
  }

  /** Nearest allowed value for the current quantity — saved orders may sit off the grid. */
  getSquareFeetSliderIndex(service: Service, quantity: number): number {
    const options = this.getSquareFeetOptionsFor(service);
    const q = Number(quantity) || 0;
    let best = 0;
    for (let i = 1; i < options.length; i++) {
      if (Math.abs(options[i] - q) < Math.abs(options[best] - q)) best = i;
    }
    return best;
  }

  onSquareFeetSliderChange(service: Service, index: any): void {
    const options = this.getSquareFeetOptionsFor(service);
    const i = Math.min(Math.max(Math.round(Number(index) || 0), 0), options.length - 1);
    this.updateServiceQuantity(service, options[i]);
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
      const minValue = this.getServiceMinValue(service);
      const stepValue = service.stepValue || 1;
      const newQuantity = Math.max(selectedService.quantity - stepValue, minValue);
      this.updateServiceQuantity(service, newQuantity);
    }
  }

  // Effective minimum quantity for a service. The hourly cleaning service has its base
  // minValue bumped to 2.5h whenever the 'Extra Cleaners' extra service is active — the
  // shop's rule is that an Extra-Cleaners booking is always at least 2h30m of work.
  getServiceMinValue(service: Service): number {
    const baseMin = service.minValue || 0;
    if (service.serviceRelationType === 'hours' && this.hasExtraCleanersSelected()) {
      return Math.max(baseMin, 2.5);
    }
    return baseMin;
  }

  hasExtraCleanersSelected(): boolean {
    return this.selectedExtraServices.some(
      s => s.extraService.name === 'Extra Cleaners' && s.extraService.hasQuantity
    );
  }

  // Auto-bump the hours service up to the Extra-Cleaners minimum (2.5h) when the user
  // toggles Extra Cleaners on while hours sits below it. Without this, the +/- control
  // would simply be disabled at a too-low value and the user couldn't tell why.
  private enforceHoursMinForExtraCleaners() {
    const hoursSelected = this.selectedServices.find(
      s => s.service.serviceRelationType === 'hours'
    );
    if (!hoursSelected) return;
    const min = this.getServiceMinValue(hoursSelected.service);
    if (hoursSelected.quantity < min) {
      this.updateServiceQuantity(hoursSelected.service, min);
    }
  }

  // New click handler for extra service card
  onExtraServiceCardClick(extraService: ExtraService) {
    // If it's a disabled same day service and on mobile, show tooltip.
    // Admins / SuperAdmins are never restricted, so they always fall through to the toggle.
    if (extraService.isSameDayService && !this.isSameDayServiceAvailable && !this.isAdminOrSuperAdmin && this.isCurrentlyMobile()) {
      this.clearAllMobileTooltips();
      this.showMobileTooltip(extraService.id);
      return;
    }
    // Otherwise, toggle the service normally
    this.toggleExtraService(extraService);
  }

  toggleExtraService(extraService: ExtraService, skipDateChange: boolean = false) {
    
    // Prevent selecting same day service if it's not available.
    // Admins / SuperAdmins are never blocked (no same-day restrictions for them).
    if (extraService.isSameDayService && !this.isSameDayServiceAvailable && !this.isAdminOrSuperAdmin) {
      return;
    }
    
    const index = this.selectedExtraServices.findIndex(s => s.extraService.id === extraService.id);
    
    if (index > -1) {
      // Remove if already selected
      this.selectedExtraServices.splice(index, 1);

      // On mobile, briefly re-show this service's tooltip so a deselect
      // tap still reveals the description (matches desktop hover behaviour).
      this.clearAllMobileTooltips();
      this.showMobileTooltip(extraService.id);

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

    // Extra Cleaners forces the hourly cleaning service to a 2.5h minimum.
    this.enforceHoursMinForExtraCleaners();

    this.calculateTotal();
    this.saveFormData();
  }

  // Mobile tooltip management — delegates to the shared MobileTooltipManager
  showMobileTooltip(extraServiceId: number) {
    this.mobileTooltips.show(extraServiceId);
  }

  clearMobileTooltip(extraServiceId: number) {
    this.mobileTooltips.clear(extraServiceId);
  }

  clearAllMobileTooltips() {
    this.mobileTooltips.clearAll();
  }

  isMobileTooltipVisible(extraServiceId: number): boolean {
    return this.mobileTooltips.isVisible(extraServiceId);
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
    // Defaults for not-yet-selected cards: 0.5h / qty 1. Math lives in the shared calculator.
    const hours = selected ? selected.hours : 0.5;
    const quantity = selected ? selected.quantity : 1;
    return getExtraServiceDisplayPrice(extraService, quantity, hours, this.getSelectedPriceMultiplier());
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
    // Zero-quantity rule, thresholds, tiers and the multiplier all live in the shared
    // calculator. selectedServices is passed so threshold sources (e.g. bedrooms for sqft)
    // resolve exactly as they do in the summary.
    return getServiceDisplayPrice(service, quantity, this.getSelectedPriceMultiplier(), this.selectedServices);
  }



  selectSubscription(subscription: Subscription) {
    this.selectedSubscription = subscription;
    this.calculateTotal();
    this.saveFormData(); // Persist selected subscription

    // Show mobile tooltip for subscription
    this.showMobileTooltip(subscription.id);
  }

  // Dollar value the user's loyalty discount would contribute to the current subTotal. Used by
  // the apply-promo / apply-special-offer pre-flight gate below so we can refuse to apply a
  // candidate that loyalty would beat anyway (the stacking gate inside calculateTotal would
  // zero it out — better UX to block up front with a clear message). Returns 0 when no loyalty.
  private currentLoyaltyDollarValue(): number {
    if (this.loyaltyDiscountPercentage <= 0) return 0;
    const sub = this.calculation.subTotal || 0;
    if (sub <= 0) return 0;
    return round2(sub * (this.loyaltyDiscountPercentage / 100));
  }

  // Compute what a candidate discount would be worth in $ on the current subTotal, matching
  // the math used by calculateTotal so the pre-flight comparison stays consistent with what
  // the stacking gate actually does. Gift cards aren't checked here — they stack with loyalty.
  private candidateDollarValue(value: number, isPercentage: boolean): number {
    const sub = this.calculation.subTotal || 0;
    if (sub <= 0) return 0;
    if (isPercentage) {
      return round2(sub * (value / 100));
    }
    return Math.min(value, sub);
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

    this.bookingService.validatePromoCode(code, this.calculation.subTotal).subscribe({
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
            // Pre-flight loyalty check (non-gift-card promos only). If the user's existing
            // loyalty discount is worth more than this promo, refuse to apply and tell them
            // why — the stacking gate would zero the promo anyway, so this is just clearer UX.
            const loyaltyDollars = this.currentLoyaltyDollarValue();
            const promoDollars = this.candidateDollarValue(validation.discountValue, validation.isPercentage);
            if (loyaltyDollars > promoDollars) {
              this.errorMessage =
                `You already have a Loyalty Discount of ${this.loyaltyDiscountPercentage}% on your account — ` +
                `it's better than this promo code, so they can't be used together.`;
              return;
            }

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

  // Maps the component's selections into the shared calculator's input shape.
  // ALL price math AND the selection→input mapping live in
  // shared/pricing/order-pricing.calculator.ts (mirrored by the backend).
  private buildQuoteInput(): QuoteInput {
    if (this.showCustomPricing && this.customAmount.value) {
      return {
        basePrice: this.selectedServiceType?.basePrice ?? 0,
        baseDuration: this.selectedServiceType?.timeDuration ?? 0,
        services: [],
        extraServices: [],
        isCustomPricing: true,
        customAmount: parseFloat(this.customAmount.value) || 0,
        customCleaners: parseInt(this.customCleaners.value) || 1,
        customDuration: parseInt(this.customDuration.value) || 90
      };
    }

    return buildQuoteInputFromSelections(this.selectedServiceType, this.selectedServices, this.selectedExtraServices);
  }

  /** Current cleaning-type multiplier (super deep > deep > 1) from the shared calculator. */
  getSelectedPriceMultiplier(): number {
    return resolvePriceMultiplier(mapSelectedExtraInputs(this.selectedExtraServices)).multiplier;
  }

  calculateTotal() {
    // Single source of truth: the shared pricing calculator (mirrored by the backend).
    const quote = calculateQuote(this.buildQuoteInput());

    this.calculatedMaidsCount = quote.maidsCount;
    this.actualTotalDuration = quote.totalDuration;
    const subTotal = quote.subTotal;

    // Reset discount amounts
    this.subscriptionDiscountAmount = 0;
    this.promoOrFirstTimeDiscountAmount = 0;

    // Subscription discount: only when the user's active subscription matches the selection.
    if (this.hasActiveSubscription && this.userSubscription && this.selectedSubscription) {
      const userSubscriptionDays = this.getSubscriptionDaysForSubscription(this.userSubscription.subscriptionName);
      const selectedSubscriptionDays = this.selectedSubscription.subscriptionDays || 0;
      if (userSubscriptionDays === selectedSubscriptionDays && selectedSubscriptionDays > 0) {
        this.subscriptionDiscountAmount = round2(subTotal * (this.selectedSubscription.discountPercentage / 100));
      }
    }

    // Promo / special offer / first-time discount (can stack with subscription).
    if (this.specialOfferApplied && this.selectedSpecialOffer) {
      const offer = this.selectedSpecialOffer;
      this.promoOrFirstTimeDiscountAmount = offer.isPercentage
        ? round2(subTotal * (offer.discountValue / 100))
        : Math.min(offer.discountValue, subTotal);
    } else if (this.hasFirstTimeDiscount && this.currentUser?.firstTimeOrder && this.firstTimeDiscountApplied) {
      this.promoOrFirstTimeDiscountAmount = round2(subTotal * (this.firstTimeDiscountPercentage / 100));
    } else if (this.promoCodeApplied && !this.giftCardApplied) {
      this.promoOrFirstTimeDiscountAmount = this.promoIsPercentage
        ? round2(subTotal * (this.promoDiscount / 100))
        : this.promoDiscount;
    }

    // Loyalty Discount stacking — mutates the three discount slots in place.
    this.applyLoyaltyStacking(subTotal);

    // Total discount is the sum of all three slots; after stacking at most two are non-zero.
    const totalDiscountAmount = this.subscriptionDiscountAmount + this.promoOrFirstTimeDiscountAmount + this.loyaltyDiscountAmount;

    const tips = this.tips.value || 0;
    const companyDevelopmentTips = this.companyDevelopmentTips.value || 0;
    const totalTips = tips + companyDevelopmentTips;

    const totals = calculateTotals({
      subTotal,
      discountAmount: this.promoOrFirstTimeDiscountAmount,
      subscriptionDiscountAmount: this.subscriptionDiscountAmount,
      loyaltyDiscountAmount: this.loyaltyDiscountAmount,
      tips,
      companyDevelopmentTips
    });

    // Gift card / bubble points / bubble credits come off the very end.
    let finalTotal = totals.totalBeforeGiftCard;
    if (this.giftCardApplied && this.isGiftCard) {
      this.giftCardAmountToUse = resolveGiftCardAmountToUse(this.giftCardBalance, totals.totalBeforeGiftCard);
      finalTotal = Math.max(0, finalTotal - this.giftCardAmountToUse);
    }
    if (this.selectedPointsToRedeem > 0 && this.pointsDiscountAmount > 0) {
      finalTotal = Math.max(0, finalTotal - this.pointsDiscountAmount);
    }
    if (this.useCredits && this.userBubbleCredits > 0) {
      finalTotal = Math.max(0, finalTotal - this.userBubbleCredits);
    }

    this.calculation = {
      subTotal: round2(subTotal),
      tax: totals.tax,
      discountAmount: totalDiscountAmount,
      tips: totalTips,
      total: round2(finalTotal),
      totalDuration: quote.displayDuration
    };

    // Next order's total with the subscription discount applied (no tips/gift card).
    if (this.selectedSubscription && this.selectedSubscription.subscriptionDays > 0 && !this.hasActiveSubscription) {
      this.nextOrderDiscount = round2(subTotal * (this.selectedSubscription.discountPercentage / 100));
      const nextTotals = calculateTotals({ subTotal, discountAmount: this.nextOrderDiscount });
      this.nextOrderTotal = nextTotals.discountedSubTotal + nextTotals.tax;
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
    if (this.isOfficeCleaningServiceType()) return false;
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
    return basePrice * this.getSelectedPriceMultiplier();
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
    return formatTime12h(time);
  }

  // ── Summary card line builders (OrderSummaryCardComponent) ──────────────
  // Same content/conditions as the old inline summary markup; `mobile` keeps
  // the mobile card's small differences (no shimmer, no '—' fallbacks,
  // 'Bubble Points' label).

  getSummaryDetailLines(mobile: boolean): SummaryLine[] {
    const lines: SummaryLine[] = [];
    if (mobile && !this.selectedServiceType) return lines;

    lines.push({ label: 'Service Type:', value: this.selectedServiceType?.name || (mobile ? '' : '—'), shimmer: !mobile && this.loading.serviceTypes });

    if (this.showCustomPricing) {
      lines.push({ label: 'Number of Cleaners:', value: `${this.customCleaners.value}`, shimmer: !mobile && this.loading.serviceTypes });
      lines.push({ label: 'Duration:', value: this.formatDuration(this.customDuration.value), shimmer: !mobile && this.loading.serviceTypes });
    } else {
      if (this.selectedSubscription) {
        lines.push({ label: 'Cleaning frequency:', value: this.selectedSubscription.name || (mobile ? '' : '—'), shimmer: !mobile && this.loading.summary });
      }
      lines.push({ label: 'Duration:', value: this.formatDuration(this.calculation.totalDuration), shimmer: !mobile && this.loading.summary });
      // Cleaner count is only a customer-facing concept for cleaner+hours service
      // types; for regular types the team decides staffing (admin-set, never shown).
      if (this.hasCleanerServices()) {
        lines.push({ label: 'Number of Cleaners:', value: `${this.calculatedMaidsCount}`, shimmer: !mobile && this.loading.summary });
      }
    }

    const hasDateTime = this.serviceDate.value && this.serviceTime.value;
    if (hasDateTime || !mobile) {
      lines.push({
        label: 'Date & Time:',
        value: hasDateTime ? `${formatDate(this.serviceDate.value, 'MMM d', 'en-US')} at ${this.formatTime(this.serviceTime.value)}` : '—',
        shimmer: !mobile && this.loading.summary
      });
    }
    return lines;
  }

  getSummaryPriceLines(mobile: boolean): SummaryLine[] {
    const shimmer = !mobile && this.loading.pricing;
    const lines: SummaryLine[] = [];

    lines.push({ label: 'Subtotal:', value: `$${this.calculation.subTotal.toFixed(2)}`, shimmer });

    if (this.subscriptionDiscountAmount > 0) {
      lines.push({
        label: `Plan discount (${this.userSubscription?.discountPercentage}%):`,
        value: `-$${this.subscriptionDiscountAmount.toFixed(2)}`,
        rowClass: 'subscription-discount', valueClass: 'discount', shimmer
      });
    }

    if (this.loyaltyDiscountAmount > 0) {
      lines.push({
        label: `Loyalty Discount (${this.loyaltyDiscountPercentage}%):`,
        value: `-$${this.loyaltyDiscountAmount.toFixed(2)}`,
        valueClass: 'discount', shimmer
      });
    }

    if (this.promoOrFirstTimeDiscountAmount > 0) {
      let label = '';
      if (this.specialOfferApplied && this.selectedSpecialOffer) {
        label = this.selectedSpecialOffer.name + (this.selectedSpecialOffer.isPercentage ? ` (${this.selectedSpecialOffer.discountValue}%)` : '');
      } else if (this.firstTimeDiscountApplied) {
        label = `First-Time Discount (${this.firstTimeDiscountPercentage}%)`;
      } else if (this.promoCodeApplied) {
        label = 'Promo Code Discount' + (this.promoIsPercentage ? ` (${this.promoDiscount}%)` : '');
      }
      lines.push({ label, value: `-$${this.promoOrFirstTimeDiscountAmount.toFixed(2)}`, valueClass: 'discount', shimmer });
    }

    if (this.giftCardApplied) {
      lines.push({
        label: 'Gift Card Discount:',
        value: `-$${this.getGiftCardDisplayInfo().amountToUse.toFixed(2)}`,
        rowClass: 'gift-card-discount', valueClass: 'discount', shimmer
      });
    }

    if (this.selectedPointsToRedeem > 0) {
      lines.push({
        label: `${mobile ? 'Bubble Points' : 'Points'} (${formatNumber(this.selectedPointsToRedeem, 'en-US')} pts):`,
        value: `-$${formatNumber(this.pointsDiscountAmount, 'en-US', '1.2-2')}`,
        rowClass: 'points-discount', valueClass: 'discount', shimmer
      });
    }

    if (this.useCredits && this.userBubbleCredits > 0) {
      lines.push({
        label: 'Reward Balance:',
        value: `-$${this.userBubbleCredits.toFixed(2)}`,
        rowClass: 'points-discount', valueClass: 'discount', shimmer
      });
    }

    lines.push({ label: 'Sales Tax (8.875%):', value: `$${this.calculation.tax.toFixed(2)}`, shimmer });

    if (this.tips.value > 0) {
      lines.push({ label: 'Tips for Cleaners:', value: `$${(this.tips.value || 0).toFixed(2)}`, shimmer });
    }

    if (this.companyDevelopmentTips.value > 0) {
      lines.push({ label: 'Tips for Company Development:', value: `$${(this.companyDevelopmentTips.value || 0).toFixed(2)}`, shimmer });
    }

    return lines;
  }

  /** Pts-earn preview value for the summary card; null hides the block. */
  getEstimatedPointsDisplay(): string | null {
    return this.currentUser && this.bubblePointsEnabled && this.estimatedPoints > 0
      ? formatNumber(this.estimatedPoints, 'en-US')
      : null;
  }

  getServiceDuration(service: Service): number {
    // Per-service display duration is NOT multiplier-scaled (bug B1) — it now matches the
    // summary exactly. The multiplier is still passed for signature symmetry.
    const quantity = this.getServiceQuantity(service);
    return getServiceDisplayDuration(service, quantity, this.getSelectedPriceMultiplier(), this.selectedServices);
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
             this.termsConsent.value === true &&
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
           this.cancellationConsent.value === true &&
           this.termsConsent.value === true;
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
    if (this.showCustomPricing && (!this.customAmount.valid || !this.customCleaners.valid || !this.customDuration.valid || !this.entryMethod.value || !this.customServiceName.value)) {
      this.customServiceName.markAsTouched();
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
      // null (not "") when booking for a no-email cash customer — the backend's
      // [EmailAddress] validation accepts null but rejects an empty string.
      contactEmail: formValue.contactEmail?.trim() ? formValue.contactEmail.trim() : null,
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
      // Loyalty Discount the frontend computed for the breakdown preview. Backend re-evaluates
      // from the target user's actual LoyaltyDiscountPercentage and re-runs the stacking gate —
      // this field is sent so the request body is complete, but never trusted server-side.
      loyaltyDiscountAmount: this.loyaltyDiscountAmount,
      subTotal: this.calculation.subTotal,
      // ADD THESE FIELDS TO FIX THE ISSUE:
      tax: this.calculation.tax,
      total: this.calculation.total,
      calculation: this.calculation, // Add the full calculation object
      // TOTAL cleaner-minutes from the shared calculator (custom pricing included — the
      // calculator already stores per-cleaner × cleaners with the 1h floor). The booking
      // summary shows this same total for regular types (auto-staffing is disabled);
      // custom/cleaner-hours summaries still show per-cleaner.
      totalDuration: this.actualTotalDuration,
      hasActiveSubscription: this.hasActiveSubscription,
      userSubscriptionId: this.userSubscription?.subscriptionId,
      giftCardCode: this.giftCardApplied && this.isGiftCard ? this.promoCode.value : null,
      giftCardAmountToUse: this.giftCardApplied ? this.giftCardAmountToUse : 0,
      isCustomPricing: this.showCustomPricing,
      customAmount: this.showCustomPricing ? parseFloat(this.customAmount.value) : undefined,
      customCleaners: this.showCustomPricing ? parseInt(this.customCleaners.value) : undefined,
      customDuration: this.showCustomPricing ? parseInt(this.customDuration.value) : undefined,
      // Admin-chosen display name for the custom service type — replaces "Pre-Arranged Cleaning".
      customServiceDisplayName: this.showCustomPricing ? (this.customServiceName.value || null) : undefined,
      bedroomsQuantity: this.getSelectedBedroomsQuantity(),
      bathroomsQuantity: this.getSelectedBathroomsQuantity(),
      smsConsent: formValue.smsConsent,
      cancellationConsent: formValue.cancellationConsent,
      termsConsent: formValue.termsConsent,
      uploadedPhotos: this.preparePhotosForSubmission(),
      floorTypes: this.buildFloorTypesString(),
      floorTypeOther: this.floorTypeOther || null,
      pointsToRedeem: this.selectedPointsToRedeem,
      useCredits: this.useCredits && this.userBubbleCredits > 0,
      creditsToApply: this.useCredits ? Math.min(this.userBubbleCredits, this.calculation.total + this.userBubbleCredits) : 0,
      referralCode: this.isBrowser
        ? (localStorage.getItem('dreamcleaning_referral') ?? undefined)
        : undefined,
      // Card-on-file opt-in — never for admin-created (unpaid/manual) bookings.
      saveCardForFutureUse: this.cardOnFileEnabled && this.saveCardForFutureUse && !this.isAdminMode,
    };

    // If admin mode, create booking for target user (unpaid). Phase 1 manual payment fields
    // ride along — for Normal they're effectively no-ops, for Cash/Zelle/Check/Other the
    // backend records the payment and skips the Pay Now reminder.
    if (this.isAdminMode && this.selectedTargetUser) {
      this.bookingService.createBookingForUser(
        this.selectedTargetUser.id,
        bookingData,
        this.adminPaymentMethod,
        this.adminPaymentMethod !== 'Normal' ? this.adminPaymentReference : null,
        this.adminPaymentMethod !== 'Normal' ? this.adminPaymentNotes : null
      ).subscribe({
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
          this.isAdminMode = false;
          this.resetAdminPaymentFields();
          
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
      const currentPhone = normalizePhone10(this.currentUser.phone) ?? '';
      const newPhone = normalizePhone10(formValue.contactPhone) ?? '';
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
    // Admins / SuperAdmins may book any date with no minimum (incl. today / past dates).
    if (this.isAdminOrSuperAdmin) return '';
    const today = new Date();
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    const year = tomorrow.getFullYear();
    const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const day = String(tomorrow.getDate()).padStart(2, '0'); // Tomorrow
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

  /** Reorder widget opened — lazy-load orders if none are loaded yet. */
  onReorderOpened() {
    if (this.previousOrders.length === 0) {
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
    // (User search/list loading is owned by AdminUserSearchComponent, which
    // initializes itself when admin mode renders it.)
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
      this.resetAdminPaymentFields();

      // Restore the standard email requirement (may have been relaxed for a no-email customer).
      this.applyContactEmailValidators();

      // Reload admin's subscription when admin mode is turned off
      this.loadUserSubscription();
      // Reload loyalty for the admin's own account now that there's no target user.
      this.loadLoyaltyDiscount();

      // Reload admin's own previous orders
      this.previousOrders = [];
      this.loadOrders();
    }
  }

  selectUser(user: UserAdmin) {
    this.selectedTargetUser = user;

    // Store admin's original apartments before loading user's apartments
    this.adminOriginalApartments = [...this.userApartments];

    // Pre-fill form with selected user's contact information
    if (user.firstName) {
      this.contactFirstName.setValue(user.firstName);
    }
    if (user.lastName) {
      this.contactLastName.setValue(user.lastName);
    }
    if (user.isNoEmailUser) {
      // Cash customer without email: blank the field and drop the required rule so the
      // admin can complete the booking. The backend allows a missing contact email only
      // for these accounts (create-for-user checks IsNoEmailUser server-side).
      this.contactEmail.setValue('');
    } else if (user.email) {
      this.contactEmail.setValue(user.email);
    }
    this.applyContactEmailValidators();
    if (user.phone) {
      this.contactPhone.setValue(user.phone.replace(/\D/g, '').slice(0, 10));
    }
    
    // Load and populate user's address information
    this.loadUserAddress(user.id);

    // Load the selected user's subscription (not admin's subscription)
    this.loadUserSubscription(user.id);
    // And the selected user's loyalty discount — must mirror the subscription pattern so the
    // admin's own loyalty never leaks onto a customer order.
    this.loadLoyaltyDiscount(user.id);

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

  // Reset Phase 1 admin payment selection back to defaults. Called when admin mode toggles
  // off, target user changes, or booking submission completes — keeps stale Zelle/Cash values
  // from leaking onto the next booking.
  resetAdminPaymentFields(): void {
    this.adminPaymentMethod = 'Normal';
    this.adminPaymentReference = '';
    this.adminPaymentNotes = '';
  }

  clearSelectedUser() {
    this.selectedTargetUser = null;
    this.resetAdminPaymentFields();

    // Restore the standard email requirement (may have been relaxed for a no-email customer).
    this.applyContactEmailValidators();

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
    // Same for loyalty: clear back to the admin's own account.
    this.loadLoyaltyDiscount();

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
            // Extra Cleaners is admin-only now — don't carry it over from a past
            // order into a new booking (it would be selected but invisible).
            if (extraService && extraService.name === EXTRA_CLEANERS_NAME && extraService.hasQuantity) {
              return;
            }
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

    // Pre-flight loyalty check. The stacking gate inside calculateTotal would zero this offer
    // anyway if loyalty beats it — surface that explicitly instead of letting the user click
    // "Apply" and watch nothing visible change.
    const loyaltyDollars = this.currentLoyaltyDollarValue();
    const offerDollars = this.candidateDollarValue(offer.discountValue, offer.isPercentage);
    if (loyaltyDollars > offerDollars) {
      this.errorMessage =
        `You already have a Loyalty Discount of ${this.loyaltyDiscountPercentage}% on your account — ` +
        `it's better than this offer, so they can't be used together.`;
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
      return;
    }
    if (!this.authService.isLoggedIn()) {
      this.showGuestOfferLoginModal = true;
      this.setBodyScrollLock(true);
      return;
    }
    this.applySpecialOffer(offer);
  }

  closeGuestOfferLoginModal() {
    this.showGuestOfferLoginModal = false;
    this.setBodyScrollLock(false);
  }

  openLoginFromGuestOfferModal() {
    this.showGuestOfferLoginModal = false;
    this.setBodyScrollLock(false);
    // navigateAfterLogin in auth-modal reads from BOTH localStorage.returnUrl and
    // authModalService.getReturnUrl(); set both to the current booking URL so the modal
    // (including social logins) keeps the user on the booking page after sign-in.
    const currentUrl = this.router.url || '/booking';
    if (this.isBrowser) {
      try { localStorage.setItem('returnUrl', currentUrl); } catch (_) {}
    }
    this.authModalService.open('login', currentUrl);
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

  /** True when an admin is booking for a cash customer without an email account. */
  get isNoEmailTargetUser(): boolean {
    return this.isAdminMode && !!this.selectedTargetUser?.isNoEmailUser;
  }

  // Single place that decides whether the contact email is required. Every code path
  // that (re)arms email validators must go through this, otherwise a later service-type
  // change silently restores the required rule and blocks admins booking for
  // no-email customers at step 3.
  private applyContactEmailValidators(): void {
    this.contactEmail.setValidators(
      this.isNoEmailTargetUser
        ? [Validators.email]
        : [Validators.required, Validators.email]
    );
    this.contactEmail.updateValueAndValidity();
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

  onContactPhoneInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const cleaned = sanitizePhoneInput(input.value);
    if (input.value !== cleaned) {
      input.value = cleaned;
    }
    this.contactPhone.setValue(cleaned, { emitEvent: false });
  }
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
  get termsConsent() { return this.bookingForm.get('termsConsent') as FormControl; }

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

  // Stacking gate (spec section 2.4) — kept in sync with backend
  // LoyaltyDiscountService.ResolveStacking so frontend preview matches what the server persists.
  //
  // Rule:
  //   Round 1: loyalty vs subscription — higher wins, zero the loser. Both are subTotal-pct-based
  //            so dollar comparison ≡ percentage comparison.
  //   Round 2: round-1 winner vs promo/special/first-time — higher wins, zero the loser.
  //   Subscription that survived round 1 continues to stack with promo as before.
  //   Gift card, bubble points, reward balance: stack normally — untouched here.
  //
  // Mutates this.loyaltyDiscountAmount + this.subscriptionDiscountAmount +
  // this.promoOrFirstTimeDiscountAmount in place so existing callers' totalDiscountAmount sum
  // continues to work without any rewiring downstream.
  private applyLoyaltyStacking(subTotal: number): void {
    this.loyaltyDiscountAmount = 0;
    if (this.loyaltyDiscountPercentage <= 0 || subTotal <= 0) return;

    // Single stacking implementation lives in the shared calculator (mirrored by the backend).
    const loyaltyCandidate = round2(subTotal * (this.loyaltyDiscountPercentage / 100));
    const stacked = resolveLoyaltyStacking(
      loyaltyCandidate,
      this.loyaltyDiscountPercentage,
      this.subscriptionDiscountAmount,
      this.promoOrFirstTimeDiscountAmount
    );
    this.loyaltyDiscountAmount = stacked.loyaltyAmount;
    this.subscriptionDiscountAmount = stacked.subscriptionAmount;
    this.promoOrFirstTimeDiscountAmount = stacked.promoAmount;
  }

  // Load the user's current loyalty discount percentage. In admin mode this MUST read from
  // the target customer's account (not the logged-in admin's) — spec 4.5 step 7 / case 13.
  // Self-mode uses the profile endpoint, which now exposes loyaltyDiscountPercentage.
  // Errors are swallowed (set to 0) so a flaky lookup doesn't block the booking page.
  private loadLoyaltyDiscount(userId?: number) {
    const before = this.loyaltyDiscountPercentage;
    const resetAndRecalc = (pct: number) => {
      this.loyaltyDiscountPercentage = pct || 0;
      if (this.loyaltyDiscountPercentage !== before) {
        this.calculateTotal();
      }
    };

    if (userId && this.isAdminMode) {
      this.adminService.getUserLoyaltyDiscount(userId).subscribe({
        next: (dto) => resetAndRecalc(dto?.percentage ?? 0),
        error: () => resetAndRecalc(0),
      });
      return;
    }

    if (!this.authService.isLoggedIn()) {
      resetAndRecalc(0);
      return;
    }

    this.profileService.getProfile().subscribe({
      next: (profile: any) => resetAndRecalc(profile?.loyaltyDiscountPercentage ?? 0),
      error: () => resetAndRecalc(0),
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

      // Extra Cleaners is admin-only now: the team decides staffing, so customers
      // can't buy cleaners here (the extra stays active for the admin order editor).
      if (extra.name === EXTRA_CLEANERS_NAME && extra.hasQuantity) {
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
    // Booking-specific: a disabled Same Day Service explains why instead.
    if (extra.isSameDayService && !this.isSameDayServiceAvailable) {
      return this.sameDayServiceDisabledReason;
    }
    return getExtraServiceTooltip(extra);
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

  /** Show move in/out checklist when this service type is selected (name from API). */
  isMoveInOutCleaningServiceType(): boolean {
    const name = this.selectedServiceType?.name?.toLowerCase().trim() ?? '';
    if (!name.includes('move')) return false;
    return name.includes('in') && name.includes('out');
  }

  /** Cleaning-type + what's-included UI only for Residential Cleaning (name from API). */
  isResidentialCleaningServiceType(): boolean {
    const name = this.selectedServiceType?.name?.toLowerCase().trim() ?? '';
    return name.includes('residential') && name.includes('cleaning');
  }

  /** Offices don't have bedrooms/bathrooms — suppress the standalone inputs for this service type. */
  isOfficeCleaningServiceType(): boolean {
    const name = this.selectedServiceType?.name?.toLowerCase().trim() ?? '';
    return name.includes('office');
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

  /** Admins / SuperAdmins (and admin-mode bookings) bypass all blocked-date / busy restrictions. */
  get bypassBlockedDates(): boolean {
    return this.isAdminMode || this.isAdminOrSuperAdmin;
  }

  /** Returns list of fully blocked date strings (YYYY-MM-DD) for the date-selector. */
  getBlockedDates(): string[] {
    if (this.bypassBlockedDates) return [];
    return Array.from(this.blockedFullDays);
  }

  /** Returns list of partially blocked date strings (YYYY-MM-DD) for the date-selector. */
  getPartiallyBlockedDates(): string[] {
    if (this.bypassBlockedDates) return [];
    return Array.from(this.blockedHoursMap.keys());
  }

  /** Returns set of blocked hours for a specific date (empty if admin mode). */
  getBlockedHoursForDate(dateStr: string): Set<string> {
    if (this.bypassBlockedDates) return new Set();
    return this.blockedHoursMap.get(dateStr) || new Set();
  }

  /** Returns blocked hours array for the currently selected date (for time-selector input). */
  getBlockedHoursForSelectedDate(): string[] {
    if (this.bypassBlockedDates) return [];
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
    if (this.bypassBlockedDates) return false;
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

    // If same day service is selected, filter time slots based on current time.
    // Admins / SuperAdmins skip this filter — they can pick any time for same-day.
    if (this.isSameDaySelected && !this.isAdminOrSuperAdmin) {
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
    
    // If user selected a date that's not today, uncheck same day service.
    // Admins / SuperAdmins are exempt — they may keep Same Day Service on any date.
    if (date !== todayFormatted && !this.isAdminOrSuperAdmin) {
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
    // Home Office ('cabinet' is the former name, kept as an alias).
    if (serviceName.includes('office') || serviceName.includes('cabinet')) return 'fas fa-desktop';
    if (serviceName.includes('couches')) return 'fas fa-couch';
    
    // Default icon for unknown services
    return 'fas fa-plus';
  }

  getExtraServiceImage(extraService: ExtraService, isSelected: boolean): string {
    // Icon mapping lives in shared/booking/extra-service-display.utils.
    return getExtraServiceImage(extraService, isSelected);
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
    // Admins / SuperAdmins bypass the same-day restriction entirely — always available.
    if (this.isAdminOrSuperAdmin) {
      this.isSameDayServiceAvailable = true;
      this.sameDayServiceDisabledReason = '';
      return;
    }

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
    if (this.bypassBlockedDates) return false;
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
        this.setBodyScrollLock(true);
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
    this.setBodyScrollLock(false);
  }

  selectCleaningSuppliesAndContinue(): void {
    const extra = this.getCleaningSuppliesExtraService();
    if (extra && !this.isExtraServiceSelected(extra)) {
      this.toggleExtraService(extra);
    }
    this.showCleaningSuppliesConfirm = false;
    this.setBodyScrollLock(false);
    this.nextStep();
  }

  continueWithoutCleaningSupplies(): void {
    this.showCleaningSuppliesConfirm = false;
    this.setBodyScrollLock(false);
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
           this.cancellationConsent.value === true &&
           this.termsConsent.value === true;
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