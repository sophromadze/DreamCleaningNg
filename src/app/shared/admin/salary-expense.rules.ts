// Mirror of Helpers/SalaryExpenseRules.cs — the frontend half of "a salary names a person".
//
// Only the parts the form actually needs are mirrored. Name resolution and grouping stay on the
// server: it is the side that knows whether the linked account still exists, and every surface
// here reads an already-resolved name off the DTO rather than deriving a second answer.

/**
 * The seeded "Salaries" category. Matching on the Id rather than the name is deliberate — the
 * category is renameable, so a name match would break the day the owner called it "Payroll".
 * Kept in step with SalaryExpenseRules.SalariesCategoryId.
 */
export const SALARIES_CATEGORY_ID = 4;

export function isSalaryCategory(categoryId: number | null | undefined): boolean {
  return Number(categoryId) === SALARIES_CATEGORY_ID;
}

/**
 * Which categories may be entered in a currency other than USD. Only salaries — the admins are
 * paid in lari. Mirrors ExpenseCurrency.AllowsCurrencyChoice; the server enforces it either way
 * and forces USD on everything else, so a mis-tagged supplier invoice cannot report at ~2.7x its
 * real cost.
 */
export function allowsCurrencyChoice(categoryId: number | null | undefined): boolean {
  return isSalaryCategory(categoryId);
}

/**
 * The symbol an amount is written with. Display only — no conversion happens on this side at all:
 * the server sends both the entered amount and its USD equivalent, because it is the side that
 * holds the month's locked exchange rate.
 */
export function currencySymbol(currency: string | null | undefined): string {
  return (currency ?? '').toUpperCase() === 'GEL' ? '₾' : '$';
}
