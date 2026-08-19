import { ComponentFixture, TestBed } from '@angular/core/testing';

import { HomeHeroComponent } from './home-hero.component';

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
      expect(component.isLevelsService(levels)).toBeTrue();
      expect(component.isLevelsService(bedrooms)).toBeFalse();
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

      expect(component.canSelectDeepCleaning).toBeTrue();
      expect(component.showPropertyTypeSelector()).toBeFalse();
    });

    it('fills the otherwise-empty slot on a non-Residential type', () => {
      component.selectedServiceType = moveInOut;

      expect(component.canSelectDeepCleaning).toBeFalse();
      expect(component.showPropertyTypeSelector()).toBeTrue();
    });

    it('stays hidden on a quote-request type, via the shared exclusion rule', () => {
      component.selectedServiceType = pollType;

      expect(component.showPropertyTypeSelector()).toBeFalse();
    });

    it('stays hidden on a type an admin switched off', () => {
      // Office Cleaning is the shipped example. The flag exists because Office and Heavy
      // Conditional are structurally identical, so nothing else can tell them apart.
      component.selectedServiceType = { ...moveInOut, collectsPropertyType: false } as any;

      expect(component.showPropertyTypeSelector()).toBeFalse();
    });

    it('treats an ABSENT flag as true, so a stale payload never hides it everywhere', () => {
      const noFlag = { ...moveInOut } as any;
      delete noFlag.collectsPropertyType;
      component.selectedServiceType = noFlag;

      expect(component.showPropertyTypeSelector()).toBeTrue();
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
});
