// Shared payment method definitions for admin booking + Done modal + orders filter.
// Wire format matches the backend PaymentMethod enum's ToString() exactly so values
// can round-trip without translation. "Normal" is the Stripe path (existing IsPaid flow);
// all others are handled outside Stripe.

export type PaymentMethodValue = 'Normal' | 'Cash' | 'Zelle' | 'Check' | 'Other' | 'Invoice';

export const PAYMENT_METHOD_OPTIONS: { value: PaymentMethodValue; label: string }[] = [
  { value: 'Normal', label: 'Normal (Stripe)' },
  { value: 'Cash',   label: 'Cash' },
  { value: 'Zelle',  label: 'Zelle' },
  { value: 'Check',  label: 'Check' },
  { value: 'Other',  label: 'Other' },
  { value: 'Invoice', label: 'Invoice (commercial)' },
];

/**
 * "Does choosing this method mean the money has ALREADY arrived?"
 *
 * Mirrors `PaymentMethodRules.IsSettledOnRecord` on the backend, and exists for the same reason
 * it does there: until the Invoice method was added (2026-09), "handled outside Stripe" and "paid"
 * were the same question, and every surface spelled both as `method !== 'Normal'`.
 *
 * An INVOICE order is billed to a commercial client and stays Pending until a CommercialInvoice
 * covering it is settled in full — so a form that treats it as settled would offer a payment
 * reference for money nobody has sent and show the order as Active before it is.
 */
export function isSettledOnRecord(method: PaymentMethodValue): boolean {
  return method !== 'Normal' && method !== 'Invoice';
}

/** True for everything the website does not charge a card for. */
export function isOutsideStripe(method: PaymentMethodValue): boolean {
  return method !== 'Normal';
}
