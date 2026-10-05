import {
  calculateQuote,
  calculateTotals,
  capFixedDiscount,
  percentOf,
  resolveEditedDiscounts,
  resolveGiftCardAmountToUse,
  resolveLoyaltyStacking,
  round2,
  buildQuoteInputFromSelections
} from './order-pricing.calculator';
import { discountsForSubTotal, solveSubTotalForTypedTotal } from './admin-total-solve';

/**
 * 2026-10 (owner's rules): an order edit prices EXACTLY like booking. These are the browser halves
 * of the backend's EditPricingParityTests, on the same catalogue and the same numbers:
 *
 *   booking   - what the booking page charges for the edited job (its own discount rules)
 *   customer  - the customer order-edit preview (resolveEditedDiscounts from the booked order)
 *   admin     - the admin editor (discountsForSubTotal, and the typed-Total solve)
 *
 * Booking is computed here the way BookingComponent.calculateTotal does it (percentOf /
 * capFixedDiscount, loyalty stacking, then the post-stacking cap), so a change to either side's
 * rule fails this spec.
 */
describe('edit pricing parity (booking = customer edit = admin edit)', () => {
  const BED = { id: 10, name: 'Bedrooms', serviceKey: 'bedrooms', cost: 22.5, timeDuration: 30, isActive: true,
    minValue: 0, maxValue: 6, zeroQuantityCost: 0, zeroQuantityDuration: 0, thresholds: [], rateTiers: [] } as any;
  const BATH = { id: 20, name: 'Bathrooms', serviceKey: 'bathrooms', cost: 22.5, timeDuration: 30, isActive: true,
    minValue: 1, maxValue: 5, thresholds: [], rateTiers: [] } as any;
  const SQFT = { id: 30, name: 'Sq.ft', serviceKey: 'sqft', cost: 0.18, timeDuration: 0.24, isActive: true,
    chargeAboveThreshold: true, rateTiers: [],
    thresholds: [[0, 400], [1, 650], [2, 850], [3, 1000], [4, 1500]].map(([q, inc], i) =>
      ({ id: i + 1, serviceId: 30, sourceServiceId: 10, sourceServiceKey: 'bedrooms', sourceQuantity: q, includedQuantity: inc })) } as any;
  const ST = { id: 1, name: 'Residential Cleaning', basePrice: 90, timeDuration: 120, minimumPrice: 130,
    services: [BED, BATH, SQFT], extraServices: [], isActive: true, hasPoll: false } as any;

  const subTotalOf = (bed: number, bath: number, sqft: number) => calculateQuote(buildQuoteInputFromSelections(ST,
    [{ service: BED, quantity: bed }, { service: BATH, quantity: bath }, { service: SQFT, quantity: sqft }], [])).subTotal;

  const A = subTotalOf(2, 1, 850);   // the job as booked
  const B = subTotalOf(3, 2, 1000);  // the job after the edit

  interface Rule { promoPercent?: number; promoFixed?: number; planPercent?: number; giftCardBalance?: number }

  /** BookingComponent.calculateTotal's discount steps, then the totals and the gift-card draw. */
  function book(subTotal: number, rule: Rule) {
    let plan = rule.planPercent ? percentOf(subTotal, rule.planPercent) : 0;
    let promo = rule.promoPercent ? percentOf(subTotal, rule.promoPercent)
      : rule.promoFixed ? capFixedDiscount(rule.promoFixed, subTotal, 0) : 0;
    const stacked = resolveLoyaltyStacking(0, 0, plan, promo);
    plan = stacked.subscriptionAmount;
    promo = stacked.promoAmount;
    if (rule.promoFixed && promo > 0) promo = capFixedDiscount(rule.promoFixed, subTotal, plan);
    const totals = calculateTotals({ subTotal, discountAmount: promo, subscriptionDiscountAmount: plan });
    const giftCard = rule.giftCardBalance ? resolveGiftCardAmountToUse(rule.giftCardBalance, totals.totalBeforeGiftCard) : 0;
    return { subTotal, promo, plan, tax: totals.tax, total: round2(Math.max(0, totals.totalBeforeGiftCard - giftCard)), giftCard };
  }

  /** The order as booking stored it at A, with the rules it recorded. */
  function storedOrder(rule: Rule) {
    const booked = book(A, rule);
    return {
      originalSubTotal: A,
      discountAmount: booked.promo,
      discountPercent: booked.promo > 0 ? rule.promoPercent ?? null : null,
      discountFixedAmount: booked.promo > 0 ? rule.promoFixed ?? null : null,
      subscriptionDiscountAmount: booked.plan,
      subscriptionDiscountPercent: booked.plan > 0 ? rule.planPercent ?? null : null,
      loyaltyDiscountPercentage: 0,
      giftCardUsed: booked.giftCard
    };
  }

  /** An edit: re-derive the discounts for B, re-draw the gift card against its balance + what A used. */
  function edit(order: ReturnType<typeof storedOrder>, rule: Rule, discounts: { discountAmount: number; subscriptionDiscountAmount: number }) {
    const totals = calculateTotals({ subTotal: B, discountAmount: discounts.discountAmount, subscriptionDiscountAmount: discounts.subscriptionDiscountAmount });
    const balanceLeft = (rule.giftCardBalance ?? 0) - order.giftCardUsed;
    const giftCard = rule.giftCardBalance ? resolveGiftCardAmountToUse(balanceLeft + order.giftCardUsed, totals.totalBeforeGiftCard) : 0;
    return { subTotal: B, promo: discounts.discountAmount, plan: discounts.subscriptionDiscountAmount,
      tax: totals.tax, total: round2(Math.max(0, totals.totalBeforeGiftCard - giftCard)), giftCard };
  }

  const cases: [string, Rule][] = [
    ['a percentage promo', { promoPercent: 20 }],
    ['a fixed promo', { promoFixed: 30 }],
    ['a fixed special offer', { promoFixed: 25 }],
    ['a recurring-plan discount', { planPercent: 15 }],
    ['a percentage promo stacked with a plan', { promoPercent: 20, planPercent: 15 }],
    ['a gift card', { giftCardBalance: 100 }],
    ['a fixed promo larger than the job', { promoFixed: 999 }]
  ];

  cases.forEach(([name, rule]) => {
    it(`stores the same price with ${name}`, () => {
      const expected = book(B, rule);
      const order = storedOrder(rule);

      const customer = edit(order, rule, resolveEditedDiscounts({ ...order, newSubTotal: B }));
      expect(customer).withContext('customer edit').toEqual(expected);

      const admin = edit(order, rule, discountsForSubTotal({
        originalSubTotal: order.originalSubTotal, originalDiscount: order.discountAmount,
        originalSubscriptionDiscount: order.subscriptionDiscountAmount, loyaltyPercentage: 0,
        discountPercent: order.discountPercent, discountFixedAmount: order.discountFixedAmount,
        subscriptionDiscountPercent: order.subscriptionDiscountPercent
      }, B));
      expect(admin).withContext('admin edit').toEqual(expected);
    });
  });

  it('keeps a fixed promo fixed instead of scaling it with the subtotal', () => {
    const order = storedOrder({ promoFixed: 30 });
    expect(resolveEditedDiscounts({ ...order, newSubTotal: B }).discountAmount).toBe(30);
    // The pre-2026-10 behaviour, still used for an order with no recorded rule:
    expect(resolveEditedDiscounts({ ...order, discountFixedAmount: null, newSubTotal: B }).discountAmount)
      .toBe(round2(B * (30 / A)));
  });

  // Same vectors as EditPricingParityTests.PercentOf_RoundsHalfAwayFromZeroInCents (C# decimal).
  ([[1.15, 50, 0.58], [347.53, 20, 69.51], [10.25, 10, 1.03], [202.5, 15, 30.38], [157.5, 11.11, 17.5]] as const)
    .forEach(([sub, pct, expected]) => {
      it(`percentOf(${sub}, ${pct}%) = ${expected}, exactly as the server rounds it`, () => {
        expect(percentOf(sub, pct)).toBe(expected);
      });
    });

  it('a typed Total settles on a subtotal whose rule-derived discounts leave exactly the taxed amount', () => {
    const snapshot = { originalSubTotal: A, originalDiscount: 30, originalSubscriptionDiscount: percentOf(A, 15),
      loyaltyPercentage: 0, discountFixedAmount: 30, subscriptionDiscountPercent: 15 };
    [250, 199.99, 300, 333.33].forEach(typed => {
      const solved = solveSubTotalForTypedTotal(typed, snapshot,
        { discountAmount: 30, subscriptionDiscountAmount: snapshot.originalSubscriptionDiscount, loyaltyDiscountAmount: 0 });
      const serverDiscounts = discountsForSubTotal(snapshot, solved.subTotal); // what the server re-derives
      expect(serverDiscounts.discountAmount).toBe(30);
      expect(round2(solved.subTotal - serverDiscounts.discountAmount - serverDiscounts.subscriptionDiscountAmount))
        .withContext(`typed ${typed}`).toBe(solved.discountedSubTotal);
      expect(round2(solved.discountedSubTotal + solved.tax)).toBe(typed);
    });
  });
});
