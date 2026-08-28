import { ComponentFixture, TestBed } from '@angular/core/testing';

import { OrdersComponent } from './orders.component';
import { round2 } from '../../../shared/pricing/order-pricing.calculator';

import { testProviders } from '../../../../testing/test-providers';
import { AdminService } from '../../../services/admin.service';
import { of } from 'rxjs';

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

  /**
   * Nobody applies an order change without reading it first.
   *
   * A regular Admin's edit goes to a SuperAdmin, who reads a table of "field / current / proposed"
   * rows before approving. Whoever saves DIRECTLY - a SuperAdmin, or an Admin a SuperAdmin has
   * granted it - now reads the same table before the write happens. One function builds the table
   * for both, so the two views cannot drift apart.
   */
  describe('order edit save confirmation', () => {
    /** Minimal order-details shape: only the fields the diff reads. */
    const baseOrder = () => ({
      id: 42,
      contactFirstName: 'Ann',
      contactLastName: 'Lee',
      contactEmail: 'ann@example.com',
      contactPhone: '(212) 555-0134',
      serviceAddress: '5 Main St',
      city: 'Brooklyn',
      state: 'New York',
      zipCode: '11201',
      serviceDate: '2026-09-01T00:00:00',
      serviceTime: '09:00:00',
      totalDuration: 180,
      maidsCount: 1,
      status: 'Active',
      subTotal: 200,
      tax: 17.75,
      tips: 0,
      total: 217.75,
      discountAmount: 0,
      services: [],
      extraServices: []
    }) as any;

    it('lists only the fields that actually changed, with a signed difference', () => {
      const changes = component.computeOrderEditChanges(baseOrder(), {
        contactFirstName: 'Ann',
        subTotal: 250,
        total: 267.75
      } as any);

      const fields = changes.map(c => c.field);
      expect(fields).toContain('SubTotal');
      expect(fields).toContain('Total');
      // Unchanged and unsent fields must never appear, or every save looks like a rewrite.
      expect(fields).not.toContain('Contact First Name');
      expect(fields).not.toContain('Status');

      expect(changes.find(c => c.field === 'SubTotal')!.difference).toBe('+50');
    });

    it('does not report a phone whose only difference is formatting', () => {
      // The order can hold "(212) 555-0134" while the form always submits 10 digits. Comparing
      // raw strings flagged a Phone change on every save that touched nothing.
      const changes = component.computeOrderEditChanges(baseOrder(), { contactPhone: '2125550134' } as any);
      expect(changes.map(c => c.field)).not.toContain('Phone');
    });

    /** An Admin with the update permission — canEditOrder's non-SuperAdmin branch. */
    const asAdmin = (canSaveDirectly: boolean) => {
      component.userRole = 'Admin';
      component.isSuperAdmin = false;
      component.userPermissions = {
        role: 'Admin',
        permissions: {
          canView: true, canCreate: true, canUpdate: true,
          canDelete: false, canActivate: false, canDeactivate: false
        }
      } as any;
      component.canSaveOrderEditsDirectly = canSaveDirectly;
      component.selectedOrder = baseOrder();
      component.editingOrder = true;
      component.editOrderForm = { ...baseOrder(), subTotal: 250, total: 267.75 } as any;
    };

    it('holds the save behind the confirmation modal for a granted admin', () => {
      asAdmin(true);

      component.saveOrderEdit();

      expect(component.showSaveConfirm).toBeTrue();
      // Still in the editor, nothing sent: the write only happens on confirm.
      expect(component.savingOrder).toBeFalse();
      expect(component.editingOrder).toBeTrue();
      expect(component.saveConfirmChanges.length).toBeGreaterThan(0);
    });

    it('discards the pending save when the admin goes back to editing', () => {
      asAdmin(true);

      component.saveOrderEdit();
      component.closeSaveConfirm();

      expect(component.showSaveConfirm).toBeFalse();
      expect(component.saveConfirmChanges).toEqual([]);
      // The form stays open so the admin can adjust rather than retype everything.
      expect(component.editingOrder).toBeTrue();
    });

    it('sends an ungranted admin straight to approval without a confirmation step', () => {
      asAdmin(false);

      component.saveOrderEdit();

      // Their changes are reviewed on the SuperAdmin side; a second review here would be noise.
      expect(component.showSaveConfirm).toBeFalse();
      expect(component.savingOrder).toBeTrue();
    });

    it('always shows the Total row, emphasised, even when nothing moved it', () => {
      // It is the number the customer pays; a reviewer should never have to infer it from the
      // row's absence.
      const changes = component.computeOrderEditChanges(baseOrder(), { specialInstructions: 'Ring twice' } as any);

      const total = changes.find(c => c.field === 'Total');
      expect(total).toBeTruthy();
      expect(total!.emphasised).toBeTrue();
      expect(total!.difference).toBe('—');
      // Pinned last so it reads as the bottom line.
      expect(changes[changes.length - 1]).toBe(total!);
    });

    it('shows the Total delta when the edit moves it', () => {
      const changes = component.computeOrderEditChanges(baseOrder(), { total: 267.75 } as any);

      const total = changes.find(c => c.field === 'Total')!;
      expect(total.difference).toBe('+50');
      expect(total.emphasised).toBeTrue();
    });
  });

  /**
   * Typing a TOTAL instead of a subtotal. The figure is tax-inclusive and post-discount: the
   * editor splits it, keeps the order's recorded discounts, and derives the subtotal from both —
   * so the customer pays exactly what was typed and the order still shows why.
   */
  describe('editable total', () => {
    const TYPED = 300.00;
    const SPLIT_SUBTOTAL = 275.55;
    const SPLIT_TAX = 24.45;

    /** Mirrors what startEditOrder seeds, INCLUDING the discount snapshot the re-scale needs. */
    const openEditorOn = (order: any) => {
      component.selectedOrder = order;
      component.editingOrder = true;
      component.editOrderForm = {
        subTotal: order.subTotal,
        tax: order.tax,
        total: order.total,
        tips: order.tips ?? 0,
        discountAmount: order.discountAmount ?? 0,
        subscriptionDiscountAmount: order.subscriptionDiscountAmount ?? 0,
        loyaltyDiscountAmount: order.loyaltyDiscountAmount ?? 0
      } as any;
      component.editOrderFormOriginalSubTotal = order.subTotal;
      component.editOrderFormOriginalDiscount = order.discountAmount ?? 0;
      component.editOrderFormOriginalSubscriptionDiscount = order.subscriptionDiscountAmount ?? 0;
      component.editOrderFormOriginalLoyaltyPercentage = order.loyaltyDiscountPercentage ?? 0;
      component.editGiftCardAmountToUse = 0;
      component.editGiftCardOriginalUsed = 0;
      component.editOrderTaxOverride = null;
    };

    const plainOrder = (over: any = {}) => ({
      id: 7, services: [], extraServices: [],
      subTotal: 200, tax: 17.75, total: 217.75, tips: 0,
      discountAmount: 0, subscriptionDiscountAmount: 0, loyaltyDiscountAmount: 0,
      pointsRedeemedDiscount: 0, rewardBalanceUsed: 0,
      ...over
    }) as any;

    it('derives the subtotal from a typed total and charges it to the cent', () => {
      openEditorOn(plainOrder());

      component.editOrderTotalInput = TYPED;
      component.onEditTotalChange();

      expect(component.editOrderForm.subTotal).toBe(SPLIT_SUBTOTAL);
      expect(component.editOrderForm.tax).toBe(SPLIT_TAX);
      expect(component.editOrderForm.total).toBe(TYPED);
    });

    it('re-scales the discount with the new total, exactly as the SubTotal field does', () => {
      // $200 order with a $50 (25%) promo. Typing a total must move the promo too, or the order
      // ends up advertising "25% off" while showing a discount that is no longer 25% of anything.
      openEditorOn(plainOrder({ subTotal: 200, discountAmount: 50 }));

      component.editOrderTotalInput = TYPED;
      component.onEditTotalChange();

      expect(component.editOrderForm.discountAmount).toBe(91.85);
      expect(component.editOrderForm.subTotal).toBe(367.40);
      // Still 25%, and the customer still pays exactly what was typed.
      expect(round2(component.editOrderForm.discountAmount! / component.editOrderForm.subTotal!)).toBe(0.25);
      expect(component.editOrderForm.total).toBe(TYPED);
    });

    it('adds tips on top of a typed total without disturbing it', () => {
      openEditorOn(plainOrder({ tips: 40 }));
      component.editOrderForm.tips = 40;

      component.editOrderTotalInput = TYPED;
      component.onEditTotalChange();

      expect(component.editOrderForm.tax).toBe(SPLIT_TAX);
      expect(component.editOrderForm.total).toBe(TYPED + 40);
      // The input stays tip-free, so what was typed is what is still shown.
      expect(component.editOrderTotalInput).toBe(TYPED);
    });

    it('drops the typed total once a discount moves', () => {
      openEditorOn(plainOrder());
      component.editOrderTotalInput = TYPED;
      component.onEditTotalChange();
      expect(component.editOrderTaxOverride).not.toBeNull();

      component.editOrderForm.discountAmount = 25;
      component.onEditDiscountChange();

      // The typed figure no longer describes what is owed, so pricing goes back to the rate math.
      expect(component.editOrderTaxOverride).toBeNull();
      expect(component.editOrderForm.tax).toBe(round2((SPLIT_SUBTOTAL - 25) * 0.08875));
    });

    it('drops the typed total when a subtotal is typed instead', () => {
      openEditorOn(plainOrder());
      component.editOrderTotalInput = TYPED;
      component.onEditTotalChange();

      component.editOrderForm.subTotal = 400;
      component.onEditSubTotalChange();

      expect(component.editOrderTaxOverride).toBeNull();
      expect(component.editOrderForm.tax).toBe(round2(400 * 0.08875));
    });

    /**
     * A real order that could not be edited before this was fixed: $170 subtotal, a $42.50
     * "Women Day" promo and 1000 bubble points worth $10, paying $128.82. The blocker was the
     * POINTS, not the discount — points are a fixed grant and invert perfectly.
     */
    it('inverts through bubble points, which are a fixed credit', () => {
      openEditorOn(plainOrder({
        subTotal: 170, discountAmount: 42.50, pointsRedeemedDiscount: 10
      }));

      expect(component.canEditTotalDirectly()).toBeTrue();

      // Sanity: the order as it stands reads back as what the panel shows.
      component.recalculateEditPricing();
      expect(component.editOrderForm.tax).toBe(11.32);
      expect(component.editOrderTotalInput).toBe(128.82);

      // Now raise what the customer pays to $150.
      component.editOrderTotalInput = 150;
      component.onEditTotalChange();

      // 150 paid + 10 of points = 160 owed; the 25% promo scales with it.
      expect(component.editOrderForm.subTotal).toBe(195.95);
      expect(component.editOrderForm.discountAmount).toBe(48.99);
      expect(component.editOrderForm.tax).toBe(13.04);
      expect(component.editOrderTotalInput).toBe(150);
    });

    it('inverts through a reward balance the same way', () => {
      openEditorOn(plainOrder({ rewardBalanceUsed: 25 }));

      expect(component.canEditTotalDirectly()).toBeTrue();

      component.editOrderTotalInput = 100;
      component.onEditTotalChange();

      // 100 paid + 25 credit = 125 owed, which is what the tax lives inside.
      expect(round2(component.editOrderForm.subTotal! + component.editOrderForm.tax!)).toBe(125);
      expect(component.editOrderTotalInput).toBe(100);
    });

    it('stays read-only only for a gift card', () => {
      // A gift card's draw is min(balance, totalBeforeGiftCard) — a function of the subtotal we
      // would be solving for — so a typed figure has two equally valid readings. Points and
      // rewards have no such problem.
      openEditorOn(plainOrder());
      component.editGiftCardAmountToUse = 30;
      expect(component.canEditTotalDirectly()).toBeFalse();

      component.editGiftCardAmountToUse = 0;
      component.editGiftCardOriginalUsed = 30;
      expect(component.canEditTotalDirectly()).toBeFalse();

      component.editGiftCardOriginalUsed = 0;
      expect(component.canEditTotalDirectly()).toBeTrue();
    });
  });

  /**
   * The internal per-order note shown above Assigned Cleaners. It is admin-only text on its own
   * endpoint — deliberately NOT part of OrderDto, which is the shared shape behind the customer's
   * own order-details page.
   */
  describe('internal order note', () => {
    let adminService: AdminService;

    beforeEach(() => {
      adminService = TestBed.inject(AdminService);
      component.userPermissions = {
        role: 'Admin',
        permissions: { canView: true, canCreate: true, canUpdate: true, canDelete: false }
      } as any;
      component.viewingOrderId = 7;
    });

    it('sends null when the box is cleared, so the row is deleted rather than stored empty', () => {
      const save = spyOn(adminService, 'updateOrderAdminNotes').and.returnValue(of({ orderId: 7 } as any));
      component.orderNoteDraft = '   ';
      (component as any).orderNoteSaved = 'gate code 4412';

      component.saveOrderNote();

      expect(save).toHaveBeenCalledWith(7, null);
      expect(component.orderNoteDraft).toBe('');
    });

    it('trims before saving, and a whitespace-only edit of an empty note is not dirty', () => {
      const save = spyOn(adminService, 'updateOrderAdminNotes').and.returnValue(
        of({ orderId: 7, notes: 'dog on site' } as any));

      component.orderNoteDraft = '  dog on site  ';
      expect(component.orderNoteDirty).toBeTrue();

      component.saveOrderNote();

      expect(save).toHaveBeenCalledWith(7, 'dog on site');
      // Saved text is echoed back, so the Save button goes quiet again.
      expect(component.orderNoteDirty).toBeFalse();
    });

    it('ignores a response that arrives after the panel moved to another order', () => {
      spyOn(adminService, 'updateOrderAdminNotes').and.callFake((..._args: any[]) => {
        component.viewingOrderId = 9;
        return of({ orderId: 7, notes: 'stale' } as any);
      });

      component.orderNoteDraft = 'stale';
      component.saveOrderNote();

      // Order 7's text must not be painted into order 9's panel.
      expect(component.orderNoteDraft).toBe('stale');
      expect((component as any).orderNoteSaved).toBe('');
    });

    it('refuses to save without update rights, mirroring the endpoint permission', () => {
      const save = spyOn(adminService, 'updateOrderAdminNotes');
      component.userPermissions.permissions.canUpdate = false;
      component.isSuperAdmin = false;
      component.orderNoteDraft = 'not allowed';

      component.saveOrderNote();

      expect(component.canEditOrderNote).toBeFalse();
      expect(save).not.toHaveBeenCalled();
    });
  });
