import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { testProviders } from '../../../../testing/test-providers';
import { RecreateOrderModalComponent } from './recreate-order-modal.component';
import { environment } from '../../../../environments/environment';
import { ReorderPreview } from '../../../services/admin.service';

const SERVICE_TYPES_URL = `${environment.apiUrl}/booking/service-types`;
const PREVIEW_URL = (id: number) => `${environment.apiUrl}/admin/orders/${id}/reorder-preview`;
const CREATE_URL = `${environment.apiUrl}/booking/create-for-user`;

const SOURCE_ORDER_ID = 900;

function serviceTypes(): any[] {
  return [{
    id: 1,
    name: 'Residential Cleaning',
    basePrice: 90,
    timeDuration: 120,
    minimumPrice: 0,
    isActive: true,
    hasPoll: false,
    isCustom: false,
    collectsPropertyType: true,
    services: [
      {
        id: 10, name: 'Bedrooms', serviceKey: 'bedrooms', cost: 22.5, timeDuration: 30,
        serviceTypeId: 1, inputType: 'dropdown', minValue: 0, maxValue: 10, stepValue: 1,
        isRangeInput: false, isActive: true
      },
      {
        id: 11, name: 'Bathrooms', serviceKey: 'bathrooms', cost: 22.5, timeDuration: 30,
        serviceTypeId: 1, inputType: 'dropdown', minValue: 0, maxValue: 10, stepValue: 1,
        isRangeInput: false, isActive: true
      }
    ],
    extraServices: [
      {
        id: 20, name: 'Windows', price: 12, duration: 20, priceMultiplier: 1,
        hasQuantity: true, hasHours: false, isDeepCleaning: false, isSuperDeepCleaning: false,
        isSameDayService: false, isAvailableForAll: true, isActive: true
      },
      {
        id: 21, name: 'Organizing', price: 30, duration: 60, priceMultiplier: 1,
        hasQuantity: false, hasHours: true, isDeepCleaning: false, isSuperDeepCleaning: false,
        isSameDayService: false, isAvailableForAll: true, isActive: true
      },
      // Deep / Super Deep are the cleaning TYPE. They live in the catalogue as extras, and the
      // modal must present them as type buttons, never as selectable add-ons.
      {
        id: 30, name: 'Deep Cleaning', price: 90, duration: 120, priceMultiplier: 1.5,
        hasQuantity: false, hasHours: false, isDeepCleaning: true, isSuperDeepCleaning: false,
        isSameDayService: false, isAvailableForAll: true, isActive: true
      },
      {
        id: 31, name: 'Super Deep Cleaning', price: 150, duration: 180, priceMultiplier: 2,
        hasQuantity: false, hasHours: false, isDeepCleaning: false, isSuperDeepCleaning: true,
        isSameDayService: false, isAvailableForAll: true, isActive: true
      }
    ]
  }];
}

function preview(overrides: Partial<ReorderPreview> = {}): ReorderPreview {
  return {
    sourceOrderId: SOURCE_ORDER_ID,
    customerUserId: 100,
    customerName: 'Cus Tomer',
    originalServiceDate: '2026-03-14T00:00:00',
    serviceTypeName: 'Residential Cleaning',
    isCustomServiceType: false,
    original: {
      subTotal: 169.5, discountAmount: 35, subscriptionDiscountAmount: 0,
      loyaltyDiscountAmount: 0, giftCardAmountUsed: 0, pointsRedeemedDiscount: 0,
      rewardBalanceUsed: 0, tax: 11.94, tips: 0, total: 146.44,
      totalDuration: 230, maidsCount: 1
    },
    recreated: {
      subTotal: 169.5, discountAmount: 0, subscriptionDiscountAmount: 0,
      loyaltyDiscountAmount: 0, giftCardAmountUsed: 0, pointsRedeemedDiscount: 0,
      rewardBalanceUsed: 0, tax: 15.04, tips: 0, total: 184.54,
      totalDuration: 230, maidsCount: 1
    },
    lineChanges: [],
    unavailable: [],
    discounts: [],
    hasChanges: true,
    prefill: {
      serviceTypeId: 1,
      services: [{ serviceId: 10, quantity: 2 }, { serviceId: 11, quantity: 1 }],
      extraServices: [{ extraServiceId: 20, quantity: 1, hours: 0 }],
      subscriptionId: 5,
      serviceDate: '2026-03-14T00:00:00',
      serviceTime: '10:00',
      entryMethod: 'Doorman',
      specialInstructions: 'Cat is friendly',
      contactFirstName: 'Cus', contactLastName: 'Tomer',
      contactEmail: 'customer@example.com', contactPhone: '5551234567',
      serviceAddress: '1 Main St', aptSuite: null,
      city: 'Manhattan', state: 'New York', zipCode: '10001',
      apartmentId: null, apartmentName: 'Home',
      tips: 15,
      bedroomsQuantity: 2, bathroomsQuantity: 1,
      propertyType: 'Apartment', levelsQuantity: null,
      floorTypes: null, floorTypeOther: null,
      promoCode: null, giftCardCode: null, giftCardAmountToUse: 0,
      pointsToRedeem: 0, useCredits: false, creditsToApply: 0
    },
    notificationEmail: 'customer@example.com',
    notificationPhone: '5551234567',
    customerHasNoAccountEmail: false,
    ...overrides
  };
}

