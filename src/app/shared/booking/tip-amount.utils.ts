/**
 * Tip amount normalization — single source of truth for "what is an empty tip worth?".
 *
 * A `<input type="number">` bound to a FormControl produces `null` when the box is cleared,
 * `''` in some browsers mid-edit, and `NaN` for garbage input. `FormGroup.reset()` and
 * form data restored from sessionStorage can also seed `null`. Every one of those means
 * exactly one thing to the customer: no tip. They must all collapse to 0 before any
 * validation, pricing, persistence or API call sees them — an empty tip box previously
 * failed the "$10 minimum" validator and disabled the Book Now button with no way out.
 *
 * Use this everywhere a tip value is read. Never read the raw control value.
 */
export function normalizeTipAmount(value: unknown): number {
  const parsed = typeof value === 'string' ? parseFloat(value) : Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(parsed)) {
    return 0;
  }
  return parsed < 0 ? 0 : parsed;
}
