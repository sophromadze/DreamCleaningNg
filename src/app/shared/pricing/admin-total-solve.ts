/**
 * Admin order editor: solve backwards from a typed TOTAL to the subtotal and discounts behind it.
 *
 * Editing the SubTotal re-scales this order's discounts, because a 25% promo on a bigger job is a
 * bigger promo. Editing the TOTAL has to do the same thing or the two fields disagree: raising the
 * total used to leave the promo frozen at its old dollar amount, so the order ended up showing a
 * "25%" discount that was no longer 25% of anything.
 *
 * That makes it a circular definition — the discounts scale with the subtotal, and the subtotal is
 * what is left once the discounts come off the typed figure — but a closed-form one, because every
 * discount is proportional to the subtotal:
 *
 *     S - (k x S + F) = D        =>        S = (D + F) / (1 - k)
 *
 * where D is the discounted subtotal split out of the typed total, k is the combined proportional
 * rate (promo + subscription ratios off the snapshot, plus the locked loyalty percentage) and F is
 * any discount that does NOT scale and is simply carried.
 *
 * WHY THIS HAS NO BACKEND TWIN, unlike everything else in this folder: the server never repeats
 * the solve. It receives the solved subtotal and discounts and re-derives the total from them
 * through the shared calculator, using `taxOverrideBase` to VERIFY the split rather than trust it
 * (see OrderPricingCalculator.CalculateTotals). Mirroring this file would be dead code on that
 * side, and dead code is how mirrors drift.
 */

import {
  rescaleDiscountToSubTotal,
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
}

/** Whatever the form currently holds — used for any discount that does not scale. */
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

  // No snapshot to scale against (a legacy order opened with a zero subtotal): hold every recorded
  // discount where it is and let the subtotal absorb the change — the same thing the SubTotal path
  // does when it skips its re-scale.
  const scales = snapshot.originalSubTotal > 0;
  const loyaltyRate = scales && snapshot.loyaltyPercentage > 0 ? snapshot.loyaltyPercentage / 100 : 0;

  let rate = 0;
  let carried = 0;
  if (scales) {
    rate =
      snapshot.originalDiscount / snapshot.originalSubTotal +
      snapshot.originalSubscriptionDiscount / snapshot.originalSubTotal +
      loyaltyRate;
    // Loyalty without a locked percentage is not derivable, so it is carried rather than scaled.
    carried = loyaltyRate > 0 ? 0 : current.loyaltyDiscountAmount;
  } else {
    carried =
      current.discountAmount + current.subscriptionDiscountAmount + current.loyaltyDiscountAmount;
  }

  // Discounts totalling the whole subtotal leave no subtotal that produces the target: there is
  // nothing to solve, so fall back to carrying the recorded amounts unchanged.
  if (!(rate < 1)) {
    rate = 0;
    carried =
      current.discountAmount + current.subscriptionDiscountAmount + current.loyaltyDiscountAmount;
  }

  const estimate = round2((discountedSubTotal + carried) / (1 - rate));

  const discountAmount = rate > 0
    ? rescaleDiscountToSubTotal(snapshot.originalDiscount, snapshot.originalSubTotal, estimate)
    : current.discountAmount;
  const subscriptionDiscountAmount = rate > 0
    ? rescaleDiscountToSubTotal(snapshot.originalSubscriptionDiscount, snapshot.originalSubTotal, estimate)
    : current.subscriptionDiscountAmount;
  const loyaltyDiscountAmount = loyaltyRate > 0
    ? round2(estimate * loyaltyRate)
    : current.loyaltyDiscountAmount;

  // Anchor the SUBTOTAL on the discounted amount rather than keeping the estimate: rounding each
  // discount to cents can move their sum by a cent, and the subtotal is the free variable here, so
  // it is the one that should absorb it. This is what keeps `subTotal - discounts` landing exactly
  // on discountedSubTotal, which is in turn what keeps the tax override valid.
  const subTotal = round2(
    discountedSubTotal + discountAmount + subscriptionDiscountAmount + loyaltyDiscountAmount);

  return {
    subTotal,
    discountAmount,
    subscriptionDiscountAmount,
    loyaltyDiscountAmount,
    discountedSubTotal,
    tax
  };
}