describe('RecreateOrderModalComponent', () => {
  let component: RecreateOrderModalComponent;
  let fixture: ComponentFixture<RecreateOrderModalComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RecreateOrderModalComponent],
      providers: [...testProviders]
    }).compileComponents();

    fixture = TestBed.createComponent(RecreateOrderModalComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  /** Opens the modal and answers both load requests. */
  function openWith(p: ReorderPreview = preview()): void {
    fixture.componentRef.setInput('sourceOrderId', SOURCE_ORDER_ID);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    httpMock.expectOne(SERVICE_TYPES_URL).flush(serviceTypes());
    httpMock.expectOne(PREVIEW_URL(SOURCE_ORDER_ID)).flush(p);
    fixture.detectChanges();
  }

  /**
   * Fills the one thing the prefill deliberately leaves blank, then submits.
   *
   * Returns the WHOLE create-for-user envelope, not just `bookingData`: the notification,
   * status and discount switches ride alongside it, and half these tests are about those.
   */
  function submitWith(date = '2026-03-14'): any {
    component.serviceDate = date;
    component.onScheduleChange();
    component.submit();
    const req = httpMock.expectOne(CREATE_URL);
    req.flush({ orderId: 951, status: 'Done', total: 184.54 });
    return req.request.body;
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('lands on the changes screen, not the form', () => {
    openWith();
    expect(component.step).toBe('changes');
  });

  /**
   * The DATE IS THE ONE THING NOT PREFILLED. Prefilling the original service date would leave the
   * modal one Enter away from duplicating the order the admin is looking at; the original is
   * offered as a one-click fill instead.
   */
  describe('the service date', () => {
    it('starts empty even though the source order has one', () => {
      openWith();
      expect(component.serviceDate).toBe('');
      expect(component.validationError).toContain('service date');
    });

    it('fills from the source order on request', () => {
      openWith();
      component.useOriginalDate();
      expect(component.serviceDate).toBe('2026-03-14');
    });

    it('accepts a date in the past — back-dating is the point', () => {
      openWith();
      component.serviceDate = '2020-01-15';
      component.onScheduleChange();
      expect(component.isBackDated).toBeTrue();
      expect(component.validationError).toBeNull();
    });
  });

  /**
   * NOTIFICATIONS ARE OPT-IN HERE. A normal admin booking emails and texts the customer straight
   * away; re-entering a job that already happened must not. Both flags are sent EXPLICITLY —
   * omitting them means "send" on the shared endpoint, which is exactly the behaviour being
   * opted out of.
   */
  describe('customer notifications', () => {
    it('start off and are sent as an explicit false', () => {
      openWith();
      component.step = 'form';

      expect(component.notifyByEmail).toBeFalse();
      expect(component.notifyBySms).toBeFalse();

      const body = submitWith();
      expect(body.sendCustomerEmail).toBeFalse();
      expect(body.sendCustomerSms).toBeFalse();
    });

    it('are sent as true once the admin ticks them', () => {
      openWith();
      component.step = 'form';
      component.notifyByEmail = true;
      component.notifyBySms = true;

      const body = submitWith();
      expect(body.sendCustomerEmail).toBeTrue();
      expect(body.sendCustomerSms).toBeTrue();
    });

    it('cannot be turned on for a channel the customer does not have', () => {
      openWith(preview({ notificationEmail: null, notificationPhone: null }));
      component.step = 'form';
      // Even if the flag is forced on, a channel with no destination must not be requested.
      component.notifyByEmail = true;
      component.notifyBySms = true;

      const body = submitWith();
      expect(component.canNotifyByEmail).toBeFalse();
      expect(component.canNotifyBySms).toBeFalse();
      expect(body.sendCustomerEmail).toBeFalse();
      expect(body.sendCustomerSms).toBeFalse();
    });
  });

  /**
   * NO DISCOUNT IS CARRIED OVER. The server clears every slot in the prefill; the modal must not
   * put any of them back, and the two live entitlements stay off until asked for.
   */
  describe('discounts', () => {
    it('posts no promo code, gift card, offer, points or credits', () => {
      openWith();
      component.step = 'form';

      const { bookingData } = submitWith();
      expect(bookingData.promoCode).toBeNull();
      expect(bookingData.giftCardCode).toBeNull();
      expect(bookingData.giftCardAmountToUse).toBe(0);
      expect(bookingData.userSpecialOfferId).toBeUndefined();
      expect(bookingData.specialOfferId).toBeUndefined();
      expect(bookingData.pointsToRedeem).toBe(0);
      expect(bookingData.useCredits).toBeFalse();
      expect(bookingData.discountAmount).toBe(0);
    });

    it('suppresses the live loyalty / plan discounts by default', () => {
      openWith();
      component.step = 'form';

      expect(component.applyCurrentDiscounts).toBeFalse();
      const body = submitWith();
      expect(body.applyCurrentDiscounts).toBeFalse();
    });

    it('applies them to the preview total only when the admin opts in', () => {
      openWith(preview({
        discounts: [{
          kind: 'Loyalty', label: 'Loyalty discount',
          originalAmount: 0, availableAmount: 16.95, canReapply: true, reason: '10% available'
        }]
      }));
      component.step = 'form';

      const before = component.quoteTotal;
      component.applyCurrentDiscounts = true;
      component.onDiscountToggleChange();

      expect(component.appliedLoyalty).toBeCloseTo(16.95, 2);
      expect(component.quoteTotal).toBeLessThan(before);

      const body = submitWith();
      expect(body.applyCurrentDiscounts).toBeTrue();
    });

    /** The plan itself is job metadata — it is what keeps the order counted as recurring. */
    it('still carries the recurring plan over', () => {
      openWith();
      component.step = 'form';
      const { bookingData } = submitWith();
      expect(bookingData.subscriptionId).toBe(5);
    });
  });

  describe('the recreated order', () => {
    it('reproduces the job from the prefill', () => {
      openWith();
      component.step = 'form';

      const { bookingData } = submitWith();
      expect(bookingData.serviceTypeId).toBe(1);
      expect(bookingData.services).toContain(jasmine.objectContaining({ serviceId: 10, quantity: 2 }));
      expect(bookingData.services).toContain(jasmine.objectContaining({ serviceId: 11, quantity: 1 }));
      expect(bookingData.extraServices).toContain(jasmine.objectContaining({ extraServiceId: 20 }));
      expect(bookingData.entryMethod).toBe('Doorman');
      expect(bookingData.serviceAddress).toBe('1 Main St');
      expect(bookingData.tips).toBe(15);
    });

    it('prices through the shared calculator rather than trusting the preview', () => {
      openWith();
      // 90 base + 2 bedrooms @22.50 + 1 bathroom @22.50 + windows @12
      expect(component.quoteSubTotal).toBeCloseTo(169.5, 2);
    });

    it('reprices when the admin changes a quantity', () => {
      openWith();
      const before = component.quoteSubTotal;
      const bedrooms = component.selectedServices.find(s => s.service.serviceKey === 'bedrooms')!;
      component.incrementService(bedrooms.service);
      expect(component.quoteSubTotal).toBeCloseTo(before + 22.5, 2);
    });

    it('sends an empty email as null, so a cash customer can be booked', () => {
      openWith();
      component.step = 'form';
      component.contactEmail = '   ';

      const { bookingData } = submitWith();
      expect(bookingData.contactEmail).toBeNull();
    });

    it('names the source order for the audit trail without linking to it', () => {
      openWith();
      component.step = 'form';
      const body = submitWith();
      expect(body.recreatedFromOrderId).toBe(SOURCE_ORDER_ID);
    });
  });

  /**
   * DEEP CLEANING IS A CLEANING TYPE, NOT AN EXTRA — the same rule the booking page applies in
   * getFilteredExtraServices. It shipped as a card in the extras list, which let an admin pick
   * "Deep Cleaning" and "Super Deep Cleaning" together and read the price multiplier as an
   * ordinary add-on.
   */
  describe('the cleaning type', () => {
    it('keeps Deep and Super Deep out of the extras list', () => {
      openWith();
      const names = component.selectableExtras.map(e => e.name);
      expect(names).toEqual(['Windows', 'Organizing']);
    });

    it('offers one button per cleaning type the catalogue actually has', () => {
      openWith();
      expect(component.showCleaningTypeSelector).toBeTrue();
      expect(component.cleaningTypeOptions.map(o => o.value))
        .toEqual(['normal', 'deep', 'superdeep']);
    });

    it('reads the type off the source order rather than resetting it', () => {
      openWith(preview({
        prefill: {
          ...preview().prefill,
          extraServices: [{ extraServiceId: 30, quantity: 1, hours: 0 }]
        }
      }));
      expect(component.cleaningType).toBe('deep');
    });

    it('starts at Regular when the order carried no deep extra', () => {
      openWith();
      expect(component.cleaningType).toBe('normal');
    });

    it('applies the multiplier when Deep is picked, and removes it again', () => {
      openWith();
      const regular = component.quoteSubTotal;

      component.selectCleaningType('deep');
      expect(component.cleaningType).toBe('deep');
      expect(component.quoteSubTotal).toBeGreaterThan(regular);

      component.selectCleaningType('normal');
      expect(component.cleaningType).toBe('normal');
      expect(component.quoteSubTotal).toBeCloseTo(regular, 2);
    });

    /** Two multipliers must never stack. */
    it('replaces Deep with Super Deep rather than adding both', () => {
      openWith();
      component.selectCleaningType('deep');
      component.selectCleaningType('superdeep');

      const chosen = component.selectedExtraServices.filter(
        s => s.extraService.isDeepCleaning || s.extraService.isSuperDeepCleaning);
      expect(chosen.length).toBe(1);
      expect(chosen[0].extraService.id).toBe(31);
    });

    /** The type still travels as an extra line — that is what carries the multiplier. */
    it('submits the chosen type as its extra-service line', () => {
      openWith();
      component.selectCleaningType('deep');
      component.step = 'form';

      const { bookingData } = submitWith();
      expect(bookingData.extraServices)
        .toContain(jasmine.objectContaining({ extraServiceId: 30 }));
    });
  });

  describe('extra services', () => {
    it('toggles selection on and off', () => {
      openWith();
      const windows = component.selectableExtras.find(e => e.id === 20)!;
      expect(component.isExtraSelected(windows)).toBeTrue();

      component.toggleExtra(windows);
      expect(component.isExtraSelected(windows)).toBeFalse();

      component.toggleExtra(windows);
      expect(component.isExtraSelected(windows)).toBeTrue();
      expect(component.extraQuantity(windows)).toBe(1);
    });

    it('steps quantity with a floor of one', () => {
      openWith();
      const windows = component.selectableExtras.find(e => e.id === 20)!;
      component.changeExtraQuantity(windows, 1);
      expect(component.extraQuantity(windows)).toBe(2);
      component.changeExtraQuantity(windows, -1);
      component.changeExtraQuantity(windows, -1);
      expect(component.extraQuantity(windows)).toBe(1);
    });

    it('steps hours in half hours with a half-hour floor', () => {
      openWith();
      const organizing = component.selectableExtras.find(e => e.id === 21)!;
      component.toggleExtra(organizing);
      expect(component.extraHours(organizing)).toBe(0.5);

      component.changeExtraHours(organizing, 0.5);
      expect(component.extraHours(organizing)).toBe(1);

      component.changeExtraHours(organizing, -0.5);
      component.changeExtraHours(organizing, -0.5);
      expect(component.extraHours(organizing)).toBe(0.5);
    });
  });

  /**
   * The status default follows the date and the payment method until the admin decides for
   * themselves — a job re-entered after the fact has already happened.
   */
  describe('the initial status', () => {
    it('is Done for a back-dated manual payment', () => {
      openWith();
      component.serviceDate = '2020-01-15';
      component.paymentMethod = 'Cash';
      component.onScheduleChange();
      expect(component.orderStatus).toBe('Done');
    });

    it('is Active for a future manual payment', () => {
      openWith();
      component.serviceDate = '2099-01-15';
      component.paymentMethod = 'Cash';
      component.onScheduleChange();
      expect(component.orderStatus).toBe('Active');
    });

    it('is Pending for Stripe, which is unpaid at creation', () => {
      openWith();
      component.serviceDate = '2099-01-15';
      component.paymentMethod = 'Normal';
      component.onScheduleChange();
      expect(component.orderStatus).toBe('Pending');
    });

    it('stops following the date once the admin picks one', () => {
      openWith();
      component.orderStatus = 'Active';
      component.onStatusChange();
      component.serviceDate = '2020-01-15';
      component.onScheduleChange();
      expect(component.orderStatus).toBe('Active');
    });
  });

  it('reports a failed create instead of leaving the button stuck', () => {
    openWith();
    component.step = 'form';
    component.serviceDate = '2026-03-14';
    component.submit();

    httpMock.expectOne(CREATE_URL).flush(
      { message: 'Target user not found' }, { status: 404, statusText: 'Not Found' });

    expect(component.errorMessage).toContain('Target user not found');
    expect(component.submitting).toBeFalse();
  });
});
