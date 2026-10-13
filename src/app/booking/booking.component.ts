import { Component, OnInit, OnDestroy, ChangeDetectorRef, PLATFORM_ID, afterNextRender, Injector, runInInjectionContext, ElementRef, inject, ChangeDetectionStrategy, viewChild, signal, computed, TransferState } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, FormControl, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { BookingService, ServiceType, Service, ExtraService, Subscription, BookingCalculation, BlockedTimeSlot } from '../services/booking.service';
import {
  PAYMENT_METHOD_OPTIONS, PaymentMethodValue, isSettledOnRecord
} from '../shared/payment-method';
import { InvoiceService, InvoiceClientOption } from '../services/invoice.service';
import { BillingService } from '../services/billing.service';
import { AuthService } from '../services/auth.service';
import { AuthModalService } from '../services/auth-modal.service';
import { ProfileService } from '../services/profile.service';
import { LocationService } from '../services/location.service';
import { BookingDataService } from '../services/booking-data.service';
import { DurationUtils } from '../utils/duration.utils';
import { SpecialOfferService, UserSpecialOffer, PublicSpecialOffer } from '../services/special-offer.service';
import { FormPersistenceService, BookingFormData } from '../services/form-persistence.service';
import { OrderService, OrderList, Order } from '../services/order.service';
import { Subject, takeUntil, debounceTime, startWith, distinctUntilChanged, map, skip, finalize } from 'rxjs';
import { PollService, PollQuestion, PollAnswer, PollSubmission } from '../services/poll.service';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { DurationSelectorComponent } from './duration-selector/duration-selector.component';
import { TimeSelectorComponent } from './time-selector/time-selector.component';
import { DateSelectorComponent } from './date-selector/date-selector.component';
import { AdminService, UserAdmin } from '../services/admin.service';
import { GoogleMapsLoaderService } from '../services/google-maps-loader.service';
import { FloorTypeSelectorComponent, FloorTypeSelection } from '../shared/components/floor-type-selector/floor-type-selector.component';
import { AdminUserSearchComponent } from './admin-user-search/admin-user-search.component';
import {
  RegisterCustomerModalComponent,
  RegisteredCustomer
} from '../shared/components/register-customer-modal/register-customer-modal.component';
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
  resolveSquareFeetForBedroomChange,
  clampRestoredSquareFeet,
  buildQuoteInputFromSelections,
  mapSelectedExtraInputs,
  round2,
  percentOf,
  capFixedDiscount,
  SALES_TAX_RATE,
  isExtraCleaners,
  QuoteInput
} from '../shared/pricing/order-pricing.calculator';
import { findResidentialServiceType, isResidentialServiceType, serviceTypeIs } from '../shared/booking/service-type-keys';
import { findFirstTimeOffer, isFirstTimeOffer as offerIsFirstTime, KeyedOffer } from '../shared/booking/special-offer-keys';
import { buildCustomServiceTypeNameOptions } from '../shared/booking/custom-service-type.util';
import { normalizeTipAmount } from '../shared/booking/tip-amount.utils';
import {
  buildServiceTimeSlots,
  getAllServiceTimeSlots,
  getEarliestStartTimeForDate,
  getLatestStartTime
} from '../shared/booking/service-time-slots';
import {
  LEVEL_OPTIONS,

  PROPERTY_TYPE_APARTMENT,
  PROPERTY_TYPE_HOUSE,
  PropertyType,
  findLevelsService,
  isHouse,
  isLevelsService,
  normalizePropertyType,
  serviceTypeCollectsPropertyType
} from '../shared/booking/property-type.utils';
import {
  buildSupplyChecklistItems,
  CLEANING_ESSENTIALS_ITEMS,
  isCleaningEssentialsExtra,
  isCleaningSuppliesExtra,
  requiresOvenCleaner,
  resolveSupplyChecklistFacts
} from '../shared/booking/supply-checklist.utils';
import {
  SMS_CONSENT_LEAD,
  CANCELLATION_CONSENT_TEXT,
  TERMS_CONSENT_LEAD
} from '../shared/booking/consent-texts';
import {
  BookingDiagnosticsSnapshot,
  logBookingBlockers
} from '../shared/booking/booking-blockers.diagnostics';
import { IconComponent } from '../shared/icons/icon.component';
import { IconDefinition } from '../shared/icons/icon-definition';
import { IconServiceType, serviceTypeIcon } from '../shared/icons/service-type-icon';
import { faBolt } from '../shared/icons/glyphs/faBolt';
import { faBroom } from '../shared/icons/glyphs/faBroom';
import { faCheck } from '../shared/icons/glyphs/faCheck';
import { faChevronDown } from '../shared/icons/glyphs/faChevronDown';
import { faCircleCheck } from '../shared/icons/glyphs/faCircleCheck';
import { faCircleInfo } from '../shared/icons/glyphs/faCircleInfo';
import { faCoins } from '../shared/icons/glyphs/faCoins';
import { faLock } from '../shared/icons/glyphs/faLock';
import { faPiggyBank } from '../shared/icons/glyphs/faPiggyBank';
import { faPlus } from '../shared/icons/glyphs/faPlus';
import { faShieldHalved } from '../shared/icons/glyphs/faShieldHalved';
import { faSprayCanSparkles } from '../shared/icons/glyphs/faSprayCanSparkles';
import { faStar } from '../shared/icons/glyphs/faStar';
import { faTag } from '../shared/icons/glyphs/faTag';
import { faTriangleExclamation } from '../shared/icons/glyphs/faTriangleExclamation';
import { faUserCheck } from '../shared/icons/glyphs/faUserCheck';
import { faUserPlus } from '../shared/icons/glyphs/faUserPlus';
import { faUserShield } from '../shared/icons/glyphs/faUserShield';
import { faXmark } from '../shared/icons/glyphs/faXmark';
import { debugTimersPaused } from '../shared/debug-timers';
import { formViewRefresher } from '../shared/forms/form-view-refresher';
import { SSR_CATALOGUE } from '../shared/ssr/ssr-catalogue.token';
import { SSR_RESPONSE_CONTEXT } from '../shared/ssr/ssr-response.token';
import { SSR_BOOKING_SESSION, SsrBookingSession } from '../shared/ssr/ssr-booking-session.token';
import { fillDraftIdsFromKeys, readBookingChoice } from '../shared/booking/booking-choice-cookie';
import { BookingCatalogueStore } from '../services/booking-catalogue-store.service';
import { AccountStatusService } from '../services/account-status.service';
import { ACCOUNT_STATUS_KEY } from '../shared/account/account-status';
import { BOOKING_INITIAL_STATE_KEY, BookingInitialState, addDaysToIsoDate, newYorkToday } from './booking-initial-state';

/** Address-name presets. Anything that isn't one of the fixed labels is "Other" (free text). */
type AddressNameType = 'Home' | 'Office' | 'Other';
/** Preset labels, and the value a fresh/cleared address falls back to. */
const ADDRESS_NAME_PRESETS: readonly string[] = ['Home', 'Office'];
const DEFAULT_ADDRESS_NAME = 'Home';

/** Naming the address is optional: leaving the "Other" field blank books it as "Other". */
function resolveAddressName(name: string | null | undefined): string {
  return (name ?? '').trim() || 'Other';
}

interface SelectedService {
  service: Service;
  quantity: number;
}

interface SelectedExtraService {
  extraService: ExtraService;
  quantity: number;
  hours: number;
}

/**
 * Who a Book Now click creates the order for. Resolved exactly once, by resolveSubmitTarget().
 * There is deliberately no "unknown" member — an unresolvable target returns null and aborts the
 * submit, so the payment redirect can never be reached by falling through.
 */
type BookingSubmitTarget = 'admin-for-user' | 'self';

/**
 * The admin payment choices on the booking page. `RegularInvoice` is booking-page-only — it is not
 * a stored payment method (the order is an ordinary card order the server issues a regular
 * invoice for), so it deliberately does not live in the shared PaymentMethodValue list used by
 * the orders filters and the recreate modal.
 */
export type AdminBookingPaymentMethod = PaymentMethodValue | 'RegularInvoice';

/** Normal / Cash / Zelle / Check / Other, then Invoice; Commercial invoice only for a business customer. */
export function AdminBookingPaymentOptions(hasBusinessClient: boolean): { value: AdminBookingPaymentMethod; label: string }[] {
  const options: { value: AdminBookingPaymentMethod; label: string }[] =
    PAYMENT_METHOD_OPTIONS.filter(o => o.value !== 'Invoice');
  options.push({ value: 'RegularInvoice', label: 'Invoice' });
  if (hasBusinessClient) options.push({ value: 'Invoice', label: 'Commercial invoice' });
  return options;
}

/** Money already in hand? RegularInvoice is not — it is an unpaid card order with a bill. */
export function adminMethodIsSettled(method: AdminBookingPaymentMethod): boolean {
  return method !== 'RegularInvoice' && isSettledOnRecord(method);
}

@Component({
  selector: 'app-booking',
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterModule, DurationSelectorComponent, TimeSelectorComponent, DateSelectorComponent, FloorTypeSelectorComponent, CleaningTypeDetailsExpandableComponent, MoveInOutChecklistComponent, AdminUserSearchComponent, RegisterCustomerModalComponent, ReorderSectionComponent, QuantityControlComponent, ExtraServicesGridComponent, OrderSummaryCardComponent, IconComponent],
  // This page-level BookingService must get the APP's HttpClient (app.config: authInterceptor).
  // Never add HttpClientModule to `imports` above: it gave this component a private HttpClient
  // with no interceptors, so the service's calls skipped refresh-on-401 and session revocation.
  providers: [BookingService],
  templateUrl: './booking.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './booking.component.scss'
})
export class BookingComponent implements OnInit, OnDestroy {
  /** Re-renders when a form changes outside a template event (see form-view-refresher). */
  private readonly watchForm = formViewRefresher();
  private fb = inject(FormBuilder);
  private bookingService = inject(BookingService);
  private authService = inject(AuthService);
  private authModalService = inject(AuthModalService);
  private profileService = inject(ProfileService);
  private locationService = inject(LocationService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private bookingDataService = inject(BookingDataService);
  private specialOfferService = inject(SpecialOfferService);
  formPersistenceService = inject(FormPersistenceService);
  private pollService = inject(PollService);
  private sanitizer = inject(DomSanitizer);
  private cdr = inject(ChangeDetectorRef);
  private orderService = inject(OrderService);
  private adminService = inject(AdminService);
  private platformId = inject<Object>(PLATFORM_ID);
  private injector = inject(Injector);
  private googleMapsLoader = inject(GoogleMapsLoaderService);
  private bubbleRewardsService = inject(BubbleRewardsService);
  private invoiceService = inject(InvoiceService);
  private transferState = inject(TransferState);
  private bookingCatalogueStore = inject(BookingCatalogueStore);
  /** The signed-in account's shared state: order list, booking context (AccountStatusService). */
  private accountStatus = inject(AccountStatusService);
  /** The signed-in context this page was drawn from (server session, or this tab's prefetch). */
  private sessionContext: SsrBookingSession | null = null;
  /** Server only (absent in the browser): server.ts's in-memory lists, the request's cookies, the session. */
  private ssrCatalogue = inject(SSR_CATALOGUE, { optional: true });
  private ssrContext = inject(SSR_RESPONSE_CONTEXT, { optional: true });
  private ssrSession = inject(SSR_BOOKING_SESSION, { optional: true });

  /**
   * True while this page is being HYDRATED over the server's HTML (created by the app's first
   * navigation in the browser). Its first render must reproduce that HTML exactly, so it draws
   * from the server's BookingInitialState and reads its own storage, cookie and auth state only
   * after that render (reconcileAfterHydration). An in-app navigation renders from scratch.
   */
  private hydrating = false;
  /** What step 1 was first drawn from (server render / hydration); null otherwise. */
  private initialState: BookingInitialState | null = null;
  private reconciled = false;
  /**
   * Off until the page has read the visitor's saved draft. Every save before that point (the
   * server's and hydration's drawing of the form) would overwrite the draft - contact details
   * included - with a form that has not been restored yet.
   */
  private persistenceReady = false;
  /**
   * Whether the catalogue on screen is fresh server data (the server render, or a request made by
   * this page or less than a minute before it). A per-tab copy older than that is DRAWN at once
   * but never priced into a booking: Book Now waits until fresh data has replaced it.
   */
  readonly catalogueFresh = signal(false);
  /** The signed-in user the server drew this page for (their session), or null. */
  private sessionUserId: number | null = null;
  private sessionPermissionKnown = false;
  /** The server already knows the plans / blocked slots / guest offer; the browser does not ask again. */
  private subscriptionsKnown = false;
  private blockedSlotsKnown = false;
  private guestOfferKnown = false;
  private publicDataRequested = false;
  /**
   * The role every role-dependent part of the page is DRAWN for (admin windows, extra prices,
   * same-day rules). Server and hydration take it from the session the server rendered; it then
   * follows the signed-in user (checkAdminStatus). Reading AuthService directly here would let a
   * cached browser user disagree with the server's HTML on the first render.
   */
  private readonly renderRole = signal<string | null>(null);
  /**
   * The Reorder button for the signed-in user, known from the server's session without loading
   * their order list (that list is fetched when the button is opened). Null: unknown.
   */
  readonly hasOrdersHint = signal<boolean | null>(null);

  protected readonly icons = { faBolt, faBroom, faCheck, faChevronDown, faCircleCheck, faCircleInfo, faCoins, faLock, faPiggyBank, faPlus, faShieldHalved, faSprayCanSparkles, faStar, faTag, faTriangleExclamation, faUserCheck, faUserPlus, faUserShield, faXmark };

  private destroy$ = new Subject<void>();
  private isBrowser: boolean;
  /** Set true when navigating to confirmation or clearing form so ngOnDestroy does not overwrite storage. */
  private skipSaveOnDestroy = false;
  
  // Make Math available in template
  Math = Math;

  // Custom pricing properties - initialized with default values
  readonly showCustomPricing = signal(false);
  customAmount: FormControl = new FormControl('', [Validators.required, Validators.min(0.01)]);
  customCleaners: FormControl = new FormControl(1, [Validators.required, Validators.min(1), Validators.max(10)]);
  customDuration: FormControl = new FormControl(60, [Validators.required, Validators.min(60), Validators.max(480)]);
  // Admin-chosen display name for the custom ("Pre-Arranged") service type. Required while custom
  // pricing is shown. Options are built from the live DB service types (Residential -> Regular/Deep).
  customServiceName: FormControl = new FormControl('', [Validators.required]);
  readonly customServiceNameOptions = signal<string[]>([]);
  bedroomsQuantityControl: FormControl = new FormControl(0, [Validators.required, Validators.min(0), Validators.max(10)]);
  /** Custom pricing only: share the bedroom/bathroom counts with the customer (off by default). */
  showRoomCountsToCustomer: FormControl<boolean> = new FormControl(false, { nonNullable: true });
  bathroomsQuantityControl: FormControl = new FormControl(1, [Validators.required, Validators.min(0), Validators.max(10)]);

  // Service Type Form Control
  serviceTypeControl: FormControl = new FormControl('', [Validators.required]);

  // Data
  readonly serviceTypes = signal<ServiceType[]>([]);
  /** Service types to show in the dropdown: Custom only for Admin/SuperAdmin. */
  get visibleServiceTypes(): ServiceType[] {
    return this.serviceTypes().filter(st => !st.isCustom || this.isAdminOrSuperAdmin);
  }

  /**
   * Admin or SuperAdmin (NOT Moderator). These two roles may select the Same Day Service
   * extra without the 4-hour-notice / time-of-day restrictions that apply to customers.
   */
  get isAdminOrSuperAdmin(): boolean {
    const role = this.renderRole();
    return role === 'Admin' || role === 'SuperAdmin';
  }

  /**
   * Admins get the evening window (to 8:00 PM) and skip the weekend 9:30 floor. It follows the
   * ROLE, not Admin Mode: an admin taking a job by phone books it from their own account either
   * way, and a customer can never reach it. Moderators are customers here, as elsewhere in this
   * file. See shared/booking/service-time-slots.
   */
  get hasExtendedBookingHours(): boolean {
    return this.isAdminOrSuperAdmin;
  }

  /**
   * Extra-service prices are shown on the cards to Admin/SuperAdmin ONLY — never a customer
   * (the summary card is what they are quoted) and never a Moderator, same audience as
   * `isAdminOrSuperAdmin` everywhere else in this file. It follows the signed-in ROLE, not
   * Admin Mode: an admin pricing a job over the phone needs the number whether or not they
   * have picked a target customer yet.
   *
   * Off in Custom ("Pre-Arranged") mode: extras there are informational and persisted at $0
   * (see the custom-pricing rules in CLAUDE.md), so a catalogue price on those cards would
   * name money nobody is charging.
   */
  get showExtraServicePrices(): boolean {
    return this.isAdminOrSuperAdmin && !this.showCustomPricing();
  }
  readonly subscriptions = signal<Subscription[]>([]);
  readonly currentUser = signal<any>(null);
  readonly userApartments = signal<any[]>([], { equal: () => false });
  adminOriginalApartments: any[] = []; // Store admin's apartments when selecting a user
  
  // Selected values
  readonly selectedServiceType = signal<ServiceType | null>(null);
  readonly selectedServices = signal<SelectedService[]>([], { equal: () => false });
  readonly selectedExtraServices = signal<SelectedExtraService[]>([], { equal: () => false });

  /**
   * Apartment/condo vs house/townhouse. NO DEFAULT - null means "not answered yet" and step 1
   * stays blocked until the customer picks one. Only asked when the selected service type
   * actually has a levels service (see serviceTypeHasLevels).
   */
  readonly propertyType = signal<PropertyType | null>(null);

  /**
   * Levels to clean, for a house. NO DEFAULT, and deliberately NOT a member of selectedServices
   * until the customer picks a chip.
   *
   * initializeRegularServices seeds every service at its minValue, which for levels is 1. If the
   * levels row lived in selectedServices from the start there would be no way to tell "not yet
   * chosen" from "chose 1 level" - the array would say 1 either way, and the no-default rule
   * would be quietly broken. Keeping it out until a chip is clicked also means a legacy reorder
   * and a pre-feature saved session both arrive with null and are forced to answer, with no
   * special legacy branch anywhere.
   */
  readonly levelsQuantity = signal<number | null>(null);

  /**
   * Stands in for FormControl.touched on the property-type block.
   *
   * propertyType and levelsQuantity are plain fields, not FormControls, so they have no `touched`
   * state and markFormGroupUntouched does not reach them. Every other required step-1 field hides
   * its error behind `control.touched` (a control is only touched on BLUR, never on value change),
   * so the equivalent here is "the customer tried to move on", not "the customer clicked
   * something" - set only when a blocked Continue or Book Now is pressed.
   *
   * Cleared by clearCurrentStepValidationErrors alongside formSubmitted, so stepping back to
   * step 1 does not re-show a stale error.
   */
  readonly propertyTypeTouched = signal(false);

  readonly levelOptions = LEVEL_OPTIONS;
  readonly propertyTypeApartment = PROPERTY_TYPE_APARTMENT;
  readonly propertyTypeHouse = PROPERTY_TYPE_HOUSE;
  readonly selectedSubscription = signal<Subscription | null>(null);
  // Saving a card is no longer asked on this form (2026-09): the question is put once, between
  // the Pay click and the charge, by the pre-payment "Save your card?" modal on the confirmation
  // page — where the card being saved is the card being typed.
  private billingService = inject(BillingService);

  // Special offers
  readonly userSpecialOffers = signal<UserSpecialOffer[]>([]);
  firstTimeDiscountPercentage: number = 0; 
  hasFirstTimeDiscountOffer: boolean = false;
  readonly selectedSpecialOffer = signal<UserSpecialOffer | null>(null);
  readonly specialOfferApplied = signal(false);
  readonly showGuestOfferLoginModal = signal(false);

  // Form
  bookingForm: FormGroup;
  
  // Calculation
  readonly calculation = signal<BookingCalculation>({
    subTotal: 0,
    tax: 0,
    discountAmount: 0,
    tips: 0,
    total: 0,
    totalDuration: 0
  });
  
  // UI state
  /** Granular loading flags for per-section shimmer (SSR: all start true so placeholders render). */
  readonly loading = signal({
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
  }, { equal: () => false });

  // Step 1 confirmation: user didn't select Cleaning Supplies
  readonly showCleaningSuppliesConfirm = signal(false);
  /** Used for extra-services shimmer placeholder count (matches card layout). */
  readonly shimmerExtraCardCount = [1, 2, 3, 4, 5];
  /** Number of service field shimmers to show (matches selected type, saved form, or default). */
  get serviceShimmerPlaceholderCount(): number[] {
    if (this.selectedServiceType()?.services?.length) {
      const n = this.selectedServiceType()!.services.length;
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
    if (!this.serviceTypes()?.length) return null;
    const saved = this.formPersistenceService.getFormData();
    if (saved?.selectedServiceTypeId) {
      const st = this.serviceTypes().find(st => String(st.id) === String(saved.selectedServiceTypeId));
      if (st) return st;
    }
    const residential = findResidentialServiceType(this.serviceTypes());
    return residential ?? this.serviceTypes()[0] ?? null;
  }
  readonly isLoading = signal(false);
  readonly errorMessage = signal('');
  readonly isSameDaySelected = signal(false);
  readonly serviceTypeDropdownOpen = signal(false);
  readonly entryMethodDropdownOpen = signal(false);
  hasFirstTimeDiscount = false;
  firstTimeDiscountApplied = false;
  readonly promoCodeApplied = signal(false);
  readonly promoDiscount = signal(0);
  readonly promoIsPercentage = signal(true);
  readonly calculatedMaidsCount = signal(1);
  actualTotalDuration: number = 0;
  
  // Form step tracking
  readonly currentStep = signal(1);
  totalSteps = 3;

  // When arriving via ?cleaningType=deep (e.g. "most requested service" CTAs), preselect Deep Cleaning
  preselectDeepCleaning = false;

  // Google Places Autocomplete (step 3 address)
  readonly addressContainer = viewChild<ElementRef>('addressAutocompleteContainer');
  autocompleteLoaded = false;
  readonly autocompleteError = signal(false);
  readonly showAddressFallbackAfterDelay = signal(false);
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
  private resizeHandler = () => {
    this.updateExtraServicesToShow();
    this.cdr.detectChanges();
  };
  
  // Debug flags to prevent duplicate logs


  readonly uploadedPhotos = signal<Array<{
    file: File;
    preview: SafeUrl;
    base64: string;
  }>>([], { equal: () => false });
  maxPhotos = 12;
  maxFileSize = 15 * 1024 * 1024; // 15MB per photo
  readonly specialInstructionsMaxLength = 2000;
  // Must match Order.EntryMethod / CreateBookingDto.EntryMethod (500) on the backend.
  readonly entryMethodMaxLength = 500;
  acceptedFormats = 'image/jpeg,image/jpg,image/png,image/webp,image/gif,image/bmp,image/heic,image/heif';
  readonly isUploadingPhoto = signal(false);
  readonly photoUploadError = signal('');
  isMobileDevice = false; // Will be updated in ngOnInit
  
  // Subscription-related properties
  readonly userSubscription = signal<any>(null, { equal: () => false });

  /**
   * The plan the customer chose on their profile's Plan tab. A PREFERENCE, not an entitlement:
   * it only decides which frequency chip starts selected, exactly as if they had tapped it here.
   * It never affects a price — the subscription discount is granted server-side by
   * BookingCreationService.ResolveDiscountsAsync purely from the plan the customer ALREADY
   * holds, which is why the first cleaning on a plan is full price whatever this says.
   * See DreamCleaningBackend/Helpers/PlanSelectionPolicy.
   */
  preferredSubscriptionId: number | null = null;
  readonly hasActiveSubscription = signal(false);
  readonly nextOrderDiscount = signal(0);
  readonly nextOrderTotal = signal(0);
  readonly subscriptionDiscountAmount = signal(0);
  readonly promoOrFirstTimeDiscountAmount = signal(0);

  // Loyalty Discount (re-engagement). Source-of-truth percentage lives on the user's account;
  // we fetch it once per user-context change (self login OR admin target switch). The booking
  // page never tells the customer WHY they have it — spec section 2.6 framing rules.
  readonly loyaltyDiscountPercentage = signal(0);
  // Computed each calculateTotal() pass after stacking. Zero when subscription/promo/special
  // beats it.
  readonly loyaltyDiscountAmount = signal(0);

  // Gift card specific properties
  readonly giftCardApplied = signal(false);
  readonly giftCardBalance = signal(0);
  readonly giftCardAmountToUse = signal(0);
  readonly isGiftCard = signal(false);

  // Bubble Points redemption
  readonly bubblePointsOptions = signal<RedemptionOption[]>([]);
  readonly selectedPointsToRedeem = signal(0);
  readonly pointsDiscountAmount = signal(0);
  readonly userBubblePoints = signal(0);
  readonly userBubbleCredits = signal(0);
  readonly useCredits = signal(false);
  readonly bubblePointsPerDollar = signal(0);
  readonly bubblePointsEnabled = signal(false);
  
  // Mobile tooltip management
  // Mobile tooltip state — shared machinery in shared/booking/extra-service-display.utils
  // Public: passed into ExtraServicesGridComponent, which reads visibility from it.
  mobileTooltips = new MobileTooltipManager(() => this.isCurrentlyMobile(), 3000);
  
  // Tip dropdown state
  readonly tipDropdownOpen = signal(false);

  // Address name: a Home / Office / Other picker sitting next to Zip Code. Home is the default;
  // "Other" swaps in a free-text field. The select is DERIVED from the apartmentName control
  // (see syncAddressNameType) because that control is also written programmatically by the
  // saved-address fill, reorder and the restored session — none of which fire (change).
  readonly addressNameType = signal<AddressNameType>('Home');
  readonly addressNameDropdownOpen = signal(false);
  readonly cityDropdownOpen = signal(false);
  readonly stateDropdownOpen = signal(false);
  readonly savedAddressDropdownOpen = signal(false);
  readonly addressNameOtherInput = viewChild<ElementRef<HTMLInputElement>>('addressNameOtherInput');

  /**
   * The admin-mode customer search. Present only while admin mode is on (it sits inside an
   * `*ngIf`), which is why every use is optional-chained. Needed so a customer registered from
   * this page is in the list the admin is about to search.
   */
  readonly adminUserSearch = viewChild(AdminUserSearchComponent);
  
  // Booking summary collapse state
  readonly isSummaryCollapsed = signal(true);
  /** When true, scroll handler won't close summary (avoids closing on open-button scrollIntoView). */
  private summaryJustOpened = false;
  /** When true, scroll handler won't close summary (avoids closing on promo/gift card apply/remove layout shift). */
  private summaryCodeActionInProgress = false;
  
  
  // Extra info expansion state
  readonly isExtraInfoExpanded = signal(false);
  
  // Saved data for restoration
  savedCustomPricingData: any = null;
  savedPollData: any = null;
  
  // Constants
  salesTaxRate = SALES_TAX_RATE;
  minDate = new Date();
  minTipAmount = 10;
  
  // Entry methods
  entryMethods = [
    'I will be home',
    'Doorman',
    'Office reception',
    'Other'
  ];

  // Floor types
  readonly floorTypes = signal<string[]>([]);
  readonly floorTypeOther = signal<string>('');

  readonly pollQuestions = signal<PollQuestion[]>([]);
  readonly pollAnswers = signal<{ [key: number]: string }>({}, { equal: () => false });
  readonly showPollForm = signal(false);
  readonly pollFormSubmitted = signal(false);
  readonly formSubmitted = signal(false);
  
  // States and Cities - will be loaded from backend
  readonly states = signal<string[]>([]);
  readonly cities = signal<string[]>([]);

  // Same Day Service availability properties
  readonly isSameDayServiceAvailable = signal(true);
  readonly sameDayServiceDisabledReason = signal('');

  // Reorder functionality (widget UI lives in ReorderSectionComponent)
  readonly previousOrders = signal<OrderList[]>([]);
  readonly isLoadingOrders = signal(false);
  readonly reorderingOrderId = signal<number | null>(null);

  // Blocked time slots (scheduling restrictions for non-admin users)
  readonly blockedTimeSlots = signal<BlockedTimeSlot[]>([]);
  readonly blockedFullDays = signal<Set<string>>(new Set(), { equal: () => false });     // YYYY-MM-DD strings
  readonly blockedHoursMap = signal<Map<string, Set<string>>>(new Map(), { equal: () => false }); // date -> set of "HH:mm"

  // Admin functionality
  readonly isAdmin = signal(false);
  isSuperAdmin = false;
  readonly isModerator = signal(false);
  readonly isAdminMode = signal(false);

  /**
   * Whether to offer the header's "Register Customer" button — the same action as the admin
   * Users tab, resolved through the same `canCreate` permission rather than a role check here.
   * `GET api/admin/permissions` grants Create to Admin and SuperAdmin only (Moderators have
   * View), which is exactly who may see this, and it is the flag the endpoint itself enforces.
   */
  readonly canRegisterCustomers = signal(false);
  readonly showRegisterCustomerModal = signal(false);
  /** Transient confirmation after a customer is registered from this page. */
  readonly registeredCustomerMessage = signal('');

  /**
   * Customers registered from this page during this session, fed to the admin search as
   * `seedUsers` so they are selectable IMMEDIATELY — no page reload.
   *
   * The page holds them rather than the search box because the search box lives inside the
   * admin-mode `*ngIf`: registering with Admin Mode off destroys nothing and loses nothing, and
   * the freshly created search box picks the list up from here. Session-scoped on purpose — after
   * a reload the server's own list is authoritative and these are redundant.
   */
  readonly registeredCustomers = signal<UserAdmin[]>([]);

  // Consent copy — shared with the payment page's gate for admin-created orders, so both
  // surfaces always show the same wording (see shared/booking/consent-texts.ts).
  readonly smsConsentLead = SMS_CONSENT_LEAD;
  readonly cancellationConsentText = CANCELLATION_CONSENT_TEXT;
  readonly termsConsentLead = TERMS_CONSENT_LEAD;
  // Search box UI lives in AdminUserSearchComponent; the page owns the selection.
  readonly selectedTargetUser = signal<UserAdmin | null>(null);
  /**
   * Admin Mode: is this order Regular or Commercial work? Starts Regular and follows the picked
   * customer — a business customer switches it to Commercial — and the admin can still change it.
   * The server stores it (Order.IsCommercial); it moves no price.
   */
  readonly adminOrderIsCommercial = signal(false);
  /** True after an admin-mode / target-user change wiped applied discounts, so the admin is told to re-apply. */
  readonly discountsClearedForAccountSwitch = signal(false);

  // Phase 1 manual payment tracking — admin-only. Reset to defaults whenever admin mode is
  // toggled off or the target user changes so a previous selection doesn't leak across users.
  // PAYMENT_METHOD_OPTIONS is imported below.
  /**
   * The admin payment choices on THIS page (2026-09). "Invoice" is the REGULAR customer invoice
   * (`RegularInvoice`: an ordinary card order plus an invoice the customer can pay by card or bank
   * transfer — no client to choose). The commercial invoice is offered as "Commercial invoice"
   * only when the selected customer has a linked business client, and is billed to that client
   * automatically. Rebuilt by refreshAdminPaymentMethodOptions(), never a getter — a new array on
   * every change detection would re-render the radios under the admin's cursor.
   */
  readonly paymentMethodOptions = signal<{ value: AdminBookingPaymentMethod; label: string }[]>(AdminBookingPaymentOptions(false));
  readonly adminPaymentMethod = signal<AdminBookingPaymentMethod>('Normal');
  /** The selected customer's linked commercial client, when they have one. */
  readonly adminBusinessClient = signal<InvoiceClientOption | null>(null);
  readonly adminPaymentReference = signal('');
  readonly adminPaymentNotes = signal('');

  /**
   * The commercial client an INVOICE-method booking is billed to.
   *
   * A ContractClient, not a User: plenty of commercial clients have no website account, and
   * ContractClient is the entity invoices, contracts and billing contacts already hang off. The
   * server refuses an Invoice order without one — a cleaning no invoice can pick up would sit
   * Pending forever with nothing able to settle it.
   */
  adminContractClientId: number | null = null;
  adminContractClients: InvoiceClientOption[] = [];
  loadingContractClients = false;

  /** Set by discardAdminDraftIfPresent() — drives the "session was not restored" banner. */
  readonly adminDraftDiscarded = signal(false);

  constructor() {
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
      // Optional: an empty custom name is booked as "Other" (see resolveAddressName).
      apartmentName: [DEFAULT_ADDRESS_NAME],
      aptSuite: [''],
      city: ['', Validators.required],
      state: ['', Validators.required],
      zipCode: ['', [Validators.required, Validators.pattern(/^\d{5}$/)]],
      promoCode: [''],
      // A number input yields null (not 0) when cleared, and `reset()`/restored form data can
      // put null here too. An empty tip means "no tip" — it must NEVER invalidate the form,
      // or Book Now silently locks up. Only a typed, non-empty amount is held to the minimum.
      tips: [0, [
        Validators.min(0),
        (control: AbstractControl): ValidationErrors | null => {
          const value = normalizeTipAmount(control.value);
          if (value === 0) return null; // Empty / cleared / 0 is always valid
          return value >= this.minTipAmount ? null : { minTipAmount: true };
        }
      ]],
      cleaningType: ['normal', Validators.required], // Add new form control for cleaning type
      smsConsent: [false, [Validators.requiredTrue]],
      cancellationConsent: [false, [Validators.requiredTrue]],
      termsConsent: [false, [Validators.requiredTrue]]
    });
    this.watchForm(this.bookingForm, this.customAmount, this.customCleaners, this.customDuration, this.customServiceName, this.bedroomsQuantityControl, this.showRoomCountsToCustomer, this.bathroomsQuantityControl, this.serviceTypeControl);
  }

