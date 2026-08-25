import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { BookingComponent } from './booking.component';

import { testProviders } from '../../testing/test-providers';
import { BookingFormData, FormPersistenceService } from '../services/form-persistence.service';

describe('BookingComponent', () => {
  let component: BookingComponent;
  let fixture: ComponentFixture<BookingComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [...testProviders],
      imports: [BookingComponent]
    })
    .compileComponents();

    // A draft left behind by a previous spec would be picked up (and, if it carries the admin
    // marker, discarded) by this component's ngOnInit. Start every spec from an empty session.
    sessionStorage.clear();

    fixture = TestBed.createComponent(BookingComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  /**
   * Regression: an empty "Tips for Cleaners" box used to fail the $10-minimum validator
   * (the old check only whitelisted a literal 0, and a cleared number input yields null),
   * which invalidated the whole form and disabled Book Now with no way to recover. A hidden
   * "Tips for Company Development" control had the same validator and made it unfixable.
   */
  describe('tips never block the form', () => {
    const emptyValues: any[] = [null, undefined, '', NaN];

    for (const value of emptyValues) {
      it(`treats ${JSON.stringify(value) ?? String(value)} as no tip, not a validation error`, () => {
        component.tips.setValue(value);

        expect(component.tips.errors).toBeNull();
        expect(component.tipsAmount).toBe(0);
      });
    }

    it('still enforces the $10 minimum on a typed amount', () => {
      component.tips.setValue(5);

      expect(component.tips.errors?.['minTipAmount']).toBeTrue();
    });

    it('accepts a typed amount at or above the minimum', () => {
      component.tips.setValue(10);

      expect(component.tips.errors).toBeNull();
      expect(component.tipsAmount).toBe(10);
    });

    it('snaps a cleared box back to 0 on blur', () => {
      component.tips.setValue(null);

      component.normalizeTipsOnBlur();

      expect(component.tips.value).toBe(0);
    });

    it('has no company-development tip control left to invalidate the form', () => {
      expect(component.bookingForm.get('companyDevelopmentTips')).toBeNull();
    });
  });

  /**
   * Regression: picking an out-of-area address (Google Places returns e.g. "New Jersey") left
   * that state in the form. On reload the states subscription matched neither of its branches,
   * so the city list was never fetched and the City dropdown rendered with only its
   * placeholder — and because Places patches `state` programmatically, the picker's own
   * click handler never fired, so even re-entering a valid New York address could not bring
   * the boroughs back.
   */
  describe('city options follow the state control', () => {
    beforeEach(() => {
      // The wiring lives in setupFormListeners, which normally runs from afterNextRender.
      component['setupFormListeners']();
      component.states = ['New York'];
      component.cities = ['Manhattan', 'Brooklyn', 'Queens'];
    });

    it('drops the city list and any stale borough when an out-of-area state arrives', () => {
      component.city.setValue('Brooklyn');

      component.state.setValue('New Jersey');

      expect(component.cities).toEqual([]);
      expect(component.city.value).toBe('');
    });

    it('never queries cities for a state we do not serve', () => {
      // LocationService.getCities falls back to the three boroughs on error, so asking for an
      // unserved state could otherwise offer NYC boroughs for a New Jersey address.
      const loadCities = spyOn(component, 'loadCities');

      component.state.setValue('New Jersey');

      expect(loadCities).not.toHaveBeenCalled();
    });

    it('repopulates when a served state is set programmatically, not via the select', () => {
      component.state.setValue('New Jersey');
      const loadCities = spyOn(component, 'loadCities');

      component.state.setValue('New York');

      expect(loadCities).toHaveBeenCalledWith('New York');
    });
  });

  /**
   * Regression: changing the bedroom count reset Sq.ft to the new bedroom's included amount
   * unconditionally, throwing away a value the customer had deliberately chosen — 2 bedrooms
   * at 2650 sq.ft collapsed to 1000 the moment they picked a third bedroom.
   *
   * The unit-level rule is covered in shared/pricing/square-feet-linkage.spec.ts; these specs
   * pin the two things only the component can get wrong: reading the OUTGOING bedroom count
   * (the new quantity is written to selectedServices before the linkage runs, so computing the
   * old floor afterwards would make it equal the new one and silently invert the behaviour),
   * and applying the restore rule once per restore instead of once per service row.
   */
  describe('bedrooms → sq.ft linkage', () => {
    const BEDROOMS_ID = 101;
    const SQFT_ID = 102;

    /** Sq.ft allowances keyed off the bedrooms service: studio 400 / 1bd 650 / 2bd 850 / 3bd 1000 / 4bd 1500. */
    const sqftThresholds = [
      { sourceQuantity: 0, includedQuantity: 400 },
      { sourceQuantity: 1, includedQuantity: 650 },
      { sourceQuantity: 2, includedQuantity: 850 },
      { sourceQuantity: 3, includedQuantity: 1000 },
      { sourceQuantity: 4, includedQuantity: 1500 }
    ].map((t, i) => ({ id: i + 1, serviceId: SQFT_ID, sourceServiceId: BEDROOMS_ID, ...t }));

    const bedroomsService = {
      id: BEDROOMS_ID, name: 'Bedrooms', serviceKey: 'bedrooms', cost: 25, timeDuration: 30,
      serviceTypeId: 1, inputType: 'dropdown', isRangeInput: false, isActive: true,
      minValue: 0, maxValue: 10, stepValue: 1, displayOrder: 1
    } as any;

    const sqftService = {
      id: SQFT_ID, name: 'Square Feet', serviceKey: 'sqft', cost: 0.05, timeDuration: 0.05,
      serviceTypeId: 1, inputType: 'slider', isRangeInput: true, isActive: true,
      minValue: 400, maxValue: 5000, stepValue: 100, displayOrder: 3,
      chargeAboveThreshold: true, thresholds: sqftThresholds
    } as any;

    /** Seed the page with a bedrooms + sq.ft selection, as selectServiceType would. */
    function seedSelection(bedrooms: number, squareFeet: number) {
      component.selectedServices = [
        { service: bedroomsService, quantity: bedrooms },
        { service: sqftService, quantity: squareFeet }
      ] as any;
    }

    const currentSquareFeet = () =>
      component.selectedServices.find(s => s.service.serviceKey === 'sqft')!.quantity;

    describe('changing bedrooms', () => {
      it('preserves a sq.ft the customer raised above the floor', () => {
        seedSelection(2, 2650);

        component.updateServiceQuantity(bedroomsService, 3);

        expect(currentSquareFeet()).toBe(2650);
      });

      it('raises it only when the new floor overtakes it', () => {
        seedSelection(2, 950);

        component.updateServiceQuantity(bedroomsService, 3);

        expect(currentSquareFeet()).toBe(1000);
      });

      it('tracks the floor downward when sq.ft was sitting on the old floor', () => {
        seedSelection(3, 1000);

        component.updateServiceQuantity(bedroomsService, 2);

        expect(currentSquareFeet()).toBe(850);
      });

      it('keeps a chosen value when bedrooms go down', () => {
        seedSelection(3, 1200);

        component.updateServiceQuantity(bedroomsService, 2);

        expect(currentSquareFeet()).toBe(1200);
      });

      it('tracks the floor downward from 4bd to 3bd', () => {
        seedSelection(4, 1500);

        component.updateServiceQuantity(bedroomsService, 3);

        expect(currentSquareFeet()).toBe(1000);
      });

      it('tracks the floor upward out of studio', () => {
        seedSelection(0, 400);

        component.updateServiceQuantity(bedroomsService, 1);

        expect(currentSquareFeet()).toBe(650);
      });

      it('moves the slider minimum in the same change cycle', () => {
        seedSelection(2, 2650);

        component.updateServiceQuantity(bedroomsService, 3);

        // The slider is index-based over this list, so the option list IS the min.
        expect(component.getSquareFeetMinForBedrooms()).toBe(1000);
      });
    });

    /**
     * Reorder used to apply the bedrooms→sq.ft linkage inside the restore loop, so the result
     * depended on the order order.services happened to arrive in from the database: a sq.ft row
     * ahead of the bedrooms row had its value overwritten and never put back.
     */
    describe('reordering a past order', () => {
      function reorderWith(services: { serviceId: number; quantity: number }[]) {
        const serviceType = {
          id: 1, name: 'Residential Cleaning', basePrice: 100, isActive: true, hasPoll: false,
          timeDuration: 0, services: [bedroomsService, sqftService], extraServices: []
        } as any;
        component.serviceTypes = [serviceType];

        spyOn(component['orderService'], 'getOrderById').and.returnValue(of({
          id: 7, serviceTypeId: 1, services, extraServices: [],
          contactFirstName: '', contactLastName: '', contactEmail: '', contactPhone: '',
          serviceAddress: '', aptSuite: '', city: '', state: '', zipCode: '',
          entryMethod: '', specialInstructions: '', tips: 0
        } as any));

        component.selectOrderToReorder(7);
      }

      it('keeps the ordered sq.ft when bedrooms come first', () => {
        reorderWith([
          { serviceId: BEDROOMS_ID, quantity: 2 },
          { serviceId: SQFT_ID, quantity: 2650 }
        ]);

        expect(currentSquareFeet()).toBe(2650);
      });

      it('keeps the ordered sq.ft when sq.ft comes first', () => {
        reorderWith([
          { serviceId: SQFT_ID, quantity: 2650 },
          { serviceId: BEDROOMS_ID, quantity: 2 }
        ]);

        expect(currentSquareFeet()).toBe(2650);
      });

      it('lifts an ordered sq.ft that now sits below its allowance', () => {
        // Restores floor but never lower — e.g. the allowance grew after the order was placed.
        reorderWith([
          { serviceId: SQFT_ID, quantity: 500 },
          { serviceId: BEDROOMS_ID, quantity: 2 }
        ]);

        expect(currentSquareFeet()).toBe(850);
      });
    });
  });

  describe('discounts are dropped when the order owner changes', () => {
    /** Put the page in "every kind of discount is applied" state. */
    function applyEveryDiscount() {
      component.selectedSpecialOffer = {
        id: 11,
        specialOfferId: 3,
        name: 'First Time Customer',
        description: '10% off',
        isPercentage: true,
        discountValue: 10,
        isUsed: false
      } as any;
      component.specialOfferApplied = true;
      component.firstTimeDiscountApplied = true;
      component.promoCodeApplied = true;
      component.promoDiscount = 25;
      component.giftCardApplied = true;
      component.isGiftCard = true;
      component.giftCardBalance = 100;
      component.giftCardAmountToUse = 40;
      component.selectedPointsToRedeem = 500;
      component.pointsDiscountAmount = 5;
      component.useCredits = true;
      component.promoCode.setValue('SAVE25');
    }

    function expectNoDiscountsApplied() {
      expect(component.selectedSpecialOffer).toBeNull();
      expect(component.specialOfferApplied).toBeFalse();
      expect(component.firstTimeDiscountApplied).toBeFalse();
      expect(component.promoCodeApplied).toBeFalse();
      expect(component.promoDiscount).toBe(0);
      expect(component.giftCardApplied).toBeFalse();
      expect(component.isGiftCard).toBeFalse();
      expect(component.giftCardAmountToUse).toBe(0);
      expect(component.selectedPointsToRedeem).toBe(0);
      expect(component.pointsDiscountAmount).toBe(0);
      expect(component.useCredits).toBeFalse();
      expect(component.promoCode.value).toBe('');
      // The promo input is disabled while a special offer is applied — it must come back.
      expect(component.promoCode.disabled).toBeFalse();
    }

    it('clears them when admin mode is toggled on', () => {
      applyEveryDiscount();

      component.toggleAdminMode();

      expect(component.isAdminMode).toBeTrue();
      expectNoDiscountsApplied();
      expect(component.discountsClearedForAccountSwitch).toBeTrue();
    });

    it('clears them when a target user is picked in admin mode', () => {
      component.isAdminMode = true;
      applyEveryDiscount();

      component.selectUser({ id: 42, firstName: 'Ann', lastName: 'Lee', email: 'ann@example.com' } as any);

      expect(component.selectedTargetUser?.id).toBe(42);
      expectNoDiscountsApplied();
      expect(component.discountsClearedForAccountSwitch).toBeTrue();
    });

    it('clears them when the target user selection is cleared', () => {
      component.isAdminMode = true;
      component.selectedTargetUser = { id: 42, firstName: 'Ann', lastName: 'Lee', email: 'ann@example.com' } as any;
      applyEveryDiscount();

      component.clearSelectedUser();

      expect(component.selectedTargetUser).toBeNull();
      expectNoDiscountsApplied();
      expect(component.discountsClearedForAccountSwitch).toBeTrue();
    });

    it('does not show the re-apply notice when nothing was applied', () => {
      component.toggleAdminMode();

      expect(component.discountsClearedForAccountSwitch).toBeFalse();
    });
  });

  /**
   * Extras on a Custom Pricing ("Pre-Arranged") service type are INFORMATIONAL: they are
   * recorded for the admin panel and the cleaner's job email at $0 / 0 min, and must never
   * move the summary. Two regressions this pins:
   *   - the quote input was gated on `showCustomPricing && customAmount.value`, so an empty
   *     Total Amount fell through to the ordinary path and charged for the selections;
   *   - Deep / Super Deep briefly appeared as cards here, but they are a cleaning TYPE.
   */
  describe('custom pricing extras are informational', () => {
    const customServiceType = {
      id: 9, name: 'Pre-Arranged Cleaning', basePrice: 150, timeDuration: 60,
      isCustom: true, isActive: true, services: [], extraServices: []
    } as any;

    const extra = (id: number, name: string, overrides: any = {}) => ({
      id, name, price: 40, duration: 45, priceMultiplier: 1,
      isDeepCleaning: false, isSuperDeepCleaning: false, isSameDayService: false,
      hasQuantity: false, hasHours: false, isActive: true, displayOrder: id,
      ...overrides
    }) as any;

    const fridge = extra(1, 'Inside the Fridge');
    const deep = extra(2, 'Deep Cleaning', { isDeepCleaning: true, priceMultiplier: 1.5 });
    const sameDay = extra(3, 'Same Day Service', { isSameDayService: true });
    const extraCleaners = extra(4, 'Extra Cleaners', { hasQuantity: true });

    beforeEach(() => {
      component.selectedServiceType = { ...customServiceType, extraServices: [fridge, deep, sameDay, extraCleaners] };
      component.showCustomPricing = true;
      component.selectedServices = [];
      component.selectedExtraServices = [{ extraService: fridge, quantity: 1, hours: 0 }] as any;
      component.customCleaners.setValue(2);
      component.customDuration.setValue(240);
    });

    it('keeps the summary at zero when no amount has been entered', () => {
      component.customAmount.setValue('');

      component.calculateTotal();

      expect(component.calculation.subTotal).toBe(0);
      expect(component.calculation.tax).toBe(0);
      expect(component.calculation.total).toBe(0);
    });

    it('charges exactly the entered amount, extras included', () => {
      component.customAmount.setValue('300');

      component.calculateTotal();

      expect(component.calculation.subTotal + component.calculation.tax).toBe(300);

      // Same amount with no extras selected — the extras contributed nothing.
      const withExtras = component.calculation.subTotal;
      component.selectedExtraServices = [];
      component.calculateTotal();
      expect(component.calculation.subTotal).toBe(withExtras);
    });

    it('reports the entered duration, not the extras durations', () => {
      component.customAmount.setValue('300');

      component.calculateTotal();

      // 2 cleaners x 240 min, with the 45-min extra adding nothing.
      expect(component.actualTotalDuration).toBe(480);
    });

    it('offers ordinary extras but not the cleaning type, same-day or cleaner-count cards', () => {
      const offered = component.getFilteredExtraServices().map(e => e.name);

      expect(offered).toEqual(['Inside the Fridge']);
    });
  });

  /**
   * Property type (apartment vs house) and levels.
   *
   * The rule the whole feature rests on: a house is not inherently more expensive than an
   * apartment of the same size. Stairs are. So a one-level house must cost exactly what the
   * equivalent apartment costs, and the price driver is the level count alone.
   */
  describe('property type and levels', () => {
    const bedrooms = {
      id: 1, name: 'Bedrooms', serviceKey: 'bedrooms', cost: 22.5, timeDuration: 30,
      serviceTypeId: 1, inputType: 'dropdown', isRangeInput: false, isActive: true,
      minValue: 0, maxValue: 6, stepValue: 1, displayOrder: 1,
      zeroQuantityCost: 0, zeroQuantityDuration: 0,
      chargeAboveThreshold: false, thresholds: [], rateTiers: []
    } as any;

    const sqft = {
      id: 3, name: 'Square Feet', serviceKey: 'sqft', cost: 0.18, timeDuration: 0.24,
      serviceTypeId: 1, inputType: 'slider', isRangeInput: true, isActive: true,
      minValue: 400, maxValue: 5000, stepValue: 100, displayOrder: 3,
      chargeAboveThreshold: true,
      thresholds: [
        { id: 1, serviceId: 3, sourceServiceId: 1, sourceQuantity: 0, includedQuantity: 400 },
        { id: 2, serviceId: 3, sourceServiceId: 1, sourceQuantity: 1, includedQuantity: 650 },
        { id: 3, serviceId: 3, sourceServiceId: 1, sourceQuantity: 2, includedQuantity: 850 }
      ],
      rateTiers: [{ id: 1, serviceId: 3, fromQuantity: 0, cost: 0.18, timeDuration: 0.24, displayOrder: 1 }]
    } as any;

    // Seeded exactly as the migration does: chargeAboveThreshold with ONE self-referencing
    // threshold row, and both zero-quantity columns left null.
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
      services: [bedrooms, sqft, levels], extraServices: []
    } as any;

    /**
     * Hourly type: cleaners x hours, no bedrooms service. Property type IS still asked here;
     * levels are NOT, because stair time is already inside the hours the customer buys.
     */
    const cleaners = {
      id: 5, name: 'Cleaners', serviceKey: 'cleaners', cost: 40, timeDuration: 0,
      serviceTypeId: 2, inputType: 'dropdown', isRangeInput: false, isActive: true,
      serviceRelationType: 'cleaner', minValue: 1, maxValue: 10,
      chargeAboveThreshold: false, thresholds: [], rateTiers: []
    } as any;

    const hours = {
      id: 6, name: 'Hours', serviceKey: 'hours', cost: 0, timeDuration: 60,
      serviceTypeId: 2, inputType: 'dropdown', isRangeInput: false, isActive: true,
      serviceRelationType: 'hours', minValue: 2, maxValue: 8,
      chargeAboveThreshold: false, thresholds: [], rateTiers: []
    } as any;

    const office = {
      id: 2, name: 'Office Cleaning', basePrice: 200, timeDuration: 120, minimumPrice: 0,
      isActive: true, hasPoll: false, isCustom: false,
      services: [cleaners, hours], extraServices: []
    } as any;

    beforeEach(() => {
      component.showCustomPricing = false;
      component.showPollForm = false;
      component.selectedServiceType = residential;
      // Mirrors what initializeRegularServices produces: every service EXCEPT levels.
      component.selectedServices = [
        { service: bedrooms, quantity: 2 },
        { service: sqft, quantity: 850 }
      ] as any;
      component.selectedExtraServices = [];
      component.propertyType = null;
      component.levelsQuantity = null;
      component.cleaningType.setValue('normal');
      component.serviceTypeControl.setValue(residential.id);
    });

    it('asks the property type on EVERY service type, with no gating', () => {
      expect(component.showPropertyTypeSelector()).toBeTrue();

      // Hourly type: no bedrooms, no levels, but the question is still asked because admins and
      // cleaners need to know about parking, a walk-up, travel time and equipment.
      component.selectedServiceType = office;
      expect(component.showPropertyTypeSelector()).toBeTrue();

      // Custom ("Pre-Arranged") too - it is an Order like any other.
      component.showCustomPricing = true;
      expect(component.showPropertyTypeSelector()).toBeTrue();
    });

    it('shows the levels chips for a house on EVERY service type', () => {
      component.selectPropertyType('House');
      expect(component.showLevelsSelector()).toBeTrue();
      expect(component.levelsArePriced()).toBeTrue();

      // Hourly type: chips still render, because the crew needs to know about the stairs...
      component.selectedServiceType = office;
      component.selectedServices = [
        { service: cleaners, quantity: 2 },
        { service: hours, quantity: 3 }
      ] as any;
      expect(component.showLevelsSelector()).toBeTrue();
      // ...but the answer is informational only, because stair time is already inside the hours.
      expect(component.levelsArePriced()).toBeFalse();
    });

    it('hides the chips for an apartment on every service type', () => {
      component.selectPropertyType('Apartment');
      expect(component.showLevelsSelector()).toBeFalse();

      component.selectedServiceType = office;
      expect(component.showLevelsSelector()).toBeFalse();
    });

    it('has NO default selection', () => {
      expect(component.propertyType).toBeNull();
      expect(component.levelsQuantity).toBeNull();
    });

    it('never seeds a levels line into selectedServices before a chip is clicked', () => {
      // The whole reason levelsQuantity is a separate field: a seeded minValue of 1 would make
      // "not yet chosen" indistinguishable from "chose 1 level".
      expect(component.selectedServices.some(s => s.service.serviceKey === 'levels')).toBeFalse();
    });

    it('blocks step 1 until a property type is chosen', () => {
      expect(component.isStep1Valid()).toBeFalse();

      component.selectPropertyType('Apartment');
      expect(component.isStep1Valid()).toBeTrue();
    });

    it('blocks step 1 for a house until levels are chosen too', () => {
      component.selectPropertyType('House');
      expect(component.isStep1Valid()).toBeFalse();

      component.selectLevels(2);
      expect(component.isStep1Valid()).toBeTrue();
    });

    it('requires the property type AND the level count on a type that prices no rooms', () => {
      component.selectedServiceType = office;
      component.serviceTypeControl.setValue(office.id);
      component.selectedServices = [
        { service: cleaners, quantity: 2 },
        { service: hours, quantity: 3 }
      ] as any;

      expect(component.isStep1Valid()).toBeFalse();

      // House is not enough: the chips ARE rendered here now, so an answer is owed even though
      // it costs nothing.
      component.selectPropertyType('House');
      expect(component.showLevelsSelector()).toBeTrue();
      expect(component.isStep1Valid()).toBeFalse();

      component.selectLevels(3);
      expect(component.isStep1Valid()).toBeTrue();
    });

    it('captures an informational level count with no line, no charge and no summary row', () => {
      component.selectedServiceType = office;
      component.selectedServices = [
        { service: cleaners, quantity: 2 },
        { service: hours, quantity: 3 }
      ] as any;
      component.calculateTotal();
      const before = component.calculation.subTotal;
      const beforeDuration = component.actualTotalDuration;

      component.selectPropertyType('House');
      component.selectLevels(4);

      // The answer is recorded...
      expect(component.levelsQuantity).toBe(4);
      // ...but nothing priced happens: no OrderService line, no cost, no duration, no summary row.
      expect(component.selectedServices.some(s => s.service.serviceKey === 'levels')).toBeFalse();
      expect(component.getAdditionalLevelsCost()).toBe(0);
      expect(component.calculation.subTotal).toBe(before);
      expect(component.actualTotalDuration).toBe(beforeDuration);
      expect(component.getSummaryPriceLines(false).some(l => l.label.startsWith('Additional levels')))
        .toBeFalse();
    });

    it('picking House does not throw where there is no bedrooms service', () => {
      component.selectedServiceType = office;
      component.selectedServices = [
        { service: cleaners, quantity: 2 },
        { service: hours, quantity: 3 }
      ] as any;

      expect(() => component.selectPropertyType('House')).not.toThrow();
    });

    it('leaves the apartment flow exactly as it was', () => {
      component.calculateTotal();
      const before = component.calculation.subTotal;

      component.selectPropertyType('Apartment');

      expect(component.showLevelsSelector()).toBeFalse();
      expect(component.selectedServices.some(s => s.service.serviceKey === 'levels')).toBeFalse();
      expect(component.calculation.subTotal).toBe(before);
    });

    it('prices a one-level house exactly like the apartment', () => {
      component.selectPropertyType('Apartment');
      component.calculateTotal();
      const apartment = component.calculation.subTotal;

      component.selectPropertyType('House');
      component.selectLevels(1);

      expect(component.calculation.subTotal).toBe(apartment);
      expect(component.getAdditionalLevelsCost()).toBe(0);
    });

    it('charges 35 per level above the first', () => {
      component.selectPropertyType('House');

      component.selectLevels(2);
      expect(component.getAdditionalLevelsCost()).toBe(35);

      component.selectLevels(3);
      expect(component.getAdditionalLevelsCost()).toBe(70);

      component.selectLevels(4);
      expect(component.getAdditionalLevelsCost()).toBe(105);
    });

    it('stores the ACTUAL level count on the priced line, not the billable count', () => {
      component.selectPropertyType('House');
      component.selectLevels(3);

      const line = component.selectedServices.find(s => s.service.serviceKey === 'levels');
      expect(line?.quantity).toBe(3);
    });

    it('clears the level count AND the charge when switching back to apartment', () => {
      component.selectPropertyType('House');
      component.selectLevels(4);
      expect(component.getAdditionalLevelsCost()).toBe(105);

      component.selectPropertyType('Apartment');

      expect(component.levelsQuantity).toBeNull();
      expect(component.selectedServices.some(s => s.service.serviceKey === 'levels')).toBeFalse();
      expect(component.getAdditionalLevelsCost()).toBe(0);
    });

    it('raises a studio to one bedroom for a house, and the sq.ft floor follows', () => {
      component.selectedServices = [
        { service: bedrooms, quantity: 0 },
        { service: sqft, quantity: 400 }
      ] as any;

      component.selectPropertyType('House');

      expect(component.selectedServices.find(s => s.service.serviceKey === 'bedrooms')?.quantity).toBe(1);
      expect(component.selectedServices.find(s => s.service.serviceKey === 'sqft')?.quantity).toBe(650);
    });

    it('stops offering Studio while House is selected', () => {
      expect(component.getServiceMinValue(bedrooms)).toBe(0);

      component.selectPropertyType('House');
      expect(component.getServiceMinValue(bedrooms)).toBe(1);
    });

    it('does not lower the values back when switching to apartment', () => {
      component.selectedServices = [
        { service: bedrooms, quantity: 0 },
        { service: sqft, quantity: 400 }
      ] as any;
      component.selectPropertyType('House');

      component.selectPropertyType('Apartment');

      expect(component.selectedServices.find(s => s.service.serviceKey === 'bedrooms')?.quantity).toBe(1);
      expect(component.selectedServices.find(s => s.service.serviceKey === 'sqft')?.quantity).toBe(650);
      expect(component.getServiceMinValue(bedrooms)).toBe(0);
    });

    it('shows an Additional levels summary line only when it costs something', () => {
      component.selectPropertyType('House');
      component.selectLevels(1);
      expect(component.getSummaryPriceLines(false).some(l => l.label.startsWith('Additional levels')))
        .withContext('a $0 line reads as a mistake, not reassurance').toBeFalse();

      component.selectLevels(3);
      const line = component.getSummaryPriceLines(false).find(l => l.label.startsWith('Additional levels'));
      expect(line?.label).toBe('Additional levels (2):');
      expect(line?.value).toBe('$70.00');
    });

    /**
     * A greyed-out Continue with no explanation is the bug this block exists to prevent. The
     * inline message, the console blocker table and isStep1Valid must all read the SAME two
     * predicates, or the screen and the diagnostics can disagree about why the button is dead.
     */
    describe('a blocked Continue is always explainable', () => {
      it('names the missing property type', () => {
        expect(component.isPropertyTypeMissing()).toBeTrue();
        expect(component.isLevelsMissing()).toBeFalse();
        expect(component.isPropertyTypeAnswered()).toBeFalse();
        expect(component.isStep1Valid()).toBeFalse();
      });

      it('names the missing level count once House is chosen', () => {
        component.selectPropertyType('House');

        expect(component.isPropertyTypeMissing()).toBeFalse();
        expect(component.isLevelsMissing()).toBeTrue();
        expect(component.isStep1Valid()).toBeFalse();
      });

      it('reports nothing missing once both are answered', () => {
        component.selectPropertyType('House');
        component.selectLevels(2);

        expect(component.isPropertyTypeMissing()).toBeFalse();
        expect(component.isLevelsMissing()).toBeFalse();
        expect(component.isPropertyTypeAnswered()).toBeTrue();
      });

      /**
       * REGRESSION: the levels error used to appear the instant House was clicked, before a
       * single chip existed to click. Picking House is the customer STARTING to answer.
       */
      it('does NOT reveal an error just because House was selected', () => {
        component.selectPropertyType('House');

        expect(component.isLevelsMissing()).toBeTrue();
        expect(component.propertyTypeTouched)
          .withContext('selecting a card must not mark the block touched').toBeFalse();
        expect(component.formSubmitted).toBeFalse();
      });

      it('reveals the errors once a blocked Continue is pressed', () => {
        component.selectPropertyType('House');

        component.onNextButtonClick();

        expect(component.propertyTypeTouched).toBeTrue();
      });

      it('clears the revealed state when step-1 errors are cleared', () => {
        component.propertyTypeTouched = true;

        (component as any).clearCurrentStepValidationErrors();

        expect(component.propertyTypeTouched).toBeFalse();
      });

      it('feeds the blocker diagnostics the same predicates the inline errors read', () => {
        const missingBoth = (component as any).buildBookingDiagnosticsSnapshot('Continue');
        expect(missingBoth.propertyTypeMissing).toBeTrue();
        expect(missingBoth.levelsMissing).toBeFalse();

        component.selectPropertyType('House');
        const missingLevels = (component as any).buildBookingDiagnosticsSnapshot('Continue');
        expect(missingLevels.propertyTypeMissing).toBeFalse();
        expect(missingLevels.levelsMissing).toBeTrue();
      });
    });
  });

  /**
   * Regression (2026-08): `isAdminMode` / `selectedTargetUser` are component state and do not
   * survive a reload, while every form field is persisted and `currentStep` is restored from
   * `?step=`. A refresh of `/booking?step=3` therefore handed an admin back a fully populated
   * booking with Admin Mode silently OFF, and Book Now redirected the ADMIN to Stripe to pay
   * for their customer's cleaning. Such a draft is now discarded outright.
   */
  describe('an admin draft is never silently resumed', () => {
    let persistence: FormPersistenceService;

    beforeEach(() => {
      persistence = TestBed.inject(FormPersistenceService);
      persistence.clearFormData();
    });

    afterEach(() => {
      persistence.clearFormData();
    });

    /** Seed a saved draft, then boot a fresh page on top of it (the reload). */
    function bootOnSavedDraft(data: Partial<BookingFormData>): BookingComponent {
      persistence.saveFormData(data as BookingFormData);
      const reloaded = TestBed.createComponent(BookingComponent);
      reloaded.detectChanges();
      return reloaded.componentInstance;
    }

    it('discards a draft written in Admin Mode and tells the admin why', () => {
      const reloaded = bootOnSavedDraft({
        wasAdminMode: true,
        contactFirstName: 'Ann',
        contactEmail: 'ann@example.com',
        selectedServiceTypeId: '1'
      });

      expect(persistence.getFormData()).toBeNull();
      expect(reloaded.adminDraftDiscarded).toBeTrue();
      // Nothing of the customer's booking may survive into the admin's own form.
      expect(reloaded.contactFirstName.value).toBeFalsy();
      expect(reloaded.contactEmail.value).toBeFalsy();
      // And the admin starts over rather than landing on an empty step 3.
      expect(reloaded.currentStep).toBe(1);
    });

    it('leaves an ordinary customer draft alone', () => {
      const reloaded = bootOnSavedDraft({
        contactFirstName: 'Ann',
        contactEmail: 'ann@example.com',
        selectedServiceTypeId: '1'
      });

      expect(persistence.getFormData()).not.toBeNull();
      expect(reloaded.adminDraftDiscarded).toBeFalse();
      expect(reloaded.contactFirstName.value).toBe('Ann');
    });

    it('stamps the marker when admin mode is turned on, and clears it when turned off', () => {
      persistence.saveFormData({ contactFirstName: 'Ann' } as BookingFormData);

      component.toggleAdminMode();
      expect(persistence.getFormData()?.wasAdminMode).toBeTrue();

      component.toggleAdminMode();
      expect(persistence.getFormData()?.wasAdminMode).toBeFalsy();
    });
  });

  /**
   * The submit branch is resolved ONCE, explicitly. Every "shouldn't happen" combination is a
   * loud stop — never an implicit fall-through to the customer flow, which is what sent the
   * admin to the Stripe payment page.
   */
  describe('submit target resolution', () => {
    const targetUser = { id: 42, firstName: 'Ann', lastName: 'Lee', email: 'ann@example.com' } as any;

    function resolve(): 'admin-for-user' | 'self' | null {
      return (component as any).resolveSubmitTarget();
    }

    beforeEach(() => {
      TestBed.inject(FormPersistenceService).clearFormData();
    });

    it('resolves to the customer branch for a plain booking', () => {
      component.isAdminMode = false;
      component.selectedTargetUser = null;

      expect(resolve()).toBe('self');
    });

    it('resolves to the admin branch when admin mode is on with a customer selected', () => {
      spyOn((component as any).authService, 'isLoggedIn').and.returnValue(true);
      component.isAdmin = true;
      component.isAdminMode = true;
      component.selectedTargetUser = targetUser;

      expect(resolve()).toBe('admin-for-user');
    });

    it('blocks admin mode with no customer selected', () => {
      component.isAdminMode = true;
      component.selectedTargetUser = null;

      expect(resolve()).toBeNull();
      expect(component.errorMessage).toContain('select a user');
    });

    it('blocks a selected customer while admin mode is off, instead of booking as the admin', () => {
      component.isAdminMode = false;
      component.selectedTargetUser = targetUser;

      expect(resolve()).toBeNull();
      expect(component.errorMessage).toContain('Admin Mode is off');
    });

    it('blocks a draft flagged wasAdminMode when admin mode is off', () => {
      TestBed.inject(FormPersistenceService).saveFormData({ wasAdminMode: true } as BookingFormData);
      component.isAdminMode = false;
      component.selectedTargetUser = null;

      expect(resolve()).toBeNull();
      expect(component.adminDraftDiscarded).toBeTrue();
      expect(component.errorMessage).toContain('start the booking again');
    });
  });

  /**
   * The admin needs to see, without scrolling back to the top of the page, that Book Now is
   * about to act on someone else's behalf and what it will do.
   */
  describe('submit button label', () => {
    const targetUser = { id: 42, firstName: 'Ann', lastName: 'Lee', email: 'ann@example.com' } as any;

    it('reads "Book Now" for a customer booking', () => {
      component.showPollForm = false;
      component.isAdminMode = false;
      component.selectedTargetUser = null;

      expect(component.submitButtonLabel).toBe('Book Now');
    });

    it('reads "Send Payment" for an admin booking paid through Stripe', () => {
      component.showPollForm = false;
      component.isAdminMode = true;
      component.selectedTargetUser = targetUser;
      component.adminPaymentMethod = 'Normal';

      expect(component.submitButtonLabel).toBe('Send Payment');
    });

    for (const method of ['Cash', 'Zelle', 'Check', 'Other'] as const) {
      it('reads "Book for User" for an admin booking paid by ' + method, () => {
        component.showPollForm = false;
        component.isAdminMode = true;
        component.selectedTargetUser = targetUser;
        component.adminPaymentMethod = method;

        expect(component.submitButtonLabel).toBe('Book for User');
      });
    }

    it('reads "Send for Quote" for a poll form, admin mode included', () => {
      component.showPollForm = true;
      component.isAdminMode = true;
      component.selectedTargetUser = targetUser;
      component.adminPaymentMethod = 'Normal';

      expect(component.submitButtonLabel).toBe('Send for Quote');
    });

    it('keeps the customer-facing label while admin mode is on but no customer is picked', () => {
      component.showPollForm = false;
      component.isAdminMode = true;
      component.selectedTargetUser = null;

      expect(component.submitButtonLabel).toBe('Book Now');
    });
  });
  /**
   * The admin Users tab's "Register Customer" action, moved onto the booking page's header so an
   * admin taking a booking by phone can create the account without leaving the page.
   *
   * Two things must hold. The button follows the same `canCreate` permission the Users tab uses —
   * NOT a local role check, because the permission map lives on the backend and a second copy here
   * would drift. And registering only selects the customer when Admin Mode is already on: with it
   * off there is no target-user slot to select into, and silently turning it on would change what
   * the Book Now button is about to do.
   */
  describe('register customer from the booking header', () => {
    const newCustomer = {
      id: 501,
      firstName: 'Nino',
      lastName: 'Beridze',
      email: 'nino@example.com',
      phone: '2125550134',
      role: 'Customer',
      authProvider: 'Admin',
      isNoEmailUser: false
    };

    const renderedButton = () =>
      fixture.nativeElement.querySelector('.register-customer-btn') as HTMLElement | null;

    it('is hidden for an admin who may not create users', () => {
      component.isAdmin = true;
      component.canRegisterCustomers = false;
      fixture.detectChanges();

      expect(renderedButton()).toBeNull();
    });

    it('is shown beside the Admin Mode toggle once create is granted', () => {
      component.isAdmin = true;
      component.canRegisterCustomers = true;
      fixture.detectChanges();

      const button = renderedButton();
      expect(button).not.toBeNull();
      // Same container as the Admin Mode pill — that is what "near the Admin Mode button" means.
      expect(button!.closest('.admin-mode-toggle')).not.toBeNull();
    });

    it('never opens the modal for someone without the permission', () => {
      component.canRegisterCustomers = false;

      component.openRegisterCustomerModal();

      expect(component.showRegisterCustomerModal).toBeFalse();
    });

    it('selects the new customer when Admin Mode is already on', () => {
      component.isAdminMode = true;
      const selectUser = spyOn(component, 'selectUser');

      component.onCustomerRegistered(newCustomer);

      expect(selectUser).toHaveBeenCalled();
      expect(selectUser.calls.mostRecent().args[0].id).toBe(501);
      expect(component.registeredCustomerMessage).toContain('Nino Beridze');
      expect(component.registeredCustomerMessage).toContain('selected');
    });

    it('only confirms the registration when Admin Mode is off', () => {
      component.isAdminMode = false;
      const selectUser = spyOn(component, 'selectUser');

      component.onCustomerRegistered(newCustomer);

      expect(selectUser).not.toHaveBeenCalled();
      expect(component.registeredCustomerMessage).toContain('Nino Beridze');
      expect(component.registeredCustomerMessage).not.toContain('selected');
    });

    /**
     * The reload-the-page complaint. The new customer has to be selectable at once, so the page
     * keeps them in `registeredCustomers` and hands them to the search box as `seedUsers`. That
     * list also has to survive Admin Mode being toggled off and on, which destroys and rebuilds
     * the search box — which is why the PAGE owns it and not the box.
     */
    describe('the new customer joins the list live', () => {
      it('adds them to the seed list handed to the search box', () => {
        spyOn(component, 'selectUser');

        component.onCustomerRegistered(newCustomer);

        expect(component.registeredCustomers.map(u => u.id)).toEqual([501]);
      });

      it('adds them even with Admin Mode off, so they are there when it is switched on', () => {
        component.isAdminMode = false;

        component.onCustomerRegistered(newCustomer);

        expect(component.registeredCustomers.map(u => u.id)).toEqual([501]);
      });

      /** `seedUsers` is an @Input — mutating the array in place would not notify the search box. */
      it('replaces the array rather than mutating it', () => {
        const before = component.registeredCustomers;

        component.onCustomerRegistered(newCustomer);

        expect(component.registeredCustomers).not.toBe(before);
      });

      it('never lists the same customer twice', () => {
        component.onCustomerRegistered(newCustomer);
        component.onCustomerRegistered(newCustomer);

        expect(component.registeredCustomers.map(u => u.id)).toEqual([501]);
      });

      it('keeps several customers registered in a row, newest first', () => {
        component.onCustomerRegistered(newCustomer);
        component.onCustomerRegistered({ ...newCustomer, id: 502, firstName: 'Dato' });

        expect(component.registeredCustomers.map(u => u.id)).toEqual([502, 501]);
      });

      /**
       * GET /api/admin/users is an ordinary cacheable GET, so the refresh that follows the POST
       * must bypass the cache — otherwise it can return the list from before the registration,
       * which is exactly the symptom that made admins reload the page.
       */
      it('forces the server list to refresh past the HTTP cache', () => {
        const searchBox = jasmine.createSpyObj('AdminUserSearchComponent', ['loadUsers']);
        (component as any).adminUserSearch = searchBox;

        component.onCustomerRegistered(newCustomer);

        expect(searchBox.loadUsers).toHaveBeenCalledWith(true);
      });

      it('does not fall over when the search box is absent (Admin Mode off)', () => {
        component.isAdminMode = false;
        (component as any).adminUserSearch = undefined;

        expect(() => component.onCustomerRegistered(newCustomer)).not.toThrow();
      });
    });

    /** A no-email cash customer arrives with a null email; nothing downstream may be handed "null". */
    it('carries a no-email customer through without inventing an address', () => {
      component.isAdminMode = true;
      const selectUser = spyOn(component, 'selectUser');

      component.onCustomerRegistered({ ...newCustomer, email: null, isNoEmailUser: true });

      const selected = selectUser.calls.mostRecent().args[0];
      expect(selected.email).toBe('');
      expect(selected.isNoEmailUser).toBeTrue();
      expect(selected.canReceiveCommunications).toBeFalse();
    });
  });
});
