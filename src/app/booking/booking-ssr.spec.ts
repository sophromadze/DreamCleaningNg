import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ApplicationRef, PLATFORM_ID, TransferState } from '@angular/core';
import { HttpTestingController } from '@angular/common/http/testing';

import { BookingComponent } from './booking.component';
import { BOOKING_INITIAL_STATE_KEY, BookingInitialState, addDaysToIsoDate, newYorkToday } from './booking-initial-state';
import { testProviders } from '../../testing/test-providers';
import { SSR_RESPONSE_CONTEXT, SsrResponseContext } from '../shared/ssr/ssr-response.token';
import { SSR_CATALOGUE, SsrCatalogue } from '../shared/ssr/ssr-catalogue.token';
import { SSR_BOOKING_SESSION, SsrBookingSession } from '../shared/ssr/ssr-booking-session.token';
import { BOOKING_CHOICE_COOKIE, writeBookingChoiceCookie } from '../shared/booking/booking-choice-cookie';
import { readCookie } from '../shared/ssr/read-cookie';
import { BookingCatalogueStore } from '../services/booking-catalogue-store.service';
import { NO_MARKETING_PRICES } from '../shared/pricing/marketing-prices';

/**
 * Step 1 of /booking is drawn on the SERVER (catalogue, plans and blocked slots from server.ts's
 * memory, the visitor's booking-choice cookie, their session) and the hydrating browser draws
 * exactly the same thing from TransferState before it reads anything of its own - so nothing
 * moves, nothing is fetched twice, and no NG05xx mismatch is possible.
 */