  ngOnInit() {

    // Restore step from URL BEFORE the browser guard so SSR renders the correct step
    // (prevents hydration mismatch that shows the wrong navigation buttons on refresh)
    // Deep-cleaning preselect from CTAs like the homepage "most requested service" button
    this.preselectDeepCleaning = this.route.snapshot.queryParamMap.get('cleaningType') === 'deep';

    const stepParam = this.route.snapshot.queryParamMap.get('step');
    const stepNum = stepParam ? parseInt(stepParam, 10) : NaN;
    if (stepNum >= 1 && stepNum <= this.totalSteps) {
      this.currentStep.set(stepNum);
      // Clear all loading flags on step 2/3 so SSR HTML matches client state
      if (this.currentStep() === 2 || this.currentStep() === 3) {
        this.loading().previousOrders = false;
        this.loading.set(this.loading());
        this.loading().promoBanner = false;
        this.loading.set(this.loading());
        this.loading().serviceTypes = false;
        this.loading.set(this.loading());
        this.loading().serviceDetails = false;
        this.loading.set(this.loading());
        this.loading().partnership = false;
        this.loading.set(this.loading());
        this.loading().availableDates = false;
        this.loading.set(this.loading());
        this.loading().timeSlots = false;
        this.loading.set(this.loading());
        this.loading().cleaningTypes = false;
        this.loading.set(this.loading());
        this.loading().extras = false;
        this.loading.set(this.loading());
        this.loading().summary = false;
        this.loading.set(this.loading());
        this.loading().pricing = false;
        this.loading.set(this.loading());
      }
      if (this.isBrowser && this.currentStep() === 3) {
        runInInjectionContext(this.injector, () => {
          afterNextRender(() => {
            this.autocompleteInitRetryCount = 0;
            this.initAddressAutocomplete();
          });
        });
      }
    }

    // Step 1 drawn whole on the FIRST render, on the server and in the hydrating browser alike:
    // the server builds the state (catalogue, plans, blocked slots, the visitor's booking-choice
    // cookie, their session) and ships it in TransferState; hydration draws exactly that before
    // reading anything of its own. See booking-initial-state.ts.
    // Hydrating exactly when the server's state is waiting for this page. (router.navigated is no
    // test here: the route's async guard can finish the first navigation's bookkeeping before
    // this page is created.) The key is removed once read, so an in-app visit never sees it.
    this.hydrating = this.isBrowser && this.transferState.hasKey(BOOKING_INITIAL_STATE_KEY);
    if (this.isBrowser && !this.hydrating) {
      // An in-app navigation: the app's auth state is already the truth to draw from.
      this.renderRole.set(this.authService.currentUserValue?.role ?? null);
      // This user's booking context, prefetched by AccountStatusService (idle time, Book link
      // intent, the /booking resolver): their offers, plan, points and Reorder button are drawn in
      // the first frame instead of arriving after it.
      const context = this.accountStatus.peekBookingContext();
      if (context && context.user.id === this.authService.currentUserValue?.id) this.applySession(context);
    }
    this.initialState = this.takeInitialState();
    if (this.initialState) this.applyInitialState(this.initialState);

    // Only run initialization in browser environment
    if (!this.isBrowser) return;

    // MUST run before anything reads the saved draft (loadSavedFormData / applyServiceTypes).
    // Hydration defers it with the rest of the storage reads (reconcileAfterHydration): its banner
    // would otherwise be in the first render but not in the server's HTML.
    if (!this.initialState) this.discardAdminDraftIfPresent();

    // Check same day service availability
    this.checkSameDayServiceAvailability();

    // Update extra services to show based on screen size. (The extras grid's max-width is CSS
    // now - booking.component.scss - so the server's HTML already has it.)
    this.updateExtraServicesToShow();

    // Set up periodic check for same day service availability (every minute)
    const intervalId = debugTimersPaused() ? undefined : setInterval(() => {
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

    // Minimum date: tomorrow in New York (the business's calendar, on every device).
    this.minDate = this.parseServiceDate(this.newYorkTomorrow())!;

    if (!this.initialState) {
      // Default date/time: tomorrow (New York) at 8:00.
      this.serviceDate.setValue(this.newYorkTomorrow());
      this.serviceTime.setValue('08:00');
      this.ensureValidServiceTimeForSelectedDate();
    }

    // Ensure custom pricing FormControls have proper default values
    this.initializeCustomPricingDefaults();

    // Subscribe to promo code value changes to keep both input fields synchronized
    this.promoCode.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        // Force change detection to update both input fields
        this.cdr.detectChanges();
      });

    if (this.initialState) {
      // The visitor's own storage is read once the server's HTML has been hydrated.
      runInInjectionContext(this.injector, () => {
        afterNextRender(() => this.reconcileAfterHydration());
      });
    } else {
      // Load saved form data if exists
      this.loadSavedFormData();
      this.ensureValidServiceTimeForSelectedDate();
      this.persistenceReady = true;
      // The public data (catalogue, plans, blocked slots) never waits for auth: this tab's copy
      // is drawn in the first frame, and only the signed-in user's own data follows later.
      this.loadPublicData();

      // Do NOT sync URL here: calling updateBookingStepUrl() on init caused a navigation that
      // could reset the component or overwrite restored form data. Step is only updated when
      // user clicks Next/Previous (nextStep/previousStep).

      // Mark booking as started if we have any saved data
      if (this.formPersistenceService.hasSavedData()) {
        this.formPersistenceService.markBookingStarted();
      }
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
        // Not when the offers on screen already belong to whoever is signed in now (the server
        // drew them from this user's session, and auth has only just caught up).
        if (!this.offersCovered()) this.loadSpecialOffers();
      });

    // Wait for auth service to be initialized before proceeding. Hydration runs everything after
    // its first render (the server drew it from the session, never from this browser's auth
    // state); an in-app navigation runs at once, so whatever this tab already holds is drawn in
    // its first frame.
    this.authService.isInitialized$.pipe(
      takeUntil(this.destroy$)
    ).subscribe(isInitialized => {
      if (!isInitialized) return;
      const start = () => {
        this.checkAdminStatus();
        const runLoaders = () => {
          this.reconcileAfterHydration();
          this.loadPublicData();
          this.loadInitialData();
          this.setupFormListeners();
          if (this.offersCovered()) {
            this.loading().promoBanner = false;
            this.loading.set(this.loading());
          } else {
            this.loadSpecialOffers();
          }
          if (!this.ordersCovered()) this.loadOrders();
          this.loading().partnership = false;
          this.loading.set(this.loading());
        };
        // The server already drew this user's profile from their session: no refresh call.
        if (this.authService.isLoggedIn() && !this.sessionCovers()) {
          this.authService.refreshUserProfile().pipe(
            takeUntil(this.destroy$)
          ).subscribe({
            next: runLoaders,
            error: runLoaders
          });
        } else {
          runLoaders();
        }
      };
      if (this.hydrating) {
        runInInjectionContext(this.injector, () => afterNextRender(start));
      } else {
        start();
      }
    });

