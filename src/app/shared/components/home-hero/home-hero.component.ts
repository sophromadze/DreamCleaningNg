import { findResidentialServiceType } from '../../booking/service-type-keys';
import {
  Component,
  OnInit,
  OnDestroy,
  Input,
  Inject,
  Injector,
  PLATFORM_ID,
  TransferState,
  afterNextRender,
  inject,
  makeStateKey,
  DOCUMENT
} from '@angular/core';
import { NgOptimizedImage, isPlatformBrowser } from '@angular/common';
import { RouterLink, Router } from '@angular/router';
import { FormsModule, ReactiveFormsModule, FormControl, Validators } from '@angular/forms';
import { Observable, of, Subscription, throwError, timeout } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { GooglePlacesService, formatReviewCount } from '../../../services/google-reviews.service';
import { SpecialOfferService, PublicSpecialOffer } from '../../../services/special-offer.service';
import { BookingService, ServiceType, Service } from '../../../services/booking.service';
import { BookingFormData, FormPersistenceService } from '../../../services/form-persistence.service';
import { SSR_RESPONSE_CONTEXT } from '../../ssr/ssr-response.token';
import { SSR_CATALOGUE } from '../../ssr/ssr-catalogue.token';
import {
  HERO_CHOICE_COOKIE, HeroChoice, decodeHeroChoice, readCookie, validateHeroChoice
} from '../../booking/hero-choice-cookie';
import { ShimmerDirective } from '../../directives/shimmer.directive';
import {
  calculateQuote, QuoteInput, ExtraServiceLineInput,
  mapSelectedServiceInput, getSquareFeetForBedrooms,
  resolveSquareFeetForBedroomChange, clampRestoredSquareFeet
} from '../../pricing/order-pricing.calculator';
import {
  MIN_LEVELS,
  PROPERTY_TYPE_APARTMENT,
  PROPERTY_TYPE_HOUSE,
  PropertyType,
  isLevelsService,
  normalizePropertyType,
  serviceTypeCollectsPropertyType
} from '../../booking/property-type.utils';
import { PhoneNumberService } from '../../../services/phone-number.service';
import { RESPONSIVE_IMAGE_LOADER_PROVIDER, responsiveWidths } from '../../images/responsive-image.loader';
import { IconComponent } from '../../icons/icon.component';
import { IconDefinition } from '../../icons/icon-definition';
import { IconServiceType, serviceTypeIcon } from '../../icons/service-type-icon';
import { faBroom } from '../../icons/glyphs/faBroom';
import { faCalendarCheck } from '../../icons/glyphs/faCalendarCheck';
import { faChevronDown } from '../../icons/glyphs/faChevronDown';
import { faCircleCheck } from '../../icons/glyphs/faCircleCheck';
import { faLock } from '../../icons/glyphs/faLock';
import { faSprayCanSparkles } from '../../icons/glyphs/faSprayCanSparkles';
import { findAdvertisedFirstTimeOffer } from '../../booking/special-offer-keys';

const HERO_IMAGE = '/images/cabinet-cleaning-in-nyc.webp';

/**
 * The width the hero photo is DRAWN at, per breakpoint - not the card width. The card crops a
 * 3:2 photo with object-fit: cover, so wherever the card is proportionally taller than 3:2 the
 * photo is scaled to the card HEIGHT and drawn wider than the card (a 365x260 phone card draws it
 * 390px wide). Measured from the rendered card (.hero-image-card in home-hero.component.scss):
 *   >= 1335px            778px wide (grid column max)
 *   1025-1334px          100vw - 557px wide, 320-370px tall -> never narrower than 555px drawn
 *   641-1024px           100vw - 55px wide, 370px tall
 *   551-640px            430px tall -> 645px drawn
 *   <= 550px             100vw - 47px wide, 260px tall -> never narrower than 390px drawn
 * Re-measure if the hero grid, paddings or card min-heights change.
 */
const HERO_IMAGE_SIZES =
  '(min-width: 1335px) 778px, ' +
  '(min-width: 1112px) calc(100vw - 557px), ' +
  '(min-width: 1025px) 555px, ' +
  '(min-width: 641px) calc(100vw - 55px), ' +
  '(min-width: 551px) 645px, ' +
  '(min-width: 437px) calc(100vw - 47px), ' +
  '390px';

