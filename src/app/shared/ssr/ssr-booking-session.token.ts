import { InjectionToken } from '@angular/core';
import type { AccountStatusSnapshot } from '../account/account-status';

/**
 * What the booking page's first paint needs to know about a SIGNED-IN visitor, fetched by
 * server.ts (ssr-booking-session.ts) for GET /booking only, with the visitor's own access_token
 * cookie, before the render starts. Every part except `user` may be null: that part was
 * unavailable (error, timeout) and the browser loads it after hydration, as it always did.
 *
 * Absent (null token value) for a guest, an expired/revoked session, or any failure of the
 * profile call - the page then renders exactly as for a guest.
 *
 * This is one person's data. It travels to that person's browser in TransferState, inside HTML
 * that server.ts marks `private, no-cache` + `Vary: Cookie`.
 */
export interface SsrBookingSession {
  user: {
    id: number;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
    role: string;
    firstTimeOrder: boolean;
  };
  /** GET api/profile -> loyaltyDiscountPercentage. */
  loyaltyDiscountPercentage: number;
  /** GET api/profile/special-offers. */
  specialOffers: unknown[] | null;
  /** GET api/booking/user-subscription, as returned. */
  subscription: Record<string, unknown> | null;
  /** GET api/bubble-points/summary, as returned. */
  points: Record<string, unknown> | null;
  /** Whether GET api/order holds any non-custom order (the Reorder button). Only the flag ships. */
  hasPreviousOrders: boolean | null;
  /** Staff only: GET api/permissions -> permissions.canCreate (the Register User button). */
  canRegisterCustomers: boolean | null;
  /**
   * What the header shows about this account (unpaid dot, My Contracts / My Invoices, points
   * badge, staff indicators), so it is not fetched again after hydration. Absent when a part of
   * it did not answer - the browser then loads it once, as on every other page.
   */
  account?: AccountStatusSnapshot | null;
}

export const SSR_BOOKING_SESSION = new InjectionToken<SsrBookingSession | null>('SSR_BOOKING_SESSION');
