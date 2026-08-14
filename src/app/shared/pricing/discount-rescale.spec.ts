import { rescaleDiscountToSubTotal } from './order-pricing.calculator';

/**
 * DISCOUNT RE-SCALING ACROSS AN EDIT.
 *
 * Shared by the admin order editor and the customer order-edit page — it existed as two
 * copies of the same money math, and the copies had drifted: the admin one skipped the
 * re-scale whenever the subtotal happened to equal its original value, which left the
 * discount one step behind after any round trip.
 *
 * The property that matters is that this is a PURE function of the new subtotal. Deriving
 * the next discount from the current one is what produced the bug.
 */
describe('rescaleDiscountToSubTotal', () => {
  // Order #306: subtotal 563.00 with promo "nika" at 20% → 112.60.
  const SUBTOTAL = 563;
  const DISCOUNT = 112.6;

  it('returns the original discount when the subtotal has not moved', () => {
    expect(rescaleDiscountToSubTotal(DISCOUNT, SUBTOTAL, SUBTOTAL)).toBe(DISCOUNT);
  });

  it('scales with the subtotal', () => {
    expect(rescaleDiscountToSubTotal(DISCOUNT, SUBTOTAL, 540.5)).toBe(108.1);
    expect(rescaleDiscountToSubTotal(DISCOUNT, SUBTOTAL, 585.5)).toBe(117.1);
  });

  it('depends only on the new subtotal, never on the previous result', () => {
    // The old admin behaviour effectively fed the previous result back in; these three
    // must all agree because only the last argument differs.
    const viaDown = rescaleDiscountToSubTotal(DISCOUNT, SUBTOTAL, 540.5);
    const viaUp = rescaleDiscountToSubTotal(DISCOUNT, SUBTOTAL, 585.5);
    expect(viaDown).not.toBe(viaUp);
    expect(rescaleDiscountToSubTotal(DISCOUNT, SUBTOTAL, SUBTOTAL)).toBe(DISCOUNT);
  });

  it('round-trips exactly across the whole quantity grid', () => {
    // Every intermediate subtotal a bathroom step can produce, then back to the original.
    for (let bathrooms = 0; bathrooms <= 10; bathrooms++) {
      const moved = SUBTOTAL + (bathrooms - 2) * 22.5;
      rescaleDiscountToSubTotal(DISCOUNT, SUBTOTAL, moved);
      expect(rescaleDiscountToSubTotal(DISCOUNT, SUBTOTAL, SUBTOTAL)).toBe(DISCOUNT);
    }
  });

  it('is a no-op guard when the original subtotal is zero or missing', () => {
    expect(rescaleDiscountToSubTotal(50, 0, 400)).toBe(0);
    expect(rescaleDiscountToSubTotal(50, -1, 400)).toBe(0);
    expect(rescaleDiscountToSubTotal(50, NaN, 400)).toBe(0);
  });

  it('rounds to cents, half up', () => {
    // 33.33 of 100 scaled to 150 → 49.995, which must land on 50.00 not 49.99.
    expect(rescaleDiscountToSubTotal(33.33, 100, 150)).toBe(50);
  });

  /**
   * NOT a statement about fixed-amount promo semantics. A flat "$50 off" currently scales
   * with the subtotal on BOTH surfaces, because neither can tell a flat code from a
   * percentage one — the order DTO carries the promo code and the resulting dollar amount,
   * but not the promo type. Asserted here so the behaviour is at least written down.
   */
  it('scales a flat-amount promo too — a known limitation, not the desired semantics', () => {
    // A "$50 off" code ought to stay $50; it becomes $48.00 because the ratio is all the
    // surfaces have to go on. Round trips are still exact, which is what this task fixed.
    expect(rescaleDiscountToSubTotal(50, SUBTOTAL, 540.5)).toBe(48);
    expect(rescaleDiscountToSubTotal(50, SUBTOTAL, SUBTOTAL)).toBe(50);
  });
});