    if (this.customAmount) {
      this.customAmount.valueChanges
        .pipe(
          takeUntil(this.destroy$)
        )
        .subscribe(() => {
          if (this.showCustomPricing()) {
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
        if (this.showCustomPricing()) {
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
        if (this.showCustomPricing()) {
          this.calculateTotal();
          this.saveFormData(); // Save form data when custom duration changes
        }
      });
    
    // Setup click outside handler for dropdown
    this.setupDropdownClickOutside();

    // Expose window.bookingWhyDisabled() for on-demand "why is the button grey?" checks
    this.registerBookingDiagnosticsHelper();
  }

  ngOnDestroy() {
    // Persist current form state when leaving so returning to booking restores it (unless we just cleared / went to confirmation)
    if (this.isBrowser && !this.skipSaveOnDestroy && this.selectedServiceType()) {
      this.saveFormData();
    }
    // Clean up window listeners
    if (this.isBrowser) {
      window.removeEventListener('resize', this.resizeHandler);
      window.removeEventListener('scroll', this.summaryScrollCloseHandler);
      delete (window as any).bookingWhyDisabled;
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
        this.serviceTypeDropdownOpen.set(false);
      }
      if (!target.closest('.entry-method-dropdown')) {
        this.entryMethodDropdownOpen.set(false);
      }
      if (!target.closest('.tip-dropdown')) {
        this.tipDropdownOpen.set(false);
      }
      // Clicks INSIDE this menu (including the "Other" text field) must not close it.
      if (!target.closest('.address-name-dropdown')) {
        this.addressNameDropdownOpen.set(false);
      }
      if (!target.closest('.city-dropdown')) {
        this.cityDropdownOpen.set(false);
      }
      if (!target.closest('.state-dropdown')) {
        this.stateDropdownOpen.set(false);
      }
      if (!target.closest('.saved-address-dropdown')) {
        this.savedAddressDropdownOpen.set(false);
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

  /**
   * Throws away a saved draft that was written in Admin Mode, and says so on screen.
   *
   * `isAdminMode` / `selectedTargetUser` are component state and do NOT survive a reload, while
   * every form field does and `currentStep` is restored from `?step=`. Before this guard, a
   * refresh of `/booking?step=3` handed the admin back a fully populated booking with Admin Mode
   * silently OFF — and Book Now then took the customer branch and sent the ADMIN to Stripe to pay
   * for their customer's cleaning (2026-08 incident).
   *
   * Resuming such a draft correctly would mean re-selecting the customer and replaying every
   * side effect of selectUser() (apartments, subscription, loyalty, offers, points, orders)
   * WITHOUT clobbering the admin's own contact edits. Discarding is the provably safe option:
   * the admin loses the draft, never the customer's money.
   *
   * Runs before any restore path reads storage, so nothing downstream ever sees the draft.
   */
  private discardAdminDraftIfPresent(): void {
    if (!this.isBrowser) return;

    this.formPersistenceService.loadFormData();
    const savedData = this.formPersistenceService.getFormData();
    if (!savedData?.wasAdminMode) return;

    this.formPersistenceService.clearFormData();
    this.adminDraftDiscarded.set(true);

    // Start over from the top rather than dropping the admin onto a step-3 form that no longer
    // has any data behind it.
    this.currentStep.set(1);
    if (this.route.snapshot.queryParamMap.get('step')) {
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { step: null },
        queryParamsHandling: 'merge',
        replaceUrl: true
      });
    }

    console.warn(
      '[booking] Discarded a saved draft that was created in Admin Mode. Admin context is not ' +
      'persisted across reloads, so resuming it would have submitted the booking as the admin.'
    );
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
    // Restored even when empty: a blank name is the customer's "Other, unnamed" choice, and
    // the truthiness check used to throw it away and silently snap the picker back to Home.
    if (savedData.apartmentName !== undefined) formValues.apartmentName = savedData.apartmentName;
    if (savedData.aptSuite) formValues.aptSuite = savedData.aptSuite;
    if (savedData.city) formValues.city = savedData.city;
    if (savedData.state) formValues.state = savedData.state;
    if (savedData.zipCode) formValues.zipCode = savedData.zipCode;
    if (savedData.promoCode) formValues.promoCode = savedData.promoCode;
    // Normalize on the way in: older persisted sessions can hold a null tip, which used to
    // come back as an unfixable "minimum $10" error on a form the customer never touched.
    if (savedData.tips !== undefined) formValues.tips = normalizeTipAmount(savedData.tips);
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
      this.floorTypes.set([...savedData.floorTypes]);
      this.floorTypeOther.set(savedData.floorTypeOther || '');
    }
  }

  /** Apply loaded service types: sort, restore the saved selection (this tab's draft) or the default. */
  private applyServiceTypes(serviceTypes: ServiceType[]) {
    this.setServiceTypes(serviceTypes);
    // Re-hydrate from sessionStorage so we use persisted state (user may have come from main or returned to booking)
    this.formPersistenceService.loadFormData();
    const stored = this.formPersistenceService.getFormData();
    this.restoreSelection(stored ? fillDraftIdsFromKeys(stored, this.serviceTypes(), this.subscriptions()) : null, true);
  }

  /** Sorts the catalogue (types, their services and extras by displayOrder) and puts it on screen. */
  private setServiceTypes(serviceTypes: ServiceType[]) {
    this.serviceTypes.set(serviceTypes.sort((a, b) => {
      const orderA = a.displayOrder || 999;
      const orderB = b.displayOrder || 999;
      return orderA - orderB;
    }));
    this.serviceTypes().forEach(serviceType => {
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
    if (this.errorMessage() === 'Failed to load service types') this.errorMessage.set('');
  }

  /**
   * Draws a saved draft - this tab's storage, or the server's cookie choice - on the current
   * catalogue: service type, quantities, property type, extras, cleaning type. No draft (or one
   * whose type is gone): the default form. `persist` false writes nothing (server render,
   * hydration), and nothing here reads storage, so all three produce the same form.
   */
  private restoreSelection(savedData: BookingFormData | null, persist: boolean) {
    const savedServiceType = savedData?.selectedServiceTypeId ? this.serviceTypes().find(st => String(st.id) === String(savedData.selectedServiceTypeId)) : null;
    if (savedData?.selectedServiceTypeId && savedServiceType) {
        this.serviceTypeControl.setValue(savedServiceType.id);
        const savedServices = savedData.selectedServices || [];
        const savedExtraServices = savedData.selectedExtraServices || [];
        this.selectServiceType(savedServiceType, true); // skipSave: we'll save after restoring quantities and deep extra
        if (savedServices.length > 0) {
          savedServices.forEach(ss => {
            const service = savedServiceType.services.find(s => String(s.id) === String(ss.serviceId));
            if (service) {
              const existingIndex = this.selectedServices().findIndex(s => String(s.service.id) === String(service.id));
              if (existingIndex >= 0) {
                this.selectedServices()[existingIndex].quantity = ss.quantity;
              }
            }
          });
          this.selectedServices.set(this.selectedServices());
          // Restore is NOT a bedroom change: the saved Sq.ft is an explicit customer value and
          // there is no previous bedroom count. Floor it once, after every quantity has landed,
          // so the result doesn't depend on whether bedrooms happened to precede sqft here.
          this.clampSquareFeetToBedroomMinimum();
        }
        this.restorePropertyTypeSelection(savedData);
        if (savedExtraServices.length > 0) {
          this.selectedExtraServices.set([]);
          savedExtraServices.forEach(ses => {
            const extraService = savedServiceType.extraServices.find(es => String(es.id) === String(ses.extraServiceId));
            // Extra Cleaners is admin-only now — drop it from restored drafts so an
            // invisible (filtered-out) extra can't keep charging the customer.
            if (extraService && isExtraCleaners(extraService)) {
              return;
            }
            if (extraService) {
              this.selectedExtraServices().push({
                extraService,
                quantity: ses.quantity || 1,
                hours: ses.hours || (extraService.hasHours ? 0.5 : 0)
              });
            }
          });
          this.selectedExtraServices.set(this.selectedExtraServices());
          this.cleaningType.setValue(this.getCurrentCleaningType());
        } else if ((savedData.cleaningType === 'deep' || this.preselectDeepCleaning) && this.canSelectDeepCleaning) {
          // Main page only saves cleaningType, not selectedExtraServices. Add deep cleaning extra
          // so the booking price uses the correct multiplier.
          const hasDeep = this.selectedExtraServices().some(s => s.extraService.isDeepCleaning);
          if (!hasDeep) {
            const deepExtra = this.getActiveDeepCleaningExtraService();
            if (deepExtra) {
              this.selectedExtraServices().push({
                extraService: deepExtra,
                quantity: 1,
                hours: deepExtra.hasHours ? 0.5 : 0
              });
              this.selectedExtraServices.set(this.selectedExtraServices());
            }
          }
          this.cleaningType.setValue(this.getCurrentCleaningType());
        }
        this.normalizeCleaningTypeForSelectedServiceType();
        this.calculateTotal();
        if (persist) this.saveFormData(); // Persist restored state (quantities + deep extra) so it's not overwritten by defaults
    } else {
      const residentialCleaning = findResidentialServiceType(this.serviceTypes());
      if (residentialCleaning) {
        this.serviceTypeControl.setValue(residentialCleaning.id);
        this.selectServiceType(residentialCleaning, !persist);
        // Honor ?cleaningType=deep (e.g. "most requested service" CTA) on a fresh booking
        if (this.preselectDeepCleaning && this.canSelectDeepCleaning) {
          const hasDeep = this.selectedExtraServices().some(s => s.extraService.isDeepCleaning);
          if (!hasDeep) {
            const deepExtra = this.getActiveDeepCleaningExtraService();
            if (deepExtra) {
              this.selectedExtraServices().push({
                extraService: deepExtra,
                quantity: 1,
                hours: deepExtra.hasHours ? 0.5 : 0
              });
              this.selectedExtraServices.set(this.selectedExtraServices());
            }
          }
          this.cleaningType.setValue(this.getCurrentCleaningType());
          this.normalizeCleaningTypeForSelectedServiceType();
          if (persist) this.saveFormData();
        }
        this.calculateTotal();
      }
    }
  }

  /** Every catalogue-dependent placeholder flag off: the form is drawn from real data. */
  private markCatalogueLoaded() {
    const flags = this.loading();
    flags.serviceTypes = false;
    flags.serviceDetails = false;
    flags.cleaningTypes = false;
    flags.extras = false;
    flags.availableDates = false;
    flags.timeSlots = false;
    flags.summary = false;
    flags.pricing = false;
    this.loading.set(flags);
  }

  /** Tomorrow's date in New York, YYYY-MM-DD: the default (and, for customers, the earliest) date. */
  private newYorkTomorrow(): string {
    return addDaysToIsoDate(this.initialState?.today ?? newYorkToday(), 1);
  }

  /**
   * The state step 1 is first drawn from, or null.
   * - Server: built from server.ts's in-memory lists (deep copies - those objects are shared by
   *   every render, and this page sorts and annotates what it is given), the visitor's
   *   booking-choice cookie and their session, then handed to the browser in TransferState.
   *   Null when the server has no catalogue: the page goes out with its placeholders and the
   *   browser loads it after hydration, as it did before.
   * - Hydrating browser: exactly what the server drew from.
   * - In-app navigation: null (the page draws from this tab's own state).
   */
  private takeInitialState(): BookingInitialState | null {
    if (!this.isBrowser) {
      const catalogue = this.ssrCatalogue;
      if (!catalogue?.serviceTypes?.length) return null;
      const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
      const serviceTypes = copy(catalogue.serviceTypes);
      const subscriptions = catalogue.subscriptions ? copy(catalogue.subscriptions) : null;
      const session = this.ssrSession ? copy(this.ssrSession) : null;
      const state: BookingInitialState = {
        serviceTypes,
        subscriptions,
        blockedTimeSlots: catalogue.blockedTimeSlots ? copy(catalogue.blockedTimeSlots) : null,
        today: newYorkToday(),
        // Keys only, against this catalogue; anything unresolvable is simply not part of it.
        choice: readBookingChoice(this.ssrContext?.requestCookies, serviceTypes, { subscriptions }),
        session
      };
      // A guest's Special Discount card shows ONE public offer picked at random. Picked here,
      // once, so the browser shows the same one.
      if (!session && catalogue.publicOffers) {
        const offers = catalogue.publicOffers;
        state.guestOffer = offers.length ? copy(offers[Math.floor(Math.random() * offers.length)]) : null;
      }
      this.transferState.set(BOOKING_INITIAL_STATE_KEY, state);
      // The header's account state is part of the same lookup: not fetched again after hydration.
      // It travels under its own key (AccountStatusService reads it), not twice.
      if (session?.account) this.transferState.set(ACCOUNT_STATUS_KEY, session.account);
      if (session) delete session.account;
      return state;
    }
    if (this.hydrating && this.transferState.hasKey(BOOKING_INITIAL_STATE_KEY)) {
      const state = this.transferState.get(BOOKING_INITIAL_STATE_KEY, null);
      this.transferState.remove(BOOKING_INITIAL_STATE_KEY);
      return state;
    }
    return null;
  }

  /**
   * Draws step 1 from the initial state, synchronously, writing nothing. Runs identically on the
   * server and in the hydrating browser, so the two renders are the same.
   */
  private applyInitialState(state: BookingInitialState) {
    this.catalogueFresh.set(true);
    if (this.isBrowser) {
      this.bookingCatalogueStore.remember('serviceTypes', state.serviceTypes);
      if (state.subscriptions) this.bookingCatalogueStore.remember('subscriptions', state.subscriptions);
      if (state.blockedTimeSlots) this.bookingCatalogueStore.remember('blockedTimeSlots', state.blockedTimeSlots);
    }

    // Who it is drawn for, first: the role decides admin-only rendering below.
    const session = state.session;
    if (session) {
      this.applySession(session);
      // A later in-app visit to /booking draws from it too (fresh for a minute).
      this.accountStatus.rememberBookingContext(session);
    }

    if (!session && state.guestOffer !== undefined) {
      this.applyGuestOffer(state.guestOffer);
      this.guestOfferKnown = true;
      this.loading().promoBanner = false;
      this.loading.set(this.loading());
    }
    if (!session) {
      // A guest has no orders to reorder.
      this.loading().previousOrders = false;
      this.loading.set(this.loading());
    }

    if (state.blockedTimeSlots) {
      this.applyBlockedTimeSlots(state.blockedTimeSlots);
      this.blockedSlotsKnown = true;
    }

    // Date and time: the saved ones when still bookable, else tomorrow (New York) at 8:00.
    const choice = state.choice;
    const tomorrow = this.newYorkTomorrow();
    const choiceType = choice ? state.serviceTypes.find(t => String(t.id) === choice.selectedServiceTypeId) : undefined;
    const sameDayChosen = !!choice?.selectedExtraServices?.some(saved =>
      choiceType?.extraServices?.find(e => String(e.id) === saved.extraServiceId)?.isSameDayService);
    const savedDate = choice?.serviceDate;
    const dateUsable = !!savedDate && (savedDate >= tomorrow || (sameDayChosen && savedDate === state.today));
    this.serviceDate.setValue(dateUsable ? savedDate! : tomorrow);
    this.serviceTime.setValue(choice?.serviceTime ?? '08:00');
    if (choice?.tips != null) this.tips.setValue(normalizeTipAmount(choice.tips));
    if (choice?.cleaningType) this.cleaningType.setValue(choice.cleaningType);
    if (choice?.floorTypes?.length) this.floorTypes.set([...choice.floorTypes]);

    // The catalogue and the selection. Plans are set afterwards so the plan choice below sees the
    // whole picture (draft plan, live plan, preference) rather than whatever selectServiceType
    // picks on its way through.
    this.setServiceTypes(state.serviceTypes);
    this.restoreSelection(choice, false);
    if (state.subscriptions) {
      this.applySubscriptionsList(state.subscriptions, choice);
      this.subscriptionsKnown = true;
    }

    this.isSameDaySelected.set(this.selectedExtraServices().some(s => s.extraService.isSameDayService));
    this.ensureValidServiceTimeForSelectedDate();
    this.adjustDefaultDateIfBlocked();
    this.checkSameDayServiceAvailability();
    this.calculateTotal();
    this.markCatalogueLoaded();
  }

  /** The signed-in visitor's booking context from the server's session lookup. */
  private applySession(session: SsrBookingSession) {
    this.sessionContext = session;
    const user = session.user;
    this.sessionUserId = user.id;
    this.renderRole.set(user.role);
    this.currentUser.set({ ...user });
    this.isAdmin.set(user.role === 'Admin' || user.role === 'SuperAdmin' || user.role === 'Moderator');
    this.isSuperAdmin = user.role === 'SuperAdmin';
    this.isModerator.set(user.role === 'Moderator');
    if (session.canRegisterCustomers != null) {
      this.canRegisterCustomers.set(session.canRegisterCustomers);
      this.sessionPermissionKnown = true;
    }
    this.hasFirstTimeDiscount = user.firstTimeOrder;
    this.loyaltyDiscountPercentage.set(session.loyaltyDiscountPercentage || 0);
    if (session.points) this.applyPointsSummary(session.points);
    if (session.subscription) {
      this.applyUserSubscriptionResponse(session.subscription);
    }
    if (session.specialOffers) {
      this.applyUserOffers(session.specialOffers as UserSpecialOffer[]);
      this.loading().promoBanner = false;
      this.loading.set(this.loading());
    }
    if (session.hasPreviousOrders != null) {
      this.hasOrdersHint.set(session.hasPreviousOrders);
      this.loading().previousOrders = false;
      this.loading.set(this.loading());
    }
  }

  /** True while the signed-in user is the one the server drew this page for. */
  private sessionCovers(): boolean {
    return this.sessionUserId != null && this.authService.currentUserValue?.id === this.sessionUserId;
  }

  /** The offers on screen are already the right ones for whoever is (or isn't) signed in. */
  private offersCovered(): boolean {
    if (this.isAdminMode()) return false;
    if (this.authService.isLoggedIn()) return this.sessionCovers() && !!this.sessionContext?.specialOffers;
    return this.guestOfferKnown && !this.sessionUserId;
  }

  /** The Reorder button is already right without loading the order list (a guest's costs nothing). */
  private ordersCovered(): boolean {
    if (this.isAdminMode() || !this.authService.isLoggedIn()) return false;
    return this.sessionCovers() && this.hasOrdersHint() != null;
  }

  /** Whether step 1 shows the Reorder button. */
  showReorderButton(): boolean {
    if (this.loading().previousOrders || this.currentStep() !== 1) return false;
    if (this.previousOrders().length > 0) return true;
    // The session's flag speaks for the signed-in user themselves - never for an admin's target,
    // and not once somebody else (or nobody) is signed in.
    return !this.selectedTargetUser() && !!this.hasOrdersHint()
      && this.sessionUserId != null && this.currentUser()?.id === this.sessionUserId;
  }

  /**
   * After the server's HTML has been hydrated: read this tab's storage. When the form was drawn
   * from the booking-choice cookie, storage only adds what the cookie never carries (contact and
   * address details, notes, consents, promo code text, poll answers, unkeyed extras) - into
   * fields whose size does not change. When it was not (no cookie yet, or an unusable one), this
   * is the old restore from storage, now after hydration. Then one save brings the draft and the
   * cookie in step with what is on screen.
   */
  private reconcileAfterHydration() {
    if (!this.initialState || this.reconciled) return;
    this.reconciled = true;

    this.discardAdminDraftIfPresent();
    this.formPersistenceService.loadFormData();
    const stored = this.formPersistenceService.getFormData();

    if (stored && this.initialState.choice) {
      this.restoreNonCookieFields(stored);
    } else if (stored) {
      this.loadSavedFormData();
      this.restoreSelection(fillDraftIdsFromKeys(stored, this.serviceTypes(), this.subscriptions()), false);
      if (this.subscriptions().length) this.applySubscriptionsList(this.subscriptions(), stored);
      this.isSameDaySelected.set(this.selectedExtraServices().some(s => s.extraService.isSameDayService));
      this.ensureValidServiceTimeForSelectedDate();
      this.adjustDefaultDateIfBlocked();
      this.calculateTotal();
    }

    this.persistenceReady = true;
    this.saveFormData();
    if (this.formPersistenceService.hasSavedData()) {
      this.formPersistenceService.markBookingStarted();
    }
  }

  /** The draft's fields the booking-choice cookie never carries (see reconcileAfterHydration). */
  private restoreNonCookieFields(savedData: BookingFormData) {
    const formValues: any = {};
    const keys: (keyof BookingFormData)[] = ['entryMethod', 'customEntryMethod', 'specialInstructions',
      'contactFirstName', 'contactLastName', 'contactEmail', 'contactPhone', 'selectedApartmentId',
      'serviceAddress', 'aptSuite', 'city', 'state', 'zipCode', 'promoCode'];
    for (const key of keys) if (savedData[key]) formValues[key] = savedData[key];
    // Restored even when empty: a blank name is the customer's "Other, unnamed" choice.
    if (savedData.apartmentName !== undefined) formValues.apartmentName = savedData.apartmentName;
    if (savedData.smsConsent !== undefined) formValues.smsConsent = savedData.smsConsent;
    if (savedData.cancellationConsent !== undefined) formValues.cancellationConsent = savedData.cancellationConsent;
    if (savedData.termsConsent !== undefined) formValues.termsConsent = savedData.termsConsent;
    this.bookingForm.patchValue(formValues);

    if (savedData.floorTypeOther && this.floorTypes().includes('other')) this.floorTypeOther.set(savedData.floorTypeOther);

    const type = this.selectedServiceType();
    if (!type || String(type.id) !== String(savedData.selectedServiceTypeId)) return;

    if (this.showPollForm() && savedData.pollAnswers) {
      if (this.pollQuestions().length) this.pollAnswers.set({ ...savedData.pollAnswers });
      else this.savedPollData = savedData.pollAnswers;
    }

    // An extra without a key cannot travel in the cookie: it comes back from this tab's draft.
    let added = false;
    for (const saved of savedData.selectedExtraServices ?? []) {
      const extra = type.extraServices?.find(e => String(e.id) === String(saved.extraServiceId));
      if (!extra || extra.extraServiceKey || isExtraCleaners(extra)) continue;
      if (this.selectedExtraServices().some(s => s.extraService.id === extra.id)) continue;
      this.selectedExtraServices().push({ extraService: extra, quantity: saved.quantity || 1, hours: saved.hours || (extra.hasHours ? 0.5 : 0) });
      added = true;
    }
    if (added) {
      this.selectedExtraServices.set(this.selectedExtraServices());
      this.isSameDaySelected.set(this.selectedExtraServices().some(s => s.extraService.isSameDayService));
      this.cleaningType.setValue(this.getCurrentCleaningType());
      this.calculateTotal();
    }
  }

  /**
   * The catalogue, the plans and the blocked time slots: public, so never behind auth. Once per
   * page; whatever the server's state already gave is not asked for again.
   */
  private loadPublicData() {
    if (!this.isBrowser || this.publicDataRequested) return;
    this.publicDataRequested = true;
    this.errorMessage.set('');

    // The catalogue. Fresh server data (the server render, or a request made by this page or
    // just before it) is used as it is. A per-tab copy older than that is drawn at once, then
    // replaced by fresh data - which always wins, and is what Book Now prices.
    if (!this.catalogueFresh()) {
      if (!this.serviceTypes().length && !this.bookingCatalogueStore.isFresh('serviceTypes')) {
        const stored = this.bookingCatalogueStore.peek('serviceTypes');
        if (stored) {
          this.applyServiceTypes(stored);
          this.markCatalogueLoaded();
        }
      }
      this.bookingCatalogueStore.load('serviceTypes').pipe(
        takeUntil(this.destroy$)
      ).subscribe({
        next: (serviceTypes) => {
          // Keep what is on screen: the restore below reads it back from the draft.
          if (this.selectedServiceType()) this.saveFormData();
          this.applyServiceTypes(serviceTypes);
          this.catalogueFresh.set(true);
          this.markCatalogueLoaded();
        },
        error: (error) => {
          console.error('Failed to load service types:', error);
          this.errorMessage.set('Failed to load service types');
          const flags = this.loading();
          flags.serviceTypes = false;
          flags.serviceDetails = false;
          flags.extras = false;
          flags.cleaningTypes = false;
          flags.availableDates = false;
          flags.timeSlots = false;
          this.loading.set(flags);
        }
      });
    }

    if (!this.subscriptionsKnown) {
      this.bookingCatalogueStore.load('subscriptions').pipe(
        takeUntil(this.destroy$)
      ).subscribe({
        next: (subscriptions) => {
          this.applySubscriptionsList(subscriptions, this.formPersistenceService.getFormData());
        },
        error: (error) => {
          console.error('Failed to load subscriptions:', error);
          this.errorMessage.set('Failed to load subscriptions');
        }
      });
    }

    if (!this.blockedSlotsKnown) this.loadBlockedTimeSlots();
  }

  private loadInitialData() {
    if (!this.isBrowser) return;

    this.locationService.getStates().pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (states) => {
        this.states.set(states);
        if (states.length === 0) return;

        const savedState = this.bookingForm.get('state')?.value;
        // A saved state we don't serve (restored from a previous session where the customer
        // picked an out-of-area address) must fall back to the default. Leaving it in place
        // used to match neither branch here, so the city list was never loaded and the City
        // dropdown rendered with nothing but its placeholder.
        if (savedState && states.includes(savedState)) {
          this.loadCities(savedState);
        } else {
          this.bookingForm.patchValue({ state: states[0] });
          this.loadCities(states[0]);
        }
      },
      error: () => {}
    });

    // Load current user data
    this.authService.currentUser.pipe(
      takeUntil(this.destroy$)
    ).subscribe(user => {
      // What the server drew from this user's session is not asked for again.
      const covered = !!user && user.id === this.sessionUserId;
      this.currentUser.set(covered ? { ...this.currentUser(), ...user } : user);
      // Re-evaluate same-day availability once we know the role — Admin/SuperAdmin are exempt
      // from the time restriction, so the flag must reflect the user even if it was set before
      // the user resolved during early init.
      this.checkSameDayServiceAvailability();
      if (user) {
        if (!covered) {
          this.hasFirstTimeDiscount = user.firstTimeOrder;
          if (this.isBrowser) this.loadBubblePointsOptions();
        }

        // Check if we have saved form data
        const savedData = this.formPersistenceService.getFormData();
        const returnedFromLoginStep3 = this.route.snapshot.queryParamMap.get('step') === '3';
        // The session's profile is the freshest copy the page has of who this is.
        const profile = covered ? this.sessionContext!.user : user;

        // If user just logged in from Book Now (step=3 in URL), use their real account email/name
        if (user && savedData && returnedFromLoginStep3) {
          this.bookingForm.patchValue({
            contactFirstName: profile.firstName || '',
            contactLastName: profile.lastName || '',
            contactEmail: profile.email || ''
          });
        } else if (!savedData || !savedData.contactFirstName) {
          // Only pre-fill contact info if there's no saved data
          this.bookingForm.patchValue({
            contactFirstName: profile.firstName,
            contactLastName: profile.lastName,
            contactEmail: profile.email,
            contactPhone: profile.phone || ''
          });
        }

        // Load user apartments
        this.profileService.getApartments().pipe(
          takeUntil(this.destroy$)
        ).subscribe({
          next: (apartments) => {
            this.userApartments.set(apartments);

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

        if (!covered) {
          // Load user subscription after loading user data
          this.loadUserSubscription();
          // Same trigger fans out to the loyalty discount loader — both are user-context state
          // that needs to refresh whenever the booking page sees a new effective user.
          this.loadLoyaltyDiscount();
        }
      }
    });
  }

  /**
   * The plans list arrived (server state or request): put it on screen and decide which plan is
   * selected - the target customer's in Admin Mode, else a live plan, else the draft's, else the
   * one-off plan and then the profile preference. `draft` is the draft the form was drawn from.
   */
  private applySubscriptionsList(subscriptions: Subscription[], draft: BookingFormData | null) {
    this.subscriptions.set(subscriptions.sort((a, b) => {
      const orderA = a.displayOrder || 999;
      const orderB = b.displayOrder || 999;
      return orderA - orderB;
    }));
    if (this.errorMessage() === 'Failed to load subscriptions') this.errorMessage.set('');
    if (this.isAdminMode() && this.selectedTargetUser()) {
      this.loadUserSubscription(this.selectedTargetUser()!.id);
      this.loadLoyaltyDiscount(this.selectedTargetUser()!.id);
      return;
    }
    if (this.hasActiveSubscription() && this.userSubscription()) {
      this.updateSelectedSubscription();
      return;
    }
    const savedPlan = draft?.selectedSubscriptionId
      ? this.subscriptions().find(s => String(s.id) === String(draft.selectedSubscriptionId))
      : draft?.selectedSubscriptionDays != null
        ? this.subscriptions().find(s => s.subscriptionDays === draft.selectedSubscriptionDays)
        : undefined;
    if (savedPlan) {
      this.selectedSubscription.set(savedPlan);
      this.calculateTotal();
      return;
    }
    if (this.subscriptions().length > 0) {
      const oneTimeSubscription = this.findOneTimeSubscription();
      this.selectedSubscription.set(oneTimeSubscription);
    }
    // Last, so a draft in progress always wins over a standing preference. The two loads
    // race, so this is attempted from both of them and is a no-op once one has landed.
    this.applyPreferredSubscription(draft);
    this.calculateTotal();
  }

  loadCities(state: string) {
    // The states load and the state control's own listener both ask for the default state's
    // cities on the first visit; one request answers both.
    if (this.citiesRequestedFor === state) return;
    this.citiesRequestedFor = state;
    this.locationService.getCities(state).subscribe({
      next: (cities) => {
        this.cities.set(cities);
      },
      error: () => {
        if (this.citiesRequestedFor === state) this.citiesRequestedFor = null;
      }
    });
  }
  private citiesRequestedFor: string | null = null;

  /**
   * Point the City options at the given state. Driven by the `state` control's valueChanges so
   * it covers every writer — the select, Google Places, the saved-address fill, reorder and the
   * restored session — not just user interaction with the dropdown.
   */
  private syncCitiesToState(state: string | null | undefined) {
    if (!state) {
      this.cities.set([]);
      this.citiesRequestedFor = null;
      return;
    }

    // An address outside our service area (Google Places happily returns e.g. "New Jersey").
    // Offer no cities rather than querying for a state we don't serve: City is required and
    // its only valid answers are boroughs, so an empty list is what blocks the booking. Also
    // drop a stale borough left over from a previous address, or the form would stay valid
    // claiming e.g. Brooklyn for a New Jersey street.
    if (this.states().length > 0 && !this.states().includes(state)) {
      this.cities.set([]);
      this.citiesRequestedFor = null;
      if (this.bookingForm.get('city')?.value) {
        this.bookingForm.patchValue({ city: '' });
      }
      return;
    }

    this.loadCities(state);
  }

  /**
   * User picked a State from the dropdown. Cities reload via the `state` valueChanges
   * subscription; this handler only clears the now-stale city choice, which is deliberately
   * NOT done there — the Places autocomplete sets city and state together, and clearing on
   * every state change would wipe the city it just filled in.
   */
  onStateChange(state: string) {
    this.bookingForm.patchValue({ city: '' });
  }

  toggleStateDropdown(): void {
    this.stateDropdownOpen.set(!this.stateDropdownOpen());
    this.cityDropdownOpen.set(false);
  }

  /** Only ever called from a click on an option, so onStateChange's city reset stays user-driven. */
  selectState(value: string): void {
    this.stateDropdownOpen.set(false);
    this.state.markAsDirty();
    this.state.markAsTouched();
    if (this.state.value === value) return;
    this.state.setValue(value);
    this.onStateChange(value);
  }

  toggleCityDropdown(): void {
    this.cityDropdownOpen.set(!this.cityDropdownOpen());
    this.stateDropdownOpen.set(false);
  }

  selectCity(value: string): void {
    this.cityDropdownOpen.set(false);
    this.city.setValue(value);
    this.city.markAsDirty();
    this.city.markAsTouched();
  }

  private setupFormListeners() {
    // Listen to apartment selection changes: address name is always required; a saved apartment
    // brings its stored name, a new address falls back to the default preset.
    this.bookingForm.get('selectedApartmentId')?.valueChanges.subscribe(apartmentId => {
      const apartmentNameControl = this.bookingForm.get('apartmentName');
      if (!apartmentNameControl) return;
      if (apartmentId) {
        const apartment = this.userApartments().find(a => a.id === +apartmentId);
        apartmentNameControl.setValue(apartment?.name || DEFAULT_ADDRESS_NAME);
      } else {
        apartmentNameControl.setValue(DEFAULT_ADDRESS_NAME);
      }
      apartmentNameControl.updateValueAndValidity();
    });

    // Keep the Home/Office/Other select in step with the control, no matter who wrote it —
    // the saved-address fill, reorder and the restored session all patch it programmatically.
    this.bookingForm.get('apartmentName')?.valueChanges
      .pipe(startWith(this.bookingForm.get('apartmentName')?.value), takeUntil(this.destroy$))
      .subscribe(name => this.syncAddressNameType(name));

    // Keep the City options in sync with whatever the State control holds, no matter who set
    // it. Google Places, the saved-address fill, reorder and the restored session all patch
    // `state` programmatically, which does NOT fire the select's (change) handler — so before
    // this, picking an out-of-area address left the City dropdown empty and even re-entering a
    // valid New York address could not repopulate it.
    this.bookingForm.get('state')?.valueChanges
      .pipe(distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(state => this.syncCitiesToState(state));

    // Listen to tips changes
    this.bookingForm.get('tips')?.valueChanges.subscribe(() => {
      this.calculateTotal();
    });

    // Listen to service date changes
    this.bookingForm.get('serviceDate')?.valueChanges.subscribe(newDate => {
      // Admins / SuperAdmins may keep Same Day Service on any date — never auto-remove it for them.
      // (Customer flow/timing below is unchanged.)
      if (this.isSameDaySelected() && newDate && !this.isAdminOrSuperAdmin) {
        // "Today" is New York's, like every other date on this page.
        const todayFormatted = newYorkToday();
        
        // Check if the selected date is not today
        if (newDate !== todayFormatted) {
          
          // Find and remove the same day service
          const sameDayService = this.selectedExtraServices().find(s => s.extraService.isSameDayService);
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
    if (!this.selectedServiceType()) return;
    // Nothing is written before this page has read the visitor's draft (server render, and the
    // hydration pass that redraws the server's form): see persistenceReady.
    if (!this.persistenceReady) return;

    const formData: BookingFormData = {
      // Service Type and Services. The keys travel next to the ids: they are what the
      // booking-choice cookie is written from (FormPersistenceService).
      selectedServiceTypeId: this.selectedServiceType()!.id ? String(this.selectedServiceType()!.id) : undefined,
      selectedServiceTypeKey: this.selectedServiceType()!.serviceKey ?? null,
      selectedServices: this.selectedServices().map(s => ({
        serviceId: String(s.service.id),
        serviceKey: s.service.serviceKey,
        quantity: s.quantity
      })),
      selectedExtraServices: this.selectedExtraServices().map(es => ({
        extraServiceId: String(es.extraService.id),
        extraServiceKey: es.extraService.extraServiceKey ?? null,
        quantity: es.quantity,
        hours: es.hours
      })),
      
      // Form Values
      ...this.bookingForm.value,

      // Tips last, normalized: the spread above would otherwise persist a cleared number
      // input as null, and every later visit would restore that null into the form.
      tips: normalizeTipAmount(this.tips.value),

      // Selected Subscription
      selectedSubscriptionId: this.selectedSubscription()?.id ? String(this.selectedSubscription()!.id) : undefined,
      selectedSubscriptionDays: this.selectedSubscription()?.subscriptionDays,
      
      // Consent checkboxes
      smsConsent: this.smsConsent.value,
      cancellationConsent: this.cancellationConsent.value,
      termsConsent: this.termsConsent.value,

      // Custom Pricing Data
      customAmount: this.showCustomPricing() ? this.customAmount.value : undefined,
      customCleaners: this.showCustomPricing() ? this.customCleaners.value : undefined,
      customDuration: this.showCustomPricing() ? this.customDuration.value : undefined,
      customServiceName: this.showCustomPricing() ? this.customServiceName.value : undefined,
      bedroomsQuantity: this.getSelectedBedroomsQuantity(),
      bathroomsQuantity: this.getSelectedBathroomsQuantity(),

      // Property type + levels. Persisted separately from selectedServices because the levels
      // line is absent from that array until a chip is clicked, so the restore loop (which only
      // writes into entries that already exist) could never bring it back on its own.
      propertyType: this.propertyType() ?? undefined,
      levelsQuantity: this.levelsQuantity(),

      // Poll Data
      pollAnswers: this.showPollForm() ? this.pollAnswers() : undefined,

      // Floor Types
      floorTypes: this.floorTypes().length > 0 ? this.floorTypes() : undefined,
      floorTypeOther: this.floorTypeOther() || undefined,

      // Marker only — the admin context itself is never persisted. A draft carrying this can
      // only be discarded on reload, never silently resumed as a customer booking.
      // See discardAdminDraftIfPresent() and BookingFormData.wasAdminMode.
      wasAdminMode: this.isAdminMode() || undefined
    };

    this.formPersistenceService.saveFormData(formData);
    
    // Mark booking as in progress if user is making changes
    if (this.selectedServiceType()) {
      this.formPersistenceService.markBookingInProgress();
    }
    
    // Also save the service type control value
    if (this.selectedServiceType()) {
      this.serviceTypeControl.setValue(this.selectedServiceType()!.id);
    }
  }

  clearAllFormData() {
    if (confirm('Are you sure you want to clear all form data?')) {
      this.skipSaveOnDestroy = true;
      this.formPersistenceService.clearFormData();
      
      // Reset service type selection
      this.serviceTypeControl.setValue('');
      this.selectedServiceType.set(null);
      this.selectedServices.set([]);
      this.selectedExtraServices.set([]);
      this.resetPropertyTypeSelection();
      
      // Reset form to default values
      this.bookingForm.reset();
      
      // Reset floor types
      this.floorTypes.set([]);
      this.floorTypeOther.set('');

      // Reset custom pricing
      this.showCustomPricing.set(false);
      this.customAmount.setValue('');
      this.customCleaners.setValue(1);
      this.customDuration.setValue(60);
      
      // Reset special offers and discounts (+ the first-time marker the offer sets)
      this.selectedSpecialOffer.set(null);
      this.specialOfferApplied.set(false);
      this.firstTimeDiscountApplied = false;
      this.promoCodeApplied.set(false);
      this.promoDiscount.set(0);
      this.promoIsPercentage.set(true);
      this.selectedPointsToRedeem.set(0);
      this.pointsDiscountAmount.set(0);
      this.useCredits.set(false);
      this.userBubbleCredits.set(0);

      // Reset calculation
      this.calculation.set({
        subTotal: 0,
        tax: 0,
        discountAmount: 0,
        tips: 0,
        total: 0,
        totalDuration: 0
      });
      
      // Reset UI state
      this.serviceTypeDropdownOpen.set(false);
      this.entryMethodDropdownOpen.set(false);
      this.isSummaryCollapsed.set(false);
      
      // Set default date and time (tomorrow in New York)
      this.serviceDate.setValue(this.newYorkTomorrow());
      this.serviceTime.setValue('08:00');
      this.cleaningType.setValue('normal');
      this.tips.setValue(0);
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
    // The weekend 9:30 floor is a customer rule; admins start at 8:00 on every day.
    return getEarliestStartTimeForDate(date, this.hasExtendedBookingHours);
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

  /** "Name — Street" for a saved address, falling back to whichever half exists. */
  getSavedAddressLabel(apt: { name?: string; address?: string }): string {
    const name = (apt?.name ?? '').trim();
    const address = (apt?.address ?? '').trim();
    if (name && address && address !== name) return `${name} — ${address}`;
    return name || address;
  }

  /** Closed toggle text: the chosen saved address, or the "new address" placeholder. */
  get savedAddressLabel(): string {
    const selectedId = this.selectedApartmentId.value;
    if (!selectedId) return 'Enter new address';
    const apartment = this.userApartments().find(a => a.id === +selectedId);
    return apartment ? this.getSavedAddressLabel(apartment) : 'Enter new address';
  }

  toggleSavedAddressDropdown(): void {
    this.savedAddressDropdownOpen.set(!this.savedAddressDropdownOpen());
  }

  /**
   * Picking an option mirrors what the old <select> did: the control is set (which resets the
   * address name through its subscription) and a real apartment also fills the address fields.
   * Passing '' is the "Enter new address" option — it clears the selection only, exactly as
   * before; wiping the typed address stays the Clear button's job.
   */
  selectSavedAddress(apartmentId: number | string): void {
    this.savedAddressDropdownOpen.set(false);
    const value = apartmentId === '' ? '' : String(apartmentId);
    this.selectedApartmentId.setValue(value);
    this.selectedApartmentId.markAsDirty();
    this.selectedApartmentId.markAsTouched();
    if (value) {
      this.fillApartmentAddress(value);
    } else {
      // Back to "new address": the Places widget was torn down when the saved address took
      // over, so bring it back instead of leaving the fallback input in its place.
      this.reinitAddressAutocomplete();
    }
  }

  clearApartmentSelection() {
    // apartmentName resets to the default preset through the selectedApartmentId subscription.
    this.bookingForm.patchValue({
      selectedApartmentId: '',
      serviceAddress: '',
      aptSuite: '',
      city: '',
      state: this.states().length > 0 ? this.states()[0] : '',
      zipCode: ''
    });
    
    // Load cities for the default state
    if (this.states().length > 0) {
      this.loadCities(this.states()[0]);
    }

    this.reinitAddressAutocomplete();
  }

  /**
   * Re-arm Google Places after switching back to "new address". Without this the widget stays
   * torn down and the customer is left with the plain fallback input.
   */
  private reinitAddressAutocomplete(): void {
    if (!this.isBrowser || this.currentStep() !== 3) return;
    this.autocompleteLoaded = false;
    this.autocompleteError.set(false);
    this.showAddressFallbackAfterDelay.set(false);
    this.autocompleteInitRetryCount = 0;
    const container = this.addressContainer()?.nativeElement;
    if (container) {
      container.innerHTML = '';
    }
    this.autocompleteElement = null;
    setTimeout(() => this.initAddressAutocomplete(), 100);
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
            /* Same radius as every other address field — custom properties inherit through
               the shadow boundary, so the token resolves from :root. */
            border-radius: var(--radius-md) !important;
            box-shadow: none !important;
            /* 3rem matches the height pinned on every other address control in
               booking.component.scss — change both together. */
            min-height: 3rem !important;
            height: 3rem !important;
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
            font-family: 'Inter', 'Inter Fallback', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
            font-weight: 400 !important;
            line-height: 1.5 !important;
            background: transparent !important;
            color: var(--text-primary) !important;
            text-align: left !important;
            min-height: 3rem !important;
            height: 3rem !important;
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
    const addressContainer = this.addressContainer();
    const container = addressContainer?.nativeElement;
    if (container && !container.querySelector('gmp-place-autocomplete')) {
      this.autocompleteLoaded = false;
    }
    if (this.autocompleteLoaded) return;

    if (this.addressFallbackTimer) {
      clearTimeout(this.addressFallbackTimer);
      this.addressFallbackTimer = null;
    }
    this.addressFallbackTimer = setTimeout(() => {
      if (!this.autocompleteLoaded && !this.autocompleteError()) {
        this.showAddressFallbackAfterDelay.set(true);
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

      const containerEl = addressContainer?.nativeElement;
      if (containerEl) {
        containerEl.innerHTML = '';
        containerEl.appendChild(placeAutocomplete);
        this.autocompleteElement = placeAutocomplete;
        this.autocompleteLoaded = true;
        this.autocompleteInitRetryCount = 0;
        this.showAddressFallbackAfterDelay.set(false);
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
      this.autocompleteError.set(true);
    }
  }

  private scheduleAddressAutocompleteRetry(): void {
    if (this.autocompleteInitRetryCount >= BookingComponent.AUTOCOMPLETE_INIT_MAX_RETRIES) return;
    if (this.currentStep() !== 3 || this.selectedApartmentId?.value) return;
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
  }

  /**
   * Derives the select's position from whatever the apartmentName control holds. A value that
   * isn't one of the presets — including the empty string the user starts with after picking
   * "Other" — is "Other", so the free-text field stays open while they type.
   */
  private syncAddressNameType(name: string | null | undefined): void {
    const value = (name ?? '').trim();
    const next: AddressNameType = ADDRESS_NAME_PRESETS.includes(value)
      ? (value as AddressNameType)
      : 'Other';
    if (next === this.addressNameType()) return;
    this.addressNameType.set(next);
  }

  toggleAddressNameDropdown(): void {
    this.addressNameDropdownOpen.set(!this.addressNameDropdownOpen());
  }

  /**
   * User picked Home / Office / Other from the menu. The menu always closes; the presets write
   * their own label into the control, while "Other" empties it and reveals the free-text field
   * sitting next to the dropdown. Leaving that field blank is fine — it books as "Other".
   */
  selectAddressNameType(type: AddressNameType): void {
    this.addressNameType.set(type);
    this.addressNameDropdownOpen.set(false);
    // Picking from the menu IS interacting with the field — setValue() alone would leave the
    // control pristine/untouched, so it looked untouched however many times it was changed.
    this.apartmentName.markAsDirty();
    this.apartmentName.markAsTouched();

    if (type === 'Other') {
      this.apartmentName.setValue('');
      this.focusAddressNameInput();
      return;
    }

    this.apartmentName.setValue(type);
    this.persistAddressNameToSavedApartment();
  }

  /** Waits a tick so *ngIf has rendered the field before it takes focus. */
  private focusAddressNameInput(): void {
    if (!this.isBrowser) return;
    setTimeout(() => this.addressNameOtherInput()?.nativeElement.focus(), 0);
  }

  /**
   * Custom name finished: trim it and, for a saved address, push the rename to the profile.
   * A blank field is left blank (the placeholder keeps reading better than the word "Other"
   * typed into the box) — the booking itself is named "Other" via resolveAddressName.
   */
  onAddressNameBlur(): void {
    const trimmed = (this.apartmentName.value ?? '').trim();
    if (trimmed !== this.apartmentName.value) this.apartmentName.setValue(trimmed);
    this.persistAddressNameToSavedApartment();
  }

  /**
   * When the booking uses one of the customer's SAVED addresses, renaming it here renames the
   * saved address itself — same behaviour the old inline Edit/Done field had.
   */
  private persistAddressNameToSavedApartment(): void {
    // Blank resolves to "Other" here too, so the saved address and the order never disagree.
    const newName = resolveAddressName(this.apartmentName.value);
    const selectedId = this.bookingForm.get('selectedApartmentId')?.value;
    if (!selectedId) return;
    const apartment = this.userApartments().find((a: { id: number }) => a.id === +selectedId);
    if (!apartment || apartment.name === newName) return;
    const updated = { ...apartment, name: newName };
    const update$ = this.selectedTargetUser()
      ? this.adminService.updateUserApartment(this.selectedTargetUser()!.id, apartment.id, updated)
      : this.profileService.updateApartment(apartment.id, updated);
    update$.subscribe({
      next: (saved) => {
        const idx = this.userApartments().findIndex((a: { id: number }) => a.id === saved.id);
        if (idx !== -1) { this.userApartments()[idx] = saved; this.userApartments.set(this.userApartments()); }
        this.errorMessage.set('');
      },
      error: () => {
        this.errorMessage.set('Could not save address name. Please try again.');
      }
    });
  }

  toggleServiceTypeDropdown() {
    this.serviceTypeDropdownOpen.set(!this.serviceTypeDropdownOpen());
  }

  /** Icon for a service type in the dropdown — see shared/icons/service-type-icon.ts. */
  getServiceTypeIcon(type: IconServiceType | null | undefined): IconDefinition {
    return serviceTypeIcon(type);
  }

  /** @param skipSave When true, do not persist to storage (e.g. when restoring from main page). Caller should save after restoring. */
  selectServiceType(serviceType: ServiceType, skipSave?: boolean) {
    // Don't show shimmer when restoring saved data on step 2/3 — shimmers are already off there
    if (this.currentStep() === 1) {
      this.loading().serviceDetails = true;
      this.loading.set(this.loading());
      this.loading().extras = true;
      this.loading.set(this.loading());
      this.loading().pricing = true;
      this.loading.set(this.loading());
    }
    this.selectedServiceType.set(serviceType);
    this.serviceTypeControl.setValue(serviceType.id);
    this.serviceTypeDropdownOpen.set(false);
    this.selectedServices.set([]);
    this.selectedExtraServices.set([]);
    // The levels line belongs to a specific service type's catalogue row, so a level count can
    // never carry across a type change - and a type without levels must not keep a property type.
    this.resetPropertyTypeSelection();
    this.showPollForm.set(false);
    this.showCustomPricing.set(false);

    // Check if this service type has custom pricing
    if (serviceType.isCustom) {
      this.showCustomPricing.set(true);

      // Build the name options from the live service types (Residential -> Regular/Deep) and
      // restore any previously chosen name.
      this.customServiceNameOptions.set(buildCustomServiceTypeNameOptions(this.serviceTypes()));
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
      this.showPollForm.set(true);
      this.loadPollQuestions(serviceType.id);
      
      // DISABLE validation for fields not needed in poll forms
      this.entryMethod.clearValidators();
      this.entryMethod.updateValueAndValidity();
      
      // Clear validators for fields not required in poll forms
      this.contactLastName.clearValidators();
      this.contactLastName.updateValueAndValidity();

      // The poll's contact block asks for an email now, so it keeps the normal required +
      // format rule (applyContactEmailValidators is the single place that decides it).
      this.applyContactEmailValidators();

      this.applyConsentValidators();

      // Set default values to prevent validation errors but disable validators
      // Only set to 'I will be home' if no saved value exists
      if (!this.entryMethod.value) {
        this.entryMethod.setValue('I will be home');
      }
      
      // Initialize subscription and cleaning type for consistency
      if (!this.selectedSubscription() && this.subscriptions() && this.subscriptions().length > 0) {
        if (!this.hasActiveSubscription()) {
          this.selectedSubscription.set(this.subscriptions()[0]);
        } else {
          this.updateSelectedSubscription();
        }
      }
      
      if (!this.cleaningType.value) {
        this.cleaningType.setValue('normal');
      }
    } else {
      this.showPollForm.set(false);
      
      // RESTORE validation for regular booking forms
      this.entryMethod.setValidators([Validators.required]);
      this.entryMethod.updateValueAndValidity();
      
      // Restore validators for regular booking forms
      this.contactLastName.setValidators([Validators.required]);
      this.contactLastName.updateValueAndValidity();
      
      this.applyContactEmailValidators();

      this.applyConsentValidators();

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
          // Levels is never seeded with a default — see initializeRegularServices.
          if (isLevelsService(service)) return;

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
            
            this.selectedServices().push({
              service: service,
              quantity: defaultQuantity
            });
          }
        });
        this.selectedServices.set(this.selectedServices());
        
        // Set square feet based on bedrooms after all services are initialized
        const sqftService = this.selectedServices().find(s => s.service.serviceKey === 'sqft');
        if (sqftService) {
          sqftService.quantity = this.getSquareFeetForBedrooms(bedroomsQuantity);
          this.selectedServices.set(this.selectedServices());
        }
        this.syncStandaloneBedroomBathroomFromServices();
        const persisted = this.formPersistenceService.getFormData();
        if (persisted?.bedroomsQuantity !== undefined) this.bedroomsQuantityControl.setValue(persisted.bedroomsQuantity);
        if (persisted?.bathroomsQuantity !== undefined) this.bathroomsQuantityControl.setValue(persisted.bathroomsQuantity);
      }
      
      this.selectedExtraServices.set([]);
      
      if (!this.selectedSubscription() && this.subscriptions() && this.subscriptions().length > 0) {
        if (!this.hasActiveSubscription()) {
          this.selectedSubscription.set(this.subscriptions()[0]);
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
    this.loading().serviceDetails = false;
    this.loading.set(this.loading());
    this.loading().extras = false;
    this.loading.set(this.loading());
    this.loading().pricing = false;
    this.loading.set(this.loading());
    this.loading().summary = false;
    this.loading.set(this.loading());
  }

  onServiceTypeChange(event: any) {
    const serviceTypeId = event.target.value;
    if (serviceTypeId) {
      const selectedType = this.serviceTypes().find(type => type.id === parseInt(serviceTypeId));
      if (selectedType) {
        this.selectServiceType(selectedType);
      }
    } else {
      // Reset when no service type is selected
      this.selectedServiceType.set(null);
      this.selectedServices.set([]);
      this.selectedExtraServices.set([]);
      this.resetPropertyTypeSelection();
      this.showPollForm.set(false);
      this.showCustomPricing.set(false);
      this.calculateTotal();
      this.saveFormData();
    }
  }

  toggleEntryMethodDropdown() {
    this.entryMethodDropdownOpen.set(!this.entryMethodDropdownOpen());
  }

  selectEntryMethod(method: string) {
    this.entryMethod.setValue(method);
    this.entryMethodDropdownOpen.set(false); // Close dropdown after selection
    this.saveFormData(); // Save the selection
  }

  // Single definition shared with the order edits (user + admin) so the bedrooms→sqft linkage
  // prices identically everywhere. Reads the Sq.ft service's configured allowances so the
  // slider minimum and the billing allowance are the SAME data — a customer can never sit
  // below their included amount. Falls back to the shared defaults before the catalog loads.
  private getSquareFeetForBedrooms(bedrooms: number): number {
    const sqftService = this.selectedServices().find(s => s.service.serviceKey === 'sqft');
    const bedroomsService = this.selectedServices().find(s => s.service.serviceKey === 'bedrooms');
    return getSquareFeetForBedrooms(
      bedrooms,
      sqftService?.service?.thresholds,
      bedroomsService?.service?.id
    );
  }

  getSquareFeetMinForBedrooms(): number {
    const bedroomsService = this.selectedServices().find(s => s.service.serviceKey === 'bedrooms');
    if (bedroomsService) {
      return this.getSquareFeetForBedrooms(bedroomsService.quantity);
    }
    return 400; // Default minimum
  }

  /**
   * Floor the restored Sq.ft to the current bedroom minimum without ever lowering it.
   * Call ONCE after a restore loop has written every quantity — never per-item, or the
   * result depends on the order the saved services happen to arrive in.
   */
  private clampSquareFeetToBedroomMinimum(): void {
    const sqftService = this.selectedServices().find(s => s.service.serviceKey === 'sqft');
    if (!sqftService) return;
    sqftService.quantity = clampRestoredSquareFeet(
      sqftService.quantity,
      this.getSquareFeetMinForBedrooms()
    );
    this.selectedServices.set(this.selectedServices());
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
    return this.sqftOptionsCache!.options;
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
    const selectedService = this.selectedServices().find(s => s.service.id === service.id);
    if (selectedService) {
      // Captured BEFORE the write below — the bedrooms→sqft rule needs the floor of the
      // OUTGOING bedroom count to tell an inherited sqft from a chosen one.
      const previousQuantity = selectedService.quantity;
      selectedService.quantity = quantity;
      this.selectedServices.set(this.selectedServices());

      // Update square feet when bedrooms change
      if (service.serviceKey === 'bedrooms') {
        const sqftService = this.selectedServices().find(s => s.service.serviceKey === 'sqft');
        if (sqftService) {
          sqftService.quantity = resolveSquareFeetForBedroomChange(
            sqftService.quantity,
            this.getSquareFeetForBedrooms(previousQuantity),
            this.getSquareFeetForBedrooms(quantity)
          );
          this.selectedServices.set(this.selectedServices());
        }
      }

      // If updating square feet, ensure it's not below minimum for current bedrooms
      if (service.serviceKey === 'sqft') {
        const minSquareFeet = this.getSquareFeetMinForBedrooms();
        if (quantity < minSquareFeet) {
          selectedService.quantity = minSquareFeet;
          this.selectedServices.set(this.selectedServices());
          quantity = minSquareFeet;
        }
      }
      
      // When cleaners or hours change, update the display for both
      if (service.serviceKey === 'cleaners' || service.serviceKey === 'hours') {
        // Force Angular to detect changes
        this.selectedServices.set(this.selectedServices());
      }
      this.calculateTotal();
    }
    this.saveFormData();
  }

  incrementServiceQuantity(service: Service) {
    const selectedService = this.selectedServices().find(s => s.service.id === service.id);
    if (selectedService) {
      const maxValue = service.maxValue || 10;
      const stepValue = service.stepValue || 1;
      const newQuantity = Math.min(selectedService.quantity + stepValue, maxValue);
      this.updateServiceQuantity(service, newQuantity);
    }
  }

  decrementServiceQuantity(service: Service) {
    const selectedService = this.selectedServices().find(s => s.service.id === service.id);
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
    // A house has no studio. Raising the floor here is what greys out the minus button at one
    // bedroom and stops the "Studio" label ever appearing, without a second rule in the template.
    if (service.serviceKey === 'bedrooms' && isHouse(this.propertyType())) {
      return Math.max(baseMin, 1);
    }
    return baseMin;
  }

  // ===== Property type (apartment vs house) + levels =====

  /**
   * THE step-1 gate for property type. Both branches of isStep1Valid route through it, and the
   * blocker diagnostics and the inline error message read the same two predicates below, so a
   * disabled Continue button can always be explained on screen.
   *
   * Property type is required wherever it is asked. Levels are required ONLY where they are
   * actually priced, so picking House on an hourly service type does not strand the customer
   * behind chips that were never rendered.
   */
  isPropertyTypeAnswered(): boolean {
    return !this.isPropertyTypeMissing() && !this.isLevelsMissing();
  }

  /** Property type is asked but unanswered. Drives the inline error under the two cards. */
  isPropertyTypeMissing(): boolean {
    return this.showPropertyTypeSelector() && this.propertyType() === null;
  }

  /** Levels are rendered but unanswered. Drives the inline error under the chips. */
  isLevelsMissing(): boolean {
    return this.showLevelsSelector() && this.levelsQuantity() === null;
  }

  /** Template helper: levels has its own gated block, never the generic service grid. */
  isLevelsService(service: Service): boolean {
    return isLevelsService(service);
  }

  /**
   * The property-type question is asked on EVERY service type, with NO gating - including the
   * custom ("Pre-Arranged") flow, where it is informational only.
   *
   * On a type that does not price rooms it still earns its place: admins and cleaners need to
   * know about parking, a walk-up, travel time and equipment before they arrive. Do NOT re-couple
   * this to whether a levels service exists; that was an earlier design and it was wrong.
   *
   * The ONE exclusion is the poll/quote form, which is not a booking at all - it submits a quote
   * request and never creates an Order, so there is nothing to persist a property type onto.
   */
  showPropertyTypeSelector(): boolean {
    if (this.showPollForm()) return false;
    return serviceTypeCollectsPropertyType(this.selectedServiceType());
  }

  /**
   * Levels are asked for a house on EVERY service type that shows the property type. Visibility
   * is NOT tied to whether a priced levels service exists.
   *
   * Whether the answer costs anything is a separate question, decided by
   * getPricedLevelsService():
   *
   *   - Priced (Residential, Move in/out): selecting a count creates the OrderService row and
   *     prices through the self-referencing threshold, unchanged.
   *   - Informational (Office, Custom, Heavy Conditional, Pre-Arranged...): the count is captured
   *     ONLY as Order.LevelsQuantity. No line, no cost, no duration, no summary row. Same
   *     precedent as Order.BedroomsQuantity / BathroomsQuantity, which are already collected this
   *     way for cleaner+hours and custom modes.
   *
   * That split is why an hourly type can still be asked: stair time is already inside the hours
   * the customer buys, so the answer must not add a charge - but the crew still needs to know
   * there are three flights to carry equipment up.
   */
  showLevelsSelector(): boolean {
    return this.showPropertyTypeSelector() && isHouse(this.propertyType());
  }

  /**
   * The levels catalogue row for the selected service type, or null when it has none.
   *
   * Null is the whole definition of "informational": no row means no OrderService line, so
   * nothing reaches the calculator and the price cannot move.
   */
  private getPricedLevelsService(): Service | null {
    return findLevelsService(this.selectedServiceType());
  }

  /** True when a chosen level count would actually be charged for. */
  levelsArePriced(): boolean {
    return this.getPricedLevelsService() != null;
  }

  isPropertyTypeSelected(type: PropertyType): boolean {
    return this.propertyType() === type;
  }

  selectPropertyType(type: PropertyType): void {
    // Deliberately does NOT mark the block touched. Picking House is the customer STARTING to
    // answer, not finishing: marking it here fired "Please choose how many levels" the instant
    // they clicked, before a single chip existed to click. Errors surface on a blocked Continue,
    // which is the same moment every other required step-1 control reveals its own.
    if (this.propertyType() === type) return;
    this.propertyType.set(type);

    if (type === PROPERTY_TYPE_HOUSE) {
      // Studio is not offered for a house, so a customer who had it selected is raised to one
      // bedroom - and the sq.ft floor follows, through the same linkage a manual bedroom change
      // uses. Anything the customer had ABOVE the floor is preserved.
      //
      // On a service type with no bedrooms input this is a no-op rather than an error: the
      // lookup simply finds nothing. That is the whole of rule (b) for the studio behaviour.
      this.raiseBedroomsToHouseMinimum();
    } else {
      // Back to apartment: the levels question disappears, so its answer must go too. Leaving a
      // stale count would keep charging for stairs on a flat.
      this.clearLevelsSelection();
    }

    this.calculateTotal();
    this.saveFormData();
  }

  /**
   * What the extra levels are costing right now, through the SHARED calculator.
   *
   * Deliberately not `35 * (levels - 1)`: the cost, the minutes and the included allowance are
   * all admin-editable data, and the deep-cleaning multiplier applies on top. Reading it back
   * from getServiceDisplayPrice is the only way this line can be guaranteed to agree with the
   * subtotal it sits above.
   */
  getAdditionalLevelsCost(): number {
    if (!isHouse(this.propertyType()) || this.levelsQuantity() == null) return 0;

    // Zero on an unpriced service type, because no line was ever added. That is what keeps the
    // "Additional levels" summary row off an informational order, the same way it stays off a
    // single-level house whose line prices to $0.
    const levels = this.selectedServices().find(s => isLevelsService(s.service));
    if (!levels) return 0;

    return getServiceDisplayPrice(
      levels.service, levels.quantity, this.getSelectedPriceMultiplier(), this.selectedServices());
  }

  isLevelsSelected(levels: number): boolean {
    return this.levelsQuantity() === levels;
  }

  selectLevels(levels: number): void {
    this.levelsQuantity.set(levels);
    this.applyLevelsToSelectedServices(levels);
    this.calculateTotal();
    this.saveFormData();
  }

  /**
   * Adds or updates the levels line in selectedServices, which is what makes it reach the shared
   * calculator, the submitted DTO and the persisted session as an ordinary service.
   */
  private applyLevelsToSelectedServices(levels: number): void {
    // No catalogue row means this service type does not price levels. Returning here is what
    // makes the informational case informational: nothing enters selectedServices, so nothing
    // reaches the calculator, the DTO's services array or the summary.
    const definition = this.getPricedLevelsService();
    if (!definition) return;

    const existing = this.selectedServices().find(s => s.service.id === definition.id);
    if (existing) { existing.quantity = levels; this.selectedServices.set(this.selectedServices()); }
    else { this.selectedServices().push({ service: definition, quantity: levels }); this.selectedServices.set(this.selectedServices()); }
  }

  /** Forgets the level count AND removes the priced line. Both, or the charge survives. */
  private clearLevelsSelection(): void {
    this.levelsQuantity.set(null);
    this.selectedServices.set(this.selectedServices().filter(s => !isLevelsService(s.service)));
  }

  /**
   * Raises a studio to one bedroom for a house, dragging the included sq.ft up with it.
   *
   * Uses the SAME resolveSquareFeetForBedroomChange rule a manual bedroom change uses, with the
   * previous bedroom count captured before the write - the rule needs the OUTGOING floor to tell
   * an inherited sq.ft from one the customer chose. Mirrored server-side by
   * OrderPricingInputBuilder.ClampBedroomsToPropertyType.
   */
  private raiseBedroomsToHouseMinimum(): void {
    const bedrooms = this.selectedServices().find(s => s.service.serviceKey === 'bedrooms');
    if (!bedrooms || bedrooms.quantity >= 1) return;

    // updateServiceQuantity captures the outgoing count itself before writing the new one, so
    // the sq.ft linkage sees studio -> 1 bedroom and lifts 400 to 650.
    this.updateServiceQuantity(bedrooms.service, 1);
  }

  /**
   * Restores the property answers from a persisted session.
   *
   * Anything that does not normalize to one of the two known values lands as null and the
   * customer is asked again. That covers a session saved before this feature shipped (no field
   * at all) and a stored value we no longer recognise, with no legacy branch: both simply fail
   * the step-1 gate until answered.
   *
   * The levels count is only restored for a HOUSE, and only then does the priced line go back
   * into selectedServices - a stored count left over from before the customer switched to
   * Apartment must not silently reappear as a charge.
   */
  private restorePropertyTypeSelection(savedData: BookingFormData | null): void {
    if (!this.showPropertyTypeSelector()) {
      this.resetPropertyTypeSelection();
      return;
    }

    this.propertyType.set(normalizePropertyType(savedData?.propertyType));

    // Only a house has levels at all. Restoring is safe on an unpriced type too: the count comes
    // back as an informational value and applyLevelsToSelectedServices adds no line.
    if (!isHouse(this.propertyType())) {
      this.clearLevelsSelection();
      return;
    }

    const stored = savedData?.levelsQuantity;
    const restored = stored == null ? null : Math.round(Number(stored));
    this.levelsQuantity.set(restored != null && LEVEL_OPTIONS.includes(restored) ? restored : null);

    if (this.levelsQuantity() != null) this.applyLevelsToSelectedServices(this.levelsQuantity()!);
  }

  /**
   * Resets the property answers when the service type changes.
   *
   * Switching to a type with no levels service must not leave a stale property type on the
   * order, and switching between two types that both have one must not carry a level count
   * across, because the levels line belongs to a specific service type's catalogue row.
   */
  private resetPropertyTypeSelection(): void {
    this.propertyType.set(null);
    this.clearLevelsSelection();
  }

  hasExtraCleanersSelected(): boolean {
    return this.selectedExtraServices().some(
      s => isExtraCleaners(s.extraService)
    );
  }

  // Auto-bump the hours service up to the Extra-Cleaners minimum (2.5h) when the user
  // toggles Extra Cleaners on while hours sits below it. Without this, the +/- control
  // would simply be disabled at a too-low value and the user couldn't tell why.
  private enforceHoursMinForExtraCleaners() {
    const hoursSelected = this.selectedServices().find(
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
    if (extraService.isSameDayService && !this.isSameDayServiceAvailable() && !this.isAdminOrSuperAdmin && this.isCurrentlyMobile()) {
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
    if (extraService.isSameDayService && !this.isSameDayServiceAvailable() && !this.isAdminOrSuperAdmin) {
      return;
    }
    
    const index = this.selectedExtraServices().findIndex(s => s.extraService.id === extraService.id);
    
    if (index > -1) {
      // Remove if already selected
      this.selectedExtraServices().splice(index, 1);
      this.selectedExtraServices.set(this.selectedExtraServices());

      // On mobile, briefly re-show this service's tooltip so a deselect
      // tap still reveals the description (matches desktop hover behaviour).
      this.clearAllMobileTooltips();
      this.showMobileTooltip(extraService.id);

      if (extraService.isSameDayService) {
        this.isSameDaySelected.set(false);
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
        this.selectedExtraServices.set(this.selectedExtraServices().filter(
          s => !s.extraService.isDeepCleaning && !s.extraService.isSuperDeepCleaning
        ));
      }
      
      // Add new selection
      this.selectedExtraServices().push({
        extraService: extraService,
        quantity: 1,
        hours: extraService.hasHours ? 0.5 : 0
      });
      this.selectedExtraServices.set(this.selectedExtraServices());

      // Show mobile tooltip for this service
      this.showMobileTooltip(extraService.id);

      if (extraService.isSameDayService) {
        this.isSameDaySelected.set(true);
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
    const selected = this.selectedExtraServices().find(s => s.extraService.id === extraService.id);
    if (selected && quantity >= 1) {
      selected.quantity = quantity;
      this.selectedExtraServices.set(this.selectedExtraServices());
      this.calculateTotal();
      this.saveFormData(); // Save form data immediately when quantity changes
    }
  }

  updateExtraServiceHours(extraService: ExtraService, hours: number) {
    const selected = this.selectedExtraServices().find(s => s.extraService.id === extraService.id);
    if (selected && hours >= 0.5) {
      selected.hours = hours;
      this.selectedExtraServices.set(this.selectedExtraServices());
      this.calculateTotal();
      this.saveFormData(); // Save form data immediately when hours change
    }
  }

  isExtraServiceSelected(extraService: ExtraService): boolean {
    return this.selectedExtraServices().some(s => s.extraService.id === extraService.id);
  }

  getExtraServiceQuantity(extraService: ExtraService): number {
    const selected = this.selectedExtraServices().find(s => s.extraService.id === extraService.id);
    return selected ? selected.quantity : 1;
  }

  getExtraServiceHours(extraService: ExtraService): number {
    const selected = this.selectedExtraServices().find(s => s.extraService.id === extraService.id);
    return selected ? selected.hours : 0.5;
  }

  getExtraServicePrice(extraService: ExtraService): number {
    const selected = this.selectedExtraServices().find(s => s.extraService.id === extraService.id);
    // Defaults for not-yet-selected cards: 0.5h / qty 1. Math lives in the shared calculator.
    const hours = selected ? selected.hours : 0.5;
    const quantity = selected ? selected.quantity : 1;
    return getExtraServiceDisplayPrice(extraService, quantity, hours, this.getSelectedPriceMultiplier());
  }

  getExtraServiceDuration(extraService: ExtraService): number {
    const selected = this.selectedExtraServices().find(s => s.extraService.id === extraService.id);
    
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
    return getServiceDisplayPrice(service, quantity, this.getSelectedPriceMultiplier(), this.selectedServices());
  }



  selectSubscription(subscription: Subscription) {
    this.selectedSubscription.set(subscription);
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
    if (this.loyaltyDiscountPercentage() <= 0) return 0;
    const sub = this.calculation().subTotal || 0;
    if (sub <= 0) return 0;
    return round2(sub * (this.loyaltyDiscountPercentage() / 100));
  }

  // Compute what a candidate discount would be worth in $ on the current subTotal, matching
  // the math used by calculateTotal so the pre-flight comparison stays consistent with what
  // the stacking gate actually does. Gift cards aren't checked here — they stack with loyalty.
  private candidateDollarValue(value: number, isPercentage: boolean): number {
    const sub = this.calculation().subTotal || 0;
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
    if (this.specialOfferApplied()) {
      this.errorMessage.set('Cannot apply promo code when a special offer is already applied. Please remove the special offer first.');
      return;
    }

    // Keep your existing first-time discount check as is
    if (this.firstTimeDiscountApplied) {
      this.errorMessage.set('Cannot apply promo code when first-time discount is already applied. Please remove the first-time discount first.');
      return;
    }

    // Clear any previous error
    this.errorMessage.set('');

    this.bookingService.validatePromoCode(code, this.calculation().subTotal).subscribe({
      next: (validation) => {
        if (validation.isValid) {
          // Ensure the promo code value is preserved in the FormControl
          if (this.promoCode.value !== code) {
            this.promoCode.setValue(code, { emitEvent: false });
          }

          this.discountsClearedForAccountSwitch.set(false);

          if (validation.isGiftCard) {
            // Handle gift card
            this.isGiftCard.set(true);
            this.giftCardApplied.set(true);
            this.giftCardBalance.set(validation.availableBalance || 0);
            this.promoCodeApplied.set(false); // Gift cards don't use promo system
          } else {
            // Pre-flight loyalty check (non-gift-card promos only). If the user's existing
            // loyalty discount is worth more than this promo, refuse to apply and tell them
            // why — the stacking gate would zero the promo anyway, so this is just clearer UX.
            const loyaltyDollars = this.currentLoyaltyDollarValue();
            const promoDollars = this.candidateDollarValue(validation.discountValue, validation.isPercentage);
            if (loyaltyDollars > promoDollars) {
              this.errorMessage.set(`You already have a Loyalty Discount of ${this.loyaltyDiscountPercentage()}% on your account — ` +
                `it's better than this promo code, so they can't be used together.`);
              return;
            }

            // Your existing promo code logic stays exactly the same
            this.isGiftCard.set(false);
            this.giftCardApplied.set(false);
            this.promoCodeApplied.set(true);
            this.promoDiscount.set(validation.discountValue);
            this.promoIsPercentage.set(validation.isPercentage);
          }

          this.calculateTotal();
        } else {
          this.errorMessage.set(validation.message || 'Invalid promo code');
        }
      },
      error: () => {
        this.errorMessage.set('Failed to validate promo code');
      }
    });
  }

private updateDateRestrictions() {
    if (this.isSameDaySelected()) {
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
    const apartment = this.userApartments().find(a => a.id === +apartmentId);
    if (apartment) {
      // First set the state and load cities
      this.bookingForm.patchValue({
        state: apartment.state
      });
      
      // Load cities for the state, then set the rest of the address
      this.locationService.getCities(apartment.state).subscribe({
        next: (cities) => {
          this.cities.set(cities);
          
          // Now set all address fields including city and address name (required)
          this.bookingForm.patchValue({
            serviceAddress: apartment.address,
            apartmentName: apartment.name || DEFAULT_ADDRESS_NAME,
            aptSuite: apartment.aptSuite || '',
            city: apartment.city,
            zipCode: apartment.postalCode
          });
        }
      });
    }
  }

  // Maps the component's selections into the shared calculator's input shape.
  // ALL price math AND the selection→input mapping live in
  // shared/pricing/order-pricing.calculator.ts (mirrored by the backend).
  private buildQuoteInput(): QuoteInput {
    // Gated on the MODE alone, never on the amount being filled in. It used to also require
    // customAmount, so an empty (or cleared) Total Amount fell through to the ordinary path and
    // priced the selections normally — which is how informational extras started charging the
    // customer in the summary. A custom order with no amount typed is simply $0 until one is.
    if (this.showCustomPricing()) {
      return {
        basePrice: this.selectedServiceType()?.basePrice ?? 0,
        baseDuration: this.selectedServiceType()?.timeDuration ?? 0,
        services: [],
        // Extras ARE passed on a custom-priced order even though they cost nothing: the
        // calculator's custom branch turns them into $0 / 0-minute lines so they get persisted
        // for the admin panel and the cleaner's job email. Passing [] here would diverge from
        // the backend, which prices the same DTO with its extras attached.
        extraServices: mapSelectedExtraInputs(this.selectedExtraServices()),
        isCustomPricing: true,
        customAmount: parseFloat(this.customAmount.value) || 0,
        customCleaners: parseInt(this.customCleaners.value) || 1,
        customDuration: parseInt(this.customDuration.value) || 90
      };
    }

    return buildQuoteInputFromSelections(this.selectedServiceType(), this.selectedServices(), this.selectedExtraServices());
  }

  /** Current cleaning-type multiplier (super deep > deep > 1) from the shared calculator. */
  getSelectedPriceMultiplier(): number {
    return resolvePriceMultiplier(mapSelectedExtraInputs(this.selectedExtraServices())).multiplier;
  }

  calculateTotal() {
    // Single source of truth: the shared pricing calculator (mirrored by the backend).
    const quote = calculateQuote(this.buildQuoteInput());

    this.calculatedMaidsCount.set(quote.maidsCount);
    this.actualTotalDuration = quote.totalDuration;
    const subTotal = quote.subTotal;

    // Reset discount amounts
    this.subscriptionDiscountAmount.set(0);
    this.promoOrFirstTimeDiscountAmount.set(0);

    // Subscription discount: only when the user's active subscription matches the selection.
    if (this.hasActiveSubscription() && this.userSubscription() && this.selectedSubscription()) {
      const userSubscriptionDays = this.getUserSubscriptionDays(this.userSubscription());
      const selectedSubscriptionDays = this.selectedSubscription()!.subscriptionDays || 0;
      if (userSubscriptionDays === selectedSubscriptionDays && selectedSubscriptionDays > 0) {
        this.subscriptionDiscountAmount.set(percentOf(subTotal, this.selectedSubscription()!.discountPercentage));
      }
    }

    // Promo / special offer / first-time discount (can stack with subscription). Same rules as
    // the server (BookingCreationService.ApplyPromoRule) and every order edit: a percentage is
    // percentOf, a fixed amount is its face value capped at the subtotal (2026-10: a fixed promo
    // CODE is capped too now, like a fixed special offer always was).
    let fixedPromoFace: number | null = null;
    if (this.specialOfferApplied() && this.selectedSpecialOffer()) {
      const offer = this.selectedSpecialOffer()!;
      if (!offer.isPercentage) fixedPromoFace = offer.discountValue;
      this.promoOrFirstTimeDiscountAmount.set(offer.isPercentage
        ? percentOf(subTotal, offer.discountValue)
        : capFixedDiscount(offer.discountValue, subTotal, 0));
    } else if (this.promoCodeApplied() && !this.giftCardApplied()) {
      if (!this.promoIsPercentage()) fixedPromoFace = this.promoDiscount();
      this.promoOrFirstTimeDiscountAmount.set(this.promoIsPercentage()
        ? percentOf(subTotal, this.promoDiscount())
        : capFixedDiscount(this.promoDiscount(), subTotal, 0));
    }

    // Loyalty Discount stacking — mutates the three discount slots in place.
    this.applyLoyaltyStacking(subTotal);

    // A surviving fixed amount is capped once more against the other survivors (subscription and
    // promo can stack), exactly as BookingCreationService.RecordDiscountRules does server-side.
    if (fixedPromoFace != null && this.promoOrFirstTimeDiscountAmount() > 0) {
      this.promoOrFirstTimeDiscountAmount.set(capFixedDiscount(
        fixedPromoFace, subTotal, this.subscriptionDiscountAmount() + this.loyaltyDiscountAmount()));
    }

    // Total discount is the sum of all three slots; after stacking at most two are non-zero.
    const totalDiscountAmount = this.subscriptionDiscountAmount() + this.promoOrFirstTimeDiscountAmount() + this.loyaltyDiscountAmount();

    const tips = this.tipsAmount;

    const totals = calculateTotals({
      subTotal,
      // Custom Pricing: keeps the quoted total equal to the tax-inclusive amount the admin
      // typed (null for every other quote).
      taxOverride: quote.taxOverride,
      discountAmount: this.promoOrFirstTimeDiscountAmount(),
      subscriptionDiscountAmount: this.subscriptionDiscountAmount(),
      loyaltyDiscountAmount: this.loyaltyDiscountAmount(),
      tips
    });

    // Gift card / bubble points / bubble credits come off the very end.
    let finalTotal = totals.totalBeforeGiftCard;
    if (this.giftCardApplied() && this.isGiftCard()) {
      this.giftCardAmountToUse.set(resolveGiftCardAmountToUse(this.giftCardBalance(), totals.totalBeforeGiftCard));
      finalTotal = Math.max(0, finalTotal - this.giftCardAmountToUse());
    }
    if (this.selectedPointsToRedeem() > 0 && this.pointsDiscountAmount() > 0) {
      finalTotal = Math.max(0, finalTotal - this.pointsDiscountAmount());
    }
    if (this.useCredits() && this.userBubbleCredits() > 0) {
      finalTotal = Math.max(0, finalTotal - this.userBubbleCredits());
    }

    this.calculation.set({
      subTotal: round2(subTotal),
      tax: totals.tax,
      discountAmount: totalDiscountAmount,
      tips,
      total: round2(finalTotal),
      totalDuration: quote.displayDuration
    });

    // Next order's total with the subscription discount applied (no tips/gift card).
    if (this.selectedSubscription() && this.selectedSubscription()!.subscriptionDays > 0 && !this.hasActiveSubscription()) {
      this.nextOrderDiscount.set(round2(subTotal * (this.selectedSubscription()!.discountPercentage / 100)));
      const nextTotals = calculateTotals({ subTotal, discountAmount: this.nextOrderDiscount() });
      this.nextOrderTotal.set(nextTotals.discountedSubTotal + nextTotals.tax);
    } else {
      this.nextOrderDiscount.set(0);
      this.nextOrderTotal.set(0);
    }
  }

  // Get cleaner pricing text
  getCleanerPricingText(): string {
    const deepCleaning = this.selectedExtraServices().find(s => s.extraService.isDeepCleaning);
    const superDeepCleaning = this.selectedExtraServices().find(s => s.extraService.isSuperDeepCleaning);
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
    const hoursService = this.selectedServices().find(s => s.service.serviceRelationType === 'hours');
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
    const cleanersService = this.selectedServices().find(s => s.service.serviceRelationType === 'cleaner');
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
    return this.selectedServices().some(s => s.service.serviceRelationType === 'cleaner');
  }

  hasBedroomsService(): boolean {
    return this.selectedServices().some(s => s.service.serviceKey === 'bedrooms');
  }

  hasBathroomsService(): boolean {
    return this.selectedServices().some(s => s.service.serviceKey === 'bathrooms');
  }

  shouldShowStandaloneBedroomBathroom(): boolean {
    if (!this.selectedServiceType() || this.showPollForm() || this.showCustomPricing()) return false;
    if (this.isOfficeCleaningServiceType()) return false;
    const hasCleaner = this.selectedServices().some(s => s.service.serviceRelationType === 'cleaner');
    const hasHours = this.selectedServices().some(s => s.service.serviceRelationType === 'hours');
    return hasCleaner && hasHours && !this.hasBedroomsService() && !this.hasBathroomsService();
  }

  private syncStandaloneBedroomBathroomFromServices(): void {
    const bedrooms = this.selectedServices().find(s => s.service.serviceKey === 'bedrooms');
    const bathrooms = this.selectedServices().find(s => s.service.serviceKey === 'bathrooms');
    if (bedrooms) this.bedroomsQuantityControl.setValue(bedrooms.quantity, { emitEvent: false });
    if (bathrooms) this.bathroomsQuantityControl.setValue(bathrooms.quantity, { emitEvent: false });
  }

  getSelectedBedroomsQuantity(): number | undefined {
    if (this.showPollForm()) return undefined;
    if (this.showCustomPricing() || this.shouldShowStandaloneBedroomBathroom()) {
      return Number(this.bedroomsQuantityControl.value);
    }
    const bedrooms = this.selectedServices().find(s => s.service.serviceKey === 'bedrooms');
    return bedrooms ? bedrooms.quantity : undefined;
  }

  getSelectedBathroomsQuantity(): number | undefined {
    if (this.showPollForm()) return undefined;
    if (this.showCustomPricing() || this.shouldShowStandaloneBedroomBathroom()) {
      return Number(this.bathroomsQuantityControl.value);
    }
    const bathrooms = this.selectedServices().find(s => s.service.serviceKey === 'bathrooms');
    return bathrooms ? bathrooms.quantity : undefined;
  }

  onStandaloneQuantityChange(): void {
    this.saveFormData();
  }

  // Get cleaner price per hour based on cleaning type
  getCleanerPricePerHour(): number {
    // Get the actual cleaner service cost from the selected services
    const cleanerService = this.selectedServices().find(s => s.service.serviceRelationType === 'cleaner');
    const basePrice = cleanerService ? cleanerService.service.cost : 40; // fallback to 40 if no cleaner service found
    return basePrice * this.getSelectedPriceMultiplier();
  }

  getExtraCleanersCount(): number {
    const extraCleanersService = this.selectedExtraServices().find(s => isExtraCleaners(s.extraService));
    return extraCleanersService ? extraCleanersService.quantity : 0;
  }

  formatDuration(minutes: number): string {
    // Use rounded duration
    const baseFormat = DurationUtils.formatDurationRounded(minutes);
    
    // Preserve your "per maid" logic
    if (this.calculatedMaidsCount() > 1) {
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
    if (mobile && !this.selectedServiceType()) return lines;

    lines.push({ label: 'Service Type:', value: this.selectedServiceType()?.name || (mobile ? '' : '—') });

    if (this.showCustomPricing()) {
      lines.push({ label: 'Number of Cleaners:', value: `${this.customCleaners.value}` });
      lines.push({ label: 'Duration:', value: this.formatDuration(this.customDuration.value) });
    } else {
      if (this.selectedSubscription()) {
        lines.push({ label: 'Cleaning frequency:', value: this.selectedSubscription()!.name || (mobile ? '' : '—') });
      }
      lines.push({ label: 'Duration:', value: this.formatDuration(this.calculation().totalDuration) });
      // Cleaner count is only a customer-facing concept for cleaner+hours service
      // types; for regular types the team decides staffing (admin-set, never shown).
      if (this.hasCleanerServices()) {
        lines.push({ label: 'Number of Cleaners:', value: `${this.calculatedMaidsCount()}` });
      }
    }

    const hasDateTime = this.serviceDate.value && this.serviceTime.value;
    if (hasDateTime || !mobile) {
      lines.push({
        label: 'Date & Time:',
        value: hasDateTime ? `${formatDate(this.serviceDate.value, 'MMM d', 'en-US')} at ${this.formatTime(this.serviceTime.value)}` : '—'
      });
    }
    return lines;
  }

  getSummaryPriceLines(mobile: boolean): SummaryLine[] {
    const lines: SummaryLine[] = [];

    // Additional levels, shown ONLY when they cost something. A one-level house and an apartment
    // both add $0, and a $0 line reads as a mistake rather than as reassurance.
    const additionalLevelsCost = this.getAdditionalLevelsCost();
    if (additionalLevelsCost > 0) {
      lines.push({
        label: `Additional levels (${(this.levelsQuantity() ?? 1) - 1}):`,
        value: `$${additionalLevelsCost.toFixed(2)}`
      });
    }

    lines.push({ label: 'Subtotal:', value: `$${this.calculation().subTotal.toFixed(2)}` });

    if (this.subscriptionDiscountAmount() > 0) {
      lines.push({
        label: `Plan discount (${this.userSubscription()?.discountPercentage}%):`,
        value: `-$${this.subscriptionDiscountAmount().toFixed(2)}`,
        rowClass: 'subscription-discount', valueClass: 'discount'
      });
    }

    if (this.loyaltyDiscountAmount() > 0) {
      lines.push({
        label: `Loyalty Discount (${this.loyaltyDiscountPercentage()}%):`,
        value: `-$${this.loyaltyDiscountAmount().toFixed(2)}`,
        valueClass: 'discount'
      });
    }

    if (this.promoOrFirstTimeDiscountAmount() > 0) {
      let label = '';
      if (this.specialOfferApplied() && this.selectedSpecialOffer()) {
        label = this.selectedSpecialOffer()!.name + (this.selectedSpecialOffer()!.isPercentage ? ` (${this.selectedSpecialOffer()!.discountValue}%)` : '');
      } else if (this.promoCodeApplied()) {
        label = 'Promo Code Discount' + (this.promoIsPercentage() ? ` (${this.promoDiscount()}%)` : '');
      }
      lines.push({ label, value: `-$${this.promoOrFirstTimeDiscountAmount().toFixed(2)}`, valueClass: 'discount' });
    }

    if (this.giftCardApplied()) {
      lines.push({
        label: 'Gift Card Discount:',
        value: `-$${this.getGiftCardDisplayInfo().amountToUse.toFixed(2)}`,
        rowClass: 'gift-card-discount', valueClass: 'discount'
      });
    }

    if (this.selectedPointsToRedeem() > 0) {
      lines.push({
        label: `${mobile ? 'Bubble Points' : 'Points'} (${formatNumber(this.selectedPointsToRedeem(), 'en-US')} pts):`,
        value: `-$${formatNumber(this.pointsDiscountAmount(), 'en-US', '1.2-2')}`,
        rowClass: 'points-discount', valueClass: 'discount'
      });
    }

    if (this.useCredits() && this.userBubbleCredits() > 0) {
      lines.push({
        label: 'Reward Balance:',
        value: `-$${this.userBubbleCredits().toFixed(2)}`,
        rowClass: 'points-discount', valueClass: 'discount'
      });
    }

    lines.push({ label: 'Sales Tax (8.875%):', value: `$${this.calculation().tax.toFixed(2)}` });

    if (this.tipsAmount > 0) {
      lines.push({ label: 'Tips for Cleaners:', value: `$${this.tipsAmount.toFixed(2)}` });
    }

    return lines;
  }

  /** Pts-earn preview value for the summary card; null hides the block. */
  getEstimatedPointsDisplay(): string | null {
    return this.currentUser() && this.bubblePointsEnabled() && this.estimatedPoints > 0
      ? formatNumber(this.estimatedPoints, 'en-US')
      : null;
  }

  getServiceDuration(service: Service): number {
    // Per-service display duration is NOT multiplier-scaled (bug B1) — it now matches the
    // summary exactly. The multiplier is still passed for signature symmetry.
    const quantity = this.getServiceQuantity(service);
    return getServiceDisplayDuration(service, quantity, this.getSelectedPriceMultiplier(), this.selectedServices());
  }

  getServiceQuantity(service: Service): number {
    const selected = this.selectedServices().find(s => s.service.id === service.id);
    return selected ? selected.quantity : (service.minValue || 0);
  }

  isFormValid(): boolean {
    if (this.showPollForm()) {
      return this.isPollFormValid();
    }
    
    // Check custom pricing validation if applicable
    if (this.showCustomPricing()) {
      return this.bookingForm.valid && 
             this.serviceTypeControl.valid &&
             this.selectedServiceType() !== null && 
             this.selectedSubscription() !== null && 
             this.cleaningType.value !== null &&
             this.consentsSatisfied &&
             this.customServiceName.valid &&
             this.customAmount.valid &&
             this.customCleaners.valid &&
             this.customDuration.valid &&
             this.entryMethod.value;
    }
    
    return this.bookingForm.valid && 
           this.serviceTypeControl.valid &&
           this.selectedServiceType() !== null && 
           this.selectedSubscription() !== null && 
           this.cleaningType.value !== null &&
           this.consentsSatisfied;
  }

  /**
   * Builds the read-only snapshot the blocker diagnostics work from.
   * Kept next to isFormValid()/isStepNValid() so the two stay in sync.
   */
  private buildBookingDiagnosticsSnapshot(
    trigger: BookingDiagnosticsSnapshot['trigger']
  ): BookingDiagnosticsSnapshot {
    return {
      trigger,
      currentStep: this.currentStep(),
      bookingForm: this.bookingForm,
      serviceTypeControl: this.serviceTypeControl,
      customPricingControls: this.showCustomPricing()
        ? {
            customServiceName: this.customServiceName,
            customAmount: this.customAmount,
            customCleaners: this.customCleaners,
            customDuration: this.customDuration
          }
        : null,
      selectedServiceType: this.selectedServiceType(),
      selectedSubscription: this.selectedSubscription(),
      showPollForm: this.showPollForm(),
      showCustomPricing: this.showCustomPricing(),
      pollQuestions: this.pollQuestions(),
      pollAnswers: this.pollAnswers(),
      isAdminMode: this.isAdminMode(),
      selectedTargetUser: this.selectedTargetUser(),
      sameDayFullyBooked: this.isSameDaySelected() && this.isSameDayFullyBooked(),
      dateTimeBlocked: this.isSelectedDateTimeBlocked(),
      // Same two predicates the inline error messages read, so the console table and the screen
      // can never disagree about why Continue is disabled.
      propertyTypeMissing: this.isPropertyTypeMissing(),
      levelsMissing: this.isLevelsMissing(),
      minTipAmount: this.minTipAmount,
      gates: {
        isFormValid: this.isFormValid(),
        canProceedToNextStep: this.canProceedToNextStep(),
        isStep1Valid: this.isStep1Valid(),
        isStep2Valid: this.isStep2Valid(),
        isStep3Valid: this.isStep3Valid()
      }
    };
  }

  /**
   * Console explanation of why Book Now / Continue is greyed out. Fires automatically when an
   * admin clicks a button the gate has disabled — admins kept reporting "everything is filled
   * in and it still won't submit", which is usually a required control no step renders
   * (see booking-blockers.diagnostics.ts). Customers never see this log.
   */
  private logWhyButtonDisabled(trigger: BookingDiagnosticsSnapshot['trigger']): void {
    if (!this.isBrowser || !this.isAdmin()) return;
    logBookingBlockers(this.buildBookingDiagnosticsSnapshot(trigger));
  }

  /**
   * Registers window.bookingWhyDisabled() so the reasons can be printed at any time without
   * having to click the disabled button first. Available to anyone who types it deliberately.
   */
  private registerBookingDiagnosticsHelper(): void {
    if (!this.isBrowser) return;
    (window as any).bookingWhyDisabled = () => {
      logBookingBlockers(
        this.buildBookingDiagnosticsSnapshot(
          this.currentStep() === 3 || this.showPollForm() ? 'Book Now' : 'Continue'
        )
      );
    };
  }

  /**
   * Who does this booking belong to? Returns null when the answer can't be established, in which
   * case onSubmit() aborts.
   *
   * This exists because the old code asked the question twice — a guard on `isAdminMode` near the
   * top, then `if (this.isAdminMode && this.selectedTargetUser)` 170 lines later — with an
   * unguarded `router.navigate(['/booking-confirmation'])` as the implicit else. Any way of
   * losing admin state between those two points (a reload restoring the form but not the admin
   * context) sent the admin to Stripe to pay for their customer's booking. Now the branch is
   * chosen once, explicitly, and every "shouldn't happen" case is a loud stop.
   */
  private resolveSubmitTarget(): BookingSubmitTarget | null {
    if (this.isAdminMode()) {
      if (!this.selectedTargetUser()) {
        this.errorMessage.set('Please select a user to create booking for');
        this.scrollToFirstError();
        return null;
      }
      // Admins/Moderators don't need to be logged in as themselves, but they need to be authenticated
      if (!this.authService.isLoggedIn() || !this.isAdmin()) {
        this.errorMessage.set('You must be logged in as an admin or moderator to create bookings for users');
        return null;
      }
      return 'admin-for-user';
    }

    // Half-present admin context is not a customer booking. Block rather than guess.
    if (this.selectedTargetUser()) {
      this.errorMessage.set('A customer is selected but Admin Mode is off. Nothing was booked — turn Admin Mode back on, or clear the selected customer.');
      console.error(
        '[booking] Blocked submit: selectedTargetUser is set while isAdminMode is false. ' +
        'This would have created the booking under the admin\'s own account.'
      );
      return null;
    }

    // A draft written in Admin Mode must never be submitted as a customer booking, even if
    // discardAdminDraftIfPresent() somehow did not run (SSR, a restore path added later).
    // Belt and braces for the 2026-08 "admin sent to Stripe" incident.
    if (this.formPersistenceService.getFormData()?.wasAdminMode) {
      this.errorMessage.set('This booking was started in Admin Mode, which was not restored. Nothing was booked — please start the booking again.');
      this.adminDraftDiscarded.set(true);
      console.error(
        '[booking] Blocked submit: the saved draft is flagged wasAdminMode but Admin Mode is off.'
      );
      return null;
    }

    return 'self';
  }

  /**
   * Reads the target customer and the payment consequence back to the admin before anything is
   * created. Answers both 2026-08 incidents: a mis-clicked search result shows the wrong name
   * here, and a lost Admin Mode means this dialog never appears at all.
   */
  private confirmAdminBookingTarget(): boolean {
    if (!this.isBrowser) return true;

    const user = this.selectedTargetUser();
    if (!user) return false;

    const emailLabel = user.isNoEmailUser ? 'no email on file' : user.email;
    const methodLabel = this.paymentMethodOptions().find(o => o.value === this.adminPaymentMethod())?.label
      ?? this.adminPaymentMethod();
    // Three outcomes, not two: Invoice is handled outside Stripe like cash, but the money has
    // NOT arrived — saying "recorded as already paid" for it would be plainly false, and the
    // admin confirming this dialog is the last person who can catch that.
    const client = this.adminContractClients.find(c => c.id === this.adminContractClientId);
    const paymentLine =
      this.adminPaymentMethod() === 'Normal'
        ? `Payment: ${methodLabel} — a Pay Now link will be sent to the customer. Nothing is charged to you.`
        : this.adminPaymentMethod() === 'RegularInvoice'
          ? `Payment: Invoice — an invoice is created and sent to the customer. They can pay it by card `
            + `or bank transfer; the order stays Pending Payment until it is paid.`
        : this.adminPaymentMethod() === 'Invoice'
          ? `Payment: Invoice${client ? ` to ${client.legalEntityName}` : ''} — the order stays `
            + `Pending Payment until an invoice covering it is paid in full. No payment link is sent.`
          : `Payment: ${methodLabel} — recorded as already paid. The customer gets a booking confirmation only.`;

    return window.confirm(
      `Create this booking for:\n\n` +
      `${user.firstName} ${user.lastName}\n` +
      `${emailLabel}  ·  ID ${user.id}\n\n` +
      `${paymentLine}`
    );
  }

  /**
   * Submit button text. Admin-mode wording exists so the admin can see, without scrolling back
   * up, that this booking is going to someone else and what will happen when they click.
   * Customers only ever see 'Book Now' / 'Send for Quote'.
   */
  get submitButtonLabel(): string {
    // A poll is a quote request, never a payment — it outranks admin mode, matching the order
    // of the branches in onSubmit().
    if (this.showPollForm()) return 'Send for Quote';

    if (this.isAdminMode() && this.selectedTargetUser()) {
      if (this.adminPaymentMethod() === 'RegularInvoice') return 'Send Invoice';
      return this.adminPaymentMethod() === 'Normal' ? 'Send Payment' : 'Book for User';
    }

    return 'Book Now';
  }

  onSubmit() {
    if (!this.isFormValid()) {
      // Reveal the property-type / levels errors on a blocked submit too, not only on Continue.
      this.propertyTypeTouched.set(true);
      this.logWhyButtonDisabled(this.showPollForm() ? 'Send for Quote' : 'Book Now');
    }

    if (this.showPollForm()) {
      this.submitPollForm();
      return;
    }

    // Never price a booking from an older per-tab copy of the catalogue: fresh data replaces it
    // within moments of the page opening (loadInitialData), and Book Now waits for it.
    if (!this.catalogueFresh()) {
      this.errorMessage.set('Updating prices, please try again in a moment.');
      return;
    }

    // ONE explicit decision about who this booking belongs to. Never fall through: an
    // unresolvable target aborts the submit instead of quietly becoming a customer booking.
    const submitTarget = this.resolveSubmitTarget();
    if (!submitTarget) return;

    // Set form submitted flag
    this.formSubmitted.set(true);
    
    // Check if the form is valid
    if (!this.bookingForm.valid || !this.selectedServiceType() || !this.selectedSubscription() || !this.cleaningType.value) {
      this.scrollToFirstError();
      return;
    }
    
    // Also check custom pricing fields if applicable
    if (this.showCustomPricing() && (!this.customAmount.valid || !this.customCleaners.valid || !this.customDuration.valid || !this.entryMethod.value || !this.customServiceName.value)) {
      this.customServiceName.markAsTouched();
      this.scrollToFirstError();
      return;
    }

    // An Invoice booking has to say who is billed. Checked before the confirmation rather than
    // after, so the admin fixes the field instead of reading a dialog that names no client — and
    // the server refuses it either way.
    if (submitTarget === 'admin-for-user' && this.invoiceClientMissing) {
      this.errorMessage.set('Choose the commercial client this invoice order is billed to.');
      this.scrollToFirstError();
      return;
    }

    // Last line of defence against booking for the wrong customer: make the admin read the name
    // back. Only in admin mode — customers are never interrupted.
    if (submitTarget === 'admin-for-user' && !this.confirmAdminBookingTarget()) {
      return;
    }

    this.isLoading.set(true);
    
    // Get form values, including disabled fields
    const formValue = this.bookingForm.getRawValue();
    
    // Check if serviceDate exists
    if (!formValue.serviceDate) {
      this.errorMessage.set('Please select a service date');
      this.isLoading.set(false);
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
        this.errorMessage.set('Invalid date format');
        this.isLoading.set(false);
        return;
      }
    } else if (formValue.serviceDate instanceof Date) {
      serviceDate = formValue.serviceDate;
    } else {
      this.errorMessage.set('Invalid date format');
      this.isLoading.set(false);
      return;
    }
    
    // The Home/Office/Other picker is the source of truth for the name whether or not a saved
    // address is in use — reading the stored name off the saved apartment instead meant a
    // customer who picked "Other" still booked it as whatever it was called before.
    // apartmentId stays null for a newly typed address.
    const apartmentName: string = resolveAddressName(formValue.apartmentName);
    const apartmentId: number | null = formValue.selectedApartmentId
      ? Number(formValue.selectedApartmentId)
      : null;

    const shouldApplySubscriptionDiscount = this.hasActiveSubscription() && 
    this.userSubscription() && 
    this.userSubscription().discountPercentage > 0;

    
    const bookingData = {
      serviceTypeId: this.selectedServiceType()!.id,
      orderDate: new Date(), 
      services: this.selectedServices().map(s => ({
        serviceId: s.service.id,
        quantity: s.quantity
      })),
      extraServices: this.selectedExtraServices().map(s => ({
        extraServiceId: s.extraService.id,
        quantity: s.quantity,
        hours: s.hours
      })),
      subscriptionId: this.selectedSubscription()!.id,
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
      promoCode: this.resolveSubmittedPromoCode(formValue.promoCode),
      specialOfferId: this.specialOfferApplied() ? this.selectedSpecialOffer()?.specialOfferId : undefined,
      userSpecialOfferId: this.specialOfferApplied() && this.selectedSpecialOffer() && this.authService.isLoggedIn() ? this.selectedSpecialOffer()!.id : undefined,
      // Normalized, never raw: the API's Tips is a non-nullable decimal, so a cleared
      // number input would otherwise post null and fail model binding with a 400.
      tips: this.tipsAmount,
      maidsCount: this.showCustomPricing() ? parseInt(this.customCleaners.value) : this.calculatedMaidsCount(),
      discountAmount: this.promoOrFirstTimeDiscountAmount(),
      subscriptionDiscountAmount: shouldApplySubscriptionDiscount ? this.subscriptionDiscountAmount() : 0,
      // Loyalty Discount the frontend computed for the breakdown preview. Backend re-evaluates
      // from the target user's actual LoyaltyDiscountPercentage and re-runs the stacking gate —
      // this field is sent so the request body is complete, but never trusted server-side.
      loyaltyDiscountAmount: this.loyaltyDiscountAmount(),
      subTotal: this.calculation().subTotal,
      // ADD THESE FIELDS TO FIX THE ISSUE:
      tax: this.calculation().tax,
      total: this.calculation().total,
      calculation: this.calculation(), // Add the full calculation object
      // TOTAL cleaner-minutes from the shared calculator (custom pricing included — the
      // calculator already stores per-cleaner × cleaners with the 1h floor). The booking
      // summary shows this same total for regular types (auto-staffing is disabled);
      // custom/cleaner-hours summaries still show per-cleaner.
      totalDuration: this.actualTotalDuration,
      hasActiveSubscription: this.hasActiveSubscription(),
      userSubscriptionId: this.userSubscription()?.subscriptionId,
      giftCardCode: this.giftCardApplied() && this.isGiftCard() ? this.promoCode.value : null,
      giftCardAmountToUse: this.giftCardApplied() ? this.giftCardAmountToUse() : 0,
      isCustomPricing: this.showCustomPricing(),
      customAmount: this.showCustomPricing() ? parseFloat(this.customAmount.value) : undefined,
      customCleaners: this.showCustomPricing() ? parseInt(this.customCleaners.value) : undefined,
      customDuration: this.showCustomPricing() ? parseInt(this.customDuration.value) : undefined,
      // Admin-chosen display name for the custom service type — replaces "Pre-Arranged Cleaning".
      customServiceDisplayName: this.showCustomPricing() ? (this.customServiceName.value || null) : undefined,
      bedroomsQuantity: this.getSelectedBedroomsQuantity(),
      bathroomsQuantity: this.getSelectedBathroomsQuantity(),
      showRoomCountsToCustomer: this.showCustomPricing() && this.showRoomCountsToCustomer.value,
      // Property type is sent even on a custom order (where levels are hidden and unpriced), so
      // the admin panel and the cleaner's job details still know what kind of building it is.
      // The LEVEL COUNT travels as an ordinary service line in `services`, not as its own field:
      // the OrderServices row is the pricing source of truth, and Order.LevelsQuantity is a
      // display-only column the server derives from that same line.
      propertyType: this.propertyType() ?? null,
      // Informational fallback ONLY. On a priced service type the level count also travels as an
      // ordinary line in `services`, and the server prefers that line, so this can never override
      // what was charged. On an unpriced type it is the only record of the answer.
      levelsQuantity: this.levelsQuantity(),
      smsConsent: formValue.smsConsent,
      cancellationConsent: formValue.cancellationConsent,
      termsConsent: formValue.termsConsent,
      uploadedPhotos: this.preparePhotosForSubmission(),
      floorTypes: this.buildFloorTypesString(),
      floorTypeOther: this.floorTypeOther() || null,
      pointsToRedeem: this.selectedPointsToRedeem(),
      useCredits: this.useCredits() && this.userBubbleCredits() > 0,
      creditsToApply: this.useCredits() ? Math.min(this.userBubbleCredits(), this.calculation().total + this.userBubbleCredits()) : 0,
      referralCode: this.isBrowser
        ? (localStorage.getItem('dreamcleaning_referral') ?? undefined)
        : undefined,
      // Card-on-file opt-in — never for admin-created (unpaid/manual) bookings.
      // The save decision is no longer taken on this form: it is asked once, between the Pay
      // click and the charge, by the pre-payment "Save your card?" modal (2026-09).
      saveCardForFutureUse: false,
    };

    // If admin mode, create booking for target user (unpaid). Phase 1 manual payment fields
    // ride along — for Normal they're effectively no-ops, for Cash/Zelle/Check/Other the
    // backend records the payment and skips the Pay Now reminder.
    if (submitTarget === 'admin-for-user') {
      const targetUser = this.selectedTargetUser();
      if (!targetUser) {
        // Unreachable: resolveSubmitTarget() only returns 'admin-for-user' with a target, and
        // nothing between there and here is async. Fail loudly anyway — the whole point of this
        // rewrite is that losing the target can never silently become a self-booking.
        this.isLoading.set(false);
        this.errorMessage.set('The selected customer was lost before the booking was sent. Nothing was booked — please re-select the customer and try again.');
        console.error('[booking] submitTarget was admin-for-user but selectedTargetUser is null. Submit aborted.');
        return;
      }

      this.bookingService.createBookingForUser(
        targetUser.id,
        bookingData,
        this.adminPaymentMethod(),
        // Reference and notes describe money that has ALREADY changed hands, so they travel for
        // cash/Zelle/cheque/other and not for Invoice — which is unpaid by definition.
        adminMethodIsSettled(this.adminPaymentMethod()) ? this.adminPaymentReference() : null,
        adminMethodIsSettled(this.adminPaymentMethod()) ? this.adminPaymentNotes() : null,
        { contractClientId: this.adminContractClientId, isCommercial: this.adminOrderIsCommercial() }
      ).subscribe({
        next: (response) => {
          this.isLoading.set(false);
          this.errorMessage.set('');
          
          // Show success message. The follow-up sentence has to match what the backend actually
          // did: Normal leaves the order Pending and sends a Pay Now link, manual methods mark
          // it Active and send a booking confirmation only.
          const outcome =
            this.adminPaymentMethod() === 'Normal'
              ? 'A payment request has been sent to them; the order also appears in their profile.'
              : this.adminPaymentMethod() === 'RegularInvoice'
                ? 'An invoice was created and sent to them (Admin → Invoices). The order stays Pending '
                  + 'Payment until the invoice is paid by card, or you mark it paid for a bank transfer.'
              : this.adminPaymentMethod() === 'Invoice'
                // Invoice is handled outside Stripe but is NOT settled: saying "recorded as paid"
                // would be false, and this alert is where an admin would believe it.
                ? 'Billed by invoice. The order stays Pending Payment until an invoice covering it '
                  + 'is paid in full — no payment request was sent.'
                : `Recorded as paid by ${this.adminPaymentMethod()}. They were sent a booking confirmation — no payment request.`;
          alert(`Booking created successfully for ${targetUser.firstName} ${targetUser.lastName}. Order ID: ${response.orderId}. ${outcome}`);
          
          // Reset form
          this.skipSaveOnDestroy = true;
          this.formPersistenceService.markBookingCompleted();
          this.formPersistenceService.clearFormData();
          this.bookingForm.reset();
          this.selectedTargetUser.set(null);
          this.isAdminMode.set(false);
          this.applyConsentValidators();
          this.resetAdminPaymentFields();
          
          // Reload page or navigate
          this.router.navigate(['/booking']).then(() => {
            window.location.reload();
          });
        },
        error: (error) => {
          this.isLoading.set(false);
          this.errorMessage.set(error.error?.message || 'Failed to create booking for user');
          console.error('Error creating booking for user:', error);
        }
      });
      return;
    }

    // If the user changed their phone number during booking, update their profile
    if (this.currentUser() && formValue.contactPhone) {
      const currentPhone = normalizePhone10(this.currentUser().phone) ?? '';
      const newPhone = normalizePhone10(formValue.contactPhone) ?? '';
      if (newPhone && newPhone !== currentPhone) {
        this.profileService.updateProfile({
          firstName: this.currentUser().firstName,
          lastName: this.currentUser().lastName,
          email: this.currentUser().email,
          phone: newPhone
        }).pipe(takeUntil(this.destroy$)).subscribe();
      }
    }

    // Regular flow: Store booking data in service instead of creating order immediately
    this.bookingDataService.setBookingData(bookingData);
    this.isLoading.set(false);

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
    if (this.showCustomPricing()) {
      this.customServiceName.markAsTouched();
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
    if (this.showPollForm() && this.currentStep() === 1) {
      this.pollFormSubmitted.set(true);
    }

    // Mark all form controls as touched to trigger validation
    this.markFormGroupTouched(this.bookingForm);
    
    // Mark service type control as touched
    this.serviceTypeControl.markAsTouched();
    
    // Also mark custom pricing controls if applicable
    if (this.showCustomPricing()) {
      this.customServiceName.markAsTouched();
      this.customAmount.markAsTouched();
      this.customCleaners.markAsTouched();
      this.customDuration.markAsTouched();
    }

    // Find the first invalid field in the current step and scroll to it
    if (!this.isBrowser) return;
    
    setTimeout(() => {
      let firstErrorElement: Element | null = null;
      // Poll step 1: scroll to first unanswered required question (error message or its input)
      if (this.showPollForm() && this.currentStep() === 1) {
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

      // Property type and levels are chips, not FormControls, so nothing above can find them —
      // an unanswered "what kind of place is it?" used to leave Continue doing nothing visible.
      // Whichever candidate sits HIGHER on the page wins, so the customer is always taken to the
      // first thing that is missing rather than to whichever kind of field we looked for first.
      const propertyErrorElement = this.isPropertyTypeMissing()
        ? document.querySelector('.form-step.active .property-type-section')
        : this.isLevelsMissing()
          ? document.querySelector('.form-step.active .levels-block')
          : null;
      if (propertyErrorElement &&
          (!firstErrorElement ||
           (propertyErrorElement.compareDocumentPosition(firstErrorElement) &
            Node.DOCUMENT_POSITION_FOLLOWING))) {
        firstErrorElement = propertyErrorElement;
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
        } else if (firstErrorElement === propertyErrorElement) {
          // preventScroll: the smooth scroll above is already on its way; focusing normally
          // would jump the page to the element instantly and cancel it.
          const firstChoice = firstErrorElement.querySelector('.property-type-card, .level-chip');
          if (firstChoice instanceof HTMLElement) {
            firstChoice.focus({ preventScroll: true });
          }
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
    // Tomorrow in New York, on server and browser alike.
    return this.newYorkTomorrow();
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

    this.promoCodeApplied.set(false);
    this.promoDiscount.set(0);
    this.promoCode.setValue('');
    this.errorMessage.set(''); // Clear any error messages
    this.giftCardApplied.set(false);
    this.isGiftCard.set(false);
    this.giftCardBalance.set(0);
    this.giftCardAmountToUse.set(0);
    this.calculateTotal();
  }

  getGiftCardDisplayInfo(): { amountToUse: number; remainingBalance: number } {
    if (!this.giftCardApplied()) {
      return { amountToUse: 0, remainingBalance: 0 };
    }
    return { 
      amountToUse: this.giftCardAmountToUse(), 
      remainingBalance: this.giftCardBalance() - this.giftCardAmountToUse() 
    };
  }
  
loadBubblePointsOptions(): void {
    if (this.isAdminMode() && this.selectedTargetUser()) {
      // Load target user's points, not admin's
      this.bubbleRewardsService.getAdminUserSummary(this.selectedTargetUser()!.id).subscribe({
        next: (summary: any) => {
          this.bubblePointsEnabled.set(!!summary.pointsSystemEnabled);
          this.bubblePointsPerDollar.set(summary.guide?.pointsPerDollar ?? 0);
          if (!summary.pointsSystemEnabled) { this.bubblePointsOptions.set([]); return; }
          this.userBubblePoints.set(summary.currentPoints);
          this.userBubbleCredits.set(summary.bubbleCredits ?? 0);
          this.bubblePointsOptions.set(summary.availableRedemptions ?? []);
        },
        error: () => { this.bubblePointsOptions.set([]); }
      });
    } else {
      this.bubbleRewardsService.getSummary().subscribe({
        next: (summary) => this.applyPointsSummary(summary),
        error: () => {}
      });
    }
  }

  /** GET api/bubble-points/summary's answer (from the request, or the server's session). */
  private applyPointsSummary(summary: any) {
    this.bubblePointsEnabled.set(!!summary.pointsSystemEnabled);
    this.bubblePointsPerDollar.set(summary.guide?.pointsPerDollar ?? 0);
    if (!summary.pointsSystemEnabled) return;
    this.userBubblePoints.set(summary.currentPoints);
    this.userBubbleCredits.set(summary.bubbleCredits ?? 0);
    this.bubblePointsOptions.set(summary.availableRedemptions ?? []);
  }

  selectPointsToRedeem(points: number): void {
    if (this.selectedPointsToRedeem() === points) {
      // toggle off
      this.selectedPointsToRedeem.set(0);
      this.pointsDiscountAmount.set(0);
    } else {
      const opt = this.bubblePointsOptions().find(o => o.points === points);
      if (!opt || !opt.available) return;
      this.selectedPointsToRedeem.set(points);
      this.pointsDiscountAmount.set(opt.dollarValue);
    }
    this.calculateTotal();
  }

  /** Estimated points for this booking: (total - tax - tips) * pointsPerDollar */
  get estimatedPoints(): number {
    if (!this.bubblePointsEnabled() || this.bubblePointsPerDollar() <= 0) return 0;
    const base = (this.calculation()?.total ?? 0)
      - (this.calculation()?.tax ?? 0)
      - this.tipsAmount;
    return Math.floor(Math.max(0, base) * this.bubblePointsPerDollar());
  }

  loadSpecialOffers() {
    const setPromoLoaded = () => {
      this.loading().promoBanner = false;
      this.loading.set(this.loading());
    };
    if (this.isAdminMode() && this.selectedTargetUser()) {
      this.adminService.getUserSpecialOffers(this.selectedTargetUser()!.id).subscribe({
        next: (offers) => {
          this.userSpecialOffers.set(offers);
          const firstTimeOffer = findFirstTimeOffer(offers, BookingComponent.legacyFirstTimeOfferCased);
          if (firstTimeOffer) {
            this.firstTimeDiscountPercentage = firstTimeOffer.discountValue;
            this.hasFirstTimeDiscountOffer = true;
          } else {
            this.hasFirstTimeDiscountOffer = false;
          }
          this.hasFirstTimeDiscount = offers.some(o => this.isFirstTimeOffer(o));
          setPromoLoaded();
        },
        error: (error) => {
          console.error('Error loading user special offers:', error);
          this.hasFirstTimeDiscountOffer = false;
          this.userSpecialOffers.set([]);
          setPromoLoaded();
        }
      });
    } else if (this.authService.isLoggedIn()) {
      this.specialOfferService.getMySpecialOffers().subscribe({
        next: (offers) => {
          this.applyUserOffers(offers);
          setPromoLoaded();
        },
        error: (error) => {
          console.error('Error loading special offers:', error);
          this.hasFirstTimeDiscountOffer = false;
          this.userSpecialOffers.set([]);
          setPromoLoaded();
        }
      });
    } else {
      this.specialOfferService.getPublicSpecialOffers().subscribe({
        next: (offers) => {
          this.applyGuestOffer(offers && offers.length > 0 ? offers[Math.floor(Math.random() * offers.length)] : null);
          setPromoLoaded();
        },
        error: (error) => {
          console.error('Error loading public special offers:', error);
          this.userSpecialOffers.set([]);
          setPromoLoaded();
        }
      });
    }
  }

  /** A signed-in user's own offers (from the request, or the server's session). */
  private applyUserOffers(offers: UserSpecialOffer[]) {
    this.userSpecialOffers.set(offers);
    const firstTimeOffer = findFirstTimeOffer(offers, BookingComponent.legacyFirstTimeOfferCased);
    if (firstTimeOffer) {
      this.firstTimeDiscountPercentage = firstTimeOffer.discountValue;
      this.hasFirstTimeDiscountOffer = true;
    } else {
      this.hasFirstTimeDiscountOffer = false;
    }
    this.hasFirstTimeDiscount = offers.some(o => this.isFirstTimeOffer(o));
  }

  /** A guest's Special Discount card: one public offer (picked by the caller), or none. */
  private applyGuestOffer(offer: PublicSpecialOffer | null) {
    if (!offer) {
      this.userSpecialOffers.set([]);
      return;
    }
    this.userSpecialOffers.set([{
      id: offer.id,
      specialOfferId: offer.id,
      name: offer.name,
      description: offer.description,
      isPercentage: offer.isPercentage,
      discountValue: offer.discountValue,
      expiresAt: undefined,
      isUsed: false,
      icon: offer.icon,
      badgeColor: offer.badgeColor,
      minimumOrderAmount: offer.minimumOrderAmount
    }]);
  }

  loadOrders() {
    if (!this.authService.isLoggedIn()) {
      this.previousOrders.set([]);
      this.loading().previousOrders = false;
      this.loading.set(this.loading());
      return;
    }
    this.isLoadingOrders.set(true);

    // In admin mode with a selected user, load that user's orders instead of admin's
    // The signed-in user's own list is the one the header shares (AccountStatusService).
    const orders$ = this.isAdminMode() && this.selectedTargetUser()
      ? this.adminService.getUserOrders(this.selectedTargetUser()!.id)
      : this.accountStatus.orders(30_000);

    orders$.subscribe({
      next: (orders) => {
        this.previousOrders.set(orders.filter(order => !order.isCustomServiceType));
        // The list itself now answers whether there is anything to reorder.
        this.hasOrdersHint.set(null);
        this.isLoadingOrders.set(false);
        this.loading().previousOrders = false;
        this.loading.set(this.loading());
      },
      error: (error) => {
        console.error('Error loading orders:', error);
        this.previousOrders.set([]);
        this.isLoadingOrders.set(false);
        this.loading().previousOrders = false;
        this.loading.set(this.loading());
      }
    });
  }

  /** Reorder widget opened — lazy-load orders if none are loaded yet. */
  onReorderOpened() {
    if (this.previousOrders().length === 0) {
      this.loadOrders();
    }
  }

  // Admin methods
  checkAdminStatus() {
    // From here on the page is drawn for whoever is actually signed in.
    this.renderRole.set(this.authService.currentUserValue?.role ?? null);
    if (this.authService.isLoggedIn()) {
      const user = this.authService.currentUserValue;
      this.isAdmin.set(user?.role === 'Admin' || user?.role === 'SuperAdmin' || user?.role === 'Moderator');
      this.isSuperAdmin = user?.role === 'SuperAdmin';
      this.isModerator.set(user?.role === 'Moderator');
      // The server already asked on this user's behalf (their session).
      if (!(this.sessionPermissionKnown && this.sessionCovers())) this.loadRegisterCustomerPermission();
    } else {
      this.isAdmin.set(false);
      this.isSuperAdmin = false;
      this.isModerator.set(false);
      this.canRegisterCustomers.set(false);
    }
  }

  /**
   * Ask the server who may create users, exactly as the Users tab does. Deliberately not a
   * local role check: the permission map lives in `PermissionService` on the backend and this
   * page must not hold a second, drifting copy of it.
   */
  private loadRegisterCustomerPermission(): void {
    if (!this.isBrowser || !this.isAdmin()) {
      this.canRegisterCustomers.set(false);
      return;
    }

    this.adminService.getUserPermissions().subscribe({
      next: (permissions) => {
        this.canRegisterCustomers.set(!!permissions?.permissions?.canCreate);
      },
      error: () => {
        // Hiding the button is the safe failure: the endpoint would reject the call anyway.
        this.canRegisterCustomers.set(false);
      }
    });
  }

  openRegisterCustomerModal(): void {
    if (!this.canRegisterCustomers()) return;
    this.registeredCustomerMessage.set('');
    this.showRegisterCustomerModal.set(true);
  }

  closeRegisterCustomerModal(): void {
    this.showRegisterCustomerModal.set(false);
  }

  /**
   * The shared modal has already created the customer.
   *
   * The admin must NOT have to reload the page to find them, so the new account is added to the
   * search list two ways, and both are needed:
   *  - pushed into `registeredCustomers` (the search box's `seedUsers`), which makes them
   *    selectable at once and survives Admin Mode being toggled off and back on — that rebuilds
   *    the search box from scratch,
   *  - a forced reload of the server list, so the canonical row replaces the seed. It is forced
   *    because `GET /api/admin/users` is cacheable and a plain refetch can return the list from
   *    before the POST.
   *
   * They are then selected — but only when Admin Mode is already on, since registering from this
   * page is done in order to book for them. With Admin Mode off there is nothing to select onto
   * and turning it on unasked would change what Book Now is about to do, so the admin is just
   * told the account exists; the seed is waiting when they switch it on.
   */
  onCustomerRegistered(customer: RegisteredCustomer): void {
    const newUser: UserAdmin = {
      id: customer.id,
      firstName: customer.firstName,
      lastName: customer.lastName,
      // Never undefined: the search box lower-cases this field to match against.
      email: customer.email ?? '',
      phone: customer.phone ?? undefined,
      role: customer.role,
      authProvider: customer.authProvider,
      isNoEmailUser: customer.isNoEmailUser,
      firstTimeOrder: true,
      isActive: true,
      createdAt: new Date(),
      canReceiveCommunications: !customer.isNoEmailUser
    };

    // New array reference — `seedUsers` is an @Input, and mutating in place would not notify.
    this.registeredCustomers.set([
      newUser,
      ...this.registeredCustomers().filter(user => user.id !== newUser.id)
    ]);

    this.registeredCustomerMessage.set(`${customer.firstName} ${customer.lastName} was registered and added to the customer list.`);

    this.adminUserSearch()?.loadUsers(true);

    if (this.isAdminMode()) {
      this.selectUser(newUser);
      this.registeredCustomerMessage.update(v => v + (' They are now selected for this booking.'));
    }

    setTimeout(() => { this.registeredCustomerMessage.set(''); }, 8000);
  }

  /**
   * Discounts are ACCOUNT-scoped, so they cannot survive a change of order owner.
   * A special offer is a `UserSpecialOffer` row belonging to one account, a gift card was
   * balance-checked for one account, and promo/loyalty stacking is resolved against the order
   * owner. Toggling admin mode or picking/changing the target user changes that owner, so every
   * applied discount is dropped and the admin re-applies from the new account's own list.
   *
   * Without this, the summary keeps rendering the previous account's discount AND the payload
   * still carries its ids — `BookingCreationService.ResolveDiscountsAsync` then rejects the
   * order with "The selected special offer is not available on this account."
   */
  private clearAppliedDiscountsForAccountSwitch() {
    const hadDiscount = this.specialOfferApplied() || this.promoCodeApplied() || this.giftCardApplied()
      || this.firstTimeDiscountApplied || this.selectedPointsToRedeem() > 0 || this.useCredits();

    // Special offer (+ the legacy first-time marker it also sets)
    this.selectedSpecialOffer.set(null);
    this.specialOfferApplied.set(false);
    this.firstTimeDiscountApplied = false;

    // Promo code
    this.promoCodeApplied.set(false);
    this.promoDiscount.set(0);
    this.promoIsPercentage.set(true);

    // Gift card
    this.giftCardApplied.set(false);
    this.isGiftCard.set(false);
    this.giftCardBalance.set(0);
    this.giftCardAmountToUse.set(0);

    // Bubble points / credits are balances on the previous account too
    this.selectedPointsToRedeem.set(0);
    this.pointsDiscountAmount.set(0);
    this.useCredits.set(false);

    // Re-enable the promo input first (it is disabled while a special offer is applied),
    // then blank it — setting a disabled control would leave a stale value behind.
    this.updatePromoCodeDisabledState();
    this.promoCode.setValue('', { emitEvent: false });

    this.errorMessage.set('');
    this.discountsClearedForAccountSwitch.set(hadDiscount);
    this.calculateTotal();
  }

  /**
   * Keep the persisted draft's `wasAdminMode` marker in step with the live toggle.
   *
   * Both directions matter. Turning admin mode ON must stamp it immediately, or a reload before
   * the next field change would restore an admin draft with no marker on it — the exact hole this
   * whole mechanism closes. Turning it OFF must clear it, or the safety check in
   * resolveSubmitTarget() would block a perfectly legitimate customer booking made afterwards.
   */
  private syncAdminDraftMarker(): void {
    if (!this.isBrowser) return;
    const saved = this.formPersistenceService.getFormData();
    // Nothing persisted yet — saveFormData() stamps it on the first change.
    if (!saved) return;
    if (!!saved.wasAdminMode === this.isAdminMode()) return;
    this.formPersistenceService.updateFormData({ wasAdminMode: this.isAdminMode() || undefined });
  }

  /**
   * The SMS / cancellation-fee / terms consents are the CUSTOMER's to give. An admin booking for
   * somebody (Admin Mode) never sees or ticks them — the customer accepts them on the payment page
   * instead (PaymentConsentPolicy gates an admin-created order until they do). Poll forms don't
   * ask either. One place decides, so the validators and the template can't disagree.
   */
  readonly consentsWaived = computed<boolean>(() => this.showPollForm() || this.isAdminMode());

  get consentsSatisfied(): boolean {
    return this.consentsWaived() || (
      this.smsConsent.value === true &&
      this.cancellationConsent.value === true &&
      this.termsConsent.value === true);
  }

  applyConsentValidators(): void {
    for (const control of [this.smsConsent, this.cancellationConsent, this.termsConsent]) {
      control.setValidators(this.consentsWaived() ? [] : [Validators.requiredTrue]);
      control.updateValueAndValidity();
    }
  }

  toggleAdminMode() {
    // Admin mode changes who the order belongs to — drop discounts before anything else.
    this.clearAppliedDiscountsForAccountSwitch();
    this.isAdminMode.set(!this.isAdminMode());
    this.applyConsentValidators();
    this.syncAdminDraftMarker();
    // Turning the toggle back on is the admin acknowledging the discarded-draft notice.
    if (this.isAdminMode()) this.adminDraftDiscarded.set(false);
    // (User search/list loading is owned by AdminUserSearchComponent, which
    // initializes itself when admin mode renders it.)
    if (!this.isAdminMode()) {
      // Restore admin's apartments if a user was selected
      if (this.selectedTargetUser()) {
        this.userApartments.set([...this.adminOriginalApartments]);
        this.adminOriginalApartments = [];
        
        // Restore admin's address if they have apartments
        if (this.userApartments().length > 0) {
          const firstApartment = this.userApartments()[0];
          this.bookingForm.patchValue({
            selectedApartmentId: firstApartment.id.toString()
          });
          this.fillApartmentAddress(firstApartment.id.toString());
        }
      }
      
      this.selectedTargetUser.set(null);
      this.resetAdminPaymentFields();

      // Restore the standard email requirement (may have been relaxed for a no-email customer).
      this.applyContactEmailValidators();

      // Reload admin's subscription when admin mode is turned off
      this.loadUserSubscription();
      // Reload loyalty for the admin's own account now that there's no target user.
      this.loadLoyaltyDiscount();

      // Reload admin's own previous orders
      this.previousOrders.set([]);
      this.loadOrders();

      // The offer list on screen belongs to the customer that was selected — swap it back to
      // the admin's own offers/points so nothing from that account stays clickable.
      this.loadSpecialOffers();
      this.bubblePointsOptions.set([]);
      if (this.isBrowser) this.loadBubblePointsOptions();
    }
  }

  selectUser(user: UserAdmin) {
    // Picking (or switching) a customer changes the order owner: every discount applied so far
    // belongs to the admin (or the previously selected customer) and must be re-applied from
    // this user's own offers.
    this.clearAppliedDiscountsForAccountSwitch();

    this.selectedTargetUser.set(user);
    // A business customer's booking is Commercial work by default; anybody else's is Regular.
    // Re-derived on every pick, so switching customers never carries the last one's choice over.
    this.adminOrderIsCommercial.set(!!user.isBusiness);
    // A different customer: "Commercial invoice" is only offered when THIS one has a business client.
    if (this.adminPaymentMethod() === 'Invoice') this.adminPaymentMethod.set('Normal');
    this.loadAdminBusinessClient(user);

    // Store admin's original apartments before loading user's apartments
    this.adminOriginalApartments = [...this.userApartments()];

    // Pre-fill form with the selected user's contact information. Every field is OVERWRITTEN,
    // blank included: a field the customer has no value for must come up empty, never keep
    // whatever the form held before (the admin's own details, the previously selected customer's,
    // or a restored session draft). 2026-09: a customer registered without a phone was booked
    // with the previous customer's number still in the box; create-for-user then backfilled it
    // onto the new account and the order's SMS went to a stranger.
    this.contactFirstName.setValue(user.firstName || '');
    this.contactLastName.setValue(user.lastName || '');
    if (user.isNoEmailUser) {
      // Cash customer without email: blank the field and drop the required rule so the
      // admin can complete the booking. The backend allows a missing contact email only
      // for these accounts (create-for-user checks IsNoEmailUser server-side).
      this.contactEmail.setValue('');
    } else if (user.email) {
      this.contactEmail.setValue(user.email);
    }
    this.applyContactEmailValidators();
    this.contactPhone.setValue(user.phone ? user.phone.replace(/\D/g, '').slice(0, 10) : '');
    // No number on file: show "Phone number is required" straight away, so the admin asks the
    // customer for it rather than discovering the empty box at Book Now.
    if (!this.contactPhone.value) this.contactPhone.markAsTouched();
    
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
    this.previousOrders.set([]);
    this.loadOrders();
  }
  
  private loadUserAddress(userId: number) {
    this.adminService.getUserApartments(userId).subscribe({
      next: (apartments) => {
        // Update userApartments with selected user's apartments
        this.userApartments.set(apartments);
        
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
      apartmentName: DEFAULT_ADDRESS_NAME,
      aptSuite: '',
      city: '',
      state: this.states().length > 0 ? this.states()[0] : '',
      zipCode: ''
    });
    
    // Load cities for the default state
    if (this.states().length > 0) {
      this.loadCities(this.states()[0]);
    }
  }

  // Reset Phase 1 admin payment selection back to defaults. Called when admin mode toggles
  // off, target user changes, or booking submission completes — keeps stale Zelle/Cash values
  // from leaking onto the next booking.
  resetAdminPaymentFields(): void {
    this.adminOrderIsCommercial.set(false);
    this.adminPaymentMethod.set('Normal');
    this.adminPaymentReference.set('');
    this.adminPaymentNotes.set('');
    this.adminContractClientId = null;
  }

  /**
   * The commercial invoice bills the selected customer's OWN linked business client — there is
   * nothing to choose (owner's call, 2026-09), and the option only appears when one exists. Any
   * other method clears it. The regular Invoice needs no client at all.
   */
  onAdminPaymentMethodChange(): void {
    this.adminContractClientId = this.adminPaymentMethod() === 'Invoice'
      ? (this.adminBusinessClient()?.id ?? null)
      : null;
  }

  /**
   * Looks up whether the selected customer is linked to a commercial client, which is what puts
   * "Commercial invoice" on the list. A failed lookup just leaves it off — Invoice (regular) is
   * always available.
   */
  private loadAdminBusinessClient(user: UserAdmin): void {
    this.adminBusinessClient.set(null);
    this.paymentMethodOptions.set(AdminBookingPaymentOptions(false));
    this.loadingContractClients = true;
    this.invoiceService.clientForUser(user.id)
      .pipe(finalize(() => { this.loadingContractClients = false; }))
      .subscribe({
        next: client => {
          if (this.selectedTargetUser()?.id !== user.id) return;   // switched customer meanwhile
          this.adminBusinessClient.set(client ?? null);
          this.adminContractClients = client ? [client] : [];
          this.paymentMethodOptions.set(AdminBookingPaymentOptions(!!client));
          this.onAdminPaymentMethodChange();
        },
        error: () => {
          this.adminBusinessClient.set(null);
          this.adminContractClients = [];
        }
      });
  }

  /** True when the admin has chosen Invoice but not said who is billed. Blocks submit. */
  get invoiceClientMissing(): boolean {
    return this.adminPaymentMethod() === 'Invoice' && !this.adminContractClientId;
  }

  clearSelectedUser() {
    // Order owner reverts to the admin — drop the customer's discounts (see
    // clearAppliedDiscountsForAccountSwitch).
    this.clearAppliedDiscountsForAccountSwitch();

    this.selectedTargetUser.set(null);
    this.resetAdminPaymentFields();
    this.adminBusinessClient.set(null);
    this.adminContractClients = [];
    this.paymentMethodOptions.set(AdminBookingPaymentOptions(false));

    // Restore the standard email requirement (may have been relaxed for a no-email customer).
    this.applyContactEmailValidators();

    // Restore admin's apartments
    this.userApartments.set([...this.adminOriginalApartments]);
    this.adminOriginalApartments = [];
    
    // Clear contact information and restore admin's info if available
    if (this.currentUser()) {
      this.bookingForm.patchValue({
        contactFirstName: this.currentUser().firstName || '',
        contactLastName: this.currentUser().lastName || '',
        contactEmail: this.currentUser().email || '',
        contactPhone: this.currentUser().phone ? this.currentUser().phone.replace(/\D/g, '').slice(0, 10) : ''
      });
      
      // Restore admin's address if they have apartments
      if (this.userApartments().length > 0) {
        const firstApartment = this.userApartments()[0];
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
    this.selectedPointsToRedeem.set(0);
    this.pointsDiscountAmount.set(0);
    this.bubblePointsOptions.set([]);
    if (this.isBrowser) this.loadBubblePointsOptions();
  }

  selectOrderToReorder(orderId: number) {
    this.reorderingOrderId.set(orderId);

    // In admin mode, use admin endpoint to fetch order details
    const order$ = this.isAdminMode() && this.selectedTargetUser()
      ? this.adminService.getOrderDetails(orderId)
      : this.orderService.getOrderById(orderId);

    order$.subscribe({
      next: (order: Order) => {
        // Make sure service types are loaded before proceeding
        if (this.serviceTypes().length === 0) {
          this.errorMessage.set('Service types are still loading. Please try again in a moment.');
          this.reorderingOrderId.set(null);
          return;
        }

        // Find the service type
        const serviceType = this.serviceTypes().find(st => st.id === order.serviceTypeId);
        if (!serviceType) {
          this.errorMessage.set('Service type not found. Please try again.');
          this.reorderingOrderId.set(null);
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
          apartmentName: DEFAULT_ADDRESS_NAME,
          city: order.city || '',
          state: order.state || '',
          zipCode: order.zipCode || '',
          entryMethod: order.entryMethod || '',
          specialInstructions: order.specialInstructions || '',
          // Copy tips from previous order but not promo codes, gift cards, or special offers
          tips: normalizeTipAmount(order.tips),
          hasStartedBooking: true,
          bookingProgress: 'started' as const,
          // This call REPLACES the stored draft, so the admin marker has to be re-stamped here
          // or an admin reorder would write a draft that looks like a customer's.
          wasAdminMode: this.isAdminMode() || undefined
        };

        // Save form data
        this.formPersistenceService.saveFormData(formData);
        this.formPersistenceService.markBookingStarted();

        // Clear photos, promo codes, gift cards, and special offers before restoring
        this.uploadedPhotos.set([]);
        this.promoCodeApplied.set(false);
        this.giftCardApplied.set(false);
        this.specialOfferApplied.set(false);
        this.selectedSpecialOffer.set(null);
        this.firstTimeDiscountApplied = false;
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
              const existingIndex = this.selectedServices().findIndex(s => s.service.id === service.id);
              if (existingIndex >= 0) {
                this.selectedServices()[existingIndex].quantity = orderService.quantity;
              }
            }
          });
          this.selectedServices.set(this.selectedServices());
          // Same rule as the session restore: the reordered order's Sq.ft is what the customer
          // actually bought, so it is floored and never lowered. Doing it here rather than
          // inside the loop matters — order.services arrives in DB order, so a sqft row ahead
          // of the bedrooms row used to have its value overwritten and never put back.
          this.clampSquareFeetToBedroomMinimum();
        }

        // Restore selected extra services
        if (order.extraServices && order.extraServices.length > 0) {
          // Clear any extra services that might have been added by selectServiceType
          this.selectedExtraServices.set([]);
          
          order.extraServices.forEach(orderExtraService => {
            const extraService = serviceType.extraServices.find(es => es.id === orderExtraService.extraServiceId);
            // Extra Cleaners is admin-only now — don't carry it over from a past
            // order into a new booking (it would be selected but invisible).
            if (extraService && isExtraCleaners(extraService)) {
              return;
            }
            if (extraService) {
              this.selectedExtraServices().push({
                extraService,
                quantity: orderExtraService.quantity || 1,
                hours: orderExtraService.hours || (extraService.hasHours ? 0.5 : 0)
              });
            }
          });
          this.selectedExtraServices.set(this.selectedExtraServices());
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
          tips: normalizeTipAmount(order.tips),
          cleaningType: cleaningTypeToApply
        });

        // Load cities if state is set
        if (order.state) {
          this.loadCities(order.state);
        }

        // Calculate total
        this.calculateTotal();
        
        this.reorderingOrderId.set(null);
        this.errorMessage.set('');
      },
      error: (error) => {
        console.error('Error loading order details:', error);
        this.errorMessage.set('Failed to load order details. Please try again.');
        this.reorderingOrderId.set(null);
      }
    });
  }

  /**
   * The customer's first-time offer: by its offerKey ("first-time"); an UNKEYED offer still by the
   * old "first time" in the name rule (warned once) - see shared/booking/special-offer-keys.ts.
   */
  isFirstTimeOffer(offer: UserSpecialOffer): boolean {
    return offerIsFirstTime(offer, BookingComponent.legacyFirstTimeOfferName);
  }

  /** The rules this page used before keys, verbatim: "first time" in the name, any case... */
  private static readonly legacyFirstTimeOfferName = (_: KeyedOffer, lowerName: string): boolean =>
    lowerName.includes('first time');

  /** ...and, where it picked the offer whose discount it shows, "First Time" exactly as typed. */
  private static readonly legacyFirstTimeOfferCased = (offer: KeyedOffer): boolean =>
    (offer.name ?? '').includes('First Time');

  applySpecialOffer(offer: UserSpecialOffer) {
    // Check if promo code is already applied (but NOT gift card)
    if (this.promoCodeApplied() && !this.isGiftCard()) {
      this.errorMessage.set('Cannot apply special offer when a promo code is already applied. Please remove the promo code first.');
      return;
    }

    // Check if another special offer is already applied
    if (this.specialOfferApplied() && this.selectedSpecialOffer()?.id !== offer.id) {
      this.errorMessage.set('Only one special offer can be applied at a time. Please remove the current offer first.');
      return;
    }

    // Pre-flight loyalty check. The stacking gate inside calculateTotal would zero this offer
    // anyway if loyalty beats it — surface that explicitly instead of letting the user click
    // "Apply" and watch nothing visible change.
    const loyaltyDollars = this.currentLoyaltyDollarValue();
    const offerDollars = this.candidateDollarValue(offer.discountValue, offer.isPercentage);
    if (loyaltyDollars > offerDollars) {
      this.errorMessage.set(`You already have a Loyalty Discount of ${this.loyaltyDiscountPercentage()}% on your account — ` +
        `it's better than this offer, so they can't be used together.`);
      return;
    }

    // Clear any previous error
    this.errorMessage.set('');
    this.discountsClearedForAccountSwitch.set(false);

    // Apply the special offer
    this.selectedSpecialOffer.set(offer);
    this.specialOfferApplied.set(true);
    
    // Update promo code disabled state
    this.updatePromoCodeDisabledState();
    
    // For backward compatibility with first-time discount
    if (this.isFirstTimeOffer(offer)) {
      this.firstTimeDiscountApplied = true;
    }
    
    this.calculateTotal();
  }
  
  /**
   * The promoCode the booking is submitted with. A first-time customer's discount travels as the
   * applied special offer (specialOfferId / userSpecialOfferId), so it never needs a code of its
   * own: the old "firstUse" marker is no longer sent (it could only be reached through a stale
   * first-time flag, and the server refused it).
   */
  resolveSubmittedPromoCode(formPromoCode: string | null | undefined): string | null | undefined {
    if (this.giftCardApplied() && this.isGiftCard()) return null;
    if (this.specialOfferApplied() && this.selectedSpecialOffer()) return null;
    return formPromoCode;
  }

  removeSpecialOffer() {
    this.selectedSpecialOffer.set(null);
    this.specialOfferApplied.set(false);
    this.firstTimeDiscountApplied = false;
    
    // Update promo code disabled state
    this.updatePromoCodeDisabledState();
    this.errorMessage.set('');
    
    this.calculateTotal();
  }

  /** Called when user clicks anywhere on a special offer card: apply or remove the offer. */
  onSpecialOfferCardClick(offer: UserSpecialOffer) {
    const isThisOfferApplied = this.specialOfferApplied() && this.selectedSpecialOffer()?.id === offer.id;
    if (isThisOfferApplied) {
      this.removeSpecialOffer();
      return;
    }
    if (!this.authService.isLoggedIn()) {
      this.showGuestOfferLoginModal.set(true);
      this.setBodyScrollLock(true);
      return;
    }
    this.applySpecialOffer(offer);
  }

  closeGuestOfferLoginModal() {
    this.showGuestOfferLoginModal.set(false);
    this.setBodyScrollLock(false);
  }

  openLoginFromGuestOfferModal() {
    this.showGuestOfferLoginModal.set(false);
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
        this.pollQuestions.set(questions);
        
        // Initialize poll answers
        if (this.savedPollData) {
          // Restore saved poll answers
          this.pollAnswers.set({ ...this.savedPollData });
          // Clear saved data after restoration
          this.savedPollData = null;
        } else {
          // Initialize with empty answers
          this.pollAnswers.set({});
          
          // Initialize dropdown and checkbox questions with empty string
          questions.forEach(question => {
            if (question.questionType === 'dropdown' || question.questionType === 'checkbox') {
              this.pollAnswers()[question.id] = '';
            }
          });
          this.pollAnswers.set(this.pollAnswers());
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
        // Levels is NEVER seeded here. Every other service gets a default quantity, and a
        // default is exactly what levels must not have: seeding it at minValue 1 would make
        // "not yet chosen" indistinguishable from "chose 1 level". It joins selectedServices
        // only when the customer clicks a chip (selectLevels).
        if (isLevelsService(service)) return;

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
          
          this.selectedServices().push({
            service: service,
            quantity: defaultQuantity
          });
        }
      });
      this.selectedServices.set(this.selectedServices());
      
      // Set square feet based on bedrooms after all services are initialized
      const sqftService = this.selectedServices().find(s => s.service.serviceKey === 'sqft');
      if (sqftService) {
        sqftService.quantity = this.getSquareFeetForBedrooms(bedroomsQuantity);
        this.selectedServices.set(this.selectedServices());
      }
    }
    
    // Clear any previously selected extra services
    this.selectedExtraServices.set([]);
  }
  
  isPollFormValid(): boolean {
    if (!this.showPollForm()) return true;
    
    // Check required questions
    for (const question of this.pollQuestions()) {
      if (question.isRequired && (!this.pollAnswers()[question.id] || this.pollAnswers()[question.id].trim() === '')) {
        return false;
      }
    }
    
    // For poll forms, require the four contact fields the poll shows: name, phone, email and
    // service address (no city/state/zip).
    if (!this.isPollContactValid()) {
      return false;
    }
    
    return true;
  }

  /** The poll's Contact Information block: name, phone, email and service address. */
  isPollContactValid(): boolean {
    return this.contactFirstName.valid &&
           this.contactPhone.valid &&
           this.contactEmail.valid &&
           this.serviceAddress.valid;
  }

  submitPollForm() {
    this.pollFormSubmitted.set(true);
    
    if (!this.isPollFormValid()) {
      this.scrollToFirstError();
      return;
    }
  
    this.isLoading.set(true);
    const formValue = this.bookingForm.getRawValue();
  
    const answers: PollAnswer[] = this.pollQuestions().map(question => ({
      pollQuestionId: question.id,
      answer: this.pollAnswers()[question.id] || ''
    })).filter(answer => answer.answer.trim() !== '');
  
    const submission: PollSubmission = {
      serviceTypeId: this.selectedServiceType()!.id,
      contactFirstName: formValue.contactFirstName,
      contactLastName: formValue.contactLastName,
      contactEmail: formValue.contactEmail,
      contactPhone: formValue.contactPhone,
      // The poll form asks for ONE address line and nothing else. Apt/city/state/zip still live on
      // the booking form (pre-filled from the customer's SAVED address), so sending them made the
      // quote email print the typed address and the saved one underneath it.
      serviceAddress: formValue.serviceAddress,
      aptSuite: '',
      city: '',
      state: '',
      postalCode: '',
      answers: answers,
      uploadedPhotos: this.preparePhotosForSubmission()
    };
  
    this.pollService.submitPoll(submission).subscribe({
      next: (response) => {
        this.isLoading.set(false);
        this.router.navigate(['/poll-success'], { 
          queryParams: { serviceType: this.selectedServiceType()!.name } 
        });
      },
      error: (error) => {
        this.isLoading.set(false);
        this.errorMessage.set(error.error?.message || 'Failed to submit poll. Please try again.');
      }
    });
  }

  /** True when an admin is booking for a cash customer without an email account. */
  get isNoEmailTargetUser(): boolean {
    return this.isAdminMode() && !!this.selectedTargetUser()?.isNoEmailUser;
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

  /**
   * The tip in dollars, always a number. Read this instead of `tips.value` — the raw
   * control is null whenever the number input is cleared or the form has been reset.
   */
  get tipsAmount(): number { return normalizeTipAmount(this.tips?.value); }

  /** Snap a cleared tip box back to 0 on blur so the UI and the stored value agree. */
  normalizeTipsOnBlur() {
    const normalized = this.tipsAmount;
    if (this.tips.value !== normalized) {
      this.tips.setValue(normalized);
    }
  }
  get cleaningType() { return this.bookingForm.get('cleaningType') as FormControl; }
  get smsConsent() { return this.bookingForm.get('smsConsent') as FormControl; }
  get cancellationConsent() { return this.bookingForm.get('cancellationConsent') as FormControl; }
  get termsConsent() { return this.bookingForm.get('termsConsent') as FormControl; }

  onFloorTypeSelectionChange(selection: FloorTypeSelection): void {
    this.floorTypes.set(selection.types);
    this.floorTypeOther.set(selection.otherText);
    this.saveFormData();
  }

  private buildFloorTypesString(): string | null {
    if (!this.floorTypes().length) return null;
    return this.floorTypes().map(t => {
      if (t === 'other' && this.floorTypeOther()) {
        return `other:${this.floorTypeOther()}`;
      }
      return t;
    }).join(',');
  }

  // Check if promo code should be disabled
  isPromoCodeDisabled(): boolean {
    return this.specialOfferApplied() || this.promoCode.disabled;
  }

  // Update promo code disabled state based on special offer
  updatePromoCodeDisabledState() {
    if (this.specialOfferApplied()) {
      this.promoCode.disable();
    } else {
      this.promoCode.enable();
    }
  }

  private loadUserSubscription(userId?: number) {
    // If userId is provided (admin mode), load that user's subscription
    if (userId && this.isAdminMode()) {
      this.adminService.getUserProfile(userId).subscribe({
        next: (userProfile) => {
          const rawExpiry = userProfile?.subscriptionExpiryDate;
          const expiryMs = rawExpiry ? new Date(rawExpiry).getTime() : NaN;
          const isExpired = rawExpiry && !Number.isNaN(expiryMs) && expiryMs <= Date.now();

          if (userProfile?.subscriptionId && !isExpired) {
            this.hasActiveSubscription.set(true);
            this.userSubscription.set({
              hasSubscription: true,
              subscriptionId: userProfile.subscriptionId,
              subscriptionName: userProfile.subscriptionName,
              discountPercentage: 0, // Will be set from subscription list
              expiryDate: userProfile.subscriptionExpiryDate
            });
            
            // If subscription is already loaded, update the selection
            if (this.subscriptions() && this.subscriptions().length > 0) {
              this.updateSelectedSubscription();
            }
          } else {
            this.hasActiveSubscription.set(false);
            this.userSubscription.set(null);
            // Set default subscription if user has no active subscription
            if (this.subscriptions() && this.subscriptions().length > 0) {
              const oneTimeSubscription = this.findOneTimeSubscription();
              this.selectedSubscription.set(oneTimeSubscription);
              // Recalculate total to clear any previous discount
              this.calculateTotal();
            } else {
              this.selectedSubscription.set(null);
            }
          }
        },
        error: (error) => {
          console.error('Error loading user subscription:', error);
          this.hasActiveSubscription.set(false);
          this.userSubscription.set(null);
          // Set default subscription on error
          if (this.subscriptions() && this.subscriptions().length > 0) {
            const oneTimeSubscription = this.findOneTimeSubscription();
            this.selectedSubscription.set(oneTimeSubscription);
            // Recalculate total to clear any previous discount
            this.calculateTotal();
          } else {
            this.selectedSubscription.set(null);
          }
        }
      });
      return;
    }

    // Regular flow: load subscription for logged-in user
    // Only call getUserSubscription if user is logged in
    if (!this.authService.isLoggedIn()) {
      this.hasActiveSubscription.set(false);
      this.userSubscription.set(null);
      return;
    }
  
    this.bookingService.getUserSubscription().subscribe({
      next: (data) => this.applyUserSubscriptionResponse(data),
      error: (error) => {
        // Only log error if it's not a 401 (which is expected for logged out users)
        if (error.status !== 401) {
          console.error('Error loading subscription:', error);
        }
        this.hasActiveSubscription.set(false);
        this.userSubscription.set(null);
      }
    });
  }

  /** GET api/booking/user-subscription's answer (from the request, or the server's session). */
  private applyUserSubscriptionResponse(data: any) {
    const rawExpiry =
      data?.subscriptionExpiryDate ??
      data?.expiryDate ??
      data?.expiresAt ??
      data?.subscriptionExpiresAt;

    const expiryMs = rawExpiry ? new Date(rawExpiry).getTime() : NaN;
    const isExpired = rawExpiry && !Number.isNaN(expiryMs) && expiryMs <= Date.now();

    // Carried on both branches of the response: a customer with no live plan is exactly the
    // one whose profile choice should decide which chip starts selected.
    this.preferredSubscriptionId = data?.preferredSubscriptionId ?? null;

    if (data?.hasSubscription && !isExpired) {
      this.hasActiveSubscription.set(true);
      this.userSubscription.set(data);

      // If subscription is already loaded, update the selection
      if (this.subscriptions() && this.subscriptions().length > 0) {
        this.updateSelectedSubscription();
      }
    } else {
      this.hasActiveSubscription.set(false);
      this.userSubscription.set(null);
      this.applyPreferredSubscription();
    }
  }

  /**
   * Starts the frequency picker on the plan the customer chose in their profile.
   *
   * Every condition here is a "don't touch what somebody already decided":
   *   - a LIVE plan wins, because that tier is the one that actually discounts this booking;
   *   - a draft in progress wins, because the customer picked that on this page;
   *   - admin mode is excluded entirely — the admin's own preference must never ride along into
   *     a booking being taken for somebody else.
   * It changes no price: it selects a chip the customer could have tapped themselves.
   */
  private applyPreferredSubscription(draft: BookingFormData | null = this.formPersistenceService.getFormData()): void {
    if (this.isAdminMode()) return;
    if (this.hasActiveSubscription()) return;
    if (!this.preferredSubscriptionId) return;
    if (!this.subscriptions() || this.subscriptions().length === 0) return;
    if (draft?.selectedSubscriptionId || draft?.selectedSubscriptionDays != null) return;

    const preferred = this.subscriptions().find(s => s.id === this.preferredSubscriptionId);
    if (!preferred || preferred.id === this.selectedSubscription()?.id) return;

    this.selectedSubscription.set(preferred);
    this.calculateTotal();
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
    this.loyaltyDiscountAmount.set(0);
    if (this.isAdminMode() && (this.adminPaymentMethod() === 'Invoice' || this.adminContractClientId)) return;
    if (this.loyaltyDiscountPercentage() <= 0 || subTotal <= 0) return;

    // Single stacking implementation lives in the shared calculator (mirrored by the backend).
    const loyaltyCandidate = percentOf(subTotal, this.loyaltyDiscountPercentage());
    const stacked = resolveLoyaltyStacking(
      loyaltyCandidate,
      this.loyaltyDiscountPercentage(),
      this.subscriptionDiscountAmount(),
      this.promoOrFirstTimeDiscountAmount()
    );
    this.loyaltyDiscountAmount.set(stacked.loyaltyAmount);
    this.subscriptionDiscountAmount.set(stacked.subscriptionAmount);
    this.promoOrFirstTimeDiscountAmount.set(stacked.promoAmount);
  }

  // Load the user's current loyalty discount percentage. In admin mode this MUST read from
  // the target customer's account (not the logged-in admin's) — spec 4.5 step 7 / case 13.
  // Self-mode uses the profile endpoint, which now exposes loyaltyDiscountPercentage.
  // Errors are swallowed (set to 0) so a flaky lookup doesn't block the booking page.
  private loadLoyaltyDiscount(userId?: number) {
    const before = this.loyaltyDiscountPercentage();
    const resetAndRecalc = (pct: number) => {
      this.loyaltyDiscountPercentage.set(pct || 0);
      if (this.loyaltyDiscountPercentage() !== before) {
        this.calculateTotal();
      }
    };

    if (userId && this.isAdminMode()) {
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
    if (this.userSubscription() && this.subscriptions()) {
      const matchingSubscription = this.subscriptions().find(s => s.id === this.userSubscription().subscriptionId);

      if (matchingSubscription) {
        this.selectedSubscription.set(matchingSubscription);
        // Update discount percentage from subscription list
        if (this.userSubscription()) {
          this.userSubscription().discountPercentage = matchingSubscription.discountPercentage;
          this.userSubscription.set(this.userSubscription());
        }
        // Trigger calculation when subscription is updated
        this.calculateTotal();
        this.saveFormData(); // Persist updated selection so it doesn't revert to "One Time"
      } else {
        // If subscription not found in list, clear selection
        this.selectedSubscription.set(null);
      }
    }
  }

  /**
   * The active plan's period, from the plan itself (api/booking/user-subscription carries
   * subscriptionDays). Only a response from before that field existed falls back to the old
   * name -> days table, with one console warning.
   */
  getUserSubscriptionDays(userSubscription: { subscriptionDays?: number | null; subscriptionName?: string } | null | undefined): number {
    if (!userSubscription) return 0;
    if (typeof userSubscription.subscriptionDays === 'number') return userSubscription.subscriptionDays;

    const legacyDays: { [name: string]: number } = { 'Weekly': 7, 'Bi-Weekly': 14, 'Monthly': 30 };
    const name = userSubscription.subscriptionName ?? '';
    if (!BookingComponent.warnedLegacySubscriptionDays) {
      BookingComponent.warnedLegacySubscriptionDays = true;
      console.warn(`[subscriptions] user-subscription has no subscriptionDays; mapped plan "${name}" to days by name.`);
    }
    return legacyDays[name] || 0;
  }
  private static warnedLegacySubscriptionDays = false;

  /** The one-off plan a fresh form starts on: the plan with no period (subscriptionDays 0), else the first. */
  private findOneTimeSubscription(): Subscription | null {
    return this.subscriptions().find(s => s.subscriptionDays === 0) || this.subscriptions()[0] || null;
  }

  // Get filtered extra services (excluding deep cleaning and super deep cleaning)
  getFilteredExtraServices(): ExtraService[] {
    if (!this.selectedServiceType()) return [];

    return this.selectedServiceType()!.extraServices.filter(extra => {
      // Show all extra services except deep cleaning and super deep cleaning — those are a
      // cleaning TYPE, presented as the Cleaning Type buttons, never as an extras card. That
      // holds for Custom Pricing too, where the agreed cleaning type belongs in the service-type
      // name and the description, not in a $0 informational card.
      if (extra.isDeepCleaning || extra.isSuperDeepCleaning) {
        return false;
      }

      // Extra Cleaners is admin-only now: the team decides staffing, so customers
      // can't buy cleaners here (the extra stays active for the admin order editor).
      // Custom Pricing has its own "Number of Cleaners" field, which is what sets MaidsCount —
      // a second, informational cleaner count would contradict it.
      if (isExtraCleaners(extra)) {
        return false;
      }

      // Cleaning Essentials is sold ONLY from the supplies modal on Continue, so it never
      // appears as a card on a REGULAR booking. Everywhere else — order-edit, reorder,
      // recreate, the chat agent, the admin order editor — it is an ordinary extra and stays
      // visible. Once bought it behaves like any other extra: it is priced, it reaches the
      // order, and the admin panel and cleaner's job details list it by name.
      //
      // Custom Pricing ("Pre-Arranged") is the exception, and it has to be one: the supplies
      // modal is skipped entirely on that path (shouldConfirmCleaningSuppliesBeforeContinuing
      // returns false for it), so hiding the card here left Essentials with NO way onto an
      // admin's pre-arranged order at all. It shows as an ordinary informational card there —
      // $0 and 0 minutes like every other custom-mode extra — because the CLEANER-facing half
      // of the arrangement is not informational: CleanerJobView.RequiresCleanerToBringEssentials
      // reads the order's extras by NAME, whatever the service type, so that row is what puts
      // the Essentials line in the assignment email and SMS and the banner in the portal.
      if (isCleaningEssentialsExtra(extra) && !this.showCustomPricing()) {
        return false;
      }

      // Custom Pricing ("Pre-Arranged"): extras are informational only — they describe work for
      // the admin panel and the cleaner's job email and are priced at $0 / 0 min. Same Day
      // Service is neither of those: it is a scheduling modifier that forces the calendar to
      // today, and the admin already picks the exact date here, so it has no meaning at $0.
      if (this.showCustomPricing() && extra.isSameDayService) {
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

  getExtraServiceTooltip(extra: ExtraService): string {
    // Booking-specific: a disabled Same Day Service explains why instead.
    if (extra.isSameDayService && !this.isSameDayServiceAvailable()) {
      return this.sameDayServiceDisabledReason();
    }
    return getExtraServiceTooltip(extra);
  }

  getSubscriptionTooltip(subscription: Subscription): string {
    return subscription.description || '';
  }

  private getActiveDeepCleaningExtraService(): ExtraService | null {
    if (!this.selectedServiceType()?.extraServices) return null;
    // A Custom Pricing type is served the WHOLE extras catalogue (it records extras purely as
    // information), so it "has" a deep-cleaning row even though it offers no Cleaning Type
    // buttons and no deep-cleaning card. Reporting that as available would let the restore path
    // push a deep extra the admin can neither see nor remove — the hidden-but-active pattern.
    if (this.showCustomPricing()) return null;
    return (
      this.selectedServiceType()!.extraServices.find(
        (extra) => extra.isDeepCleaning && extra.isActive !== false
      ) || null
    );
  }

  get canSelectDeepCleaning(): boolean {
    return !!this.getActiveDeepCleaningExtraService();
  }

  /** Show move in/out checklist when this service type is selected (name from API). */
  isMoveInOutCleaningServiceType(): boolean {
    return serviceTypeIs(this.selectedServiceType(), 'move-in-out',
      name => name.includes('move') && name.includes('in') && name.includes('out'));
  }

  /** Cleaning-type + what's-included UI only for Residential Cleaning (name from API). */
  isResidentialCleaningServiceType(): boolean {
    return isResidentialServiceType(this.selectedServiceType());
  }

  /** Offices don't have bedrooms/bathrooms — suppress the standalone inputs for this service type. */
  isOfficeCleaningServiceType(): boolean {
    return serviceTypeIs(this.selectedServiceType(), 'office', name => name.includes('office'));
  }

  private normalizeCleaningTypeForSelectedServiceType(): void {
    // If deep cleaning is not available for this service type, force the form to "normal"
    // and remove any deep-cleaning extra that might have been restored from saved data.
    if (this.canSelectDeepCleaning) return;

    this.selectedExtraServices.set(this.selectedExtraServices().filter(
      (s) => !s.extraService.isDeepCleaning
    ));

    if (this.cleaningType.value === 'deep') {
      this.cleaningType.setValue('normal');
    }
  }

  // Handle cleaning type selection
  onCleaningTypeChange(cleaningType: string) {
    // Remove any existing deep cleaning services
    this.selectedExtraServices.set(this.selectedExtraServices().filter(
      s => !s.extraService.isDeepCleaning
    ));

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
        this.selectedExtraServices().push({
          extraService: cleaningService,
          quantity: 1,
          hours: cleaningService.hasHours ? 0.5 : 0
        });
        this.selectedExtraServices.set(this.selectedExtraServices());
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
    this.tipDropdownOpen.set(!this.tipDropdownOpen());
  }

  selectTipPreset(amount: number) {
    this.tips.setValue(amount);
    this.tipDropdownOpen.set(false);
    this.calculateTotal();
    this.saveFormData();
  }


  
  onPollAnswerChange() {
    // Save form data when poll answers change
    if (this.showPollForm()) {
      this.saveFormData();
    }
  }

  /** Whether the given option is selected for a checkbox-type poll question (comma-separated stored value). */
  isPollCheckboxChecked(questionId: number, option: string): boolean {
    const value = (this.pollAnswers()[questionId] || '').trim();
    if (!value) return false;
    const selected = value.split(',').map(s => s.trim()).filter(Boolean);
    return selected.includes(option);
  }

  /** Toggle an option for a checkbox-type poll question. Stores selected values as comma-separated. */
  togglePollCheckbox(questionId: number, option: string): void {
    const value = (this.pollAnswers()[questionId] || '').trim();
    const selected = value ? value.split(',').map(s => s.trim()).filter(Boolean) : [];
    const idx = selected.indexOf(option);
    if (idx >= 0) {
      selected.splice(idx, 1);
    } else {
      selected.push(option);
    }
    this.pollAnswers()[questionId] = selected.join(', ');
    this.pollAnswers.set(this.pollAnswers());
  }

  loadBlockedTimeSlots() {
    this.bookingCatalogueStore.load('blockedTimeSlots').pipe(takeUntil(this.destroy$)).subscribe({
      next: (slots) => {
        this.applyBlockedTimeSlots(slots);
        // After loading blocked slots, adjust default date/time if currently on a blocked slot
        this.adjustDefaultDateIfBlocked();
      },
      error: () => {}
    });
  }

  private applyBlockedTimeSlots(slots: BlockedTimeSlot[]) {
    this.blockedTimeSlots.set(slots);
    this.blockedFullDays.set(new Set<string>());
    this.blockedHoursMap.set(new Map<string, Set<string>>());
    for (const slot of slots) {
      if (slot.isFullDay) {
        this.blockedFullDays().add(slot.date);
      } else if (slot.blockedHours) {
        this.blockedHoursMap().set(slot.date, new Set(slot.blockedHours.split(',')));
      }
    }
    this.blockedFullDays.set(this.blockedFullDays());
    this.blockedHoursMap.set(this.blockedHoursMap());
  }

  /** If the current default date is fully blocked, advance to the next available date.
   *  Also ensure the selected time is not blocked. */
  private adjustDefaultDateIfBlocked() {
    if (this.isAdminMode()) return;
    const currentDate = this.serviceDate.value;
    if (!currentDate) return;

    let dateStr = typeof currentDate === 'string' ? currentDate.split('T')[0] : currentDate;

    // If current date is fully blocked, find the next available date (up to 60 days out)
    if (this.blockedFullDays().has(dateStr)) {
      const [y, m, d] = dateStr.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      for (let i = 0; i < 60; i++) {
        date.setDate(date.getDate() + 1);
        const nextStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        if (!this.blockedFullDays().has(nextStr)) {
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
    const slot = this.blockedTimeSlots().find(s => s.date === dateStr);
    return slot?.reason || null;
  }

  /** Admins / SuperAdmins (and admin-mode bookings) bypass all blocked-date / busy restrictions. */
  get bypassBlockedDates(): boolean {
    return this.isAdminMode() || this.isAdminOrSuperAdmin;
  }

  /** Returns list of fully blocked date strings (YYYY-MM-DD) for the date-selector. */
  getBlockedDates(): string[] {
    if (this.bypassBlockedDates) return [];
    return Array.from(this.blockedFullDays());
  }

  /** Returns list of partially blocked date strings (YYYY-MM-DD) for the date-selector. */
  getPartiallyBlockedDates(): string[] {
    if (this.bypassBlockedDates) return [];
    return Array.from(this.blockedHoursMap().keys());
  }

  /** Returns set of blocked hours for a specific date (empty if admin mode). */
  getBlockedHoursForDate(dateStr: string): Set<string> {
    if (this.bypassBlockedDates) return new Set();
    return this.blockedHoursMap().get(dateStr) || new Set();
  }

  /** Returns blocked hours array for the currently selected date (for time-selector input). */
  getBlockedHoursForSelectedDate(): string[] {
    if (this.bypassBlockedDates) return [];
    const dateStr = this.serviceDate.value;
    if (!dateStr) return [];
    const cleanDate = typeof dateStr === 'string' ? dateStr.split('T')[0] : dateStr;
    // If the date is fully blocked, all hours are blocked
    if (this.blockedFullDays().has(cleanDate)) {
      return getAllServiceTimeSlots(this.hasExtendedBookingHours);
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
    if (this.blockedFullDays().has(cleanDate)) return true;
    // Partially blocked - check the specific time
    const blockedHours = this.blockedHoursMap().get(cleanDate);
    if (blockedHours && this.serviceTime.value) {
      return blockedHours.has(this.serviceTime.value);
    }
    return false;
  }

  getAvailableTimeSlots(): string[] {
    const selectedDate = this.serviceDate.value;
    if (!selectedDate) return [];

    const selectedDateObj = this.parseServiceDate(selectedDate);

    // Customers: 8:00 AM - 6:00 PM, no earlier than 9:30 AM on Sat/Sun.
    // Admin/SuperAdmin: 8:00 AM - 8:00 PM, every day. See shared/booking/service-time-slots.
    let filteredSlots = buildServiceTimeSlots(selectedDateObj, this.hasExtendedBookingHours);

    // If same day service is selected, filter time slots based on current time.
    // Admins / SuperAdmins skip this filter — they can pick any time for same-day.
    if (this.isSameDaySelected() && !this.isAdminOrSuperAdmin) {
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
    if (this.isSameDaySelected()) {
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
      const sameDayService = this.selectedExtraServices().find(s => s.extraService.isSameDayService);
      if (sameDayService) {
        this.toggleExtraService(sameDayService.extraService, true); // Skip date change since user selected a specific date
      }
    }
    
    this.onDateChange();
  }

  // Get current cleaning type from form
  getCurrentCleaningType(): string {
    const deepCleaning = this.selectedExtraServices().find(s => s.extraService.isDeepCleaning);
    
    if (deepCleaning) {
      return 'deep';
    }
    return 'normal';
  }

  // Photo upload methods
  async onPhotoSelect(event: any) {
    this.photoUploadError.set('');
    const files = event.target.files;
    
    if (!files || files.length === 0) return;
    
    // Check if adding these files would exceed the limit
    if (this.uploadedPhotos().length + files.length > this.maxPhotos) {
      this.photoUploadError.set(`You can upload a maximum of ${this.maxPhotos} photos`);
      return;
    }
    
    this.isUploadingPhoto.set(true);
    
    const fileList = Array.from(files as FileList);
    for (const file of fileList) {
      try {
        // Validate file type
        if (!file.type.startsWith('image/') && !file.name.toLowerCase().match(/\.(heic|heif)$/)) {
          this.photoUploadError.set('Only image files are allowed');
          this.isUploadingPhoto.set(false);
          return;
        }
        
        // Validate file size (15MB limit)
        if (file.size > this.maxFileSize) {
          this.photoUploadError.set(`File ${file.name} is too large. Maximum size is 15MB`);
          this.isUploadingPhoto.set(false);
          return;
        }
        
        // Compress and convert to base64
        const result = await this.compressAndConvertToBase64(file);
        this.uploadedPhotos().push({
          file: file,
          preview: this.sanitizer.bypassSecurityTrustUrl(result.preview),
          base64: result.base64
        });
        
        this.isUploadingPhoto.set(false);
        
        // Clear the input to allow re-selection of the same file
        event.target.value = '';
      } catch (error) {
        console.error('Error processing photo:', error);
        this.photoUploadError.set('Error processing photo');
        this.isUploadingPhoto.set(false);
      }
    }
    this.uploadedPhotos.set(this.uploadedPhotos());
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
    this.uploadedPhotos().splice(index, 1);
    this.uploadedPhotos.set(this.uploadedPhotos());
  }

  private preparePhotosForSubmission(): any[] {
    return this.uploadedPhotos().map(photo => ({
      fileName: photo.file.name,
      base64Data: photo.base64,
      contentType: photo.file.type
    }));
  }

  getExtraServiceImage(extraService: ExtraService, isSelected: boolean): string {
    // Icon mapping lives in shared/booking/extra-service-display.utils.
    return getExtraServiceImage(extraService, isSelected);
  }

  toggleBookingSummary() {
    this.isSummaryCollapsed.set(!this.isSummaryCollapsed());
    
    if (!this.isBrowser) return;
    
    // When opening, ignore scroll events briefly so scrollIntoView doesn't trigger close
    if (!this.isSummaryCollapsed()) {
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
    if (!this.isBrowser || this.isSummaryCollapsed()) return;
    if (this.summaryJustOpened) return; // Don't close on scroll from open-button scrollIntoView
    if (this.summaryCodeActionInProgress) return; // Don't close on layout shift from promo/gift card apply/remove
    if (typeof window === 'undefined' || window.innerWidth > 1200) return;
    this.isSummaryCollapsed.set(true);
    this.cdr.detectChanges();
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
      this.isSameDayServiceAvailable.set(true);
      this.sameDayServiceDisabledReason.set('');
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
      this.isSameDayServiceAvailable.set(false);
      
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
      this.sameDayServiceDisabledReason.set(`Requires 4 hours notice. Available again on ${tomorrowString} at ${minStartTimeTomorrowLabel}.`);
    } else {
      this.isSameDayServiceAvailable.set(true);
      this.sameDayServiceDisabledReason.set('');
    }
  }

  /** Returns true when same-day service is selected but today has no available (non-blocked) time slots. */
  isSameDayFullyBooked(): boolean {
    if (this.bypassBlockedDates) return false;
    if (!this.isSameDaySelected()) return false;
    const dateStr = this.serviceDate.value;
    if (!dateStr) return false;
    const cleanDate = typeof dateStr === 'string' ? dateStr.split('T')[0] : dateStr;
    // Fully blocked day
    if (this.blockedFullDays().has(cleanDate)) return true;
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
    
    // Ensure we don't exceed the latest start time this audience may pick.
    const latestStartTime = getLatestStartTime(this.hasExtendedBookingHours);
    if (roundedHour * 60 + roundedMinute > this.timeToMinutes(latestStartTime)) {
      return latestStartTime;
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
    this.isExtraInfoExpanded.set(!this.isExtraInfoExpanded());
  }


  getServiceSpecificInfo(): string {
    if (!this.selectedServiceType()) return '';
    
    const type = this.selectedServiceType();
    if (serviceTypeIs(type, 'move-in-out', n =>
      n.includes('move in') || n.includes('move out') || n.includes('move-in') || n.includes('move-out'))) {
      return 'move-in-out';
    } else if (serviceTypeIs(type, 'heavy-condition', n => n.includes('heavy condition') || n.includes('heavy-condition'))) {
      return 'heavy-condition';
    } else {
      return 'standard';
    }
  }

  isDeepCleaningSelected(): boolean {
    return this.selectedExtraServices().some(service => service.extraService.isDeepCleaning);
  }

  // Form step navigation methods
  nextStep() {
    if (this.currentStep() < this.totalSteps) {
      // Check if current step is valid before proceeding
      if (this.canProceedToNextStep()) {
        // Clear validation errors from current step before moving to next
        this.clearCurrentStepValidationErrors();
        this.currentStep.update(v => v + 1);
        if (this.currentStep() === 3) {
          this.autocompleteInitRetryCount = 0;
          setTimeout(() => this.initAddressAutocomplete(), 100);
        }
        this.updateBookingStepUrl();
        // Scroll to top when navigating to next step
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        // Reveal the property-type / levels errors too. They are not FormControls, so
        // clearCurrentStepValidationErrors and markAsTouched do not reach them.
        this.propertyTypeTouched.set(true);
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
        this.showCleaningSuppliesConfirm.set(true);
        this.setBodyScrollLock(true);
        return;
      }
      this.nextStep();
    } else {
      // If step is invalid, log why (admins only) and scroll to first error in current step
      this.propertyTypeTouched.set(true);
      this.logWhyButtonDisabled('Continue');
      this.scrollToFirstErrorInCurrentStep();
    }
  }

  closeCleaningSuppliesConfirm(): void {
    this.showCleaningSuppliesConfirm.set(false);
    this.setBodyScrollLock(false);
  }

  /**
   * Add or remove one of the two supply extras from inside the modal. It goes through the same
   * toggleExtraService every extras card uses, so the $15 lands in the summary total, the
   * order records it, and the admin panel and the cleaner's job details see an ordinary extra.
   */
  toggleSupplyExtraFromModal(extra: ExtraService | null): void {
    if (!extra) return;
    this.toggleExtraService(extra);
  }

  continueFromCleaningSuppliesConfirm(): void {
    this.showCleaningSuppliesConfirm.set(false);
    this.setBodyScrollLock(false);
    this.nextStep();
  }

  get cleaningSuppliesCleaningTypeLabel(): string {
    return this.cleaningType?.value === 'deep' ? 'Deep Cleaning' : 'Standard Cleaning';
  }

  /**
   * Oven Cleaner liquid rides along with Deep Cleaning — and also with the Oven Cleaning extra
   * on its own, which the supplies list used to ignore. Same rule as the confirmation
   * email/SMS (see shared/booking/supply-checklist.utils).
   */
  get suppliesRequireOvenCleaner(): boolean {
    if (this.cleaningType?.value === 'deep') return true;
    return requiresOvenCleaner(this.selectedExtraServices().map(s => s.extraService));
  }

  get cleaningSuppliesExtra(): ExtraService | null {
    return this.getCleaningSuppliesExtraService();
  }

  get cleaningEssentialsExtra(): ExtraService | null {
    return this.getCleaningEssentialsExtraService();
  }

  get cleaningSuppliesExtraCost(): number | null {
    return this.extraServicePrice(this.getCleaningSuppliesExtraService());
  }

  get cleaningEssentialsExtraCost(): number | null {
    return this.extraServicePrice(this.getCleaningEssentialsExtraService());
  }

  get cleaningSuppliesSelected(): boolean {
    const extra = this.getCleaningSuppliesExtraService();
    return !!extra && this.isExtraServiceSelected(extra);
  }

  get cleaningEssentialsSelected(): boolean {
    const extra = this.getCleaningEssentialsExtraService();
    return !!extra && this.isExtraServiceSelected(extra);
  }

  /** What Cleaning Essentials covers, listed in the modal. */
  get cleaningEssentialsItems(): string[] {
    return CLEANING_ESSENTIALS_ITEMS;
  }

  /**
   * The live "you provide" list inside the modal, built by the SHARED checklist so the modal
   * agrees with the confirmation email, the SMS and the order pages. It reacts to the toggles
   * in the modal itself, which is the point: the customer sees the list shrink as they add.
   */
  get modalSupplyChecklistItems(): string[] {
    const extras = this.selectedExtraServices().map(s => s.extraService);
    // The cleaning TYPE is a form control here rather than an extra, so fold it in — the
    // stored order will carry the Deep Cleaning extra and reach the same answer.
    const facts = resolveSupplyChecklistFacts(extras, false);
    return buildSupplyChecklistItems({
      ...facts,
      requiresOvenCleaner: facts.requiresOvenCleaner || this.cleaningType?.value === 'deep'
    });
  }

  /**
   * THE MODAL OPENS ON EVERY CONTINUE UNTIL BOTH SUPPLY EXTRAS ARE ON THE ORDER.
   *
   * "Either one is still unbought" is the whole rule (owner's call, 2026-09). It replaced a
   * narrower gate that only watched Cleaning Essentials, which stopped asking the moment that
   * one extra was taken — so a customer who added Essentials was never offered Supplies again,
   * and one who added it by mistake could not reach the modal to take it back off. Cleaning
   * Essentials is hidden from the extras grid, so this modal is the only place either of them
   * can be changed from the booking page.
   *
   * It is deliberately not "shown once": going back to step 1 and pressing Continue again asks
   * again, because the customer may have changed something in between. Once BOTH are selected
   * there is nothing left to offer and Continue goes straight through.
   *
   * Configuration is respected rather than assumed: only extras that actually exist on this
   * service type count, so a catalogue with just Cleaning Supplies keeps the modal's original
   * behaviour, and one with neither never blocks. That is what covers the window before the
   * admin-created "Cleaning Essentials" row exists.
   */
  private shouldConfirmCleaningSuppliesBeforeContinuing(): boolean {
    // Only applies to regular bookings on step 1 (not poll, not custom pricing)
    if (this.currentStep() !== 1) return false;
    if (this.showPollForm() || this.showCustomPricing()) return false;
    if (!this.selectedServiceType()) return false;

    const offered = [this.getCleaningSuppliesExtraService(), this.getCleaningEssentialsExtraService()]
      .filter((e): e is ExtraService => !!e);

    return offered.some(extra => !this.isExtraServiceSelected(extra));
  }

  private getCleaningSuppliesExtraService(): ExtraService | null {
    const extras = this.selectedServiceType()?.extraServices || [];
    return extras.find(e => isCleaningSuppliesExtra(e)) || null;
  }

  private getCleaningEssentialsExtraService(): ExtraService | null {
    const extras = this.selectedServiceType()?.extraServices || [];
    return extras.find(e => isCleaningEssentialsExtra(e)) || null;
  }

  private extraServicePrice(extra: ExtraService | null): number | null {
    const price = extra?.price;
    return typeof price === 'number' && !Number.isNaN(price) ? price : null;
  }

  previousStep() {
    if (this.currentStep() > 1) {
      this.currentStep.update(v => v - 1);
      this.updateBookingStepUrl();
      // Scroll to top when navigating to previous step
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  /** Update URL query param ?step=N so refresh and return-from-login keep user on same tab. */
  private updateBookingStepUrl(): void {
    if (!this.isBrowser) return;
    const currentStepInUrl = this.route.snapshot.queryParamMap.get('step');
    if (currentStepInUrl === String(this.currentStep())) return; // already in sync, avoid extra navigation
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { step: this.currentStep() },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  // Validation methods for each step
  isStep1Valid(): boolean {
    if (!this.selectedServiceType()) return false;

    if (this.showPollForm()) {
      // For step 1, only check poll questions
      // Contact info, address, and consent will be checked on step 3
      for (const question of this.pollQuestions()) {
        if (question.isRequired && (!this.pollAnswers()[question.id] || this.pollAnswers()[question.id].trim() === '')) {
          return false;
        }
      }
      return true;
    }

    if (this.showCustomPricing()) {
      // Custom orders answer the property type too - it is informational there, but it is still
      // an Order and the crew still needs to know what building they are going to.
      return this.isPropertyTypeAnswered() &&
             this.serviceTypeControl.valid &&
             this.customServiceName.valid &&
             this.customAmount.valid &&
             this.customCleaners.valid &&
             this.customDuration.valid;
    }

    // Block continue if same-day service is selected but today is fully booked
    if (this.isSameDaySelected() && this.isSameDayFullyBooked()) {
      return false;
    }

    // Block continue if selected date/time is blocked (for non-admin users)
    if (this.isSelectedDateTimeBlocked()) {
      return false;
    }

    if (!this.isPropertyTypeAnswered()) return false;

    // For regular booking, check service type and cleaning type
    return this.serviceTypeControl.valid &&
           this.cleaningType.value !== null;
  }

  isStep2Valid(): boolean {
    if (!this.selectedServiceType()) return false;
    
    if (this.showPollForm()) {
      // For poll forms on step 2, check contact info (name, phone, email, service address)
      return this.isPollContactValid();
    }
    
    // Block continue if selected date/time is blocked (for non-admin users)
    if (this.isSelectedDateTimeBlocked()) return false;

    return this.selectedSubscription() !== null &&
           this.serviceDate.valid &&
           this.serviceTime.valid &&
           this.entryMethod.valid;
  }

  isStep3Valid(): boolean {
    if (!this.selectedServiceType()) return false;
    
    if (this.showPollForm()) {
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
           this.consentsSatisfied;
  }

  // Check if we can proceed to next step
  canProceedToNextStep(): boolean {
    switch (this.currentStep()) {
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
    if (this.showCustomPricing()) {
      this.customServiceName.markAsUntouched();
      this.customAmount.markAsUntouched();
      this.customCleaners.markAsUntouched();
      this.customDuration.markAsUntouched();
    }
    
    // Reset form submitted flag
    this.formSubmitted.set(false);

    // Same reset for the property-type block, which has no FormControl to untouch.
    this.propertyTypeTouched.set(false);
  }

}
