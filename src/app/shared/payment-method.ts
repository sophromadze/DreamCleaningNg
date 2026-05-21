// Shared payment method definitions for admin booking + Done modal + orders filter.
// Wire format matches the backend PaymentMethod enum's ToString() exactly so values
// can round-trip without translation. "Normal" is the Stripe path (existing IsPaid flow);
// all others are manual payments recorded outside Stripe.

export type PaymentMethodValue = 'Normal' | 'Cash' | 'Zelle' | 'Check' | 'Other';

export const PAYMENT_METHOD_OPTIONS: { value: PaymentMethodValue; label: string }[] = [
  { value: 'Normal', label: 'Normal (Stripe)' },
  { value: 'Cash',   label: 'Cash' },
  { value: 'Zelle',  label: 'Zelle' },
  { value: 'Check',  label: 'Check' },
  { value: 'Other',  label: 'Other' },
];
