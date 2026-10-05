import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ApplicationRef, PLATFORM_ID, TransferState } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { HttpTestingController } from '@angular/common/http/testing';

import {
  HomeHeroComponent, HERO_CHOICE_KEY, HERO_OFFERS_KEY, HERO_SERVICE_TYPES_KEY, SSR_SERVICE_TYPES_TIMEOUT_MS, trimServiceTypesForHero
} from './home-hero.component';
import { HERO_CHOICE_COOKIE, HeroChoice, readCookie, writeHeroChoiceCookie } from '../../booking/hero-choice-cookie';
import { SSR_RESPONSE_CONTEXT, SsrResponseContext } from '../../ssr/ssr-response.token';
import { SSR_CATALOGUE } from '../../ssr/ssr-catalogue.token';
import { ANONYMOUS_UI_HINT, writeUiHintCookie } from '../../ssr/ui-hint-cookie';
import { AuthService } from '../../../services/auth.service';

import { testProviders } from '../../../../testing/test-providers';

describe('HomeHeroComponent', () => {
  let component: HomeHeroComponent;
  let fixture: ComponentFixture<HomeHeroComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [...testProviders],
      imports: [HomeHeroComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(HomeHeroComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  /**
   * REGRESSION: the hero and the booking page share FormPersistenceService.
   *
   * A customer who configures a 3-level house on /booking and then returns to the homepage
   * restores levels = 3 into this component. The hero has no levels control, so the estimate
   * would jump by $105 with nothing on screen accounting for it, while bedrooms, bathrooms,
   * sq.ft and cleaning type all read identical. That looks like a broken estimator.
   *
   * The entry deliberately STAYS in selectedServices so the hero's own save round-trips it and
   * the booking page gets its level count back untouched. Only the estimate neutralises it.
   */
  describe('levels never affect the homepage estimate', () => {
    const bedrooms = {
      id: 1, name: 'Bedrooms', serviceKey: 'bedrooms', cost: 22.5, timeDuration: 30,
      serviceTypeId: 1, inputType: 'dropdown', isRangeInput: false, isActive: true,
      minValue: 0, maxValue: 6, stepValue: 1, displayOrder: 1,
      zeroQuantityCost: 0, zeroQuantityDuration: 0,
      chargeAboveThreshold: false, thresholds: [], rateTiers: []
    } as any;

    const levels = {
      id: 40, name: 'Levels', serviceKey: 'levels', cost: 35, timeDuration: 25,
      serviceTypeId: 1, inputType: 'dropdown', isRangeInput: false, isActive: true,
      minValue: 1, maxValue: 4, stepValue: 1, displayOrder: 4,
      chargeAboveThreshold: true,
      thresholds: [{ id: 9, serviceId: 40, sourceServiceId: 40, sourceQuantity: 1, includedQuantity: 1 }],
      rateTiers: []
    } as any;

    const residential = {
      id: 1, name: 'Residential Cleaning', basePrice: 90, timeDuration: 120, minimumPrice: 130,
      isActive: true, hasPoll: false, isCustom: false,
      services: [bedrooms, levels], extraServices: []
    } as any;

    beforeEach(() => {
      component.selectedServiceType = residential;
      component.cleaningTypeControl.setValue('normal');
    });

    const withLevels = (quantity: number) => {
      component.selectedServices = [
        { service: bedrooms, quantity: 2 },
        { service: levels, quantity }
      ] as any;
    };

    it('prices a restored 3-level draft exactly like a 1-level one', () => {
      withLevels(1);
      const oneLevel = component.getEstimatedPrice();

      withLevels(3);

      expect(component.getEstimatedPrice()).toBe(oneLevel);
    });

    it('leaves the advertised starting price untouched by a restored level count', () => {
      withLevels(1);
      const startingPrice = component.getRegularStartingPrice();

      withLevels(4);

      expect(component.getRegularStartingPrice()).toBe(startingPrice);
    });

    it('keeps the restored levels entry in selectedServices so /booking gets it back', () => {
      // Dropping it here would wipe the customer's level choice out of the SHARED session
      // store the moment they touched the homepage.
      withLevels(3);
      component.getEstimatedPrice();

      const entry = component.selectedServices.find(s => s.service.serviceKey === 'levels');
      expect(entry?.quantity).toBe(3);
    });

    it('identifies the levels row so the template can hide its stepper', () => {
      expect(component.isLevelsService(levels)).toBe(true);
      expect(component.isLevelsService(bedrooms)).toBe(false);
    });
  });

  /**
   * Property type fills the slot Residential uses for its Regular/Deep choice, which every other
   * service type leaves empty.
   *
   * PROPERTY TYPE ONLY: the hero must never collect a level count, so its estimate can never
   * carry a stair charge.
   */
  describe('property type in the cleaning-type slot', () => {
    const deepExtra = {
      id: 1, name: 'Deep Cleaning', price: 90, duration: 120, priceMultiplier: 1.5,
      isDeepCleaning: true, isSuperDeepCleaning: false, isSameDayService: false,
      hasQuantity: false, hasHours: false, isAvailableForAll: true, isActive: true
    } as any;

    const residential = {
      id: 1, name: 'Residential Cleaning', basePrice: 90, timeDuration: 120, minimumPrice: 130,
      isActive: true, hasPoll: false, isCustom: false,
      services: [], extraServices: [deepExtra]
    } as any;

    /** No deep-cleaning extra, so the Regular/Deep slot is empty and ours takes it. */
    const moveInOut = {
      id: 15, name: 'Move in/out Cleaning', basePrice: 187.5, timeDuration: 270, minimumPrice: 245,
      isActive: true, hasPoll: false, isCustom: false,
      services: [], extraServices: []
    } as any;

    /** Quote-request type: creates no Order, so it collects no property type anywhere. */
    const pollType = {
      id: 7, name: 'Filthy', basePrice: 0, timeDuration: 0, minimumPrice: 0,
      isActive: true, hasPoll: true, isCustom: false,
      services: [], extraServices: []
    } as any;

    beforeEach(() => {
      component.isLoadingServiceTypes = false;
      component.propertyType = null;
    });

    it('does not take the slot on Residential, which still shows Regular / Deep', () => {
      component.selectedServiceType = residential;

      expect(component.canSelectDeepCleaning).toBe(true);
      expect(component.showPropertyTypeSelector()).toBe(false);
    });

    it('fills the otherwise-empty slot on a non-Residential type', () => {
      component.selectedServiceType = moveInOut;

      expect(component.canSelectDeepCleaning).toBe(false);
      expect(component.showPropertyTypeSelector()).toBe(true);
    });

    it('stays hidden on a quote-request type, via the shared exclusion rule', () => {
      component.selectedServiceType = pollType;

      expect(component.showPropertyTypeSelector()).toBe(false);
    });

    it('stays hidden on a type an admin switched off', () => {
      // Office Cleaning is the shipped example. The flag exists because Office and Heavy
      // Conditional are structurally identical, so nothing else can tell them apart.
      component.selectedServiceType = { ...moveInOut, collectsPropertyType: false } as any;

      expect(component.showPropertyTypeSelector()).toBe(false);
    });

    it('treats an ABSENT flag as true, so a stale payload never hides it everywhere', () => {
      const noFlag = { ...moveInOut } as any;
      delete noFlag.collectsPropertyType;
      component.selectedServiceType = noFlag;

      expect(component.showPropertyTypeSelector()).toBe(true);
    });

    it('never collects a level count, so House changes nothing about the estimate', () => {
      component.selectedServiceType = moveInOut;
      component.selectedServices = [];
      const before = component.getEstimatedPrice();

      component.selectPropertyType('House');

      expect(component.propertyType).toBe('House');
      // No levels field exists on this component at all, and the price is untouched.
      expect((component as any).levelsQuantity).toBeUndefined();
      expect(component.getEstimatedPrice()).toBe(before);
    });

    it('persists the choice under the key the booking page reads', () => {
      component.selectedServiceType = moveInOut;

      component.selectPropertyType('Apartment');

      const stored = (component as any).formPersistenceService.getFormData();
      expect(stored?.propertyType).toBe('Apartment');
      // The contract is "the hero never writes a level count". Absent or null both satisfy it;
      // which one shows up depends on whether the shared store was already initialised.
      expect(stored?.levelsQuantity ?? null).toBeNull();
    });
  });

  /**
   * Back to the homepage: the hero is created again, and drawing the loading skeleton first (a
   * different height from the form) moved everything below it once the request returned, so the
   * scroll position restored by Back landed on the wrong content.
   */
  describe('service types on a later visit', () => {
    const TYPES = [{ id: 1, name: 'Residential Cleaning', displayOrder: 1, services: [], extraServices: [] }] as any[];

    afterEach(() => { (HomeHeroComponent as any).lastServiceTypes = null; });

    it('draws a re-created hero from the list this tab already loaded', () => {
      const http = TestBed.inject(HttpTestingController);
      http.expectOne(r => r.url.endsWith('/booking/service-types')).flush(TYPES);
      expect(component.isLoadingServiceTypes).toBe(false);

      const again = TestBed.createComponent(HomeHeroComponent);
      again.detectChanges();

      expect(again.componentInstance.isLoadingServiceTypes).toBe(false);
      expect(again.componentInstance.serviceTypes.map(t => t.id)).toEqual([1]);
      // Still refreshed from the API.
      http.expectOne(r => r.url.endsWith('/booking/service-types')).flush(TYPES);
    });
  });
});

/**
 * The form is server-rendered: the service types load during SSR (bounded by a timeout) and
 * reach the browser through the HTTP transfer cache. A returning visitor's saved choices live in
 * sessionStorage, so they are restored only AFTER hydration: the hydration pass must draw exactly
 * what the server drew, or Angular reports a hydration mismatch (NG0500-series).
 */
describe('HomeHeroComponent server-rendered form', () => {
  const bedrooms = {
    id: 11, name: 'Bedrooms', serviceKey: 'bedrooms', inputType: 'dropdown', isActive: true,
    minValue: 0, maxValue: 6, displayOrder: 1, thresholds: [], rateTiers: []
  } as any;
  const bathrooms = {
    id: 12, name: 'Bathrooms', serviceKey: 'bathrooms', inputType: 'dropdown', isActive: true,
    minValue: 1, maxValue: 6, displayOrder: 2, thresholds: [], rateTiers: []
  } as any;
  const hours = {
    id: 21, name: 'Hours', serviceKey: 'hours', inputType: 'dropdown', isActive: true,
    minValue: 2, maxValue: 8, displayOrder: 1, thresholds: [], rateTiers: []
  } as any;
  const residential = {
    id: 1, name: 'Residential Cleaning', basePrice: 90, timeDuration: 120, isActive: true,
    hasPoll: false, isCustom: false, displayOrder: 1, services: [bedrooms, bathrooms], extraServices: []
  } as any;
  const office = {
    id: 2, name: 'Office Cleaning', basePrice: 100, timeDuration: 120, isActive: true,
    hasPoll: false, isCustom: false, displayOrder: 2, services: [hours], extraServices: []
  } as any;
  const TYPES = [residential, office];
  const STORAGE_KEY = 'booking_form_data';

  /**
   * platform 'server': `requestCookies` is the incoming Cookie header (SSR_RESPONSE_CONTEXT).
   * platform 'browser' + `transfer`: the hydration pass over a server render that loaded the
   * list (and, with `serverChoice`, rendered it from the visitor's hero cookie).
   */
  function create(platform: 'browser' | 'server',
                  opts: { requestCookies?: string; transfer?: boolean; serverChoice?: HeroChoice } = {}) {
    const ssrContext: SsrResponseContext = { statusCode: null, requestCookies: opts.requestCookies ?? null };
    TestBed.configureTestingModule({
      providers: [
        ...testProviders,
        { provide: PLATFORM_ID, useValue: platform },
        ...(platform === 'server' ? [{ provide: SSR_RESPONSE_CONTEXT, useValue: ssrContext }] : [])
      ],
      imports: [HomeHeroComponent]
    });
    if (opts.transfer) {
      const state = TestBed.inject(TransferState);
      state.set(HERO_SERVICE_TYPES_KEY, trimServiceTypesForHero(TYPES));
      if (opts.serverChoice) state.set(HERO_CHOICE_KEY, opts.serverChoice);
    }
    const fixture = TestBed.createComponent(HomeHeroComponent);
    // The first render only: a view-level pass does not run afterNextRender callbacks, so the
    // state here is what the hydration pass draws (afterHydration() runs the rest).
    fixture.componentRef.changeDetectorRef.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    return { fixture, hero: fixture.componentInstance, http, ssrContext };
  }
  const serviceTypesRequest = (http: HttpTestingController) =>
    http.expectOne(r => r.url.endsWith('/booking/service-types'));
  /** The render that follows hydration, which is when afterNextRender callbacks run. */
  const afterHydration = (fixture: ComponentFixture<HomeHeroComponent>) => {
    fixture.detectChanges();
    TestBed.inject(ApplicationRef).tick();
  };
  const stored = () => JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
  const saveStorage = (data: object) =>
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...data, savedAt: Date.now() }));
  const heroCookie = () => readCookie(document.cookie, HERO_CHOICE_COOKIE);
  const quantity = (hero: HomeHeroComponent, key: string) =>
    hero.selectedServices.find(s => s.service.serviceKey === key)?.quantity;
  const typeLabel = (fixture: ComponentFixture<HomeHeroComponent>) =>
    (fixture.nativeElement as HTMLElement).querySelector('.dropdown-toggle__label span')?.textContent?.trim();
  const OFFICE_CHOICE: HeroChoice = {
    selectedServiceTypeId: '2', selectedServices: [{ serviceId: '21', quantity: 5 }], cleaningType: 'normal'
  };

  beforeEach(() => {
    sessionStorage.removeItem(STORAGE_KEY);
    writeHeroChoiceCookie(document, null);
  });
  afterEach(() => {
    sessionStorage.removeItem(STORAGE_KEY);
    writeHeroChoiceCookie(document, null);
    (HomeHeroComponent as any).lastServiceTypes = null;
  });

  describe('on the server', () => {
    it('renders the real form (default type, no placeholder) and persists nothing', () => {
      const { fixture, hero, http, ssrContext } = create('server');
      serviceTypesRequest(http).flush(TYPES);
      fixture.detectChanges();

      expect(hero.isLoadingServiceTypes).toBe(false);
      expect(hero.selectedServiceType?.id).toBe(1);
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelectorAll('.service-item:not(.hero-skeleton)').length).toBe(2);
      expect(el.querySelector('.hero-skeleton')).toBeNull();
      expect(stored()).toBeNull();
      expect(ssrContext.renderedFromCookie).toBeFalsy();
    });

    it('keeps the full response out of the HTTP transfer cache and ships a trimmed copy instead', () => {
      const { http } = create('server');
      const request = serviceTypesRequest(http);
      expect(request.request.transferCache).toBe(false);

      request.flush(TYPES);

      const shipped = TestBed.inject(TransferState).get(HERO_SERVICE_TYPES_KEY, null);
      expect(shipped).toEqual(trimServiceTypesForHero(TYPES));
    });

    it('renders a returning visitor\'s form from the hero cookie and flags the response', () => {
      const { fixture, hero, http, ssrContext } = create('server', { requestCookies: 'a=1; dc_hero_choice=1.2.n.-.21-5; b=2' });
      serviceTypesRequest(http).flush(TYPES);
      fixture.detectChanges();

      expect(hero.selectedServiceType?.id).toBe(2);
      expect(quantity(hero, 'hours')).toBe(5);
      expect(typeLabel(fixture)).toBe('Office Cleaning');
      expect(TestBed.inject(TransferState).get(HERO_CHOICE_KEY, null)).toEqual(OFFICE_CHOICE);
      expect(ssrContext.renderedFromCookie).toBe(true);
    });

    for (const value of ['garbage', '1.99.n.-.11-3', '2.1.n.-.11-3', '1.1.x.-.11-3', '1.1.n.-.11-3%3Cscript%3E', '']) {
      it(`ignores an unusable cookie (${JSON.stringify(value)}): default form, response not flagged`, () => {
        const { hero, http, ssrContext } = create('server', { requestCookies: `dc_hero_choice=${value}` });
        serviceTypesRequest(http).flush(TYPES);

        expect(hero.selectedServiceType?.id).toBe(1);
        expect(quantity(hero, 'bedrooms')).toBe(0);
        expect(ssrContext.renderedFromCookie).toBeFalsy();
        expect(TestBed.inject(TransferState).hasKey(HERO_CHOICE_KEY)).toBe(false);
      });
    }

    it('drops an out-of-range quantity and keeps the rest of the choice', () => {
      const { hero, http } = create('server', { requestCookies: 'dc_hero_choice=1.1.n.-.11-3_12-60' });
      serviceTypesRequest(http).flush(TYPES);

      expect(quantity(hero, 'bedrooms')).toBe(3);
      expect(quantity(hero, 'bathrooms')).toBe(1);
    });

    it('keeps the placeholder when the backend call fails', () => {
      const { fixture, hero, http } = create('server');
      serviceTypesRequest(http).flush('down', { status: 503, statusText: 'Unavailable' });
      fixture.detectChanges();

      expect(hero.isLoadingServiceTypes).toBe(true);
      expect((fixture.nativeElement as HTMLElement).querySelectorAll('.hero-skeleton').length).toBeGreaterThan(0);
    });

    it('gives up after SSR_SERVICE_TYPES_TIMEOUT_MS and keeps the placeholder', async () => {
      vi.useFakeTimers();
      const { hero, http } = create('server');
      const request = serviceTypesRequest(http);

      await vi.advanceTimersByTimeAsync(SSR_SERVICE_TYPES_TIMEOUT_MS);

      expect(request.cancelled).toBe(true);
      expect(hero.isLoadingServiceTypes).toBe(true);
    });
  });

  describe('hydrating in the browser', () => {
    it('uses the server\'s trimmed copy from TransferState without a request', () => {
      const { hero, http } = create('browser', { transfer: true });

      expect(hero.isLoadingServiceTypes).toBe(false);
      expect(hero.selectedServiceType?.id).toBe(1);
      http.expectNone(r => r.url.endsWith('/booking/service-types'));
      expect(TestBed.inject(TransferState).hasKey(HERO_SERVICE_TYPES_KEY)).toBe(false);
    });

    it('cookie render: the first render IS the saved form, and hydration changes nothing', () => {
      // Its own cookie disagrees on purpose: the browser follows what the SERVER drew.
      writeHeroChoiceCookie(document, { selectedServiceTypeId: '1', selectedServices: [], cleaningType: 'normal' });
      const { fixture, hero } = create('browser', { transfer: true, serverChoice: OFFICE_CHOICE });

      expect(hero.selectedServiceType?.id).toBe(2);
      expect(quantity(hero, 'hours')).toBe(5);
      expect(typeLabel(fixture)).toBe('Office Cleaning');
      expect(stored()).toBeNull(); // nothing written during the hydration pass

      afterHydration(fixture);

      expect(hero.selectedServiceType?.id).toBe(2);
      expect(quantity(hero, 'hours')).toBe(5);
      // This tab's (empty) storage and the cookie now match the form on screen.
      expect(stored()?.selectedServiceTypeId).toBe('2');
      expect(heroCookie()).toBe('1.2.n.-.21-5');
    });

    it('cookie render keeps the contact details already in storage when it syncs', () => {
      saveStorage({ selectedServiceTypeId: '2', selectedServices: [{ serviceId: '21', quantity: 5 }], contactFirstName: 'Ana', contactEmail: 'ana@example.com' });
      const { fixture } = create('browser', { transfer: true, serverChoice: OFFICE_CHOICE });

      afterHydration(fixture);

      expect(stored()?.contactFirstName).toBe('Ana');
      expect(stored()?.contactEmail).toBe('ana@example.com');
      expect(heroCookie()).not.toContain('Ana');
    });

    it('no cookie, first-time visitor: draws the default form and saves it after hydration', () => {
      const { fixture, hero } = create('browser', { transfer: true });
      expect(hero.selectedServiceType?.id).toBe(1);

      afterHydration(fixture);

      expect(hero.selectedServiceType?.id).toBe(1);
      expect(stored()?.selectedServiceTypeId).toBe('1');
      expect(heroCookie()).toMatch(/^1\.1\.n\./);
    });

    it('no cookie yet, storage present: matches the server first, restores after hydration, then writes the cookie', () => {
      saveStorage({ selectedServiceTypeId: '1', selectedServices: [{ serviceId: '11', quantity: 3 }, { serviceId: '12', quantity: 2 }] });
      writeHeroChoiceCookie(document, null);
      const { fixture, hero } = create('browser', { transfer: true });

      // Hydration pass: the server's default form, and the saved choices left untouched.
      expect(quantity(hero, 'bedrooms')).toBe(0);
      expect(stored()?.selectedServices).toEqual([{ serviceId: '11', quantity: 3 }, { serviceId: '12', quantity: 2 }]);

      afterHydration(fixture);

      expect(quantity(hero, 'bedrooms')).toBe(3);
      expect(quantity(hero, 'bathrooms')).toBe(2);
      expect(heroCookie()).toBe('1.1.n.-.11-3_12-2');
    });

    it('no cookie yet, storage holds another type: switches to it after hydration', () => {
      saveStorage({ selectedServiceTypeId: '2', selectedServices: [{ serviceId: '21', quantity: 5 }] });
      writeHeroChoiceCookie(document, null);
      const { fixture, hero } = create('browser', { transfer: true });
      expect(hero.selectedServiceType?.id).toBe(1);

      afterHydration(fixture);

      expect(hero.selectedServiceType?.id).toBe(2);
      expect(quantity(hero, 'hours')).toBe(5);
    });

    it('saved type no longer offered: falls back to the default form, not an empty card', () => {
      saveStorage({ selectedServiceTypeId: '99', selectedServices: [{ serviceId: '11', quantity: 4 }] });
      const { fixture, hero } = create('browser', { transfer: true });

      afterHydration(fixture);

      expect(hero.selectedServiceType?.id).toBe(1);
      // The quantities belonged to the missing type and are not applied.
      expect(quantity(hero, 'bedrooms')).toBe(0);
      expect(stored()?.selectedServiceTypeId).toBe('1');
    });
  });

  describe('list loaded over the network (SSR fallback, or no server render)', () => {
    it('restores at once - there is no server DOM to match', () => {
      saveStorage({ selectedServiceTypeId: '2', selectedServices: [{ serviceId: '21', quantity: 5 }] });
      const { hero, http } = create('browser');
      serviceTypesRequest(http).flush(TYPES);

      expect(hero.selectedServiceType?.id).toBe(2);
      expect(quantity(hero, 'hours')).toBe(5);
    });

    it('takes the cookie when this tab\'s storage is empty', () => {
      writeHeroChoiceCookie(document, OFFICE_CHOICE);
      const { hero, http } = create('browser');
      serviceTypesRequest(http).flush(TYPES);

      expect(hero.selectedServiceType?.id).toBe(2);
      expect(quantity(hero, 'hours')).toBe(5);
      expect(stored()?.selectedServiceTypeId).toBe('2');
    });
  });
});

