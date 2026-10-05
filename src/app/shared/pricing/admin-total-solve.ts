/**
 * Admin order editor: solve backwards from a typed TOTAL to the subtotal and discounts behind it.
 *
 * Editing the SubTotal re-derives this order's discounts, because a 25% promo on a bigger job is a
 * bigger promo. Editing the TOTAL has to do the same thing or the two fields disagree: raising the
 * total used to leave the promo frozen at its old dollar amount, so the order ended up showing a
 * "25%" discount that was no longer 25% of anything.
 *
 * That makes it a circular definition — the discounts depend on the subtotal, and the subtotal is
 * what is left once the discounts come off the typed figure. Every discount is either proportional
 * to the subtotal or a fixed amount, so the closed form gives a close first estimate:
 *
 *     S - (k x S + F) = D        =>        S = (D + F) / (1 - k)
 *
 * where D is the discounted subtotal split out of the typed total, k is the combined proportional
 * rate (a recorded percentage, or a ratio off the snapshot for an order with no recorded rule, plus
 * the locked loyalty percentage) and F is a fixed-amount promo, which does not scale.
 *
 * The estimate is then settled by iterating on the SAME rule the server stores with
 * (resolveEditedDiscounts, 2026-10): the server re-derives every discount from the subtotal it is
 * sent, so the subtotal has to be one whose rule-derived discounts leave exactly D — otherwise the
 * tax override's base no longer matches and the charged total slips a cent.
 *
 * WHY THIS HAS NO BACKEND TWIN, unlike everything else in this folder: the server never repeats
 * the solve. It receives the solved subtotal, re-derives the discounts and the total through the
 * shared calculator, and uses `taxOverrideBase` to VERIFY the split rather than trust it (see
 * OrderPricingCalculator.CalculateTotals). Mirroring this file would be dead code on that side,
 * and dead code is how mirrors drift.
 */

import {
  resolveEditedDiscounts,
  round2,
  splitTaxInclusiveAmount
} from './order-pricing.calculator';

/** The discounts as they stood when the editor opened, and the subtotal they were recorded against. */
export interface EditDiscountSnapshot {
  originalSubTotal: number;
  originalDiscount: number;
  originalSubscriptionDiscount: number;
  /** Loyalty locks a PERCENTAGE at booking time, so it scales off that rather than off a ratio. */
  loyaltyPercentage: number;
  /** The booking rules recorded on the order (OrderDto); null/absent = no rule, scale by ratio. */
  discountPercent?: number | null;
  discountFixedAmount?: number | null;
  subscriptionDiscountPercent?: number | null;
  /** Stored loyalty amount — only used when no percentage is locked. */
  loyaltyDiscountAmount?: number;
}

/** Whatever the form currently holds — used when there is nothing to derive the discounts from. */
export interface EditDiscountAmounts {
  discountAmount: number;
  subscriptionDiscountAmount: number;
  loyaltyDiscountAmount: number;
}

export interface SolvedTotal extends EditDiscountAmounts {
  subTotal: number;
  /** The amount actually being taxed — pass as `taxOverrideBase`. */
  discountedSubTotal: number;
  /** The exact tax contained in the target amount — pass as `taxOverride`. */
  tax: number;
}

/** The discounts the order's rules give on a subtotal — exactly what the server will store. */
export function discountsForSubTotal(snapshot: EditDiscountSnapshot, subTotal: number): EditDiscountAmounts {
  return resolveEditedDiscounts({
    originalSubTotal: snapshot.originalSubTotal,
    newSubTotal: subTotal,
    discountAmount: snapshot.originalDiscount,
    discountPercent: snapshot.discountPercent,
    discountFixedAmount: snapshot.discountFixedAmount,
    subscriptionDiscountAmount: snapshot.originalSubscriptionDiscount,
    subscriptionDiscountPercent: snapshot.subscriptionDiscountPercent,
    loyaltyDiscountPercentage: snapshot.loyaltyPercentage,
    loyaltyDiscountAmount: snapshot.loyaltyDiscountAmount
  });
}

const sum = (d: EditDiscountAmounts) => d.discountAmount + d.subscriptionDiscountAmount + d.loyaltyDiscountAmount;

/**
 * @param targetOwed the tax-inclusive amount owed BEFORE points / reward credits come off, i.e.
 *   what the admin typed plus those credits. This is the figure the tax lives inside.
 */
export function solveSubTotalForTypedTotal(
  targetOwed: number,
  snapshot: EditDiscountSnapshot,
  current: EditDiscountAmounts
): SolvedTotal {
  const { subTotal: discountedSubTotal, tax } = splitTaxInclusiveAmount(targetOwed);

  const percent = Number(snapshot.discountPercent ?? 0) || 0;
  const fixed = Number(snapshot.discountFixedAmount ?? 0) || 0;
  const subscriptionPercent = Number(snapshot.subscriptionDiscountPercent ?? 0) || 0;
  const hasRule = percent > 0 || fixed > 0 || subscriptionPercent > 0 || snapshot.loyaltyPercentage > 0;
  const scales = snapshot.originalSubTotal > 0;

  // Nothing to derive the discounts from (a legacy order opened with a zero subtotal and no
  // recorded rule): hold every recorded discount where it is and let the subtotal absorb the
  // change — the same thing the SubTotal path does.
  const carryAll = (): SolvedTotal => ({
    subTotal: round2(discountedSubTotal + sum(current)),
    ...current,
    discountedSubTotal,
    tax
  });
  if (!scales && !hasRule) return carryAll();

  const ratio = (amount: number) => (scales ? amount / snapshot.originalSubTotal : 0);
  const rate =
    (percent > 0 ? percent / 100 : fixed > 0 ? 0 : ratio(snapshot.originalDiscount)) +
    (subscriptionPercent > 0 ? subscriptionPercent / 100 : ratio(snapshot.originalSubscriptionDiscount)) +
    (snapshot.loyaltyPercentage > 0 ? snapshot.loyaltyPercentage / 100 : ratio(snapshot.loyaltyDiscountAmount ?? 0));

  // Discounts totalling the whole subtotal leave no subtotal that produces the target: there is
  // nothing to solve, so fall back to carrying the recorded amounts unchanged.
  if (!(rate < 1)) return carryAll();

  // Closed-form estimate, then settle on a subtotal whose rule-derived discounts leave exactly D.
  // Each step moves by less than the last (the rate is below 1), so this lands within a few
  // iterations; the cap only guards against a one-cent rounding oscillation.
  let subTotal = round2((discountedSubTotal + fixed) / (1 - rate));
  for (let i = 0; i < 20; i++) {
    const next = round2(discountedSubTotal + sum(discountsForSubTotal(snapshot, subTotal)));
    if (next === subTotal) break;
    subTotal = next;
  }

  return {
    subTotal,
    ...discountsForSubTotal(snapshot, subTotal),
    discountedSubTotal,
    tax
  };
}
