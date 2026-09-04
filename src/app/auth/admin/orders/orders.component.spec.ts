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
  /**
   * The service time is picked as hour / minute / AM-PM. It used to be a free-text "HH:mm" box,
   * and admins misread it - an 8am job typed as 20:00. Storage is unchanged: the picker
   * recomposes the same 24-hour string the DTO has always carried.
   */
  describe('service time picker', () => {
    const setPicker = (time: string | null) => (component as any).setEditTimeFromForm(time);

    it('seeds the three controls from the stored 24-hour time', () => {
      setPicker('13:30');
      expect(component.editTimeHour12).toBe(1);
      expect(component.editTimeMinute).toBe(30);
      expect(component.editTimeMeridiem).toBe('PM');
    });

    it('leaves the hour unset when the order carries no time', () => {
      setPicker(null);
      expect(component.editTimeHour12).toBeNull();

      // Nothing picked yet is not an edit to the time.
      component.editOrderForm = {} as any;
      component.onEditServiceTimeChange();
      expect(component.editOrderForm.serviceTime).toBeNull();
    });

    it('writes back the 24-hour string the DTO carries', () => {
      component.editOrderForm = {} as any;
      component.editTimeHour12 = 6;
      component.editTimeMinute = 30;
      component.editTimeMeridiem = 'PM';
      component.onEditServiceTimeChange();
      expect(component.editOrderForm.serviceTime).toBe('18:30');

      component.editTimeHour12 = 12;
      component.editTimeMinute = 0;
      component.editTimeMeridiem = 'AM';
      component.onEditServiceTimeChange();
      expect(component.editOrderForm.serviceTime).toBe('00:00');
    });

    it('offers an off-grid stored minute rather than rounding it away', () => {
      // A legacy order at 09:07 must still be 09:07 after an edit that never touched the time.
      setPicker('09:07');
      expect(component.editTimeMinuteOptions).toContain(7);
      component.editOrderForm = {} as any;
      component.onEditServiceTimeChange();
      expect(component.editOrderForm.serviceTime).toBe('09:07');
    });

    it('shows the change confirmation in 12-hour form too', () => {
      const changes = component.computeOrderEditChanges(
        { serviceTime: '09:00:00' } as any,
        { serviceTime: '14:30' } as any
      );
      const row = changes.find(c => c.field === 'Service Time')!;
      expect(row.current).toBe('9:00 AM');
      expect(row.proposed).toBe('2:30 PM');
    });

    it('still reports no change when only the stored format differs', () => {
      const changes = component.computeOrderEditChanges(
        { serviceTime: '09:00:00' } as any,
        { serviceTime: '09:00' } as any
      );
      expect(changes.map(c => c.field)).not.toContain('Service Time');
    });
  });

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

    /**
     * A Custom ("Pre-Arranged") order is priced from a TAX-INCLUSIVE amount an admin typed, so
     * its stored subtotal and tax add back to that amount exactly — and re-deriving the tax as
     * round2(subtotal x rate) lands a cent away. $300.00 is one of those amounts: no cent-valued
     * subtotal satisfies S + round2(S x 8.875%) = 300.00.
     *
     * Merely OPENING the editor used to do exactly that re-derivation, so a $300.00 order read
     * $300.01 before anybody touched a field, and the cent went through the approval queue
     * unnoticed. The order's own tax now carries into the session.
     */
    describe('opening the editor on a tax-inclusive (custom-priced) order', () => {
      const customOrder = (over: any = {}) => plainOrder({
        subTotal: SPLIT_SUBTOTAL, tax: SPLIT_TAX, total: TYPED, ...over
      });

      /** startEditOrder seeds the override this way; the resolver is what decides. */
      const seedFrom = (order: any) => {
        openEditorOn(order);
        component.editOrderTaxOverride = (component as any).resolveStoredTaxOverride();
        component.recalculateEditPricing();
      };

      it('does not move the total by a cent', () => {
        seedFrom(customOrder());

        expect(component.editOrderForm.tax).toBe(SPLIT_TAX);
        expect(component.editOrderForm.total).toBe(TYPED);
        expect(component.editOrderTotalInput).toBe(TYPED);
      });

      it('carries the stored tax onto the DTO so the save lands on the same figure', () => {
        seedFrom(customOrder());

        const dto = (component as any).buildOrderEditDto();
        expect(dto.taxOverride).toBe(SPLIT_TAX);
        expect(dto.taxOverrideBase).toBe(SPLIT_SUBTOTAL);
      });

      it('keeps holding while only tips move, since tips sit outside the taxed amount', () => {
        seedFrom(customOrder());

        component.editOrderForm.tips = 20;
        component.recalculateEditPricing();

        expect(component.editOrderForm.tax).toBe(SPLIT_TAX);
        expect(component.editOrderForm.total).toBe(round2(TYPED + 20));
      });

      it('hands pricing back to the rate math the moment the subtotal moves', () => {
        seedFrom(customOrder());

        component.editOrderForm.subTotal = 400;
        component.onEditSubTotalChange();

        expect(component.editOrderTaxOverride).toBeNull();
        expect(component.editOrderForm.tax).toBe(round2(400 * 0.08875));
      });

      it('sends nothing for an ordinary order, whose stored tax already IS the rate math', () => {
        seedFrom(plainOrder());

        expect(component.editOrderTaxOverride).toBeNull();
        expect(component.editOrderForm.total).toBe(217.75);
      });

      it('survives an extras change, which on a custom order moves no money at all', () => {
        // Extras on a pre-arranged type are informational ($0, 0 minutes) and
        // recalcSubtotalFromServicesAndExtras deliberately leaves the subtotal untouched — so
        // nothing invalidates the split tax. Clearing it anyway made ticking an extra onto a
        // $300.00 job re-derive the tax and charge $300.01.
        component.serviceTypesCache = [{ id: 4, isCustom: true } as any];
        seedFrom(customOrder({ serviceTypeId: 4, services: [], extraServices: [] }));

        component.recalcSubtotalFromServicesAndExtras();

        expect(component.editOrderTaxOverride).not.toBeNull();
        expect(component.editOrderForm.subTotal).toBe(SPLIT_SUBTOTAL);
        expect(component.editOrderForm.tax).toBe(SPLIT_TAX);
        expect(component.editOrderForm.total).toBe(TYPED);
      });

      it('still corrects a stored tax that is more than a cent out', () => {
        // Not a tax-inclusive split — a legacy or hand-edited figure. Carrying it would
        // perpetuate the error; only the one-cent rounding gap is ever honoured.
        seedFrom(customOrder({ tax: 0 }));

        expect(component.editOrderTaxOverride).toBeNull();
        expect(component.editOrderForm.tax).toBe(round2(SPLIT_SUBTOTAL * 0.08875));
      });
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
        // cleanerTotalSalary carries what the server would have stored for this shape
        // (720 min / 2 cleaners x $21 = $252), because the panel now READS that column rather
        // than recomputing it - see the "cleaners total salary" block below.
        id: 900, totalDuration: 710, maidsCount: 2, cleanerHourlyRate: 21,
        cleanerTotalSalary: 252, hasCleanersService: false, ...over
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
      // The salary agrees with the label because the stored column was written from the same
      // split. It is read, not recomputed - the recompute is what could not see an override.
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

  /**
   * "Cleaners Total Salary" on the admin Orders panel.
   *
   * The panel used to RECOMPUTE this from TotalDuration x MaidsCount x the order's single rate.
   * That form cannot see a per-cleaner rate or hours override — those live on OrderCleaner and
   * only CleanerPayrollCalculator reads them — so order #315, whose second cleaner was edited
   * down to 3h, showed $200 here against a $175 payout sheet (2026-08-31). The stored column is
   * now the source of truth once anybody is assigned, and the breakdown underneath makes the
   * arithmetic checkable without opening the other screen.
   */
  describe('cleaners total salary', () => {
    const selectOrder = (over: any = {}) => {
      component.selectedOrder = {
        id: 315, totalDuration: 480, maidsCount: 2, cleanerHourlyRate: 25,
        cleanerTotalSalary: 175, hasCleanersService: false, ...over
      } as any;
      component.viewingOrderId = component.selectedOrder!.id;
    };

    const assign = (orderId: number, count: number) => {
      component.assignedCleanersCache.set(
        orderId, Array.from({ length: count }, (_, i) => ({ cleanerId: i + 1 })) as any);
      component.cleanersLoadedSet.add(orderId);
    };

    const line = (over: any = {}) => ({
      cleanerId: 1, firstName: 'Maia', lastName: 'Niauri', isUnassignedSlot: false,
      billableMinutes: 240, hoursOverridden: false, hourlyRate: 25, rateOverridden: false,
      salary: 100, ...over
    });

    it('reads the stored figure once cleaners are assigned, not the MaidsCount estimate', () => {
      selectOrder();
      assign(315, 2);

      // The estimate for this shape is 480/2 = 4h each x 2 x $25 = $200 — which is exactly the
      // wrong answer order #315 displayed. The stored column knows about the 3h override.
      expect(component.getDisplayCleanerTotalSalary()).toBe(175);
    });

    it('falls back to the estimate only when the assignment list is known to be empty', () => {
      selectOrder({ cleanerTotalSalary: 0 });
      component.assignedCleanersCache.set(315, [] as any);
      component.cleanersLoadedSet.add(315);

      // Nobody assigned: no per-cleaner rows exist to be wrong about, so the pre-assignment
      // estimate is the best answer available.
      expect(component.getDisplayCleanerTotalSalary()).toBe(200);
    });

    it('prefers the stored figure while the assignment list is still unknown', () => {
      selectOrder();
      // Nothing in cleanersLoadedSet. Guessing "nobody assigned" here is precisely what
      // produced the wrong number, so unknown must not take the estimate branch.
      expect(component.getDisplayCleanerTotalSalary()).toBe(175);
    });

    it('does not overwrite the stored figure when the edit form is recalculated', () => {
      selectOrder();
      assign(315, 2);
      component.editOrderForm = {
        totalDuration: 480, maidsCount: 2, cleanerHourlyRate: 25, cleanerTotalSalary: 175
      } as any;

      component.recalcCleanerTotalSalary();

      expect(component.editOrderForm.cleanerTotalSalary).toBe(175);
      expect(component.canEditCleanerTotalSalary()).toBe(false);
    });

    it('still recalculates the estimate before anybody is assigned', () => {
      selectOrder({ cleanerTotalSalary: 0 });
      component.assignedCleanersCache.set(315, [] as any);
      component.cleanersLoadedSet.add(315);
      component.editOrderForm = {
        totalDuration: 480, maidsCount: 2, cleanerHourlyRate: 25, cleanerTotalSalary: 0
      } as any;

      component.recalcCleanerTotalSalary();

      expect(component.editOrderForm.cleanerTotalSalary).toBe(200);
      expect(component.canEditCleanerTotalSalary()).toBe(true);
    });

    it('omits cleanerTotalSalary from the save DTO once cleaners are assigned', () => {
      selectOrder();
      assign(315, 2);
      component.editOrderForm = {
        ...(component.editOrderForm as any), cleanerTotalSalary: 175, cleanerHourlyRate: 25
      } as any;

      const dto = (component as any).buildOrderEditDto();

      // The server refuses it in this state, so sending it only put a change row in the
      // confirmation modal describing something that was never going to happen.
      expect(dto.cleanerTotalSalary).toBeUndefined();
      expect(dto.cleanerHourlyRate).toBe(25);
    });

    it('sends cleanerTotalSalary while the order is still unstaffed', () => {
      selectOrder({ cleanerTotalSalary: 0 });
      component.assignedCleanersCache.set(315, [] as any);
      component.cleanersLoadedSet.add(315);
      component.editOrderForm = {
        ...(component.editOrderForm as any), cleanerTotalSalary: 200, cleanerHourlyRate: 25
      } as any;

      expect((component as any).buildOrderEditDto().cleanerTotalSalary).toBe(200);
    });

    it('lists the unstaffed slots so the breakdown adds up to the total', () => {
      selectOrder();
      component.selectedOrderPayroll = {
        orderId: 315, totalSalary: 275, storedTotalSalary: 275, splitCount: 3, assignedCount: 2,
        automaticMinutesPerCleaner: 240, orderHourlyRate: 25,
        lines: [line(), line({ cleanerId: 2, firstName: 'Marekh', billableMinutes: 180, hoursOverridden: true, rateOverridden: true, salary: 75 })],
        unassignedLines: [line({ cleanerId: 0, firstName: '', lastName: '', isUnassignedSlot: true, salary: 100 })]
      } as any;

      const rows = component.getOrderPayrollLines();
      expect(rows.length).toBe(3);
      expect(rows.reduce((sum, r) => sum + r.salary, 0)).toBe(275);
      expect(component.getPayrollLineName(rows[2])).toBe('Unassigned slot');
      expect(component.getPayrollLineHours(rows[1])).toBe('3h');
      expect(rows[1].hoursOverridden).toBe(true);
      expect(rows[1].rateOverridden).toBe(true);
    });

    it('flags a breakdown that disagrees with the column Statistics reads', () => {
      selectOrder();
      component.selectedOrderPayroll = {
        orderId: 315, totalSalary: 175, storedTotalSalary: 200, splitCount: 2, assignedCount: 2,
        automaticMinutesPerCleaner: 240, orderHourlyRate: 25, lines: [], unassignedLines: []
      } as any;

      expect(component.payrollDisagreesWithStored()).toBe(true);

      component.selectedOrderPayroll!.storedTotalSalary = 175;
      expect(component.payrollDisagreesWithStored()).toBe(false);
    });

  });

  /**
   * The staffing warnings come from the server's shared OrderStaffingWarnings, so the Orders tab
   * prints exactly what Outgoing Payments prints for the same job. The component's only job is to
   * render them — recomputing them here is how the two screens would drift apart.
   *
   * They live on their OWN Admin+SuperAdmin path, not on the SuperAdmin-only wage breakdown: the
   * breakdown says what each cleaner is PAID, while these say something is wrong with how the
   * order is STAFFED, which is the Admins' own work.
   */
  describe('staffing warnings', () => {
    const RATE_WARNING = 'Hourly rate is $25/hr, but Deep Cleaning should default to $21/hr.';
    const UNPAID_WARNING = 'The customer has not paid for this order yet.';

    const row = (over: any = {}) => ({
      id: 315, totalDuration: 480, maidsCount: 2, hasCleanersService: false,
      isCustomServiceType: false, status: 'Active', ...over
    } as any);

    beforeEach(() => {
      component.staffingWarningsByOrderId = new Map([[315, [RATE_WARNING, UNPAID_WARNING]]]);
    });

    it('renders the server-built warnings verbatim in the detail panel', () => {
      component.selectedOrder = row();

      expect(component.getOrderStaffingWarnings()).toEqual([RATE_WARNING, UNPAID_WARNING]);
    });

    it('shows nothing rather than an all-clear for an order it has no answer for', () => {
      component.selectedOrder = row({ id: 999 });

      // An absent warning list is not the same claim as "nothing is wrong", so the block has to
      // disappear entirely rather than render as a clean bill of health.
      expect(component.getOrderStaffingWarnings()).toEqual([]);
    });

    /**
     * The row marker keeps its shape; only what it can say about itself grew. The tooltip format
     * is the Outgoing Payments one — reasons joined with " · " on a native title.
     */
    it('lists the reasons in the row tooltip, Outgoing Payments style', () => {
      // Short job at 2 cleaners: the advisory long-job flag does NOT fire, so the tooltip is the
      // server-built warnings alone.
      const order = row({ totalDuration: 300 });

      expect(component.hasStaffingWarnings(order)).toBe(true);
      expect(component.getStaffingWarningTooltip(order)).toBe(`${RATE_WARNING} · ${UNPAID_WARNING}`);
    });

    it('keeps the advisory long-job flag first when both apply', () => {
      // 900 min across 2 cleaners is 7h30 each — over the 6h advisory threshold.
      const order = row({ totalDuration: 900 });

      expect(component.needsStaffingReview(order)).toBe(true);
      expect(component.getStaffingWarningTooltip(order))
        .toBe(`Long job — review cleaner count (over 6h per cleaner) · ${RATE_WARNING} · ${UNPAID_WARNING}`);
    });

    it('still shows the marker for the long-job flag alone, exactly as before', () => {
      component.staffingWarningsByOrderId = new Map();
      const order = row({ totalDuration: 900 });

      expect(component.hasStaffingWarnings(order)).toBe(true);
      expect(component.getStaffingWarningTooltip(order))
        .toBe('Long job — review cleaner count (over 6h per cleaner)');
    });

    it('hides the marker when nothing is wrong', () => {
      component.staffingWarningsByOrderId = new Map();

      expect(component.hasStaffingWarnings(row({ totalDuration: 300 }))).toBe(false);
    });

    /**
     * A targeted refresh must CLEAR the ids it asked about before merging: an order whose last
     * warning was just resolved comes back ABSENT from the response, and a plain merge would
     * leave the stale entry showing a problem that no longer exists.
     */
    it('drops a resolved order\'s warnings on a targeted refresh', () => {
      component.staffingWarningsByOrderId = new Map([[315, [UNPAID_WARNING]], [316, [RATE_WARNING]]]);

      (component as any).applyStaffingWarnings({}, [315]);

      expect(component.staffingWarningsByOrderId.has(315)).toBe(false);
      // An order the refresh did not ask about is left exactly as it was.
      expect(component.staffingWarningsByOrderId.get(316)).toEqual([RATE_WARNING]);
    });

    it('replaces the whole cache on a full load', () => {
      component.staffingWarningsByOrderId = new Map([[999, [UNPAID_WARNING]]]);

      (component as any).applyStaffingWarnings({ '315': [RATE_WARNING] });

      expect(component.staffingWarningsByOrderId.get(315)).toEqual([RATE_WARNING]);
      expect(component.staffingWarningsByOrderId.has(999)).toBe(false);
    });

    /** Moderators are View-only and do not staff orders; the endpoint would 403 them. */
    it('only fetches for Admin and SuperAdmin', () => {
      const spy = spyOn(component['adminService'], 'getOrdersStaffingWarnings')
        .and.returnValue(of({}));
      component.orders = [row()];

      component.isSuperAdmin = false;
      component.userRole = 'Moderator';
      (component as any).preloadStaffingWarnings();
      expect(spy).not.toHaveBeenCalled();

      component.userRole = 'Admin';
      (component as any).preloadStaffingWarnings();
      expect(spy).toHaveBeenCalledTimes(1);

      component.isSuperAdmin = true;
      component.userRole = 'SuperAdmin';
      (component as any).preloadStaffingWarnings();
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });

  /**
   * A same-day 1-hour-gap conflict is ADVICE, not a block (2026-08-31). The rule cannot see that
   * two jobs are on the same block or that the earlier one will finish early — the admin can — so
   * a conflicting cleaner is selectable, warned about, and acknowledged before the assign goes
   * through. The acknowledgement is what the server requires too, so it must never be defaulted on.
   */
  describe('assigning over a schedule conflict', () => {
    const CLEAN = { id: 1, firstName: 'Maia', lastName: 'Niauri', email: 'm@x.com', isAvailable: true };
    const CONFLICTED = {
      id: 2, firstName: 'Marekh', lastName: 'Tabidze', email: 't@x.com', isAvailable: false,
      hasScheduleConflict: true, conflictReason: 'Booked 9:00 AM–1:00 PM that day (needs 60-min gap)'
    };

    beforeEach(() => {
      component.availableCleaners = [CLEAN, CONFLICTED] as any;
      component.assigningOrderId = 315;
      component.selectedCleaners = [];
      component.acknowledgeScheduleConflicts = false;
    });

    it('lets a conflicting cleaner be selected', () => {
      component.toggleCleanerSelection(2);

      expect(component.isCleanerSelected(2)).toBe(true);
      expect(component.selectedCleanersWithConflicts.map(c => c.id)).toEqual([2]);
      expect(component.selectedConflictNames).toBe('Marekh Tabidze');
    });

    it('will not assign until the conflict is acknowledged', () => {
      component.toggleCleanerSelection(2);
      expect(component.conflictAcknowledgementOwed).toBe(true);

      component.acknowledgeScheduleConflicts = true;
      expect(component.conflictAcknowledgementOwed).toBe(false);
    });

    it('asks for nothing when no conflicting cleaner is picked', () => {
      component.toggleCleanerSelection(1);

      expect(component.selectedCleanersWithConflicts).toEqual([]);
      expect(component.conflictAcknowledgementOwed).toBe(false);
    });

    /**
     * An acknowledgement belongs to the selection it was given for. Leaving it armed after the
     * conflicting cleaner is dropped would carry it silently into the next one picked.
     */
    it('drops the acknowledgement when the last conflicting cleaner is de-selected', () => {
      component.toggleCleanerSelection(2);
      component.acknowledgeScheduleConflicts = true;

      component.toggleCleanerSelection(2);

      expect(component.acknowledgeScheduleConflicts).toBe(false);
    });

    it('keeps the acknowledgement while another conflicting cleaner is still picked', () => {
      component.availableCleaners = [CLEAN, CONFLICTED, { ...CONFLICTED, id: 3 }] as any;
      component.toggleCleanerSelection(2);
      component.toggleCleanerSelection(3);
      component.acknowledgeScheduleConflicts = true;

      component.toggleCleanerSelection(3);

      expect(component.acknowledgeScheduleConflicts).toBe(true);
    });

    it('clears the acknowledgement when the modal is closed', () => {
      component.toggleCleanerSelection(2);
      component.acknowledgeScheduleConflicts = true;

      component.closeCleanerModal();

      expect(component.acknowledgeScheduleConflicts).toBe(false);
    });

    /**
     * Conflicting cleaners stay hidden until "Show busy cleaners" is on. Being assignable does
     * not make somebody with another job an hour away the right first answer.
     */
    it('still hides conflicting cleaners from the default list', () => {
      expect(component.availableCleanersFiltered.map(c => c.id)).toEqual([1]);
      expect(component.hiddenBusyCleanersCount).toBe(1);

      component.showBusyCleaners = true;
      expect(component.availableCleanersFiltered.map(c => c.id)).toEqual([1, 2]);
    });

    it('sends the acknowledgement to the server only when it was actually given', () => {
      const cleanerService = (component as any).cleanerService;
      const spy = spyOn(cleanerService, 'assignCleaners').and.returnValue(of({}));

      component.toggleCleanerSelection(1);
      component.assignCleanersToOrder();
      expect(spy.calls.mostRecent().args[4]).toBe(false);

      component.selectedCleaners = [2];
      component.acknowledgeScheduleConflicts = true;
      component.assigningOrderId = 315;
      component.assignCleanersToOrder();
      expect(spy.calls.mostRecent().args[4]).toBe(true);
    });

    it('refuses to fire the request while the acknowledgement is outstanding', () => {
      const cleanerService = (component as any).cleanerService;
      const spy = spyOn(cleanerService, 'assignCleaners').and.returnValue(of({}));

      component.toggleCleanerSelection(2);
      component.assignCleanersToOrder();

      expect(spy).not.toHaveBeenCalled();
      expect(component.errorMessage).toContain('Confirm the schedule conflict');
    });
  });

  /**
   * Assigning a cleaner does not notify them — the assignment mail is a separate, deliberate
   * admin action. So an admin who staffs an order, changes their mind and unassigns before
   * sending anything has told that cleaner nothing, and a "you have been removed" email would
   * be the first and only thing they ever heard about the job. The server decides (it owns
   * AssignmentNotificationSentAt); these assertions cover what the admin is told.
   */
  describe('removing a cleaner who was never notified', () => {
    const NOTIFIED = { id: 1, name: 'Maia Niauri', assignmentNotificationSentAt: '2026-08-30T10:00:00Z' };
    const UNNOTIFIED = { id: 2, name: 'Marekh Tabidze', assignmentNotificationSentAt: null };

    let removeSpy: jasmine.Spy;

    beforeEach(() => {
      component.assignedCleanersCache.set(315, [NOTIFIED, UNNOTIFIED] as any);
      component.cleanersLoadedSet.add(315);

      const adminService = TestBed.inject(AdminService);
      spyOn(adminService, 'getAssignedCleanersWithIds').and.returnValue(of([]));
      spyOn(component as any, 'refreshOrderAfterSave').and.stub();

      const cleanerService = (component as any).cleanerService;
      removeSpy = spyOn(cleanerService, 'removeCleanerFromOrder');
    });

    it('warns that no removal email is coming for an un-notified cleaner', () => {
      const confirmSpy = spyOn(window, 'confirm').and.returnValue(false);

      component.removeCleanerFromOrder(315, 2, 'Marekh Tabidze');

      expect(confirmSpy.calls.mostRecent().args[0]).toContain('no removal email will go out');
      expect(removeSpy).not.toHaveBeenCalled();
    });

    it('still promises the email for a cleaner who received the assignment mail', () => {
      const confirmSpy = spyOn(window, 'confirm').and.returnValue(false);

      component.removeCleanerFromOrder(315, 1, 'Maia Niauri');

      expect(confirmSpy.calls.mostRecent().args[0]).toContain('will receive an email notification');
    });

    it('reports what the server actually did rather than assuming a send', () => {
      spyOn(window, 'confirm').and.returnValue(true);
      removeSpy.and.returnValue(of({ message: 'ok', removalNotificationSent: false }));

      component.removeCleanerFromOrder(315, 2, 'Marekh Tabidze');

      expect(component.successMessage).toContain('No email was sent');
    });

    it('says the cleaner was notified when the server sent the mail', () => {
      spyOn(window, 'confirm').and.returnValue(true);
      removeSpy.and.returnValue(of({ message: 'ok', removalNotificationSent: true }));

      component.removeCleanerFromOrder(315, 1, 'Maia Niauri');

      expect(component.successMessage).toContain('notified via email');
    });
  });
});