/**
 * How long the SERVER render waits for the service-type catalogue before giving up and sending
 * the loading placeholder instead (the browser then fetches it, exactly as it did before the
 * form was server-rendered). Only used when server.ts has not provided SSR_CATALOGUE (its own
 * in-memory copy, which normally answers instantly); the cap bounds a slow or hung backend, so
 * SSR can never stall on it.
 */
export const SSR_SERVICE_TYPES_TIMEOUT_MS = 1000;

/** The hero's own copy of the catalogue in TransferState (see trimServiceTypesForHero). */
export const HERO_SERVICE_TYPES_KEY = makeStateKey<ServiceType[]>('home-hero.service-types');

/**
 * The saved choice the SERVER rendered the form from (read from the visitor's hero cookie), or
 * absent. The hydrating browser applies exactly this - never its own cookie or storage - so its
 * first render matches the HTML it received even if that HTML were ever stale or cached.
 */
export const HERO_CHOICE_KEY = makeStateKey<HeroChoice>('home-hero.choice');

/**
 * The advertised first-time offer the SERVER rendered the welcome coupon from (server.ts's
 * in-memory copy of the public offers, SSR_CATALOGUE.publicOffers), or an empty list when there is
 * none. The hydrating browser uses exactly this, so the coupon is in the first paint and the
 * browser makes no request for it.
 */
export const HERO_OFFERS_KEY = makeStateKey<PublicSpecialOffer[]>('home-hero.offers');

/**
 * The catalogue reduced to what the hero reads: the form (type names and order, the steppers,
 * the deep-cleaning switch, the property-type rule), the starting estimate (every pricing field
 * calculateQuote consumes) and the restore of saved choices (ids). It travels inside the server
 * HTML, so the rest - descriptions, icons, every extra except deep cleaning, poll and custom
 * types - stays out; the full list is ~46 KB raw. Thresholds and rate tiers are kept whole: the
 * calculator matches them on several fields and together they are small.
 *
 * Used only by the hero. Any other caller of the endpoint gets the full response as before.
 * A field the hero starts reading must be added here, or the estimate silently loses it.
 */
export function trimServiceTypesForHero(types: ServiceType[] | null | undefined): ServiceType[] {
  return (types ?? [])
    .filter(type => !type.hasPoll && !type.isCustom)
    .map(type => ({
      id: type.id,
      name: type.name,
      // The default form is found by this key (findResidentialServiceType), not by the name.
      serviceKey: type.serviceKey,
      basePrice: type.basePrice,
      timeDuration: type.timeDuration,
      minimumPrice: type.minimumPrice,
      displayOrder: type.displayOrder,
      isActive: type.isActive,
      hasPoll: type.hasPoll,
      isCustom: type.isCustom,
      collectsPropertyType: type.collectsPropertyType,
      services: (type.services ?? []).map(service => ({
        id: service.id,
        name: service.name,
        serviceKey: service.serviceKey,
        cost: service.cost,
        timeDuration: service.timeDuration,
        serviceTypeId: service.serviceTypeId,
        inputType: service.inputType,
        minValue: service.minValue,
        maxValue: service.maxValue,
        stepValue: service.stepValue,
        isRangeInput: service.isRangeInput,
        serviceRelationType: service.serviceRelationType,
        isActive: service.isActive,
        displayOrder: service.displayOrder,
        chargeAboveThreshold: service.chargeAboveThreshold,
        zeroQuantityCost: service.zeroQuantityCost,
        zeroQuantityDuration: service.zeroQuantityDuration,
        thresholds: service.thresholds,
        rateTiers: service.rateTiers
      })),
      extraServices: (type.extraServices ?? [])
        .filter(extra => extra.isDeepCleaning)
        .map(extra => ({
          id: extra.id,
          name: extra.name,
          price: extra.price,
          duration: extra.duration,
          priceMultiplier: extra.priceMultiplier,
          isDeepCleaning: extra.isDeepCleaning,
          isSuperDeepCleaning: extra.isSuperDeepCleaning,
          isSameDayService: extra.isSameDayService,
          hasQuantity: extra.hasQuantity,
          hasHours: extra.hasHours,
          isAvailableForAll: extra.isAvailableForAll,
          isActive: extra.isActive,
          displayOrder: extra.displayOrder
        }))
    }));
}

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
  imports: [NgOptimizedImage, RouterLink, FormsModule, ReactiveFormsModule, ShimmerDirective, IconComponent],
  providers: [RESPONSIVE_IMAGE_LOADER_PROVIDER],
  templateUrl: './home-hero.component.html',
  styleUrl: './home-hero.component.scss'
})
export class HomeHeroComponent implements OnInit, OnDestroy {
  protected readonly icons = { faBroom, faCalendarCheck, faChevronDown, faCircleCheck, faLock, faSprayCanSparkles };

