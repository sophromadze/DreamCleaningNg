import {
  previewTotals, resolveDueDate, invoiceStatusClass,
  InvoiceTaxType, InvoiceDiscountType, InvoiceDueTerms, InvoiceStatus
} from './invoice.service';

/**
 * THE FRONTEND HALF OF THE INVOICE CALCULATOR.
 *
 * `previewTotals` mirrors Helpers/Commercial/InvoiceCalculator.cs step for step. It is a PREVIEW —
 * the server recomputes everything on save and its answer wins — but the two must agree, or the
 * total an admin watches while typing is not the total that gets stored and billed.
 *
 * Every expectation below is duplicated in InvoiceCalculatorTests.cs against the same figures. If
 * you change a rule on one side, change it on the other in the same commit, and update both specs.
 */
describe('invoice previewTotals (mirrors InvoiceCalculator.cs)', () => {

  const line = (quantity: number, unitPrice: number) => ({ quantity, unitPrice });

  const calc = (
    items: { quantity: number; unitPrice: number }[],
    taxType = InvoiceTaxType.Exempt,
    taxRate: number | null = null,
    discountType = InvoiceDiscountType.None,
    discountValue: number | null = null
  ) => previewTotals(items, discountType, discountValue, taxType, taxRate);

  // ── Line arithmetic ──

  it('multiplies quantity by rate, including fractional quantities', () => {
    expect(calc([line(1, 925.43)]).lineAmounts[0]).toBe(925.43);
    expect(calc([line(3, 250)]).lineAmounts[0]).toBe(750);
    expect(calc([line(2.5, 125)]).lineAmounts[0]).toBe(312.5);
  });

  it('sums every line into the subtotal', () => {
    const totals = calc([line(1, 925.43), line(3, 250), line(2.5, 40)]);
    expect(totals.subTotal).toBe(1775.43);
  });

  // ── Tax: the three modes ──

  it('adds nothing when tax exempt', () => {
    const totals = calc([line(1, 925.43)], InvoiceTaxType.Exempt);
    expect(totals.taxAmount).toBe(0);
    expect(totals.total).toBe(925.43);
  });

  it('adds tax on top, reaching the reference contract figures', () => {
    const totals = calc([line(1, 849.99)], InvoiceTaxType.Added, 8.875);
    expect(totals.taxAmount).toBe(75.44);
    expect(totals.total).toBe(925.43);
  });

  it('leaves the total alone when tax is included, splitting it back out', () => {
    const totals = calc([line(1, 925.43)], InvoiceTaxType.Included, 8.875);
    expect(totals.total).toBe(925.43);
    expect(totals.taxAmount).toBe(75.44);
  });

  /**
   * THE TAX-INCLUSIVE SPLIT IS BY SUBTRACTION.
   *
   * $300.00 is the case that proves it: no cent-valued subtotal S satisfies
   * S + round2(S × 8.875%) = 300.00 exactly. Deriving the tax as round2(preTax × rate) instead
   * drifts, and the invoice then prints a subtotal and a tax that do not add back to the total the
   * client is asked to pay. Same rule as ContractPricingCalculator and splitTaxInclusiveAmount.
   */
  it('always has subtotal + tax adding back to the total exactly', () => {
    for (const amount of [300, 925.43, 1000, 12.34, 4999.99, 87.65]) {
      const totals = calc([line(1, amount)], InvoiceTaxType.Included, 8.875);
      const preTax = Math.round((totals.total - totals.taxAmount) * 100) / 100;

      expect(totals.total).toBe(amount);
      expect(Math.round((preTax + totals.taxAmount) * 100) / 100).toBe(totals.total);
    }
  });

  it('treats a missing tax rate as zero rather than inflating the bill', () => {
    const totals = calc([line(1, 500)], InvoiceTaxType.Added, null);
    expect(totals.taxAmount).toBe(0);
    expect(totals.total).toBe(500);
  });

  // ── Discounts ──

  it('takes a fixed discount off the subtotal', () => {
    const totals = calc([line(1, 1000)], InvoiceTaxType.Exempt, null,
      InvoiceDiscountType.FixedAmount, 150);
    expect(totals.discountAmount).toBe(150);
    expect(totals.total).toBe(850);
  });

  it('takes a percentage discount off the subtotal', () => {
    const totals = calc([line(1, 1000)], InvoiceTaxType.Exempt, null,
      InvoiceDiscountType.Percentage, 12.5);
    expect(totals.discountAmount).toBe(125);
    expect(totals.total).toBe(875);
  });

  /**
   * A discount larger than the bill is CAPPED. Without this the total goes negative and the
   * invoice claims the business owes the client money — which is a credit note, and this system
   * does not issue those.
   */
  it('caps a discount at the subtotal and never goes negative', () => {
    const fixedOver = calc([line(1, 100)], InvoiceTaxType.Exempt, null,
      InvoiceDiscountType.FixedAmount, 500);
    expect(fixedOver.discountAmount).toBe(100);
    expect(fixedOver.total).toBe(0);

    const percentOver = calc([line(1, 100)], InvoiceTaxType.Exempt, null,
      InvoiceDiscountType.Percentage, 250);
    expect(percentOver.discountAmount).toBe(100);
    expect(percentOver.total).toBe(0);
  });

  /**
   * TAX IS CHARGED ON THE DISCOUNTED SUBTOTAL. Taxing the gross would charge the client tax on
   * money they were never billed.
   */
  it('charges tax on the discounted subtotal, not the gross', () => {
    const totals = calc([line(1, 1000)], InvoiceTaxType.Added, 10,
      InvoiceDiscountType.FixedAmount, 200);

    expect(totals.discountAmount).toBe(200);
    expect(totals.taxAmount).toBe(80);   // 10% of 800, not of 1000
    expect(totals.total).toBe(880);
  });
});

describe('invoice due dates (mirror InvoiceCalculator.ResolveDueDate)', () => {
  const invoiceDate = '2026-09-07';

  it('resolves each preset the way the server will', () => {
    expect(resolveDueDate(invoiceDate, InvoiceDueTerms.DueOnReceipt)).toBe('2026-09-07');
    expect(resolveDueDate(invoiceDate, InvoiceDueTerms.Net7)).toBe('2026-09-14');
    expect(resolveDueDate(invoiceDate, InvoiceDueTerms.Net15)).toBe('2026-09-22');
    expect(resolveDueDate(invoiceDate, InvoiceDueTerms.Net30)).toBe('2026-10-07');
  });

  it('keeps whatever date the admin picked for custom terms', () => {
    expect(resolveDueDate(invoiceDate, InvoiceDueTerms.Custom, '2026-12-01')).toBe('2026-12-01');
  });
});

describe('invoice status badge classes', () => {
  /**
   * Every status maps to a class, and each one is distinct. A status falling through to the
   * default would render as a Draft badge — visually claiming an invoice has not been sent.
   */
  it('gives every status its own class', () => {
    const statuses = [
      InvoiceStatus.Draft, InvoiceStatus.Sent, InvoiceStatus.Viewed,
      InvoiceStatus.PartiallyPaid, InvoiceStatus.Paid, InvoiceStatus.Overdue, InvoiceStatus.Void
    ];

    const classes = statuses.map(invoiceStatusClass);
    expect(new Set(classes).size).toBe(statuses.length);
    classes.forEach(c => expect(c).toMatch(/^status-/));
  });
});
