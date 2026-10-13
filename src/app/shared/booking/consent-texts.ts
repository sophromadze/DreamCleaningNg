/**
 * SINGLE SOURCE OF TRUTH for the wording of the three booking consents.
 *
 * They are shown on TWO surfaces and must read identically on both:
 *   1. /booking — a self-service booking is blocked until the cancellation and terms boxes are
 *      ticked. The SMS box is OPTIONAL (2026-10, RingCentral 10DLC: SMS consent may never be a
 *      condition of booking) — it never blocks the booking or the payment page.
 *   2. /order/:id/pay — an admin-created order re-asks the customer for the same three
 *      agreements before their first payment, because the admin ticked them on the phone.
 *
 * The SMS and terms labels end with links to /privacy-policy and /terms-and-conditions, so
 * they are split into a leading sentence here and the anchors stay in each template. The link
 * texts are the TITLES of those pages ("Privacy Policy", "Terms & Conditions").
 * Change the wording (e.g. the cancellation fee amount) HERE and both surfaces follow.
 */

/**
 * SMS label (RingCentral wording, the same sentence as /contact and /free-quote), up to the links:
 * LEAD + <Privacy Policy> page and <Terms & Conditions>. "Reply HELP for assistance" names no
 * number on purpose: a reply goes to the number the text came from (the RingCentral sender,
 * config RingCentral:FromNumber), which can differ from the support number shown on the site.
 */
export const SMS_CONSENT_LEAD =
  'By checking this box, you agree to receive SMS messages from Dream Cleaning NYC related to your ' +
  'booking, including booking confirmations, appointment reminders and updates, and payment ' +
  'notices. You may reply STOP to opt out at any time. Reply HELP for assistance. Messages and ' +
  'data rates may apply. Message frequency will vary. Learn more on our ';

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
  "I have read and agree to Dream Cleaning NYC's ";