  /** Location shown in the H1 accent ("Professional Cleaning Services in <accent>"). */
  @Input() locationName = 'NYC';
  /** Hero subtitle paragraph copy. */
  @Input() heroSubtitle =
    'Trusted home & apartment cleaning in Brooklyn, Manhattan and Queens. ' +
    'Transparent pricing, trained cleaners, and a simple online booking experience.';
  /** Borough pill row — shown on the homepage, hidden on the borough service pages. */
  @Input() showLocations = true;

  protected readonly phoneNumber = inject(PhoneNumberService);

  protected readonly heroImageSrc = HERO_IMAGE;
  protected readonly heroImageSrcset = responsiveWidths(HERO_IMAGE);
  protected readonly heroImageSizes = HERO_IMAGE_SIZES;

  /** "153 Google reviews"; empty (badge segment hidden) until the stats arrive. */
  reviewCountLabel = '';
  specialOffers: PublicSpecialOffer[] = [];
  /**
   * True once this render KNOWS the public offers (server copy, TransferState, this tab's memory or
   * the browser fetch). Until then the coupon is still drawn — complete, with only the percentage
   * left blank in its reserved space — because the offer is far more likely to exist than not.
   */
  offersKnown = false;
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

  // True until the service types are in. The server render normally fills them in (see
  // loadServiceTypes), so the placeholder only shows when that SSR fetch failed or timed out.
  isLoadingServiceTypes = true;

  /** Placeholder rows: Residential (the default type) shows exactly these two steppers. */
  protected readonly skeletonServiceLabels = ['Bedrooms', 'Bathrooms'];

  private readonly injector = inject(Injector);
  private readonly transferState = inject(TransferState);
  private readonly document = inject(DOCUMENT);
  /** Server only: the request's cookies in, "rendered from the visitor's cookie" out. */
  private readonly ssrContext = inject(SSR_RESPONSE_CONTEXT, { optional: true });
  /** server.ts's in-memory catalogue (server only). Absent in the browser and in unit tests. */
  private readonly ssrCatalogue = inject(SSR_CATALOGUE, { optional: true });

  /**
   * True while this hero is being HYDRATED over server-rendered HTML: it was created during the
   * app's first navigation in the browser. Its first render must match the server's DOM exactly,
   * so it draws the choice the server drew (HERO_CHOICE_KEY, or the default form) and anything
   * else is restored only after hydration (afterNextRender). A hero created by an in-app
   * navigation renders from scratch and restores at once, as before.
   */
  private readonly hydrating: boolean;

  /**
   * The service types this tab last loaded. A hero created again (Back to the homepage, or any
   * later visit) draws the form from them at once instead of the loading skeleton, which is a
   * different height - drawn first, it moved everything below it once the request came back, so a
   * scroll position restored by Back landed on the wrong content. Still refreshed from the API.
   */
  private static lastServiceTypes: ServiceType[] | null = null;

  /** Same per-tab memory for the public offers, so the coupon is there on a return visit. */
  private static lastOffers: PublicSpecialOffer[] | null = null;

  constructor(
    private googlePlacesService: GooglePlacesService,
    private specialOfferService: SpecialOfferService,
    private bookingService: BookingService,
    private formPersistenceService: FormPersistenceService,
    private router: Router,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
    this.hydrating = this.isBrowser && !this.router.navigated;
  }

  /**
   * The welcome coupon is shown to EVERYONE (owner's rule, 2026-10) — signed in or not, eligible or
   * not, even a customer who already used the offer. It disappears only when the offer itself is
   * inactive or deleted in admin, which the public-offers list tells everybody the same way. So it
   * depends on no user data at all: the server renders it whole, and only the percentage may arrive
   * later (reserved space) when the server had no copy of the offers.
   */
  get showWelcomeCoupon(): boolean {
    return !this.offersKnown || !!this.firstTimeOffer;
  }

  ngOnInit() {
    this.loadReviews();
    this.loadSpecialOffers();
    this.loadServiceTypes();
  }

  ngOnDestroy() {
    this.subscription.unsubscribe();
  }

