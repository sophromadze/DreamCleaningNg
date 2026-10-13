/**
 * The signed-in part of the booking page's server render (2026-10).
 *
 * Production signs people in with an HttpOnly `access_token` cookie (Path=/, SameSite=Strict), so
 * a refresh of /booking already carries it to this server. For GET /booking ONLY, server.ts calls
 * loadBookingSession before the render: it asks the backend - over the loopback, never the public
 * domain - for exactly what step 1 draws for a signed-in visitor, so the server HTML already has
 * their offers, plan, discounts, points and Reorder button instead of swapping them in after
 * hydration.
 *
 * Rules that keep it safe:
 * - Only `access_token` is forwarded, never `refresh_token`, and never any other cookie. The
 *   server never refreshes a session: an expired, revoked or refused token renders the page as a
 *   guest, and the browser does its own refresh exactly as it always has.
 * - One deadline for the whole lookup (SESSION_TIMEOUT_MS). Whatever has not answered by then is
 *   left to the browser; a profile that has not answered means "render as a guest".
 * - Every call runs in parallel. GET api/profile alone replaces three browser calls
 *   (auth/current-user, the profile refresh and the loyalty lookup). The order list is reduced to
 *   one flag here; the list itself never reaches the HTML.
 * - Nothing is cached: the result belongs to one request and is handed to that render only.
 */
import type { SsrBookingSession } from './app/shared/ssr/ssr-booking-session.token';
import { readCookie } from './app/shared/ssr/read-cookie';
import { hasUnpaidOrder, isInternalRole, isStaffRole } from './app/shared/account/account-status';

export const SESSION_TIMEOUT_MS = 400;
export const ACCESS_TOKEN_COOKIE = 'access_token';
const STAFF_ROLES = new Set(['Admin', 'SuperAdmin', 'Moderator']);

interface SessionOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** The access token in a Cookie header, if it has a JWT's shape. Anything else reads as "no session". */
export function readAccessToken(cookieHeader: string | null | undefined): string | null {
  const token = readCookie(cookieHeader, ACCESS_TOKEN_COOKIE);
  return token && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(token) ? token : null;
}

/**
 * The signed-in visitor's booking context, or null (guest, no usable session, or the profile call
 * failed or ran out of time).
 */
export async function loadBookingSession(
  backendUrl: string,
  cookieHeader: string | null | undefined,
  options: SessionOptions = {}
): Promise<SsrBookingSession | null> {
  const token = readAccessToken(cookieHeader);
  if (!token) return null;

  const fetchImpl = options.fetchImpl ?? fetch;
  const signal = AbortSignal.timeout(options.timeoutMs ?? SESSION_TIMEOUT_MS);
  const headers = { Cookie: `${ACCESS_TOKEN_COOKIE}=${token}`, Accept: 'application/json' };

  // null on any failure (status, network, timeout, body): the caller decides what that means.
  const get = async <T>(path: string): Promise<T | null> => {
    try {
      const response = await fetchImpl(`${backendUrl}${path}`, { headers, signal, redirect: 'manual' });
      if (!response.ok) return null;
      return (await response.json()) as T;
    } catch {
      return null;
    }
  };

  const [profile, specialOffers, subscription, points, orders, headerSummary, contracts, invoices] = await Promise.all([
    get<Record<string, any>>('/api/profile'),
    get<unknown[]>('/api/profile/special-offers'),
    get<Record<string, unknown>>('/api/booking/user-subscription'),
    get<Record<string, unknown>>('/api/bubble-points/summary'),
    get<Array<{ isCustomServiceType?: boolean }>>('/api/order'),
    // The header's own state, so the page makes none of these calls after hydration.
    get<any>('/api/bubble-points/header-summary'),
    get<{ hasContracts?: boolean }>('/api/my-contracts/has-contracts'),
    get<{ hasInvoices?: boolean }>('/api/my-invoices/has-invoices')
  ]);

  if (!profile || typeof profile['id'] !== 'number' || typeof profile['role'] !== 'string') return null;
  const role = profile['role'] as string;
  const staff = STAFF_ROLES.has(role);
  // Staff only (the Register User button, the task and blog indicators), so a customer's render
  // never pays for it.
  const [permissions, pendingTasks, uncheckedDone, blogDrafts] = staff
    ? await Promise.all([
        get<{ permissions?: { canCreate?: boolean } }>('/api/admin/permissions'),
        isStaffRole(role) ? get<number>('/api/admin/personal-tasks/pending-count') : Promise.resolve(0),
        isStaffRole(role) ? get<number>('/api/admin/personal-tasks/unchecked-done-count') : Promise.resolve(0),
        isInternalRole(role) ? get<{ count?: number }>('/api/admin/blog/pending-count') : Promise.resolve({ count: 0 })
      ])
    : [null, 0, 0, { count: 0 }];
  const cleaner = role === 'Cleaner';
  // Every part must have answered, or the browser would show a wrong indicator until its next load.
  const accountComplete = Array.isArray(orders) && headerSummary !== null
    && (cleaner || (contracts && invoices)) && pendingTasks !== null && uncheckedDone !== null && blogDrafts !== null;

  return {
    user: {
      id: profile['id'],
      firstName: String(profile['firstName'] ?? ''),
      lastName: String(profile['lastName'] ?? ''),
      email: String(profile['email'] ?? ''),
      phone: profile['phone'] ?? null,
      role,
      firstTimeOrder: !!profile['firstTimeOrder']
    },
    loyaltyDiscountPercentage: Number(profile['loyaltyDiscountPercentage']) || 0,
    specialOffers: Array.isArray(specialOffers) ? specialOffers : null,
    subscription: subscription && typeof subscription === 'object' ? subscription : null,
    points: points && typeof points === 'object' ? points : null,
    hasPreviousOrders: Array.isArray(orders) ? orders.some(o => !o?.isCustomServiceType) : null,
    canRegisterCustomers: !staff ? false : permissions ? !!permissions.permissions?.canCreate : null,
    account: accountComplete ? {
      userId: profile['id'],
      hasUnpaidOrders: hasUnpaidOrder(orders as any[]),
      hasContracts: !cleaner && !!contracts?.hasContracts,
      hasInvoices: !cleaner && !!invoices?.hasInvoices,
      headerSummary: headerSummary ?? null,
      hasPendingPersonalTasks: Number(pendingTasks) > 0,
      hasUncheckedDoneTasks: Number(uncheckedDone) > 0,
      pendingBlogDrafts: Number((blogDrafts as { count?: number })?.count ?? 0)
    } : null
  };
}
