import { ComponentFixture, TestBed } from '@angular/core/testing';

import { OrdersComponent } from './orders.component';
import { round2 } from '../../../shared/pricing/order-pricing.calculator';

import { testProviders } from '../../../../testing/test-providers';

describe('OrdersComponent', () => {
  let component: OrdersComponent;
  let fixture: ComponentFixture<OrdersComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [...testProviders],
      imports: [OrdersComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(OrdersComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  /**
   * The admin editor shares the bedrooms→sq.ft rule with booking and order-edit, but NOT the
   * slider: Sq.ft here is a free number input with no min attribute (that is what lets admins
   * enter off-grid values like 2650 in the first place), so the floor exists only in code.
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

    const bedroomsDef = {
      id: BEDROOMS_ID, name: 'Bedrooms', serviceKey: 'bedrooms', cost: 25, timeDuration: 30,
      serviceTypeId: 1, inputType: 'dropdown', isRangeInput: false, isActive: true,
      minValue: 0, maxValue: 10, stepValue: 1, displayOrder: 1,
      zeroQuantityCost: 10, zeroQuantityDuration: 30
    } as any;

    const sqftDef = {
      id: SQFT_ID, name: 'Square Feet', serviceKey: 'sqft', cost: 0.05, timeDuration: 0.05,
      serviceTypeId: 1, inputType: 'number', isRangeInput: false, isActive: true,
      minValue: 400, maxValue: 5000, stepValue: 100, displayOrder: 3,
      chargeAboveThreshold: true, thresholds: sqftThresholds
    } as any;

    /**
     * Seed the edit form. Row order matches the ORDER's rows (DB order), and the catalog
     * definition for each row is resolved by index — so the fixture stubs that resolution.
     */
    function seedEditForm(rows: { def: any; quantity: number }[]) {
      component.editOrderForm = {
        services: rows.map(r => ({ orderServiceId: r.def.id, quantity: r.quantity, cost: 0 })),
        extraServices: []
      } as any;
      component.editOrderFormPrevServiceQuantities = rows.map(r => r.quantity);
      spyOn<any>(component, 'getEditServiceDefinition').and.callFake((i: number) => rows[i].def);
      spyOn<any>(component, 'getEditOrderServiceType').and.returnValue({
        id: 1, services: [bedroomsDef, sqftDef]
      });
      spyOn<any>(component, 'recalcSubtotalFromServicesAndExtras');
    }

    const rowQuantity = (index: number) => component.editOrderForm.services![index].quantity;

    it('preserves a sq.ft raised above the floor when bedrooms change', () => {
      seedEditForm([{ def: bedroomsDef, quantity: 2 }, { def: sqftDef, quantity: 2650 }]);

      component.editOrderForm.services![0].quantity = 3;
      component.onEditServiceQuantityChange(component.editOrderForm.services![0], 0);

      expect(rowQuantity(1)).toBe(2650);
    });

    it('tracks the floor downward when sq.ft was sitting on the old floor', () => {
      seedEditForm([{ def: bedroomsDef, quantity: 3 }, { def: sqftDef, quantity: 1000 }]);

      component.editOrderForm.services![0].quantity = 2;
      component.onEditServiceQuantityChange(component.editOrderForm.services![0], 0);

      expect(rowQuantity(1)).toBe(850);
    });

    /**
     * The zero-quantity branch returns early, so the bedrooms gate added there is the ONLY
     * thing that keeps a studio from stopping the linkage. Bedrooms = 0 must still sync.
     */
    it('still syncs sq.ft when bedrooms drop to 0 (studio)', () => {
      seedEditForm([{ def: bedroomsDef, quantity: 1 }, { def: sqftDef, quantity: 650 }]);

      component.editOrderForm.services![0].quantity = 0;
      component.onEditServiceQuantityChange(component.editOrderForm.services![0], 0);

      // 650 was the 1bd floor, so it tracks down to the studio floor of 400.
      expect(rowQuantity(1)).toBe(400);
    });

    it('keeps a chosen sq.ft when bedrooms drop to 0', () => {
      seedEditForm([{ def: bedroomsDef, quantity: 1 }, { def: sqftDef, quantity: 2650 }]);

      component.editOrderForm.services![0].quantity = 0;
      component.onEditServiceQuantityChange(component.editOrderForm.services![0], 0);

      expect(rowQuantity(1)).toBe(2650);
    });

    /**
     * The zero-quantity branch used to sync sq.ft for ANY row that hit 0 while carrying a
     * zero-quantity cost, re-deriving it as though the order had become a studio.
     */
    it('does not touch sq.ft when a non-bedrooms zero-quantity row hits 0', () => {
      const otherDef = {
        id: 103, name: 'Windows', serviceKey: 'windows', cost: 5, timeDuration: 10,
        serviceTypeId: 1, inputType: 'dropdown', isRangeInput: false, isActive: true,
        zeroQuantityCost: 0, zeroQuantityDuration: 0
      } as any;
      seedEditForm([
        { def: bedroomsDef, quantity: 3 },
        { def: sqftDef, quantity: 2650 },
        { def: otherDef, quantity: 2 }
      ]);

      component.editOrderForm.services![2].quantity = 0;
      component.onEditServiceQuantityChange(component.editOrderForm.services![2], 2);

      expect(rowQuantity(1)).toBe(2650);
    });

    it('floors a sq.ft typed below the current bedroom allowance', () => {
      // No min attribute on the input, so the floor is enforced here or nowhere.
      seedEditForm([{ def: bedroomsDef, quantity: 3 }, { def: sqftDef, quantity: 1000 }]);

      component.editOrderForm.services![1].quantity = 500;
      component.onEditServiceQuantityChange(component.editOrderForm.services![1], 1);

      expect(rowQuantity(1)).toBe(1000);
    });
  });

  /**
   * DISCOUNT ROUND TRIPS MUST BE IDEMPOTENT.
   *
   * The original bug (order #306, promo "nika" = 20%, subtotal 563.00): the discount re-scale
   * was gated on `subTotal !== editOrderFormOriginalSubTotal` and wrote back to the same field
   * it read. So once a quantity change returned the subtotal to its original value the gate
   * went false, the re-scale was skipped, and the PREVIOUS step's discount survived:
   *   bathrooms 2→1→2 → subtotal 563.00 but discount 108.10 (20% of 540.50)
   *   bathrooms 2→3→2 → subtotal 563.00 but discount 117.10 (20% of 585.50)
   * against a correct 112.60. Tax and total then followed the wrong discount.
   *
   * The discount is now re-scaled from the ORIGINAL snapshot on every subtotal change, so it
   * is a pure function of the current subtotal.
   */
  describe('discount round trips', () => {
    const ORIGINAL_SUBTOTAL = 563;
    const BATHROOM_UNIT = 22.5;

    /**
     * Put the component in "edit modal open" state with a known discount snapshot, and stub
     * the subtotal source so a quantity step moves it by exactly one bathroom.
     */
    function openEditWith(originalDiscount: number, extras: Partial<any> = {}) {
      component.selectedOrder = {
        id: 306, subTotal: ORIGINAL_SUBTOTAL, discountAmount: originalDiscount,
        pointsRedeemedDiscount: 0, rewardBalanceUsed: 0,
        ...extras
      } as any;
      component.editingOrder = true;
      component.editOrderForm = {
        subTotal: ORIGINAL_SUBTOTAL,
        discountAmount: originalDiscount,
        subscriptionDiscountAmount: extras['subscriptionDiscountAmount'] ?? 0,
        loyaltyDiscountAmount: extras['loyaltyDiscountAmount'] ?? 0,
        tips: 0,
        services: [{ orderServiceId: 1, quantity: 2, cost: 0 }],
        extraServices: []
      } as any;
      component.editOrderFormOriginalSubTotal = ORIGINAL_SUBTOTAL;
      component.editOrderFormOriginalDiscount = originalDiscount;
      component.editOrderFormOriginalSubscriptionDiscount = extras['subscriptionDiscountAmount'] ?? 0;
      component.editOrderFormOriginalLoyaltyDiscount = extras['loyaltyDiscountAmount'] ?? 0;
      component.editOrderFormOriginalLoyaltyPercentage = extras['loyaltyDiscountPercentage'] ?? 0;
      component.editGiftCardAvailableBalance = 0;
      component.editGiftCardOriginalUsed = extras['giftCardAmountUsed'] ?? 0;

      // The subtotal normally comes from the shared quote; drive it straight off the bathroom
      // quantity so these specs exercise the discount chain, not the service pricing.
      spyOn<any>(component, 'buildEditQuote').and.returnValue(null);
      spyOn<any>(component, 'recalcEditDurationAndMaids');
      spyOn<any>(component, 'recalcCleanerTotalSalary');
      spyOn<any>(component, 'getEditOrderServiceType').and.returnValue({ id: 1, basePrice: 0, services: [] });
    }

    /** Set the bathroom count and run the same path a quantity change runs. */
    function setBathrooms(count: number) {
      component.editOrderForm.services![0].quantity = count;
      component.editOrderForm.services![0].cost =
        round2(ORIGINAL_SUBTOTAL + (count - 2) * BATHROOM_UNIT);
      component.recalcSubtotalFromServicesAndExtras();
    }

    function snapshot() {
      return {
        subTotal: round2(Number(component.editOrderForm.subTotal)),
        discount: round2(Number(component.editOrderForm.discountAmount)),
        tax: round2(Number(component.editOrderForm.tax)),
        total: round2(Number(component.editOrderForm.total))
      };
    }

    describe('percentage promo (20% of 563.00)', () => {
      // 563.00 × 20% = 112.60
      beforeEach(() => openEditWith(112.6));

      it('reproduces the documented starting figures', () => {
        setBathrooms(2);

        const start = snapshot();
        expect(start.subTotal).toBe(563);
        expect(start.discount).toBe(112.6);
        // 563.00 − 112.60 = 450.40; 450.40 × 8.875% = 39.97
        expect(start.tax).toBe(39.97);
        expect(start.total).toBe(490.37);
      });

      it('returns to the starting figures after quantity down-then-up', () => {
        setBathrooms(2);
        const start = snapshot();

        setBathrooms(1);
        expect(snapshot().discount).toBe(108.1); // 20% of 540.50 — the old stuck value

        setBathrooms(2);
        expect(snapshot()).toEqual(start);
      });

      it('returns to the starting figures after quantity up-then-down', () => {
        setBathrooms(2);
        const start = snapshot();

        setBathrooms(3);
        expect(snapshot().discount).toBe(117.1); // 20% of 585.50 — the other old stuck value

        setBathrooms(2);
        expect(snapshot()).toEqual(start);
      });

      it('survives a longer wander back to the same subtotal', () => {
        setBathrooms(2);
        const start = snapshot();

        setBathrooms(4);
        setBathrooms(1);
        setBathrooms(3);
        setBathrooms(2);

        expect(snapshot()).toEqual(start);
      });
    });

    /**
     * IDEMPOTENCY ONLY — this does NOT cover fixed-amount promo SEMANTICS.
     *
     * A flat "$50 off" code currently SCALES with the subtotal on BOTH the admin editor and the
     * customer order-edit page, because neither surface can tell a flat code from a percentage
     * one: the order DTO exposes the promo code string and the resulting dollar amount, but not
     * the promo type. These specs assert only that a round trip returns to where it started.
     * They will still pass if flat-amount scaling is later fixed to hold $50 constant — that
     * change needs the promo type on the order DTO and is a separate task.
     */
    describe('fixed-amount promo ($50 off 563.00) — round-trip identity only', () => {
      beforeEach(() => openEditWith(50));

      it('returns to the starting figures after quantity down-then-up', () => {
        setBathrooms(2);
        const start = snapshot();

        setBathrooms(1);
        setBathrooms(2);

        expect(snapshot()).toEqual(start);
      });

      it('returns to the starting figures after quantity up-then-down', () => {
        setBathrooms(2);
        const start = snapshot();

        setBathrooms(3);
        setBathrooms(2);

        expect(snapshot()).toEqual(start);
      });
    });

    /**
     * The Discount field is an editable input whose (ngModelChange) calls recalculateEditPricing
     * directly. Re-scaling unconditionally — the naive fix for the round-trip bug — would
     * overwrite a hand-typed amount on every keystroke and make the field unusable.
     */
    describe('a hand-typed discount', () => {
      beforeEach(() => openEditWith(112.6));

      it('survives while the subtotal is unchanged', () => {
        setBathrooms(2);

        component.editOrderForm.discountAmount = 200;
        component.recalculateEditPricing();

        expect(round2(Number(component.editOrderForm.discountAmount))).toBe(200);
        // 563.00 − 200 = 363.00; 363.00 × 8.875% = 32.22
        expect(round2(Number(component.editOrderForm.tax))).toBe(32.22);
      });

      it('yields to the ratio once the subtotal moves', () => {
        setBathrooms(2);
        component.editOrderForm.discountAmount = 200;
        component.recalculateEditPricing();

        setBathrooms(1);

        expect(round2(Number(component.editOrderForm.discountAmount))).toBe(108.1);
      });

      it('yields to the ratio when the subtotal is typed by hand', () => {
        // The SubTotal input passes rederive=true, so it follows the same rule as a
        // quantity change rather than the Discount input's rule.
        setBathrooms(2);

        component.editOrderForm.subTotal = 540.5;
        component.recalculateEditPricing(true);

        expect(round2(Number(component.editOrderForm.discountAmount))).toBe(108.1);

        component.editOrderForm.subTotal = 563;
        component.recalculateEditPricing(true);

        expect(round2(Number(component.editOrderForm.discountAmount))).toBe(112.6);
      });
    });

    /**
     * Pins the read-and-mutate-the-same-field pattern from coming back: recalculating with no
     * input change must be a fixed point, not a value that drifts each time it is called.
     */
    it('is stable when recalculated repeatedly with no input change', () => {
      openEditWith(112.6);
      setBathrooms(2);
      const start = snapshot();

      for (let i = 0; i < 5; i++) {
        component.recalculateEditPricing();
        expect(snapshot()).toEqual(start);
      }

      // …and through the subtotal path too, which is the one that re-scales.
      for (let i = 0; i < 5; i++) {
        component.recalcSubtotalFromServicesAndExtras();
        expect(snapshot()).toEqual(start);
      }
    });

    /** The other money fields are separate inputs and must ride through untouched. */
    it('leaves subscription, loyalty, gift card and points untouched across a round trip', () => {
      openEditWith(112.6, {
        subscriptionDiscountAmount: 28.15,   // 5% of 563.00
        loyaltyDiscountAmount: 16.89,        // 3% of 563.00
        loyaltyDiscountPercentage: 3,
        pointsRedeemedDiscount: 10,
        rewardBalanceUsed: 0
      });
      setBathrooms(2);
      const start = {
        ...snapshot(),
        subscription: round2(Number(component.editOrderForm.subscriptionDiscountAmount)),
        loyalty: round2(Number(component.editOrderForm.loyaltyDiscountAmount))
      };

      setBathrooms(3);
      setBathrooms(2);

      expect({
        ...snapshot(),
        subscription: round2(Number(component.editOrderForm.subscriptionDiscountAmount)),
        loyalty: round2(Number(component.editOrderForm.loyaltyDiscountAmount))
      }).toEqual(start);
      // The $10 points deduction is applied off the end and never re-derived.
      expect(start.total).toBe(round2(start.subTotal - start.discount - start.subscription
        - start.loyalty + start.tax - 10));
    });
  });
  /**
   * "This customer has no email address on their account."
   *
   * The order's contactEmail is frozen at booking time, so a no-email cash account routinely
   * owns an order that displays a real-looking address — admins read the skipped email as a bug.
   * The panel must warn off the ACCOUNT flag, and each send control must state what it really
   * does: the payment link uses the account address only, while the reminder / updated-payment
   * mails fall back to the order's own address (resolved server-side).
   */
  describe('no account email warning', () => {
    const orderWith = (extra: any) => ({ id: 5, userId: 9, contactEmail: '', ...extra } as any);

    it('flags the account even when the order carries a real-looking address', () => {
      component.selectedOrder = orderWith({
        contactEmail: 'typed.on.order@example.com',
        customerHasNoAccountEmail: true,
        customerAccountEmail: null,
        notificationEmailTarget: 'typed.on.order@example.com'
      });

      expect(component.customerHasNoAccountEmail).toBe(true);
      // The reminder path still reaches that address, so the panel names it instead of
      // claiming nothing can be sent.
      expect(component.notificationEmailTarget).toBe('typed.on.order@example.com');
    });

    it('reports no email target at all when neither the order nor the account has one', () => {
      component.selectedOrder = orderWith({
        customerHasNoAccountEmail: true,
        customerAccountEmail: null,
        notificationEmailTarget: null
      });

      expect(component.customerHasNoAccountEmail).toBe(true);
      expect(component.notificationEmailTarget).toBe('');
    });

    it('opens the payment-link modal with email unchecked for a no-email account', () => {
      component.selectedOrder = orderWith({ customerHasNoAccountEmail: true });

      component.openSendPaymentLinkModal();

      expect(component.sendPaymentLinkChannels).toEqual({ email: false, sms: true });
    });

    it('keeps both channels checked for an ordinary account', () => {
      component.selectedOrder = orderWith({
        contactEmail: 'real@example.com',
        customerHasNoAccountEmail: false,
        customerAccountEmail: 'real@example.com',
        notificationEmailTarget: 'real@example.com'
      });

      component.openSendPaymentLinkModal();

      expect(component.sendPaymentLinkChannels).toEqual({ email: true, sms: true });
      // Account and order agree — nothing to point out.
      expect(component.differingAccountEmail).toBeNull();
    });

    it('surfaces an account address that disagrees with the order contact', () => {
      component.selectedOrder = orderWith({
        contactEmail: 'old.typo@example.com',
        customerHasNoAccountEmail: false,
        customerAccountEmail: 'corrected@example.com',
        notificationEmailTarget: 'old.typo@example.com'
      });

      expect(component.differingAccountEmail).toBe('corrected@example.com');
    });
  });
});