  /** Fetches the Google review count for the hero badge ("153 Google reviews"). */
  private loadReviews() {
    if (!this.showGoogleReviews) return;
    this.subscription.add(
      this.googlePlacesService.getStats().subscribe(stats => {
        this.reviewCountLabel = stats ? formatReviewCount(stats.total) : '';
      })
    );
  }

  /**
   * The coupon's offer. On the server it comes from server.ts's in-memory copy of the public
   * offers (never an API call - /api/special-offers is on the SSR skip list) and travels to the
   * browser in TransferState, so it is in the first paint. Only a client-side navigation, or a
   * server render that had no copy, fetches it in the browser as before.
   */
  private loadSpecialOffers() {
    if (!this.isBrowser) {
      const offers = this.ssrCatalogue?.publicOffers;
      if (offers) {
        const advertised = findAdvertisedFirstTimeOffer(offers);
        this.specialOffers = advertised ? [advertised] : [];
        this.offersKnown = true;
        this.transferState.set(HERO_OFFERS_KEY, this.specialOffers);
      }
      return;
    }

    if (this.hydrating && this.transferState.hasKey(HERO_OFFERS_KEY)) {
      this.specialOffers = this.transferState.get(HERO_OFFERS_KEY, []);
      this.offersKnown = true;
      this.transferState.remove(HERO_OFFERS_KEY);
      HomeHeroComponent.lastOffers = this.specialOffers;
      return;
    }

    if (HomeHeroComponent.lastOffers) {
      this.specialOffers = HomeHeroComponent.lastOffers;
      this.offersKnown = true;
    }
    this.subscription.add(
      this.specialOfferService.getPublicSpecialOffers().subscribe({
        next: (offers) => {
          this.specialOffers = offers ?? [];
          this.offersKnown = true;
          HomeHeroComponent.lastOffers = this.specialOffers;
        },
        error: (error) => { console.error('Error loading special offers:', error); }
      })
    );
  }

  /** First-time customer offer from the public special offers (percentage is admin-configurable, never hardcoded). */
  get firstTimeOffer(): PublicSpecialOffer | undefined {
    return findAdvertisedFirstTimeOffer(this.specialOffers);
  }

  /** Display label for the first-time discount, e.g. "10%" or "$20". Empty when no offer is loaded. */
  get firstTimeDiscountLabel(): string {
    const offer = this.firstTimeOffer;
    if (!offer) return '';
    return offer.isPercentage ? `${offer.discountValue}%` : `$${offer.discountValue}`;
  }

  // Booking form methods
  /**
   * Runs on the server too, so the SSR HTML carries the real form instead of a placeholder that
   * the browser swapped out once its own request returned (that swap was a layout shift). The
   * response reaches the browser through the HTTP transfer cache, so hydration re-applies the
   * same list without a second request. If the server's request fails or exceeds
   * SSR_SERVICE_TYPES_TIMEOUT_MS, the server sends the placeholder and the browser fetches
   * the list itself, which is the old behaviour.
   */
  private loadServiceTypes() {
    // The static cache is per browser tab. On the server a static field would be shared by
    // every request the Node process handles, so it is neither read nor written there.
    const cached = this.isBrowser ? HomeHeroComponent.lastServiceTypes : null;
    if (cached) {
      this.applyServiceTypes(cached, false);
    } else {
      this.isLoadingServiceTypes = true;
    }

    // Hydrating over a server render that loaded the list: take the server's trimmed copy from
    // TransferState, synchronously, so this first render matches the server DOM. No request.
    if (this.hydrating && !cached && this.transferState.hasKey(HERO_SERVICE_TYPES_KEY)) {
      const transferred = this.transferState.get(HERO_SERVICE_TYPES_KEY, []);
      this.transferState.remove(HERO_SERVICE_TYPES_KEY);
      HomeHeroComponent.lastServiceTypes = transferred;
      this.applyServiceTypes(transferred, true);
      return;
    }

    // On the server the catalogue normally comes from server.ts's in-memory copy (SSR_CATALOGUE,
    // shared with the marketing prices and /llms.txt): no backend call per render. Null there means
    // the backend is unavailable, which takes the same placeholder path as a failed request.
    // Without the token the server opts its request out of the HTTP transfer cache: that cache
    // would ship the full 46 KB response under the endpoint's URL (and hand it to any other caller
    // during hydration). The hero ships only its trimmed copy, under its own TransferState key.
    const request: Observable<ServiceType[]> = this.isBrowser
      ? this.bookingService.getServiceTypes()
      : this.ssrCatalogue
        ? (this.ssrCatalogue.serviceTypes
            ? of(this.ssrCatalogue.serviceTypes)
            : throwError(() => new Error('CatalogueUnavailable')))
        : this.bookingService.getServiceTypes({ transferCache: false }).pipe(timeout(SSR_SERVICE_TYPES_TIMEOUT_MS));
    this.subscription.add(
      request.subscribe({
        next: (response) => {
          const serviceTypes = trimServiceTypesForHero(response);
          if (this.isBrowser) {
            HomeHeroComponent.lastServiceTypes = serviceTypes;
          } else {
            this.transferState.set(HERO_SERVICE_TYPES_KEY, serviceTypes);
          }
          // Already drawn from the same list: nothing to redo.
          if (cached && JSON.stringify(cached) === JSON.stringify(serviceTypes)) return;
          // Over the network in the browser means after hydration (the response is async), so
          // there is no server DOM left to match.
          this.applyServiceTypes(serviceTypes, false);
        },
        error: (error) => {
          if (!this.isBrowser) {
            // Keep the placeholder; the browser loads the list after hydration.
            console.warn('SSR: service types unavailable, sending the form placeholder:', error?.name || error);
            return;
          }
          console.error('Error loading service types:', error);
          this.isLoadingServiceTypes = false;
        }
      })
    );
  }

