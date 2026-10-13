import { makeStateKey } from '@angular/core';
import type { BlockedTimeSlot, ServiceType, Subscription } from '../services/booking.service';
import type { PublicSpecialOffer } from '../services/special-offer.service';
import type { BookingFormData } from '../services/form-persistence.service';
import type { SsrBookingSession } from '../shared/ssr/ssr-booking-session.token';

/**
 * Everything step 1 of /booking is drawn from on its FIRST render (2026-10).
 *
 * The server builds it - catalogue, plans and blocked slots from server.ts's in-memory copies,
 * the choice from the visitor's booking-choice cookie, the session from their access_token - and
 * draws the page from it. It then travels in TransferState, and the hydrating browser draws
 * exactly the same thing from it before touching its own storage or making any request, so the
 * first browser render IS the server HTML: no swap, no layout shift, no duplicate request.
 */
export interface BookingInitialState {
  serviceTypes: ServiceType[];
  /** Null: the server had no copy; the browser loads the plans after hydration. */
  subscriptions: Subscription[] | null;
  /** Null: the server had no copy; the browser loads them after hydration. */
  blockedTimeSlots: BlockedTimeSlot[] | null;
  /** The New York calendar date the render was made on (YYYY-MM-DD). */
  today: string;
  /** The visitor's resolved booking choice (ids and keys), or null for the default form. */
  choice: BookingFormData | null;
  /**
   * A guest's Special Discount card: the public offer the SERVER picked (the pick is random, so
   * it must be made once and shared). null: there is none to show. Absent: unknown (no server
   * copy of the offers), so the browser loads them as before.
   */
  guestOffer?: PublicSpecialOffer | null;
  /** The signed-in visitor's booking context (see ssr-booking-session.token.ts), or null. */
  session: SsrBookingSession | null;
}

export const BOOKING_INITIAL_STATE_KEY = makeStateKey<BookingInitialState>('booking.initial-state');

/** The business runs on New York time; so do the booking page's dates, on server and browser alike. */
export const BOOKING_TIME_ZONE = 'America/New_York';

/** Today's date in New York, YYYY-MM-DD. */
export function newYorkToday(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: BOOKING_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** A YYYY-MM-DD date moved by whole days (calendar arithmetic, no time zone involved). */
export function addDaysToIsoDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}
