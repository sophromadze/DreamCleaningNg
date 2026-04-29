/**
 * Phone helpers for the US (NANP) market.
 * Storage form: bare 10 digits (no parens, dashes, spaces, country code).
 * Dialing form: tel:+1XXXXXXXXXX
 */

/**
 * Strip everything except digits and drop a leading "1" country code so we
 * end up with a US 10-digit number whenever possible. Returns null for empty
 * input. For unusually short/long numbers we still return the digit string
 * so we don't silently lose data.
 */
export function normalizePhone10(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const digits = String(value).replace(/\D/g, '');
  if (digits.length === 0) return null;
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.substring(1);
  }
  if (digits.length > 10 && digits.startsWith('1')) {
    // E.164-ish "1XXXXXXXXXX..." — keep the 10 digits after the country code.
    return digits.substring(1, 11);
  }
  if (digits.length > 10) {
    return digits.substring(0, 10);
  }
  return digits;
}

/**
 * Live input handler: keep the input value to digits only, capped at 10.
 * Returns the cleaned value so callers can patch their form/model.
 */
export function sanitizePhoneInput(rawValue: string | null | undefined): string {
  if (!rawValue) return '';
  const digits = String(rawValue).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.substring(1);
  }
  return digits.slice(0, 10);
}

/**
 * Build a tel: href for click-to-call. Always prefixes +1 so the dialer
 * uses the US country code.
 */
export function telHrefUS(value: string | null | undefined): string {
  const normalized = normalizePhone10(value);
  if (!normalized) return 'tel:';
  return `tel:+1${normalized}`;
}