  /**
   * @param matchServerRender True only for the hydration pass that took the list from
   * TransferState: that render must reproduce the server's form exactly.
   */
  private applyServiceTypes(serviceTypes: ServiceType[], matchServerRender: boolean) {
    // Filter out poll and custom - main page only shows regular service types for everyone
    const regularServiceTypes = serviceTypes.filter(type => !type.hasPoll && !type.isCustom);
    this.serviceTypes = regularServiceTypes.sort((a, b) => {
      const orderA = a.displayOrder || 999;
      const orderB = b.displayOrder || 999;
      return orderA - orderB;
    });
    this.isLoadingServiceTypes = false;

    if (!this.isBrowser) {
      // A returning visitor's choice comes from their hero cookie (browser storage is out of
      // reach here). Anything the current catalogue cannot show falls back to the default form.
      const choice = validateHeroChoice(
        decodeHeroChoice(readCookie(this.ssrContext?.requestCookies, HERO_CHOICE_COOKIE)), this.serviceTypes);
      if (choice) {
        this.applySavedChoice(choice, false);
        this.transferState.set(HERO_CHOICE_KEY, choice);
        if (this.ssrContext) this.ssrContext.renderedFromCookie = true;
      } else {
        this.selectDefaultServiceType(false);
      }
      return;
    }
    if (this.hydrating && matchServerRender) {
      // Draw exactly what the server drew, without persisting anything yet. Restoring a different
      // choice first would render a different form and break hydration (NG0500-series).
      const serverChoice = this.transferState.get(HERO_CHOICE_KEY, null);
      this.transferState.remove(HERO_CHOICE_KEY);
      if (serverChoice) {
        this.applySavedChoice(serverChoice, false);
        afterNextRender(() => this.syncAfterServerChoice(), { injector: this.injector });
      } else {
        // No cookie yet (e.g. the first visit after it was introduced): today's restore from
        // browser storage, after hydration. Saving it writes the cookie for next time.
        this.selectDefaultServiceType(false);
        afterNextRender(() => this.loadSavedFormData(), { injector: this.injector });
      }
      return;
    }
    // Try to restore from saved data
    this.loadSavedFormData();
  }

  /**
   * After hydrating a form the server drew from the cookie: nothing visible changes. Restore the
   * contact fields (never in the cookie) and save, which brings this tab's storage - empty in a
   * new tab or after it was cleared, or older than a cookie another tab wrote - in step with
   * the form on screen. Contact fields go first: the save writes them too.
   */
  private syncAfterServerChoice() {
    this.formPersistenceService.loadFormData();
    const stored = this.formPersistenceService.getFormData();
    if (stored) this.restoreContactFields(stored);
    this.saveMainPageFormData();
  }

  /** The hero cookie read in the browser, for a tab whose storage holds no saved form. */
  private cookieChoice(): HeroChoice | null {
    return validateHeroChoice(
      decodeHeroChoice(readCookie(this.document.cookie, HERO_CHOICE_COOKIE)), this.serviceTypes);
  }

