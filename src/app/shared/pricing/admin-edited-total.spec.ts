import {
  calculateTotals,
  round2,
  SALES_TAX_RATE,
  splitTaxInclusiveAmount
} from './order-pricing.calculator';

/**
 * THE ADMIN-TYPED TOTAL — mirror of the backend `AdminEditedTotalTests`.
 *
 * An admin editing an order can type what the customer owes instead of working back from a
 * subtotal, exactly like Custom Pricing at booking. The figure is TAX-INCLUSIVE and POST-discount,
 * so the editor splits it, keeps the order's recorded discounts untouched, and derives the
 * SUBTOTAL from the two. The split tax rides along as `taxOverride`.
 *
 * `taxOverrideBase` is what lets the two callers coexist. It names the amount the tax was split
 * out of:
 *   - Custom Pricing splits a PRE-discount amount → base is the subTotal (the null default), so
 *     any discount voids the override. Long-standing rule, unchanged.
 *   - The admin editor splits a POST-discount amount → base is the discounted subtotal, so the
 *     discounts are expected rather than disqualifying.
 *
 * Collapsing those two into one guard is the regression this file exists to catch.
 */
describe('admin-edited total (tax-inclusive, discount-aware)', () => {
  /** What the admin editor computes when 300.00 is typed. */
  const TYPED = 300.00;
  const SPLIT_SUBTOTAL = 275.55;
  const SPLIT_TAX = 24.45;

  it('splits the typed amount so the halves add back to it exactly', () => {
    const split = splitTaxInclusiveAmount(TYPED);

    expect(split.subTotal).toBe(SPLIT_SUBTOTAL);
    expect(split.tax).toBe(SPLIT_TAX);
    expect(round2(split.subTotal + split.tax)).toBe(TYPED);
  });

  it('charges exactly what was typed even with a discount on the order', () => {
    const promo = 50.00;

    const totals = calculateTotals({
      // What the editor stores: the split subtotal with the discounts added back on.
      subTotal: SPLIT_SUBTOTAL + promo,
      discountAmount: promo,
      taxOverride: SPLIT_TAX,
      taxOverrideBase: SPLIT_SUBTOTAL
    });

    expect(totals.discountedSubTotal).toBe(SPLIT_SUBTOTAL);
    expect(totals.tax).toBe(SPLIT_TAX);
    expect(totals.total).toBe(TYPED);
  });

  /**
   * Pins the cent of drift the override removes. 300.00 is one of the amounts no cent-valued
   * subtotal reaches through the rate math: 275.55 overshoots to 300.01, 275.54 undershoots to
   * 299.99 — so the tax has to come from the typed figure.
   */
  it('misses the typed total by a cent without the override', () => {
    const promo = 50.00;

    const totals = calculateTotals({
      subTotal: SPLIT_SUBTOTAL + promo,
      discountAmount: promo
    });

    expect(totals.total).toBe(300.01);
    expect(totals.total).not.toBe(TYPED);
  });

  it('leaves Custom Pricing alone: with no base, any discount still voids the override', () => {
    const withoutDiscount = calculateTotals({
      subTotal: SPLIT_SUBTOTAL,
      taxOverride: SPLIT_TAX
    });
    expect(withoutDiscount.tax).toBe(SPLIT_TAX);

    const withDiscount = calculateTotals({
      subTotal: SPLIT_SUBTOTAL,
      discountAmount: 10.00,
      taxOverride: SPLIT_TAX
    });
    expect(withDiscount.tax).toBe(round2((SPLIT_SUBTOTAL - 10.00) * SALES_TAX_RATE));
  });

  /**
   * The base is VERIFIED, not trusted. If a discount moves after the total was typed, the override
   * stops applying by itself rather than quietly charging someone else's tax figure.
   */
  it('falls back to the rate math when the base no longer matches', () => {
    const totals = calculateTotals({
      subTotal: SPLIT_SUBTOTAL + 50.00,
      discountAmount: 75.00,           // moved after the total was typed
      taxOverride: SPLIT_TAX,
      taxOverrideBase: SPLIT_SUBTOTAL  // no longer the amount being taxed
    });

    const discounted = round2(SPLIT_SUBTOTAL + 50.00 - 75.00);
    expect(totals.discountedSubTotal).toBe(discounted);
    expect(totals.tax).toBe(round2(discounted * SALES_TAX_RATE));
  });

  /**
   * The override survives a base that only matches AFTER rounding.
   *
   * `discountedSubTotal` is a raw subtraction, and 367.40 - 91.85 is 275.55000000000007 in binary
   * floating point. Comparing that to the base with === threw the override away and slipped the
   * charged total to 300.01. Nothing about the money is wrong here — only the comparison was.
   */
  it('matches the base through floating-point subtraction noise', () => {
    expect(367.40 - 91.85).not.toBe(275.55);   // the trap, stated outright

    const totals = calculateTotals({
      subTotal: 367.40,
      discountAmount: 91.85,
      taxOverride: 24.45,
      taxOverrideBase: 275.55
    });

    expect(totals.tax).toBe(24.45);
    expect(totals.total).toBe(300.00);
  });

  it('adds tips on top without disturbing the typed total', () => {
    const totals = calculateTotals({
      subTotal: SPLIT_SUBTOTAL,
      taxOverride: SPLIT_TAX,
      taxOverrideBase: SPLIT_SUBTOTAL,
      tips: 40.00
    });

    expect(totals.tax).toBe(SPLIT_TAX);
    expect(totals.total).toBe(TYPED + 40.00);
  });
});
