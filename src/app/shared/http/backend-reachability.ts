import { PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpContext, HttpContextToken, HttpErrorResponse, HttpEvent, HttpHandlerFn, HttpRequest } from '@angular/common/http';
import { Observable, TimeoutError, retry, throwError, timer } from 'rxjs';

/**
 * "The backend could not be reached" versus "the backend answered no" (2026-10).
 *
 * A deploy restarts the API. For those seconds the browser sees connections closed under it
 * (status 0, net::ERR_CONNECTION_CLOSED) or Apache / Cloudflare answering for an origin that is not
 * there (502/503/504, Cloudflare 520-524). None of that says anything about the request: the same
 * call a second later succeeds. So:
 *
 * - background / status GETs opt into ONE retry after `NETWORK_RETRY_DELAY_MS`
 *   (`withRetryWhenUnreachable`), and only GET / HEAD are ever retried - a POST that may already
 *   have reached the server is never sent twice;
 * - the auth checks never end a session on one of these - only a real 401 / 403 is an answer about
 *   the session (`isAuthRejection`);
 * - the header's flags and counts keep their last good value on any failure.
 */
export const NETWORK_RETRY_DELAY_MS = 1500;

/** The gateway answers that mean "the origin is down", not "the request was wrong". */
export const GATEWAY_UNREACHABLE_STATUSES: readonly number[] = [502, 503, 504, 520, 521, 522, 523, 524];

/** Status 0 (no response at all), a gateway answer for a down origin, or a client-side timeout. */
export function isBackendUnreachable(error: unknown): boolean {
  if (error instanceof TimeoutError) return true;
  if (!(error instanceof HttpErrorResponse)) return false;
  return error.status === 0 || GATEWAY_UNREACHABLE_STATUSES.includes(error.status);
}

/** The only answers that say something about the session: the server refused these credentials. */
export function isAuthRejection(error: unknown): boolean {
  return error instanceof HttpErrorResponse && (error.status === 401 || error.status === 403);
}

/** Opt-in flag read by `networkRetryInterceptor`. */
export const RETRY_WHEN_UNREACHABLE = new HttpContextToken<boolean>(() => false);

/** An HttpContext asking for one retry when the backend is unreachable (GET / HEAD only). */
export function withRetryWhenUnreachable(context: HttpContext = new HttpContext()): HttpContext {
  return context.set(RETRY_WHEN_UNREACHABLE, true);
}

const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD']);

/**
 * One retry, `NETWORK_RETRY_DELAY_MS` later, for an opted-in GET / HEAD that found the backend
 * unreachable. Any other failure - a 4xx, a 500, a second unreachable answer - goes to the caller
 * unchanged. Browser only: a server render does not sit waiting on a timer for a background call.
 */
export function networkRetryInterceptor(req: HttpRequest<unknown>, next: HttpHandlerFn): Observable<HttpEvent<unknown>> {
  if (!req.context.get(RETRY_WHEN_UNREACHABLE) || !IDEMPOTENT_METHODS.has(req.method)
      || !isPlatformBrowser(inject(PLATFORM_ID))) {
    return next(req);
  }
  return next(req).pipe(
    retry({
      count: 1,
      delay: error => isBackendUnreachable(error) ? timer(NETWORK_RETRY_DELAY_MS) : throwError(() => error)
    })
  );
}
