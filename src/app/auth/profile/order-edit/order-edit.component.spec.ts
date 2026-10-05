import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl } from '@angular/forms';

import { OrderEditComponent } from './order-edit.component';
import { buildQuoteInputFromSelections, calculateQuote, percentOf, round2 } from '../../../shared/pricing/order-pricing.calculator';

import { testProviders } from '../../../../testing/test-providers';

describe('OrderEditComponent', () => {
  let component: OrderEditComponent;
  let fixture: ComponentFixture<OrderEditComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [...testProviders],
      imports: [OrderEditComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(OrderEditComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  /**
   * Mirrors the booking page's bedrooms→sq.ft specs — this page shares the rule and the
   * index-based slider, so the floor has to move in the same change cycle as the value.
   * The regression: changing bedrooms reset Sq.ft to the new bedroom's included amount
   * unconditionally, discarding a value the customer had chosen.
   */
  describe('bedrooms → sq.ft linkage', () => {
    const BEDROOMS_ID = 101;
    const SQFT_ID = 102;

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

    /** Seed the page as initializeServices would, incl. the parallel form controls. */
    function seedSelection(bedrooms: number, squareFeet: number) {
      component.selectedServices = [
        { service: bedroomsService, quantity: bedrooms },
        { service: sqftService, quantity: squareFeet }
      ] as any;
      component.serviceControls.clear();
      component.serviceControls.push(new FormControl(bedrooms));
      component.serviceControls.push(new FormControl(squareFeet));
    }

    const currentSquareFeet = () =>
      component.selectedServices.find(s => s.service.serviceKey === 'sqft')!.quantity;

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

    it('writes the clamped value to the form control, not a stale one', () => {
      seedSelection(2, 950);

      component.updateServiceQuantity(bedroomsService, 3);

      // The template renders the control, so a stale control shows a different number
      // from the one being priced.
      expect(component.getServiceControl(1).value).toBe(1000);
    });

    it('moves the slider minimum in the same change cycle', () => {
      seedSelection(2, 2650);

      component.updateServiceQuantity(bedroomsService, 3);

      // The slider is index-based over the option list, whose first entry IS the minimum.
      expect(component.getSquareFeetMinForBedrooms()).toBe(1000);
      expect(component['getSquareFeetOptionsFor'](sqftService)[0]).toBe(1000);
    });

    /**
     * Loading an order does NOT apply the linkage — initializeServices walks the CATALOG and
     * looks each service's stored quantity up by id, so the order's row order is irrelevant.
     * These pin that property, because reintroducing an inline linkage in the populate loop
     * would make a stored Sq.ft depend on whether it preceded bedrooms in the DB rows.
     */
    describe('loading an existing order', () => {
      function loadOrderWith(services: { serviceId: number; quantity: number }[]) {
        component.serviceType = {
          id: 1, name: 'Residential Cleaning', basePrice: 100, isActive: true, hasPoll: false,
          timeDuration: 0, services: [bedroomsService, sqftService], extraServices: []
        } as any;
        component.order = {
          id: 306, serviceTypeId: 1, extraServices: [],
          services: services.map(s => ({ ...s, serviceName: '', duration: 0, cost: 0 }))
        } as any;

        component.initializeServices();
      }

      it('keeps the stored sq.ft when bedrooms come first', () => {
        loadOrderWith([
          { serviceId: BEDROOMS_ID, quantity: 2 },
          { serviceId: SQFT_ID, quantity: 2650 }
        ]);

        expect(currentSquareFeet()).toBe(2650);
      });

      it('keeps the stored sq.ft when sq.ft comes first', () => {
        loadOrderWith([
          { serviceId: SQFT_ID, quantity: 2650 },
          { serviceId: BEDROOMS_ID, quantity: 2 }
        ]);

        expect(currentSquareFeet()).toBe(2650);
      });
    });
  });

  /**
   * An order whose cleaner+hours type has no stored Hours line takes its hours from the Cleaners
   * line's duration. That line is found by serviceKey; the name is read only for an unkeyed line.
   */
  describe('Hours fallback finds the Cleaners line by key', () => {
    const cleaners = (name: string, key: string | null) => ({
      id: 201, name, serviceKey: key, serviceRelationType: 'cleaner', cost: 40, timeDuration: 0,
      serviceTypeId: 6, inputType: 'dropdown', isActive: true, minValue: 1, maxValue: 6, stepValue: 1, displayOrder: 1
    }) as any;
    const hours = (name: string) => ({
      id: 202, name, serviceKey: 'hours', serviceRelationType: 'hours', cost: 0, timeDuration: 60,
      serviceTypeId: 6, inputType: 'dropdown', isActive: true, minValue: 3, maxValue: 12, stepValue: 1, displayOrder: 2
    }) as any;

    function hoursAfterLoad(cleanersName: string, hoursName: string, lineKey: string | null, lineName: string): number {
      component.serviceType = { id: 6, name: 'Post Construction Cleaning', services: [cleaners(cleanersName, lineKey), hours(hoursName)] } as any;
      component.order = {
        id: 1, serviceTypeId: 6, extraServices: [],
        // No Hours line was stored - the fallback case.
        services: [{ id: 1, serviceId: 201, serviceName: lineName, serviceKey: lineKey, quantity: 2, cost: 80, duration: 300 }]
      } as any;
      component.initializeServices();
      return component.selectedServices.find(s => s.service.id === 202)!.quantity;
    }

    it('takes 5 hours from a 300-minute Cleaners line, with production names', () => {
      expect(hoursAfterLoad('Cleaners', 'Hours', 'cleaners', 'Cleaners')).toBe(5);
    });

    it('gives the same hours after every name is changed', () => {
      expect(hoursAfterLoad('Team Size', 'Time On Site', 'cleaners', 'Team Size')).toBe(5);
    });

    it('still reads an unkeyed line by its name', () => {
      expect(hoursAfterLoad('Cleaners', 'Hours', null, 'Cleaners')).toBe(5);
    });

    it('does not take a differently-keyed line for Cleaners because of its name', () => {
      expect(hoursAfterLoad('Cleaners', 'Hours', 'bedrooms', 'Cleaner rooms')).toBe(3);
    });
  });
});

/**
 * The customer's own order edit prices levels exactly like booking (2026-10 check, no change
 * needed): it seeds EVERY catalogue service, Levels included at its minimum, so an apartment
 * order turned house has a priced Levels line to write the count into. Asserted against booking's
 * own path for the same inputs; the server re-prices the save the same way
 * (EditLevelsPricingTests.CustomerEdit_PricesTheSameHouseExactlyLikeBooking).
 */
describe('OrderEditComponent — levels price like booking', () => {
  let component: OrderEditComponent;

  const LEVELS = { id: 40, name: 'Levels', serviceKey: 'levels', cost: 35, timeDuration: 25, isActive: true,
    minValue: 1, maxValue: 4, displayOrder: 4, chargeAboveThreshold: true,
    thresholds: [{ id: 9, serviceId: 40, sourceServiceId: 40, sourceServiceKey: 'levels', sourceQuantity: 1, includedQuantity: 1 }],
    rateTiers: [] } as any;
  const BEDROOMS = { id: 10, name: 'Bedrooms', serviceKey: 'bedrooms', cost: 22.5, timeDuration: 30, isActive: true,
    minValue: 0, maxValue: 6, displayOrder: 1, zeroQuantityCost: 0, zeroQuantityDuration: 0, thresholds: [], rateTiers: [] } as any;
  const BATHROOMS = { id: 20, name: 'Bathrooms', serviceKey: 'bathrooms', cost: 22.5, timeDuration: 30, isActive: true,
    minValue: 1, maxValue: 6, displayOrder: 2, thresholds: [], rateTiers: [] } as any;
  const ST = { id: 1, name: 'Residential Cleaning', basePrice: 90, timeDuration: 120, minimumPrice: 130,
    services: [BEDROOMS, BATHROOMS, LEVELS], extraServices: [], isActive: true, hasPoll: false } as any;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ providers: [...testProviders], imports: [OrderEditComponent] }).compileComponents();
    component = TestBed.createComponent(OrderEditComponent).componentInstance;
    component.serviceType = ST;
    // An apartment order as booked: no levels line, so the page seeds Levels at its minimum.
    component.order = { id: 1, serviceTypeId: 1, propertyType: 'Apartment', levelsQuantity: null,
      services: [{ serviceId: 10, quantity: 2 }, { serviceId: 20, quantity: 1 }], extraServices: [] } as any;
    component.initializeServices();
    component.propertyType = 'Apartment';
  });

  const bookingSubTotal = (levels: number) => calculateQuote(buildQuoteInputFromSelections(ST,
    [{ service: BEDROOMS, quantity: 2 }, { service: BATHROOMS, quantity: 1 }, { service: LEVELS, quantity: levels }], [])).subTotal;
  const pageSubTotal = () => calculateQuote((component as any).buildQuoteInput()).subTotal;

  [1, 2, 3, 4].forEach(levels => {
    it(`${levels} level(s) on a house costs what booking charges`, () => {
      component.selectPropertyType('House');
      component.selectLevels(levels);
      expect(pageSubTotal()).toBe(bookingSubTotal(levels));
    });
  });

  it('drops the stair charge again on Apartment', () => {
    component.selectPropertyType('House');
    component.selectLevels(4);
    component.selectPropertyType('Apartment');
    expect(pageSubTotal()).toBe(bookingSubTotal(1));
  });
});

