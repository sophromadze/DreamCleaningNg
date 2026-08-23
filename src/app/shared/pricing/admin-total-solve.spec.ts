import { solveSubTotalForTypedTotal } from './admin-total-solve';
import { calculateTotals, round2, SALES_TAX_RATE } from './order-pricing.calculator';

/**
 * Typing a TOTAL has to move this order's discounts exactly as typing a SUBTOTAL does. Before this
 * solve existed, raising the total left the promo frozen at its old dollar amount, so an order that
 * said "25% off" was showing a discount that was no longer 25% of anything — the two fields
 * disagreed and the receipt did not add up.
 *
 * The invariant every case below checks: `subTotal - discounts === discountedSubTotal`, which is
 * what keeps the tax override valid and therefore what makes the customer pay exactly what was
 * typed, to the cent.
 */
describe('solveSubTotalForTypedTotal', () => {
  const noDiscounts = { discountAmount: 0, subscriptionDiscountAmount: 0, loyaltyDiscountAmount: 0 };

  /** Re-price the solve through the real calculator, the way the component does. */
  const chargedTotal = (solved: ReturnType<typeof solveSubTotalForTypedTotal>, tips = 0) =>
    calculateTotals({
      subTotal: solved.subTotal,
      discountAmount: solved.discountAmount,
      subscriptionDiscountAmount: solved.subscriptionDiscountAmount,
      loyaltyDiscountAmount: solved.loyaltyDiscountAmount,
      tips,
      taxOverride: solved.tax,
      taxOverrideBase: solved.discountedSubTotal
    });

  it('scales a percentage promo with the new total', () => {
    // $170 order with a 25% "Women Day" promo. Raise what is owed to $160.
    const solved = solveSubTotalForTypedTotal(
      160,
      { originalSubTotal: 170, originalDiscount: 42.50, originalSubscriptionDiscount: 0, loyaltyPercentage: 0 },
      noDiscounts);

    expect(solved.subTotal).toBe(195.95);
    expect(solved.discountAmount).toBe(48.99);   // still 25%, not the frozen 42.50
    expect(solved.discountedSubTotal).toBe(146.96);
    expect(solved.tax).toBe(13.04);

    // The discount really is still the original rate.
    expect(round2(solved.discountAmount / solved.subTotal)).toBe(0.25);
    expect(chargedTotal(solved).total).toBe(160);
  });

  it('keeps subTotal - discounts landing exactly on the taxed amount', () => {
    // The rounding trap: each discount rounds to cents independently, so the subtotal has to
    // absorb the drift or the override stops matching and the total slips a cent.
    for (const target of [100, 137.77, 160, 249.99, 300, 512.34, 1000]) {
      const solved = solveSubTotalForTypedTotal(
        target,
        { originalSubTotal: 170, originalDiscount: 42.50, originalSubscriptionDiscount: 17, loyaltyPercentage: 5 },
        noDiscounts);

      const discounts = round2(
        solved.discountAmount + solved.subscriptionDiscountAmount + solved.loyaltyDiscountAmount);
      expect(round2(solved.subTotal - discounts)).toBe(solved.discountedSubTotal);
      expect(chargedTotal(solved).total).toBe(target);
    }
  });

  it('scales promo, subscription and loyalty together', () => {
    const solved = solveSubTotalForTypedTotal(
      400,
      { originalSubTotal: 200, originalDiscount: 20, originalSubscriptionDiscount: 10, loyaltyPercentage: 5 },
      noDiscounts);

    // 10% promo, 5% subscription, 5% loyalty = 20% off the solved subtotal.
    expect(round2(solved.discountAmount / solved.subTotal)).toBe(0.10);
    expect(round2(solved.subscriptionDiscountAmount / solved.subTotal)).toBe(0.05);
    expect(round2(solved.loyaltyDiscountAmount / solved.subTotal)).toBe(0.05);
    expect(chargedTotal(solved).total).toBe(400);
  });

  it('leaves an undiscounted order exactly where it was', () => {
    const solved = solveSubTotalForTypedTotal(
      300,
      { originalSubTotal: 200, originalDiscount: 0, originalSubscriptionDiscount: 0, loyaltyPercentage: 0 },
      noDiscounts);

    expect(solved.discountAmount).toBe(0);
    expect(solved.subTotal).toBe(solved.discountedSubTotal);
    expect(chargedTotal(solved).total).toBe(300);
  });

  it('carries discounts unchanged when there is no snapshot to scale against', () => {
    // A legacy order opened with a zero subtotal: nothing to derive a rate from, so the recorded
    // amounts are held and the subtotal absorbs the change — same as the SubTotal path's skip.
    const solved = solveSubTotalForTypedTotal(
      300,
      { originalSubTotal: 0, originalDiscount: 0, originalSubscriptionDiscount: 0, loyaltyPercentage: 0 },
      { discountAmount: 30, subscriptionDiscountAmount: 0, loyaltyDiscountAmount: 0 });

    expect(solved.discountAmount).toBe(30);
    expect(round2(solved.subTotal - 30)).toBe(solved.discountedSubTotal);
    expect(chargedTotal(solved).total).toBe(300);
  });

  it('does not divide by zero when the discounts eat the whole subtotal', () => {
    // 100%-off snapshot: no subtotal produces the target, so the amounts are carried instead.
    const solved = solveSubTotalForTypedTotal(
      200,
      { originalSubTotal: 100, originalDiscount: 100, originalSubscriptionDiscount: 0, loyaltyPercentage: 0 },
      { discountAmount: 100, subscriptionDiscountAmount: 0, loyaltyDiscountAmount: 0 });

    expect(Number.isFinite(solved.subTotal)).toBeTrue();
    expect(solved.discountAmount).toBe(100);
    expect(chargedTotal(solved).total).toBe(200);
  });

  /**
   * COVERAGE OF EVERY DISCOUNT THE SYSTEM CAN PUT ON AN ORDER.
   *
   * An order can carry at most three at once, and they land in three separate columns:
   *   - Order.DiscountAmount             — a promo code OR a special offer (they are mutually
   *                                        exclusive branches in BookingCreationService), which
   *                                        includes the first-time offer
   *   - Order.SubscriptionDiscountAmount — Subscription.DiscountPercentage, always a percentage
   *   - Order.LoyaltyDiscountAmount      — with LoyaltyDiscountPercentage locked alongside it
   *
   * Percentage-based discounts are proportional to the subtotal by construction, so scaling them
   * with it is exactly right. Each case below re-prices through the real calculator and checks the
   * rate survived AND that the customer pays the typed figure.
   */
  describe('every percentage discount type', () => {
    /** Re-derive the effective rate from the solved numbers. */
    const rateOf = (amount: number, subTotal: number) => round2(amount / subTotal);

    it('promo code / special offer percentage (Order.DiscountAmount)', () => {
      // 25% off $170. Both a percentage promo code and a percentage special offer are stored
      // identically, so this covers first-time offers too.
      const solved = solveSubTotalForTypedTotal(
        200,
        { originalSubTotal: 170, originalDiscount: 42.50, originalSubscriptionDiscount: 0, loyaltyPercentage: 0 },
        noDiscounts);

      expect(rateOf(solved.discountAmount, solved.subTotal)).toBe(0.25);
      expect(chargedTotal(solved).total).toBe(200);
    });

    it('subscription percentage (Order.SubscriptionDiscountAmount)', () => {
      // Weekly is 15% — Subscription.DiscountPercentage is the only source, never a flat amount.
      const solved = solveSubTotalForTypedTotal(
        200,
        { originalSubTotal: 170, originalDiscount: 0, originalSubscriptionDiscount: 25.50, loyaltyPercentage: 0 },
        noDiscounts);

      expect(rateOf(solved.subscriptionDiscountAmount, solved.subTotal)).toBe(0.15);
      expect(chargedTotal(solved).total).toBe(200);
    });

    it('loyalty percentage (locked on the order, not inferred from a ratio)', () => {
      const solved = solveSubTotalForTypedTotal(
        200,
        { originalSubTotal: 170, originalDiscount: 0, originalSubscriptionDiscount: 0, loyaltyPercentage: 10 },
        noDiscounts);

      expect(rateOf(solved.loyaltyDiscountAmount, solved.subTotal)).toBe(0.10);
      expect(chargedTotal(solved).total).toBe(200);
    });

    it('all three stacked on one order', () => {
      // 25% promo + 15% subscription + 10% loyalty = half the subtotal discounted away.
      const solved = solveSubTotalForTypedTotal(
        200,
        { originalSubTotal: 170, originalDiscount: 42.50, originalSubscriptionDiscount: 25.50, loyaltyPercentage: 10 },
        noDiscounts);

      expect(solved.subTotal).toBe(367.40);
      expect(solved.discountAmount).toBe(91.85);
      expect(solved.subscriptionDiscountAmount).toBe(55.11);
      expect(solved.loyaltyDiscountAmount).toBe(36.74);

      expect(rateOf(solved.discountAmount, solved.subTotal)).toBe(0.25);
      expect(rateOf(solved.subscriptionDiscountAmount, solved.subTotal)).toBe(0.15);
      expect(rateOf(solved.loyaltyDiscountAmount, solved.subTotal)).toBe(0.10);
      expect(chargedTotal(solved).total).toBe(200);
    });

    it('holds every rate across a wide range of typed totals, up AND down', () => {
      // Lowering the total has to work as well as raising it, and the rates must not drift as the
      // amounts get small enough for cent-rounding to bite.
      for (const target of [40, 92.54, 150, 200, 333.33, 750, 2000]) {
        const solved = solveSubTotalForTypedTotal(
          target,
          { originalSubTotal: 170, originalDiscount: 42.50, originalSubscriptionDiscount: 25.50, loyaltyPercentage: 10 },
          noDiscounts);

        expect(rateOf(solved.discountAmount, solved.subTotal)).toBe(0.25);
        expect(rateOf(solved.subscriptionDiscountAmount, solved.subTotal)).toBe(0.15);
        expect(rateOf(solved.loyaltyDiscountAmount, solved.subTotal)).toBe(0.10);
        expect(chargedTotal(solved).total).toBe(target);
      }
    });

    it('handles an awkward percentage whose dollar amount does not divide evenly', () => {
      // 5% of $137.77 rounds to $6.89, an implied rate of 5.0011% rather than a clean 5%. The
      // re-scale always derives from the ORIGINAL snapshot, never from the previous step, so that
      // sub-cent artefact cannot accumulate across edits.
      const snapshot = {
        originalSubTotal: 137.77, originalDiscount: 6.89,
        originalSubscriptionDiscount: 0, loyaltyPercentage: 0
      };

      const once = solveSubTotalForTypedTotal(300, snapshot, noDiscounts);
      const twice = solveSubTotalForTypedTotal(300, snapshot, {
        discountAmount: once.discountAmount,
        subscriptionDiscountAmount: 0,
        loyaltyDiscountAmount: 0
      });

      expect(twice.subTotal).toBe(once.subTotal);
      expect(twice.discountAmount).toBe(once.discountAmount);
      expect(chargedTotal(once).total).toBe(300);
    });
  });

  /**
   * THE ONE GAP, recorded rather than hidden.
   *
   * PromoCode and SpecialOffer both carry an `IsPercentage` flag, so a discount can be a FLAT
   * amount ("$20 off") instead of a rate. The order stores only the resulting dollar figure — no
   * flag — so nothing downstream can tell the two apart, and the re-scale treats every discount as
   * proportional. A flat $20 therefore grows with the subtotal.
   *
   * This is NOT introduced by the typed-total solve: `rescaleDiscountToSubTotal` has always done
   * this, so editing the SubTotal field has the same behaviour. The test pins what actually
   * happens today so the gap is visible in the suite rather than discovered on an order.
   */
  it('scales a FLAT-amount discount too, which is the known gap', () => {
    // $20 off $200 reads as 10%, and there is nothing stored to say otherwise.
    const solved = solveSubTotalForTypedTotal(
      400,
      { originalSubTotal: 200, originalDiscount: 20, originalSubscriptionDiscount: 0, loyaltyPercentage: 0 },
      noDiscounts);

    // A flat $20 should have stayed $20; it scales because the order does not record the flag.
    expect(solved.discountAmount).toBeGreaterThan(20);
    expect(round2(solved.discountAmount / solved.subTotal)).toBe(0.10);
    // The customer still pays exactly what was typed — the total is right, the ATTRIBUTION is not.
    expect(chargedTotal(solved).total).toBe(400);
  });

  it('adds tips on top without disturbing the solve', () => {
    const solved = solveSubTotalForTypedTotal(
      160,
      { originalSubTotal: 170, originalDiscount: 42.50, originalSubscriptionDiscount: 0, loyaltyPercentage: 0 },
      noDiscounts);

    expect(chargedTotal(solved, 25).total).toBe(185);
    expect(chargedTotal(solved, 25).tax).toBe(solved.tax);
    // Tax is never charged on tips.
    expect(solved.tax).toBe(round2(solved.tax));
    expect(solved.tax).not.toBe(round2((solved.discountedSubTotal + 25) * SALES_TAX_RATE));
  });
});
