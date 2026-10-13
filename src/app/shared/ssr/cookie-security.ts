/**
 * The `Secure` attribute for every cookie this app writes from the browser (2026-10).
 *
 * Production is https only, so every cookie there is Secure: dc_attribution, dc_session, dc_ui and
 * dc_booking_choice alike. A plain-http page gets no `Secure`, because a browser on http refuses
 * (Safari on localhost, every browser on a LAN address such as a phone testing http://192.168...)
 * or drops a Secure cookie - local dev would silently stop keeping attribution or the booking choice.
 *
 * Re-writing a cookie with the same name, path and domain replaces it, so the cookies a returning
 * visitor already holds become Secure the next time the app writes them (attribution and the
 * session are re-written on every visit).
 */
export function secureCookieAttribute(doc: Document | null | undefined): string {
  return doc?.location?.protocol === 'https:' ? '; Secure' : '';
}