describe('BookingComponent server render and hydration', () => {
  const bedrooms = { id: 11, name: 'Bedrooms', serviceKey: 'bedrooms', inputType: 'dropdown', isActive: true, cost: 20, timeDuration: 30, minValue: 0, maxValue: 6, displayOrder: 1, thresholds: [], rateTiers: [] };
  const bathrooms = { id: 12, name: 'Bathrooms', serviceKey: 'bathrooms', inputType: 'dropdown', isActive: true, cost: 20, timeDuration: 30, minValue: 1, maxValue: 6, displayOrder: 2, thresholds: [], rateTiers: [] };
  const hours = { id: 21, name: 'Hours', serviceKey: 'hours', inputType: 'dropdown', isActive: true, cost: 40, timeDuration: 60, minValue: 2, maxValue: 8, displayOrder: 1, thresholds: [], rateTiers: [] };
  const deep = { id: 50, name: 'Deep Cleaning', extraServiceKey: 'deep-cleaning', isDeepCleaning: true, priceMultiplier: 1.5, price: 0, duration: 0, isActive: true, displayOrder: 1 };
  const oven = { id: 28, name: 'Oven', extraServiceKey: 'oven', price: 30, duration: 30, hasQuantity: false, isActive: true, displayOrder: 2 };
  const cabinet = { id: 27, name: 'Cabinet', extraServiceKey: null, price: 25, duration: 20, hasQuantity: false, isActive: true, displayOrder: 3 };
  const catalogue = () => JSON.parse(JSON.stringify([
    { id: 1, name: 'Residential Cleaning', serviceKey: 'residential', basePrice: 90, timeDuration: 120, minimumPrice: 0, isActive: true, hasPoll: false, isCustom: false, displayOrder: 1,
      collectsPropertyType: false, services: [bedrooms, bathrooms], extraServices: [deep, oven, cabinet] },
    { id: 2, name: 'Office Cleaning', serviceKey: 'office', basePrice: 100, timeDuration: 120, minimumPrice: 0, isActive: true, hasPoll: false, isCustom: false, displayOrder: 2,
      collectsPropertyType: false, services: [hours], extraServices: [oven] }
  ]));
  const plans = () => [
    { id: 1, name: 'One Time', discountPercentage: 0, subscriptionDays: 0, displayOrder: 1 },
    { id: 3, name: 'Bi-Weekly', discountPercentage: 10, subscriptionDays: 14, displayOrder: 2 }
  ] as any[];
  const OFFER = { id: 7, name: 'Welcome 10%', description: 'First cleaning', isPercentage: true, discountValue: 10, icon: null, badgeColor: null, minimumOrderAmount: null };
  const later = addDaysToIsoDate(newYorkToday(), 5);
  const OFFICE_COOKIE = `${BOOKING_CHOICE_COOKIE}=2.office.n.h..hours~4.oven~1~0.14.${later.replace(/-/g, '')}.1030.1500.`;
  const SESSION: SsrBookingSession = {
    user: { id: 71, firstName: 'Nate', lastName: 'R', email: 'nate@example.invalid', phone: '7185550199', role: 'Customer', firstTimeOrder: false },
    loyaltyDiscountPercentage: 0,
    specialOffers: [{ id: 91, specialOfferId: 5, name: 'Loyal customer', isPercentage: true, discountValue: 5, isUsed: false }],
    subscription: { hasSubscription: false, preferredSubscriptionId: null },
    points: { pointsSystemEnabled: true, currentPoints: 260, guide: { pointsPerDollar: 1 }, availableRedemptions: [] },
    hasPreviousOrders: true,
    canRegisterCustomers: false
  };
  const STORAGE_KEY = 'booking_form_data';
  const BOOKING_DATA = /\/booking\/(service-types|subscriptions|blocked-time-slots)|special-offers|\/profile|\/order\b|bubble-points\/summary|user-subscription/;

  function serverRender(cookie: string | null, session: SsrBookingSession | null = null, offers: any[] | null = [OFFER]) {
    const ssrContext: SsrResponseContext = { statusCode: null, requestCookies: cookie };
    const ssrCatalogue: SsrCatalogue = {
      serviceTypes: catalogue(), prices: NO_MARKETING_PRICES, publicOffers: offers, subscriptions: plans(), blockedTimeSlots: []
    };
    TestBed.configureTestingModule({
      providers: [
        ...testProviders,
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: SSR_RESPONSE_CONTEXT, useValue: ssrContext },
        { provide: SSR_CATALOGUE, useValue: ssrCatalogue },
        { provide: SSR_BOOKING_SESSION, useValue: session }
      ],
      imports: [BookingComponent]
    });
    const fixture = TestBed.createComponent(BookingComponent);
    fixture.componentRef.changeDetectorRef.detectChanges();
    return { fixture, page: fixture.componentInstance, state: TestBed.inject(TransferState).get(BOOKING_INITIAL_STATE_KEY, null)! };
  }

  function hydrate(state: BookingInitialState) {
    TestBed.configureTestingModule({ providers: [...testProviders], imports: [BookingComponent] });
    TestBed.inject(TransferState).set(BOOKING_INITIAL_STATE_KEY, JSON.parse(JSON.stringify(state)));
    const fixture = TestBed.createComponent(BookingComponent);
    // The first render only: what hydration draws over the server's HTML.
    fixture.componentRef.changeDetectorRef.detectChanges();
    return { fixture, page: fixture.componentInstance, http: TestBed.inject(HttpTestingController) };
  }
  /** The render after hydration, when afterNextRender callbacks run. */
  const afterHydration = (fixture: ComponentFixture<BookingComponent>) => {
    fixture.detectChanges();
    TestBed.inject(ApplicationRef).tick();
  };
  const text = (fixture: ComponentFixture<BookingComponent>) => (fixture.nativeElement as HTMLElement).textContent!.replace(/\s+/g, ' ');
  const stored = () => JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
  const choiceCookie = () => readCookie(document.cookie, BOOKING_CHOICE_COOKIE);

  beforeEach(() => {
    sessionStorage.clear();
    writeBookingChoiceCookie(document, null);
  });
  afterEach(() => {
    sessionStorage.clear();
    writeBookingChoiceCookie(document, null);
  });

  describe('on the server', () => {
    it('draws a first-time visitor\'s step 1 whole: default type, prices, tomorrow in New York, no placeholder', () => {
      const { fixture, page, state } = serverRender(null);

      expect(page.selectedServiceType()?.serviceKey).toBe('residential');
      expect(page.serviceDate.value).toBe(addDaysToIsoDate(newYorkToday(), 1));
      expect(page.serviceTime.value).toBe('08:00');
      expect(page.selectedSubscription()?.subscriptionDays).toBe(0);
      expect(page.calculation().total).toBeGreaterThan(0);
      expect(text(fixture)).toContain(`$${page.calculation().total.toFixed(2)}`);
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelectorAll('.shimmer-loading').length).toBe(0);
      expect(el.querySelector('.services-shimmer-single')).toBeNull();
      expect(state.choice).toBeNull();
      expect(stored()).toBeNull();
    });

    it('draws a returning visitor\'s choice from the cookie, by key: type, quantities, extras, plan, date, time, tips', () => {
      const { page, state } = serverRender(`a=1; ${OFFICE_COOKIE}; b=2`);

      expect(page.selectedServiceType()?.serviceKey).toBe('office');
      expect(page.selectedServices().find(s => s.service.serviceKey === 'hours')?.quantity).toBe(4);
      expect(page.selectedExtraServices().map(e => e.extraService.extraServiceKey)).toEqual(['oven']);
      expect(page.selectedSubscription()?.subscriptionDays).toBe(14);
      expect(page.serviceDate.value).toBe(later);
      expect(page.serviceTime.value).toBe('10:30');
      expect(page.tipsAmount).toBe(15);
      expect(state.choice?.selectedServiceTypeId).toBe('2');
    });

    it('falls back to the default form for a stale or invalid cookie, never an error', () => {
      for (const cookie of [`${BOOKING_CHOICE_COOKIE}=garbage`, `${BOOKING_CHOICE_COOKIE}=2.gone.n.........`, 'dc_hero_choice=1.2.n.-.21-5']) {
        TestBed.resetTestingModule();
        const { page } = serverRender(cookie);
        expect(page.selectedServiceType()?.serviceKey, cookie).toBe('residential');
      }
    });

    it('a past date in the cookie is replaced by tomorrow', () => {
      const { page } = serverRender(`${BOOKING_CHOICE_COOKIE}=2.office.n...hours~4...20200101.1030..`);

      expect(page.serviceDate.value).toBe(addDaysToIsoDate(newYorkToday(), 1));
    });

    it('picks the guest\'s Special Discount card once, on the server, and ships it', () => {
      const { fixture, state } = serverRender(null);

      expect(state.guestOffer).toEqual(OFFER);
      expect(text(fixture)).toContain('Welcome 10%');
    });

    it('draws a signed-in visitor from their session: their offers and the Reorder button', () => {
      const { fixture, page, state } = serverRender(null, SESSION);

      expect(text(fixture)).toContain('Loyal customer');
      expect(text(fixture)).not.toContain('Welcome 10%');
      expect(page.showReorderButton()).toBe(true);
      expect(state.session?.user.id).toBe(71);
      expect(state.guestOffer).toBeUndefined();
    });

    it('never mutates server.ts\'s shared catalogue copy', () => {
      const shared = catalogue().reverse();
      const before = JSON.stringify(shared);
      TestBed.configureTestingModule({
        providers: [...testProviders, { provide: PLATFORM_ID, useValue: 'server' },
          { provide: SSR_CATALOGUE, useValue: { serviceTypes: shared, prices: NO_MARKETING_PRICES, subscriptions: plans().reverse(), blockedTimeSlots: [] } }],
        imports: [BookingComponent]
      });
      TestBed.createComponent(BookingComponent).componentRef.changeDetectorRef.detectChanges();

      expect(JSON.stringify(shared)).toBe(before);
    });
  });

  describe('hydrating in the browser', () => {
    let serverState: BookingInitialState;
    let serverHtml: string;
    beforeEach(() => {
      const server = serverRender(OFFICE_COOKIE);
      serverState = server.state;
      serverHtml = text(server.fixture);
      TestBed.resetTestingModule();
    });

    it('the first render IS the server\'s: same form, same total, no request for booking data, nothing written', () => {
      // Its own storage disagrees on purpose: the first render follows the SERVER.
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ selectedServiceTypeId: '1', savedAt: Date.now() }));
      const { fixture, page, http } = hydrate(serverState);

      expect(page.selectedServiceType()?.serviceKey).toBe('office');
      expect(text(fixture)).toBe(serverHtml);
      expect(http.match(r => BOOKING_DATA.test(r.url))).toEqual([]);
      expect(stored().selectedServiceTypeId).toBe('1');
      expect(TestBed.inject(TransferState).hasKey(BOOKING_INITIAL_STATE_KEY)).toBe(false);
    });

    it('after hydration: personal fields come from this tab\'s storage, and storage + cookie follow the screen', () => {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        selectedServiceTypeId: '2', contactFirstName: 'Ana', contactEmail: 'ana@example.com', serviceAddress: '1 Main St', savedAt: Date.now()
      }));
      const { fixture, page, http } = hydrate(serverState);

      afterHydration(fixture);

      expect(page.selectedServiceType()?.serviceKey).toBe('office');
      expect(page.bookingForm.get('contactFirstName')?.value).toBe('Ana');
      expect(page.bookingForm.get('serviceAddress')?.value).toBe('1 Main St');
      expect(stored().contactFirstName).toBe('Ana');
      expect(stored().selectedServiceTypeKey).toBe('office');
      expect(choiceCookie()).toMatch(/^2\.office\.n\.\.\.hours~4\.oven~1~0\.14\./);
      expect(choiceCookie()).not.toMatch(/Ana|Main/);
      // Still nothing re-fetched that the server already drew.
      expect(http.match(r => /\/booking\/(service-types|subscriptions|blocked-time-slots)/.test(r.url))).toEqual([]);
    });

    it('an unkeyed extra cannot travel in the cookie: it comes back from storage after hydration', () => {
      const server = (TestBed.resetTestingModule(), serverRender(`${BOOKING_CHOICE_COOKIE}=2.residential.n...bedrooms~2_bathrooms~1.oven~1~0.....`));
      const state = server.state;
      TestBed.resetTestingModule();
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        selectedServiceTypeId: '1', selectedExtraServices: [{ extraServiceId: '28', quantity: 1, hours: 0 }, { extraServiceId: '27', quantity: 1, hours: 0 }], savedAt: Date.now()
      }));
      const { fixture, page } = hydrate(state);
      expect(page.selectedExtraServices().map(e => e.extraService.name)).toEqual(['Oven']);

      afterHydration(fixture);

      expect(page.selectedExtraServices().map(e => e.extraService.name)).toEqual(['Oven', 'Cabinet']);
    });

    it('no cookie yet, a draft in storage: drawn as the server drew it first, restored after hydration', () => {
      const server = (TestBed.resetTestingModule(), serverRender(null));
      const state = server.state;
      TestBed.resetTestingModule();
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        selectedServiceTypeId: '2', selectedServices: [{ serviceId: '21', quantity: 6 }], selectedSubscriptionId: '3', savedAt: Date.now()
      }));
      const { fixture, page } = hydrate(state);
      expect(page.selectedServiceType()?.serviceKey).toBe('residential');

      afterHydration(fixture);

      expect(page.selectedServiceType()?.serviceKey).toBe('office');
      expect(page.selectedServices().find(s => s.service.serviceKey === 'hours')?.quantity).toBe(6);
      expect(page.selectedSubscription()?.subscriptionDays).toBe(14);
      // From now on this visitor has the cookie too.
      expect(choiceCookie()).toMatch(/^2\.office\.n\.\.\.hours~6\./);
    });

    it('remembers the server\'s data for this tab, so a later in-app visit draws at once', () => {
      hydrate(serverState);
      const store = TestBed.inject(BookingCatalogueStore);

      expect(store.peek('serviceTypes')?.length).toBe(2);
      expect(store.isFresh('subscriptions')).toBe(true);
    });
  });

  describe('an in-app visit with an older per-tab copy', () => {
    it('draws the copy at once, but refuses to book until fresh data has replaced it', () => {
      TestBed.configureTestingModule({ providers: [...testProviders], imports: [BookingComponent] });
      const store = TestBed.inject(BookingCatalogueStore);
      store.remember('serviceTypes', catalogue());
      (store as any).parts.serviceTypes.at -= 10 * 60_000;
      const fixture = TestBed.createComponent(BookingComponent);
      const page = fixture.componentInstance;
      fixture.detectChanges();
      (page as any).loadPublicData();

      expect(page.selectedServiceType()?.serviceKey).toBe('residential');
      expect(page.catalogueFresh()).toBe(false);
      page.onSubmit();
      expect(page.errorMessage()).toContain('Updating prices');

      const http = TestBed.inject(HttpTestingController);
      http.match(r => r.url.endsWith('/booking/service-types')).forEach(r => r.flush(catalogue()));
      expect(page.catalogueFresh()).toBe(true);
    });
  });

  it('the hidden clear-all keeps working and deletes the booking-choice cookie', () => {
    TestBed.configureTestingModule({ providers: [...testProviders], imports: [BookingComponent] });
    const fixture = TestBed.createComponent(BookingComponent);
    fixture.detectChanges();
    TestBed.inject(BookingCatalogueStore);
    document.cookie = `${BOOKING_CHOICE_COOKIE}=2.office.n...hours~4......; Path=/`;
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    fixture.componentInstance.clearAllFormData();

    expect(choiceCookie()).toBeNull();
    expect(stored()).toBeNull();
  });
});