/** The copy of the catalogue the hero ships inside the server HTML. */
describe('trimServiceTypesForHero', () => {
  const sqft = {
    id: 3, name: 'Square Feet', serviceKey: 'sqft', cost: 0.05, timeDuration: 1, serviceTypeId: 1,
    inputType: 'slider', minValue: 400, maxValue: 5000, stepValue: 100, isRangeInput: true, unit: 'sq ft',
    serviceRelationType: null, isActive: true, displayOrder: 3, chargeAboveThreshold: true,
    zeroQuantityCost: null, zeroQuantityDuration: null,
    thresholds: [{ id: 1, serviceId: 3, sourceServiceId: 1, sourceServiceKey: 'bedrooms', sourceServiceName: 'Bedrooms', sourceQuantity: 0, includedQuantity: 400 },
                 { id: 2, serviceId: 3, sourceServiceId: 1, sourceServiceKey: 'bedrooms', sourceServiceName: 'Bedrooms', sourceQuantity: 2, includedQuantity: 850 }],
    rateTiers: [{ id: 1, serviceId: 3, fromQuantity: 0, cost: 0.05, timeDuration: 1, displayOrder: 1 },
                { id: 2, serviceId: 3, fromQuantity: 1000, cost: 0.03, timeDuration: 1, displayOrder: 2 }]
  } as any;
  const bedrooms = {
    id: 1, name: 'Bedrooms', serviceKey: 'bedrooms', cost: 22.5, timeDuration: 30, serviceTypeId: 1,
    inputType: 'dropdown', minValue: 0, maxValue: 6, stepValue: 1, isRangeInput: false, isActive: true,
    displayOrder: 1, chargeAboveThreshold: false, zeroQuantityCost: 0, zeroQuantityDuration: 0, thresholds: [], rateTiers: []
  } as any;
  const deep = {
    id: 50, name: 'Deep Cleaning', description: 'A long description '.repeat(20), price: 90, duration: 120, icon: 'fa-star',
    hasQuantity: false, hasHours: false, isDeepCleaning: true, isSuperDeepCleaning: false, isSameDayService: false,
    priceMultiplier: 1.5, isAvailableForAll: false, isActive: true, displayOrder: 1
  } as any;
  const oven = { ...deep, id: 51, name: 'Oven', isDeepCleaning: false, priceMultiplier: 1, price: 35 };
  const residential = {
    id: 1, name: 'Residential Cleaning', description: 'Type description', basePrice: 90, timeDuration: 120,
    minimumPrice: 130, displayOrder: 1, isActive: true, hasPoll: false, isCustom: false, collectsPropertyType: true,
    services: [bedrooms, sqft], extraServices: [deep, oven]
  } as any;
  const poll = { ...residential, id: 5, name: 'Filthy Cleaning', hasPoll: true };
  const custom = { ...residential, id: 7, name: 'Pre-arranged Cleaning', isCustom: true };

  it('keeps only the types the hero offers, the deep-cleaning extra, and no descriptions or icons', () => {
    const trimmed = trimServiceTypesForHero([residential, poll, custom]);

    expect(trimmed.map(t => t.id)).toEqual([1]);
    expect(trimmed[0].extraServices.map(e => e.id)).toEqual([50]);
    expect(JSON.stringify(trimmed)).not.toContain('description');
    expect(JSON.stringify(trimmed)).not.toContain('fa-star');
    expect(trimmed[0].services[1].thresholds).toEqual(sqft.thresholds);
    expect(trimmed[0].services[1].rateTiers).toEqual(sqft.rateTiers);
  });

  it('prices exactly like the full catalogue, regular and deep, at defaults and above them', () => {
    const estimate = (types: any[], cleaningType: 'normal' | 'deep', bedroomsQty: number, sqftQty: number) => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [...testProviders], imports: [HomeHeroComponent] });
      const hero = TestBed.createComponent(HomeHeroComponent).componentInstance;
      hero.selectedServiceType = types[0];
      hero.selectedServices = [{ service: types[0].services[0], quantity: bedroomsQty }, { service: types[0].services[1], quantity: sqftQty }];
      hero.cleaningTypeControl.setValue(cleaningType);
      return [(hero as any).buildEstimateQuoteInput(cleaningType, true), (hero as any).buildEstimateQuoteInput(cleaningType, false)]
        .map((input: any) => JSON.stringify(input));
    };
    const trimmed = trimServiceTypesForHero([residential]);
    for (const cleaningType of ['normal', 'deep'] as const) {
      expect(estimate(trimmed, cleaningType, 3, 2400)).toEqual(estimate([residential], cleaningType, 3, 2400));
    }
  });
});

