import { readCookie } from '../booking/hero-choice-cookie';

/**
 * A small first-party LAYOUT hint, so the server can render the signed-in header exactly as the
 * browser will show it once auth has resolved (2026-10). Without it the server only ever knew
 * "anonymous": the admin time pill and the points badge appeared after hydration and pushed the
 * nav sideways. (The home hero's welcome coupon no longer depends on who is visiting - it is
 * shown to everyone - so the hint carries nothing for it.)
 *
 * LAYOUT ONLY. It decides what is DRAWN, never what anybody may do or see: auth, roles and every
 * API answer are unchanged and come from the session as before. A forged or stale value can only
 * mis-draw the first frame, which the app corrects once auth resolves (and then rewrites it).
 * Not HttpOnly on purpose - the app writes it, and the browser's own first render reads it so it
 * matches the server's HTML for hydration. Secure, SameSite=Lax, cleared on logout.
 *
 * Format: "u" (signed in) followed by any of
 *   a = admin/superadmin (the header's New York time pill)
 *   n = NO points badge (the points system reported itself switched off for this account)
 * e.g. "u", "ua", "uan". The badge is drawn for every signed-in visitor unless "n" says otherwise,
 * so a fresh login gets it from the first frame too.
 *
 * The first release (2026-10-04) wrote "u[a][f][b]": "f" (first-time eligible) and "b" (badge on)
 * are still ACCEPTED and ignored, so a cookie written by it keeps its visitor signed-in-shaped
 * instead of reading as anonymous for one visit. Nothing writes them any more.
 */
export const UI_HINT_COOKIE = 'dc_ui';
/** Matches the refresh token's 30-day life; the app rewrites it on every visit anyway. */
export const UI_HINT_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export interface UiHint {
  signedIn: boolean;
  admin: boolean;
  pointsBadge: boolean;
}

/** What a visitor with no hint is drawn as: anonymous - login button, no badge, no time pill. */
export const ANONYMOUS_UI_HINT: Readonly<UiHint> = Object.freeze({
  signedIn: false, admin: false, pointsBadge: false
});

/** a, then the legacy f/b (ignored), then n. Strict: anything else is anonymous. */
const FORMAT = /^u(a?)f?b?(n?)$/;

export function encodeUiHint(hint: UiHint): string | null {
  if (!hint.signedIn) return null;
  return 'u' + (hint.admin ? 'a' : '') + (hint.pointsBadge ? '' : 'n');
}

/** Strict parse; anything that is not exactly the format above is anonymous. */
export function decodeUiHint(value: string | null | undefined): UiHint {
  const m = value ? FORMAT.exec(value) : null;
  if (!m) return ANONYMOUS_UI_HINT;
  return { signedIn: true, admin: !!m[1], pointsBadge: !m[2] };
}

/** The hint in a Cookie header (server) or document.cookie (browser). */
export function readUiHint(cookieHeader: string | null | undefined): UiHint {
  return decodeUiHint(readCookie(cookieHeader, UI_HINT_COOKIE));
}

/** True when a request carried a usable hint - server.ts then marks the response private. */
export function hasUiHint(cookieHeader: string | null | undefined): boolean {
  return readUiHint(cookieHeader).signedIn;
}

/** Browser only. Writes the hint, or deletes it for an anonymous visitor. No-op when unchanged. */
export function writeUiHintCookie(doc: Document, hint: UiHint): void {
  const value = encodeUiHint(hint);
  if ((readCookie(doc.cookie, UI_HINT_COOKIE) ?? null) === value) return;
  const attributes = `; Path=/; SameSite=Lax; Secure; Max-Age=${value ? UI_HINT_MAX_AGE_SECONDS : 0}`;
  doc.cookie = `${UI_HINT_COOKIE}=${value ?? ''}${attributes}`;
}

/**
 * The hint for a signed-in user, from the same facts the browser draws from: the role, and whether
 * the points badge is on (true until the points system reports itself switched off).
 */
export function uiHintForUser(
  user: { role?: string | null } | null | undefined,
  pointsBadge: boolean
): UiHint {
  if (!user) return ANONYMOUS_UI_HINT;
  return {
    signedIn: true,
    admin: user.role === 'Admin' || user.role === 'SuperAdmin',
    pointsBadge
  };
}