describe('OrderEditComponent — discounts re-derive like booking (2026-10)', () => {
  let component: OrderEditComponent;

  const BEDROOMS = { id: 10, name: 'Bedrooms', serviceKey: 'bedrooms', cost: 22.5, timeDuration: 30, isActive: true,
    minValue: 0, maxValue: 6, displayOrder: 1, zeroQuantityCost: 0, zeroQuantityDuration: 0, thresholds: [], rateTiers: [] } as any;
  const BATHROOMS = { id: 20, name: 'Bathrooms', serviceKey: 'bathrooms', cost: 22.5, timeDuration: 30, isActive: true,
    minValue: 1, maxValue: 6, displayOrder: 2, thresholds: [], rateTiers: [] } as any;
  const ST = { id: 1, name: 'Residential Cleaning', basePrice: 90, timeDuration: 120, minimumPrice: 130,
    services: [BEDROOMS, BATHROOMS], extraServices: [], isActive: true, hasPoll: false } as any;
  const subTotalOf = (bed: number, bath: number) => calculateQuote(buildQuoteInputFromSelections(ST,
    [{ service: BEDROOMS, quantity: bed }, { service: BATHROOMS, quantity: bath }], [])).subTotal;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ providers: [...testProviders], imports: [OrderEditComponent] }).compileComponents();
    component = TestBed.createComponent(OrderEditComponent).componentInstance;
    component.serviceType = ST;
  });

  /** The order as booked at 2 bed / 1 bath with its discount, then edited to 2 bed / 3 bath. */
  function editWith(discount: { amount: number; percent?: number | null; fixed?: number | null }) {
    component.order = { id: 1, serviceTypeId: 1, propertyType: 'Apartment', levelsQuantity: null,
      services: [{ serviceId: 10, quantity: 2 }, { serviceId: 20, quantity: 1 }], extraServices: [],
      discountAmount: discount.amount, discountPercent: discount.percent ?? null, discountFixedAmount: discount.fixed ?? null } as any;
    component.initializeServices();
    component.propertyType = 'Apartment';
    component.originalRawSubTotal = subTotalOf(2, 1);
    component.originalDiscountAmount = discount.amount;
    component.selectedServices.find(s => s.service.id === 20)!.quantity = 3;
    component.calculateNewTotal();
  }

  it('previews a fixed promo as fixed', () => {
    editWith({ amount: 30, fixed: 30 });
    expect(component.appliedDiscountAmount).toBe(30);
  });

  it('previews a percentage promo exactly like booking', () => {
    editWith({ amount: percentOf(subTotalOf(2, 1), 20), percent: 20 });
    expect(component.appliedDiscountAmount).toBe(percentOf(subTotalOf(2, 3), 20));
  });

  it('keeps the proportional re-scale for an order with no recorded rule', () => {
    editWith({ amount: 30 });
    expect(component.appliedDiscountAmount).toBe(round2(subTotalOf(2, 3) * (30 / subTotalOf(2, 1))));
  });
});