  /**
   * The first-time-visitor form: Residential Cleaning with its default quantities.
   * `persist` false leaves the storage /booking shares untouched (server render, or the
   * hydration pass that runs before the saved choices are read).
   */
  private selectDefaultServiceType(persist: boolean) {
    const residentialCleaning = findResidentialServiceType(this.serviceTypes);

    if (residentialCleaning) {
      this.selectServiceType(residentialCleaning, false, persist);
    }
  }

  private loadSavedFormData() {
    // Re-hydrate from sessionStorage so we use persisted state (e.g. after refresh)
    this.formPersistenceService.loadFormData();
    const stored = this.formPersistenceService.getFormData();
    // Browser storage first, as before. The cookie covers a tab whose storage is empty (a new
    // tab, or storage cleared) while the 24-hour choice still stands.
    const savedData = stored ?? this.cookieChoice();
    if (stored) this.restoreContactFields(stored);

    if (savedData) {
      this.applySavedChoice(savedData, true);
    } else {
      // No saved data, set default to "Residential Cleaning"
      this.selectDefaultServiceType(true);
    }
  }

  private restoreContactFields(savedData: BookingFormData) {
    if (savedData.contactFirstName) this.firstNameControl.setValue(savedData.contactFirstName);
    if (savedData.contactLastName) this.lastNameControl.setValue(savedData.contactLastName);
    if (savedData.contactEmail) this.emailControl.setValue(savedData.contactEmail);
    if (savedData.contactPhone) this.phoneControl.setValue(savedData.contactPhone || '');
  }

