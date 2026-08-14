import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl } from '@angular/forms';

import { OrderEditComponent } from './order-edit.component';

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
});