/**
 * THE WELCOME COUPON IS IN THE FIRST PAINT (2026-10).
 *
 * It used to come from a browser-only request (/api/special-offers is on the SSR skip list), so
 * it popped in after hydration. The server now renders it from server.ts's in-memory copy of the
 * public offers (SSR_CATALOGUE.publicOffers) and hands it over in TransferState. Since the second
 * release it is shown to EVERYONE (only an inactive/deleted offer hides it), so no user data or
 * layout hint is involved, and only the percentage may arrive late, into reserved space.
 */
describe('HomeHeroComponent welcome coupon', () => {
  const OFFERS = [
    { id: 1, name: 'First Time Customer', description: '', isPercentage: true, discountValue: 10, type: 'FirstTime',
      requiresFirstTimeCustomer: true, offerKey: 'first-time' },
    { id: 9, name: 'Women Day', description: '', isPercentage: true, discountValue: 25, type: 'Custom',
      requiresFirstTimeCustomer: false, offerKey: null }
  ] as any[];
  const TYPES = [{ id: 1, name: 'Residential Cleaning', basePrice: 90, timeDuration: 120, isActive: true, hasPoll: false,
    isCustom: false, displayOrder: 1, services: [], extraServices: [] }] as any[];

  let auth: { isInitialized$: BehaviorSubject<boolean>; currentUser: BehaviorSubject<any> };

  function create(platform: 'browser' | 'server',
                  opts: { requestCookies?: string; transferOffers?: any[]; serverOffers?: any[] | null } = {}) {
    const ssrContext: SsrResponseContext = { statusCode: null, requestCookies: opts.requestCookies ?? null };
    auth = { isInitialized$: new BehaviorSubject(false), currentUser: new BehaviorSubject<any>(null) };
    TestBed.configureTestingModule({
      providers: [
        ...testProviders,
        { provide: PLATFORM_ID, useValue: platform },
        { provide: AuthService, useValue: { ...auth, currentUserValue: null, isLoggedIn: () => false } },
        ...(platform === 'server' ? [
          { provide: SSR_RESPONSE_CONTEXT, useValue: ssrContext },
          // serverOffers: null = the server had no copy of the offers (its cache failed).
          { provide: SSR_CATALOGUE, useValue: { serviceTypes: TYPES, prices: {},
            publicOffers: opts.serverOffers === null ? undefined : (opts.serverOffers ?? OFFERS) } }
        ] : [])
      ],
      imports: [HomeHeroComponent]
    });
    if (opts.transferOffers) TestBed.inject(TransferState).set(HERO_OFFERS_KEY, opts.transferOffers);
    const fixture = TestBed.createComponent(HomeHeroComponent);
    fixture.componentRef.changeDetectorRef.detectChanges();
    return { fixture, http: TestBed.inject(HttpTestingController), ssrContext };
  }
  const coupon = (fixture: ComponentFixture<HomeHeroComponent>) =>
    (fixture.nativeElement as HTMLElement).querySelector('.hero-offer-coupon');
  /** Hydration done (afterNextRender), then auth resolves with `user`. */
  async function resolveAuth(fixture: ComponentFixture<HomeHeroComponent>, user: any) {
    fixture.detectChanges();
    TestBed.inject(ApplicationRef).tick();
    await Promise.resolve();
    auth.currentUser.next(user);
    auth.isInitialized$.next(true);
    fixture.detectChanges();
  }

  afterEach(() => {
    writeUiHintCookie(document, ANONYMOUS_UI_HINT);
    (HomeHeroComponent as any).lastOffers = null;
    (HomeHeroComponent as any).lastServiceTypes = null;
  });

  const text = (fixture: ComponentFixture<HomeHeroComponent>, cls: string) =>
    coupon(fixture)?.querySelector('.hero-offer-coupon__' + cls)?.textContent?.trim() ?? null;
  /** Everything about the coupon except the number is there: frame, icon, both lines, "OFF". */
  function expectWholeCoupon(fixture: ComponentFixture<HomeHeroComponent>, percent: string) {
    expect(coupon(fixture)).not.toBeNull();
    expect(coupon(fixture)!.querySelector('.hero-offer-coupon__icon')).not.toBeNull();
    expect(text(fixture, 'eyebrow')).toBe('Welcome Offer');
    expect(text(fixture, 'headline')).toBe('First cleaning');
    expect(text(fixture, 'off')).toBe('OFF');
    // The percentage's slot exists even while empty (its height is reserved in CSS).
    expect(text(fixture, 'percent')).toBe(percent);
  }

  describe('on the server', () => {
    it('renders it whole for an anonymous visitor and ships only the advertised offer', () => {
      const { fixture, http, ssrContext } = create('server');
      expectWholeCoupon(fixture, '10%');
      expect(TestBed.inject(TransferState).get(HERO_OFFERS_KEY, null)).toEqual([OFFERS[0]]);
      http.expectNone(r => r.url.includes('special-offers'));
      expect(ssrContext.renderedFromCookie).toBeFalsy();
    });

    // Owner's rule (2026-10): everyone sees it, including a customer who already used the offer.
    ['dc_ui=u', 'dc_ui=ua', 'dc_ui=un', 'dc_ui=ub', 'dc_ui=ufb', 'x=1; dc_ui=uab'].forEach(cookie => {
      it(`renders it whole for every signed-in visitor too (${cookie})`, () => {
        const { fixture } = create('server', { requestCookies: cookie });
        expectWholeCoupon(fixture, '10%');
      });
    });

    it('draws it whole with the percentage left blank when the server has no copy of the offers', () => {
      const { fixture, http } = create('server', { serverOffers: null });
      expectWholeCoupon(fixture, '');
      expect(TestBed.inject(TransferState).hasKey(HERO_OFFERS_KEY)).toBe(false);
      http.expectNone(r => r.url.includes('special-offers'));
    });

    it('leaves it out for everyone when the offer is inactive or deleted in admin', () => {
      const { fixture } = create('server', { serverOffers: [OFFERS[1]] });
      expect(coupon(fixture)).toBeNull();
    });
  });

  describe('hydrating in the browser', () => {
    it('draws it on the first render from TransferState, with no request, and keeps it whoever signs in', async () => {
      writeUiHintCookie(document, { signedIn: true, admin: false, pointsBadge: true });
      const { fixture, http } = create('browser', { transferOffers: [OFFERS[0]] });
      expectWholeCoupon(fixture, '10%');
      http.expectNone(r => r.url.includes('special-offers'));

      // A customer who has already booked: it no longer goes away.
      await resolveAuth(fixture, { firstTimeOrder: false });
      expectWholeCoupon(fixture, '10%');
    });

    it('fills only the percentage when the offers arrive after the first render', () => {
      const { fixture, http } = create('browser');
      expectWholeCoupon(fixture, '');
      const before = coupon(fixture);

      http.expectOne(r => r.url.includes('special-offers')).flush(OFFERS);
      fixture.detectChanges();

      expectWholeCoupon(fixture, '10%');
      expect(coupon(fixture)).toBe(before); // the same element - nothing was re-created
    });

    it('takes it away only when the fetched offers say the offer is gone', () => {
      const { fixture, http } = create('browser');
      http.expectOne(r => r.url.includes('special-offers')).flush([OFFERS[1]]);
      fixture.detectChanges();
      expect(coupon(fixture)).toBeNull();
    });
  });
});
