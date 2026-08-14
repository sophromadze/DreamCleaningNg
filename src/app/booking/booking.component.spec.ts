import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { BookingComponent } from './booking.component';

import { testProviders } from '../../testing/test-providers';

describe('BookingComponent', () => {
  let component: BookingComponent;
  let fixture: ComponentFixture<BookingComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [...testProviders],
      imports: [BookingComponent]
    })
    .compileComponents();

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
});
