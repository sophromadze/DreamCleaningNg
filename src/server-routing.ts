/**
 * Which server.ts handler answers a request path (2026-10, Express 4 -> 5).
 *
 * Express 5 (path-to-regexp v8) dropped the '*' and '*.*' route strings server.ts used, and its
 * route strings throw at startup on characters such as ( ) * : ?. So the decisions are plain
 * functions of the RAW request path (req.path, still percent-encoded, exactly what the Express 4
 * route regexps were matched against), and server.ts only mounts them behind '/{*path}'.
 * server-routing.spec.ts pins the Express 4 answers for a table of URLs.
 */

/**
 * Real 301s for retired or commonly guessed public URLs, answered before the Angular render.
 * Angular's redirectTo routes for the same paths stay in app.routes.ts as the fallback for
 * in-app navigation, but on a full request they would answer 200 with the target page.
 * Keys are lowercase without a trailing slash: matching is case-insensitive and ignores one
 * trailing slash. The query string is carried over unchanged.
 */
export const PERMANENT_REDIRECTS: Readonly<Record<string, string>> = {
  '/services': '/service-page',
  '/commercial-cleaning': '/services/commercial-cleaning',
};

/**
 * Requests worth handing to express.static: the path contains a dot (Express 4: '*.*').
 * No page route contains one, so '/' and the extension-less folders (/images) never reach it -
 * express.static would answer them with index.html (the CSR shell) or a 301 to '/images/'.
 */
export function isStaticFileRequest(path: string): boolean {
  return path.includes('.');
}

// The '.' is deliberately unescaped (any character), as it has been since the guard was added:
// it keeps exactly the URLs it has always 404'd. No page route ends in one of these words.
const STATIC_FILE_EXT = /.(txt|md|xml|json|webmanifest|ico|png|jpe?g|gif|webp|avif|svg|css|js|mjs|map|woff2?|ttf|otf|eot|pdf|mp4|webm)$/i;

/**
 * Static-file and /.well-known/* requests that express.static could not satisfy get a real 404.
 * Without this they fall through to the Angular render, which answers 200 with the home page -
 * Lighthouse then parses HTML as llms.txt / ai-catalog.json, and a stale chunk URL gets HTML back.
 * Scoped to known file extensions so no page route (none contains a dot) and no token URL can match.
 */
export function isMissingFileRequest(path: string): boolean {
  return path.startsWith('/.well-known/') || STATIC_FILE_EXT.test(path);
}

/** The 301 Location for a request, or null. `originalUrl` supplies the query string, kept as sent. */
export function permanentRedirectLocation(path: string, originalUrl: string): string | null {
  const key = path.toLowerCase().replace(/\/$/, '');
  const target = Object.prototype.hasOwnProperty.call(PERMANENT_REDIRECTS, key) ? PERMANENT_REDIRECTS[key] : undefined;
  if (!target) {
    return null;
  }
  const queryStart = originalUrl.indexOf('?');
  return target + (queryStart === -1 ? '' : originalUrl.slice(queryStart));
}

/**
 * Cache-Control override for a file express.static serves, by its path relative to the browser
 * folder (either separator); null keeps express.static's own `public, max-age=31536000`.
 * - Unhashed, hand-edited files (robots.txt, sitemaps, the web manifest): edits must reach
 *   Cloudflare and browsers within the hour. Hashed JS/CSS keep the year. fontawesome.css is the
 *   on-demand admin/profile icon bundle (angular.json, `inject: false`), which Angular emits
 *   without a content hash, so a Font Awesome upgrade must not sit cached for a year.
 *   /fonts/*.woff2 keep the year: their names carry the font version.
 * - /images/* (public/images: unhashed, hand-maintained site images) get ONE DAY plus the
 *   ETag/Last-Modified express.static already sends (2026-10). Apache used to alias /images to
 *   the uploads folder; with that gone, an image edited in place must reach browsers within a
 *   day, and a revalidation after that costs a 304. /img/responsive/* names carry a content
 *   hash, so they keep the year.
 */
export function staticCacheControl(relativePath: string): string | null {
  const path = '/' + relativePath;
  if (/.(txt|xml|webmanifest)$/i.test(path) || /[\\/]fontawesome\.css$/i.test(path)) {
    return 'public, max-age=3600';
  }
  if (/^images[\\/]/.test(relativePath)) {
    return 'public, max-age=86400';
  }
  return null;
}

/**
 * The booking page (Angular route `booking`, no children). Its render reads the visitor's
 * session and booking cookie, so server.ts looks the session up for it alone and always marks
 * the HTML private.
 */
export function isBookingPage(path: string): boolean {
  return path === '/booking' || path === '/booking/';
}