/**
   * The status column shows PRESENT-TENSE verbs and one derived label the database never holds.
   * The whole point is that nothing is stored: order #264 was cancelled and then refunded
   * $250.91 of $320.91 (the $70 cancellation fee retained), and it must read RefundH while
   * Order.Status stays "Cancelled" — otherwise OrderBookedFilter.IsRealBooking,
   * OrderStatuses.CanBeHidden/WasPerformed and the statistics grouping all change meaning.
   */
  describe('status column labels', () => {
    const order = (over: any = {}) => ({
      id: 264, status: 'Cancelled', paymentMethod: 'Normal', totalRefundedAmount: 0, ...over
    }) as any;

    it('renders present-tense verbs without touching the stored status', () => {
      const cancelled = order();
      const refunded = order({ status: 'Refunded', totalRefundedAmount: 320.91 });

      expect(component.getStatusDisplayLabel(cancelled)).toBe('Cancel');
      expect(component.getStatusDisplayLabel(refunded)).toBe('Refund');
      // The stored values are untouched — every backend predicate still keys off these.
      expect(cancelled.status).toBe('Cancelled');
      expect(refunded.status).toBe('Refunded');
    });

    it('leaves the other statuses alone', () => {
      expect(component.getStatusDisplayLabel(order({ status: 'Pending' }))).toBe('Pending');
      expect(component.getStatusDisplayLabel(order({ status: 'Active' }))).toBe('Active');
      expect(component.getStatusDisplayLabel(order({ status: 'Done' }))).toBe('Done');
    });

    it('shows RefundH for a cancelled order with the fee retained (order #264)', () => {
      const o = order({ totalRefundedAmount: 250.91 });

      expect(component.isPartiallyRefunded(o)).toBeTrue();
      expect(component.getStatusDisplayLabel(o)).toBe('RefundH');
      expect(component.getStatusClass(o)).toBe('status-refund-partial');
      // RefundH hides the real status, so the tooltip has to name it.
      expect(component.getStatusTitle(o)).toContain('Cancelled');
      expect(component.getStatusTitle(o)).toContain('250.91');
    });

    it('does NOT treat a fully refunded order as partial', () => {
      // The backend flips Status to Refunded in exactly one place, and exactly when the refund
      // clears the charge — so the status IS the full-vs-partial test. Comparing amounts here
      // would misread an order whose total moved after the charge settled.
      const o = order({ status: 'Refunded', totalRefundedAmount: 320.91 });

      expect(component.isPartiallyRefunded(o)).toBeFalse();
      expect(component.getStatusDisplayLabel(o)).toBe('Refund');
      expect(component.getStatusClass(o)).toBe('status-cancelled status-refunded');
      expect(component.getStatusTitle(o)).toBe('');
    });

    it('keeps DoneM for manually paid Done orders', () => {
      expect(component.getStatusDisplayLabel(order({ status: 'Done', paymentMethod: 'Cash' })))
        .toBe('DoneM');
    });

    it('lets RefundH outrank DoneM when a manually paid Done order is part-refunded', () => {
      const o = order({ status: 'Done', paymentMethod: 'Cash', totalRefundedAmount: 40 });

      expect(component.getStatusDisplayLabel(o)).toBe('RefundH');
      expect(component.getStatusTitle(o)).toContain('Done');
    });

    it('ignores an order with no refund recorded', () => {
      expect(component.isPartiallyRefunded(order({ status: 'Active' }))).toBeFalse();
      expect(component.isPartiallyRefunded(order({ status: 'Active', totalRefundedAmount: undefined })))
        .toBeFalse();
    });
  });

  /**
   * ONE ANSWER FOR "HOW LONG IS THIS PER CLEANER" (2026-08).
   *
   * Three surfaces quote it — this panel, the Outgoing Payments page, and the assignment
   * email/SMS the cleaner actually receives — and they must never disagree. Two rules make
   * that true, both of which were broken here:
   *
   *  1. The share is cut from the DISPLAYED (rounded) total, so halving the "12h total" the
   *     admin is reading reproduces the "6h per cleaner" beside it. A raw 710-minute order
   *     used to read "12h total · 5h 30m per cleaner".
   *  2. It divides by max(MaidsCount, assigned) — the same divisor payroll uses — so an order
   *     priced for 2 and staffed with 3 does not claim 6h each while the payouts page and
   *     all three mails say 4h.
   */
  describe('per-cleaner duration', () => {
    const selectOrder = (over: any = {}) => {
      component.selectedOrder = {
        id: 900, totalDuration: 710, maidsCount: 2, cleanerHourlyRate: 21,
        hasCleanersService: false, ...over
      } as any;
    };

    const assign = (orderId: number, count: number) => {
      component.assignedCleanersCache.set(
        orderId, Array.from({ length: count }, (_, i) => ({ cleanerId: i + 1 })) as any);
      component.cleanersLoadedSet.add(orderId);
    };

    it('halves the total it just displayed, not the raw stored minutes', () => {
      selectOrder();
      assign(900, 2);

      // 710 min renders as "12h"; the share must be the half of THAT an admin can check.
      expect(component.formatDuration(710)).toBe('12h');
      expect(component.getSelectedOrderDurationText()).toBe('12h total · 6h per cleaner');
      expect(component.getDisplayCleanerTotalSalary()).toBe(252);
    });

    it('splits across the people actually assigned when they outnumber MaidsCount', () => {
      selectOrder({ maidsCount: 2, totalDuration: 720 });
      assign(900, 3);

      // Payroll pays these three a third each; the panel has to say the same thing.
      expect(component.getSelectedOrderSplitCount()).toBe(3);
      expect(component.getSelectedOrderDurationText()).toBe('12h total · 4h per cleaner');
    });

    it('does not shrink the split when fewer cleaners are on file than were staffed', () => {
      // The third cleaner worked their hours, they are just not in the system. Dividing by the
      // assignment count would pay the two on file for 6h each of a 2-way split.
      selectOrder({ maidsCount: 3, totalDuration: 1080 });
      assign(900, 2);

      expect(component.getSelectedOrderSplitCount()).toBe(3);
      expect(component.getSelectedOrderDurationText()).toBe('18h total · 6h per cleaner');
    });

    it('falls back to MaidsCount while the assignment list is still loading', () => {
      selectOrder({ maidsCount: 2, totalDuration: 720 });
      // Nothing added to cleanersLoadedSet — unknown must not read as "nobody assigned yet
      // and therefore a 1-way split".
      expect(component.getSelectedOrderSplitCount()).toBe(2);
      expect(component.getSelectedOrderDurationText()).toBe('12h total · 6h per cleaner');
    });

    it('drops the per-cleaner half entirely for a single cleaner', () => {
      selectOrder({ maidsCount: 1, totalDuration: 710 });
      assign(900, 1);

      expect(component.getSelectedOrderDurationText()).toBe('12h total');
    });

    it('widens the edit-form hint by the assignments, not just the typed count', () => {
      selectOrder({ maidsCount: 2, totalDuration: 720 });
      assign(900, 3);
      component.editOrderForm = { ...(component.editOrderForm as any), totalDuration: 720, maidsCount: 2 } as any;

      // Typing 2 into Maids does not un-assign the third cleaner, and payroll still pays
      // three ways — so the hint must not promise 6h each.
      expect(component.getEditDurationHintText()).toBe('12h total · 4h per cleaner');
    });
  });
});