  /**
   * Draws a saved choice: service type, its quantities, Regular/Deep, property type. Shared by
   * the browser-storage restore, the server's cookie render and the hydration pass that repeats
   * it, so all three produce the same form. `persist` false writes nothing (server, hydration).
   */
  private applySavedChoice(savedData: BookingFormData, persist: boolean) {
    // Set cleaning type first so when selectServiceType() calls saveMainPageFormData()
    // we don't overwrite storage with default 'normal'
    const cleaningType = savedData.cleaningType === 'deep' || savedData.cleaningType === 'normal' ? savedData.cleaningType : 'normal';
    this.cleaningTypeControl.setValue(cleaningType);

    // Restore service type. Passed as a RESTORE so it neither seeds Sq.ft from bedrooms nor
    // persists — the stored quantities are applied just below and saved from there.
    const savedServiceType = savedData.selectedServiceTypeId
      ? this.serviceTypes.find(st => st.id.toString() === savedData.selectedServiceTypeId)
      : undefined;
    if (savedServiceType) {
      this.selectServiceType(savedServiceType, true);
    } else {
      // No saved type, or one that is no longer offered (deleted, hidden, now custom-only):
      // show the first-time form rather than an empty card. Its saved quantities belonged to
      // the missing type, so they are not applied below.
      this.selectDefaultServiceType(persist);
    }

    // Restore services
    if (savedServiceType && savedData.selectedServices && this.selectedServiceType) {
      savedData.selectedServices.forEach(savedService => {
        const service = this.selectedServiceType!.services.find(s => s.id.toString() === savedService.serviceId);
        if (service) {
          const selectedService = this.selectedServices.find(ss => ss.service.id === service.id);
          if (selectedService) {
            selectedService.quantity = savedService.quantity;
          }
        }
      });
      // Restore is NOT a bedroom change: the persisted Sq.ft is the value the customer chose
      // on /booking, so it is floored and never lowered. Done once after the loop so the
      // result doesn't depend on whether bedrooms happens to precede sqft in storage.
      this.clampSquareFeetToBedroomMinimum();
      // Sync form controls (bedrooms, bathrooms, sqft) from restored selectedServices so "Get Exact Price" reads correct values
      this.updateFormControlsFromServices();
      // Property type round-trips through the same store the booking page uses.
      this.propertyType = normalizePropertyType(savedData?.propertyType);
      // The only write of this hydration — selectServiceType deliberately skipped saving, so
      // storage is never touched until the restored quantities are actually in place.
      if (persist) this.saveMainPageFormData();
    }

    this.normalizeCleaningTypeForSelectedServiceType();
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

  /** Icon for a service type in the dropdown — see shared/icons/service-type-icon.ts. */
  getServiceTypeIcon(type: IconServiceType | null | undefined): IconDefinition {
    return serviceTypeIcon(type);
  }

  /**
   * @param isRestore True when re-selecting the PERSISTED service type during hydration. The
   * stored quantities are about to be restored over these defaults, so seeding Sq.ft from
   * bedrooms here (and persisting it) would destroy the customer's value before the restore
   * loop ever runs — the same side effect that was removed from updateFormControlsFromServices,
   * just one call earlier. Seeding is only correct for a service type the user actively picks.
   * @param persist Whether to save the result to the storage /booking shares. Defaults to
   * `!isRestore`; the default form drawn during SSR/hydration passes false.
   */
  selectServiceType(serviceType: ServiceType, isRestore = false, persist = !isRestore) {
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

      // Seed Sq.ft from bedrooms ONLY for a service type the user actively picked — there is
      // no customer value for it yet. During a restore the persisted quantities land moments
      // later, so seeding here would just be a value we then have to undo.
      if (!isRestore) {
        const bedroomsService = this.selectedServices.find(s => s.service.serviceKey === 'bedrooms');
        const sqftService = this.selectedServices.find(s => s.service.serviceKey === 'sqft');
        if (bedroomsService && sqftService) {
          sqftService.quantity = this.getSquareFeetForBedrooms(bedroomsService.quantity);
        }
      }
    }

    // Sync the controls only — this never re-derives Sq.ft.
    this.updateFormControlsFromServices();

    this.normalizeCleaningTypeForSelectedServiceType();
    // Restores persist once, from the caller, after the stored quantities are in place.
    // Saving here would write the seeded defaults into the storage /booking shares.
    if (persist) {
      this.saveMainPageFormData();
    }
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

  /**
   * Sync the form controls FROM the current selections. Read-only with respect to the
   * selections themselves — in particular it must never re-derive Sq.ft.
   *
   * It used to recompute Sq.ft from bedrooms whenever it was called with no service key,
   * which included the initial load. Since the hero shares formPersistenceService storage
   * with /booking and then persists what it holds, merely rendering the homepage silently
   * rewrote a Sq.ft the customer had chosen on the booking page — a field the hero does not
   * even display. Callers that genuinely change bedrooms now apply the linkage themselves.
   */
  private updateFormControlsFromServices() {
    const bedroomsService = this.selectedServices.find(s => s.service.serviceKey === 'bedrooms');
    const bathroomsService = this.selectedServices.find(s => s.service.serviceKey === 'bathrooms');
    const sqftService = this.selectedServices.find(s => s.service.serviceKey === 'sqft');

    if (bedroomsService) {
      this.bedroomsControl.setValue(bedroomsService.quantity);
    }
    if (bathroomsService) {
      this.bathroomsControl.setValue(bathroomsService.quantity);
    }
    if (sqftService) {
      this.squareFeetControl.setValue(sqftService.quantity);
    }
  }

  /**
   * Apply the shared bedrooms→sqft rule after the hero's bedroom stepper moved.
   * `previousQuantity` is the bedroom count BEFORE the change.
   */
  private syncSquareFeetForBedroomChange(previousQuantity: number, newQuantity: number): void {
    const sqftService = this.selectedServices.find(s => s.service.serviceKey === 'sqft');
    if (!sqftService) return;
    sqftService.quantity = resolveSquareFeetForBedroomChange(
      sqftService.quantity,
      this.getSquareFeetForBedrooms(previousQuantity),
      this.getSquareFeetForBedrooms(newQuantity)
    );
  }

  /**
   * Floor a restored Sq.ft to the current bedroom minimum without ever lowering it.
   * Call ONCE after a restore loop, never per-item.
   */
  private clampSquareFeetToBedroomMinimum(): void {
    const sqftService = this.selectedServices.find(s => s.service.serviceKey === 'sqft');
    if (!sqftService) return;
    sqftService.quantity = clampRestoredSquareFeet(
      sqftService.quantity,
      this.getSquareFeetMinForBedrooms()
    );
  }

  incrementServiceQuantity(service: Service) {
    const selectedService = this.selectedServices.find(s => s.service.id === service.id);
    if (selectedService && selectedService.quantity < (service.maxValue || 10)) {
      const previousQuantity = selectedService.quantity;
      selectedService.quantity++;
      if (service.serviceKey === 'bedrooms') {
        this.syncSquareFeetForBedroomChange(previousQuantity, selectedService.quantity);
      }
      this.updateFormControlsFromServices();
      this.saveMainPageFormData();
    }
  }

  decrementServiceQuantity(service: Service) {
    const selectedService = this.selectedServices.find(s => s.service.id === service.id);
    if (selectedService && selectedService.quantity > (service.minValue ?? 0)) {
      const previousQuantity = selectedService.quantity;
      selectedService.quantity--;
      if (service.serviceKey === 'bedrooms') {
        this.syncSquareFeetForBedroomChange(previousQuantity, selectedService.quantity);
      }
      this.updateFormControlsFromServices();
      this.saveMainPageFormData();
    }
  }

  updateServiceQuantity(service: Service, quantity: number) {
    const selectedService = this.selectedServices.find(s => s.service.id === service.id);
    if (selectedService) {
      const previousQuantity = selectedService.quantity;
      selectedService.quantity = quantity;

      if (service.serviceKey === 'bedrooms') {
        this.syncSquareFeetForBedroomChange(previousQuantity, quantity);
      }

      // If updating square feet, ensure it's not below minimum for current bedrooms
      if (service.serviceKey === 'sqft') {
        const minSquareFeet = this.getSquareFeetMinForBedrooms();
        if (quantity < minSquareFeet) {
          selectedService.quantity = minSquareFeet;
          quantity = minSquareFeet;
        }
      }

      this.updateFormControlsFromServices();
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
      // Carried through the SAME key the booking page reads, so a property type picked here is
      // already answered on step 1. levelsQuantity is deliberately never written by the hero.
      propertyType: this.propertyType ?? undefined,
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
      const mapped = {
        ...mapSelectedServiceInput(selected),
        quantity: useMinQuantities ? minQty : (selected.quantity ?? minQty)
      };

      // LEVELS IS ALWAYS PRICED AS ONE HERE, whatever was restored.
      //
      // The hero and the booking page share FormPersistenceService. A customer who configures a
      // 3-level house on /booking and then comes back to the homepage restores levels = 3 into
      // this component - and the hero has no levels control, so the estimate would jump by $105
      // with nothing on screen accounting for it, while bedrooms, bathrooms, sq.ft and cleaning
      // type all read identical. That looks like a broken estimator.
      //
      // The entry stays in selectedServices so saveMainPageFormData round-trips it and the
      // booking page gets its level count back untouched; only the ESTIMATE neutralises it.
      // One level costs exactly zero, so this is the apartment-equivalent number.
      if (isLevelsService(selected.service)) mapped.quantity = MIN_LEVELS;

      return mapped;
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
  /** Template helper: the levels row is never rendered here. See buildEstimateQuoteInput. */
  isLevelsService(service: Service): boolean {
    return isLevelsService(service);
  }

  // ===== Property type =====
  //
  // PROPERTY TYPE ONLY. The Levels chips are deliberately never rendered on the hero, so this
  // component never writes a level count and its estimate can never carry a stair charge. The
  // restore-path neutralisation in buildEstimateQuoteInput stays regardless, because a level
  // count persisted by the BOOKING page in an earlier session can still arrive here.

  propertyType: PropertyType | null = null;

  readonly propertyTypeApartment = PROPERTY_TYPE_APARTMENT;
  readonly propertyTypeHouse = PROPERTY_TYPE_HOUSE;

  /**
   * Fills the slot the Regular/Deep choice occupies on Residential.
   *
   * canSelectDeepCleaning is the existing, data-driven Residential discriminator (does this type
   * have an active deep-cleaning extra), so this renders exactly where that slot is otherwise
   * empty. The exclusion rule itself is shared with every other surface.
   */
  showPropertyTypeSelector(): boolean {
    if (this.isLoadingServiceTypes || this.canSelectDeepCleaning) return false;
    return serviceTypeCollectsPropertyType(this.selectedServiceType);
  }

  isPropertyTypeSelected(type: PropertyType): boolean {
    return this.propertyType === type;
  }

  /**
   * Records the choice and persists it. No price recalculation is triggered because property type
   * has zero price impact anywhere in this system - only the level count moves money, and the
   * hero never collects one.
   */
  selectPropertyType(type: PropertyType): void {
    this.propertyType = type;
    this.saveMainPageFormData();
  }

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
      // MUST be repeated here: this path calls saveFormData, which REPLACES the stored object
      // rather than merging it like saveMainPageFormData's updateFormData. Omitting it would
      // wipe the property type on the way to /booking - the exact field the customer just set.
      propertyType: this.propertyType ?? undefined,
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
