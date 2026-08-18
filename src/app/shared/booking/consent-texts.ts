/**
 * SINGLE SOURCE OF TRUTH for the wording of the three booking consents.
 *
 * They are shown on TWO surfaces and must read identically on both:
 *   1. /booking — every self-service booking is blocked until all three are ticked.
 *   2. /order/:id/pay — an admin-created order re-asks the customer for the same three
 *      agreements before their first payment, because the admin ticked them on the phone.
 *
 * The SMS and terms labels end with links to /privacy-policy and /terms-and-conditions, so
 * they are split into a leading sentence here and the anchors stay in each template.
 * Change the wording (e.g. the cancellation fee amount) HERE and both surfaces follow.
 */

/** SMS label, up to "Visit " — the Privacy Policy / Terms links follow in the template. */
export const SMS_CONSENT_LEAD =
  'I consent to receive Customer care text messages from Dream Cleaning. Reply STOP to opt-out; ' +
  'Reply HELP for support; Message and data rates apply; Messaging frequency may vary. Visit ';

/** Cancellation-fee + booking-accuracy label. Self-contained — no links. */
export const CANCELLATION_CONSENT_TEXT =
  'I understand that I will be charged a $70 cancellation fee if I cancel or reschedule my ' +
  'appointment less than 48 hours before the scheduled service. I also confirm that the booking ' +
  'details accurately reflect the cleaning requirements. If the actual condition differs from the ' +
  'described details, Dream Cleaning Team reserves the right to either leave or adjust the ' +
  'services to match the actual condition. I understand, that cleaning lady may arrive within a ' +
  '30-60 minute window of the scheduled cleaning time.';

/** Terms label, up to the links. */
export const TERMS_CONSENT_LEAD =
  "I have read and agree to Dream Cleaning's ";
