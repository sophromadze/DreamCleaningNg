import { Injectable, Inject, PLATFORM_ID, Injector, inject } from '@angular/core';
import { HttpRequest, HttpHandler, HttpEvent, HttpEventType, HttpInterceptor, HttpErrorResponse, HttpHandlerFn } from '@angular/common/http';
import { Observable, throwError, of, BehaviorSubject } from 'rxjs';
import { catchError, defaultIfEmpty, filter, take, switchMap, map, tap, shareReplay } from 'rxjs/operators';
import { isPlatformBrowser } from '@angular/common';
import { AuthService } from '../services/auth.service';
import { Router } from '@angular/router';
import { environment } from '../../environments/environment';
import { deviceTokenHeaderValue } from '../services/two-factor.service';

/**
 * Set by the API on the 401 it returns for a session an admin has REVOKED — today, a role
 * change. Only that header ends the session here: an ordinary 401 can mean something else
 * entirely (a stale guest payment token, say) while the signed-in user is perfectly valid, and
 * signing them out on it would be a bug in the opposite direction.
 * Mirrors `TokenVersionService.RevokedHeader` on the backend.
 */
export const SESSION_REVOKED_HEADER = 'X-Session-Revoked';

/**
 * SINGLE-FLIGHT TOKEN REFRESH — module state on purpose, because the functional interceptor is a
 * plain function with no instance to hang it on, and the whole point is that every request in the
 * app shares one refresh.
 *
 * ══ WHY THIS EXISTS (2026-09) ══
 *
 * The access token lives 30 days and the app has always had refresh-on-401 logic — in the
 * class-based `AuthInterceptor` below, which is **registered nowhere**: `app.config.ts` provides
 * only `withInterceptors([authInterceptor])`. So when the token expired mid-session nothing
 * renewed it: every request 401'd, the admin panel rendered empty tables with an error under each
 * one, and the session only actually ended on the next reload — which is exactly the "no data,
 * console errors, then I refresh and I'm logged out" report this fixes.
 *
 * ══ WHY SINGLE-FLIGHT IS NOT OPTIONAL ══
 *
 * The backend ROTATES the refresh token on every use (`AuthService.RefreshToken` writes a new one
 * and invalidates the old). An admin panel fires a dozen requests at once, so a per-request
 * refresh would send the same refresh token a dozen times: the first rotates it and the other
 * eleven are answered "Invalid refresh token", which ends the session that was just successfully
 * renewed. Concurrent 401s therefore queue on ONE refresh and retry with its result.
 *
 * Three things widen that guarantee past "one call at a time" — see each one for the failure it
 * closes: `REFRESH_SETTLE_WINDOW_MS` (the 401s already on the wire when the refresh landed, and
 * the second browser tab), `recoverOrEndSession` (a lost race must not destroy the session that
 * won it), and `AuthService.RefreshTokenReplayGrace` on the server (a duplicate presentation of
 * the token just replaced returns the current session instead of being refused).
 */
let refreshInFlight$: Observable<string | null> | null = null;

/**
 * ══ WHY ONE IN-FLIGHT CALL IS NOT ENOUGH (2026-09, the intermittent auto-logout) ══
 *
 * Single-flight only dedupes the 401s that arrive WHILE the refresh is on the wire. The ones it
 * misses are the ordinary case: six requests leave together carrying the same stale token, the
 * first 401 comes back and renews in ~80ms, and the other five 401s land just after that — each
 * one outside the window, each one starting a refresh of its own. Worse, the window is module
 * state, so it is per TAB: an admin with the panel open twice has two independent queues racing
 * the one rotating refresh token the browser shares between them.
 *
 * So a refresh that has JUST succeeded keeps answering for a short while afterwards. A 401 inside
 * that window needs no renewal — the credentials it was sent with are simply older than the ones
 * on the machine now — so it retries straight away with whatever is current. The stamp is written
 * to localStorage as well as held here, which is what lets a second tab see the first tab's
 * renewal instead of racing it.
 */
const REFRESH_SETTLE_WINDOW_MS = 4000;

/** Shared with other tabs. A timestamp only — never a token. */
const LAST_REFRESH_STAMP_KEY = 'auth_last_refresh_at';

let lastRefreshAt = 0;

function markRefreshed(): void {
  lastRefreshAt = Date.now();
  try {
    localStorage.setItem(LAST_REFRESH_STAMP_KEY, String(lastRefreshAt));
  } catch { /* storage unavailable — the in-tab stamp above still applies */ }
}

/** True when this tab, or any other, renewed the session within the settle window. */
function refreshedRecently(): boolean {
  let stamp = lastRefreshAt;
  try {
    const shared = Number(localStorage.getItem(LAST_REFRESH_STAMP_KEY));
    if (Number.isFinite(shared) && shared > stamp) stamp = shared;
  } catch { /* see above */ }
  // A clock that jumped backwards would make `now - stamp` negative, which must not read as
  // "refreshed 0ms ago" forever — bound it at both ends.
  const age = Date.now() - stamp;
  return stamp > 0 && age >= 0 && age < REFRESH_SETTLE_WINDOW_MS;
}

/**
 * Cleared on logout so a fresh sign-in never retries against a dead refresh.
 *
 * Exported for specs: the settle stamp outlives a `TestBed` (it is module state plus a
 * localStorage key), so a suite that did not clear it would find the second test short-circuiting
 * on the first test's renewal.
 */
export function resetRefreshState(): void {
  refreshInFlight$ = null;
  lastRefreshAt = 0;
  try {
    localStorage.removeItem(LAST_REFRESH_STAMP_KEY);
  } catch { /* nothing to clear */ }
}

/** Endpoints that must never trigger a refresh: refreshing them is what they ARE. */
function isAuthUrl(url: string): boolean {
  return url.includes('/auth/login')
      || url.includes('/auth/register')
      || url.includes('/auth/refresh-token')
      || url.includes('/auth/refresh-user-token')
      || url.includes('/auth/google')
      || url.includes('/auth/apple-login');
}

function isSignalRUrl(url: string): boolean {
  return url.includes('/userManagementHub')
      || url.includes('/liveChatHub')
      || url.includes('/negotiate')
      || (url.includes('?id=') && url.includes('access_token='));
}

// Functional interceptor approach for Angular 17+
export function authInterceptor(
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
): Observable<HttpEvent<unknown>> {
  const useCookieAuth = environment.useCookieAuth || false;
  const isBrowser = typeof window !== 'undefined';

  // Skip auth checks for auth endpoints (don't attach Bearer token to login/register requests)
  const isAuthEndpoint = req.url.includes('/auth/login') ||
                        req.url.includes('/auth/register') ||
                        req.url.includes('/auth/refresh-token') ||
                        req.url.includes('/auth/google') ||
                        req.url.includes('/auth/apple-login');

  // Skip for SignalR endpoints
  const isSignalREndpoint = req.url.includes('/userManagementHub') ||
                           req.url.includes('/negotiate') ||
                           (req.url.includes('?id=') && req.url.includes('access_token='));

  // 2FA: attach the trusted-device token on login requests so the backend can decide
  // whether to skip the challenge. Safe on all login paths (email/password + OAuth).
  // The header is harmless on other endpoints but we only add it where it matters.
  const isLoginRequest = req.url.includes('/auth/login')
                       || req.url.includes('/auth/google-login')
                       || req.url.includes('/auth/apple-login')
                       || req.url.includes('/auth/verify-login-otp');
  if (isBrowser && isLoginRequest) {
    try {
      // All stored tokens (one per staff user of this browser), comma-joined.
      const deviceTokens = deviceTokenHeaderValue();
      if (deviceTokens) {
        req = req.clone({ setHeaders: { 'X-Device-Token': deviceTokens } });
      }
    } catch { /* localStorage may be unavailable; non-fatal */ }
  }

  // Handle based on auth method
  if (useCookieAuth) {
    // For cookie auth, always include credentials
    req = req.clone({
      withCredentials: true
    });
  } else {
    // For localStorage auth, add bearer token
    let token: string | null = null;

    if (isBrowser) {
      try {
        token = localStorage.getItem('token');
      } catch (error) {
        console.warn('Error accessing localStorage:', error);
        token = null;
      }
    }

    // Clone the request and add the authorization header
    if (token && !isAuthEndpoint && !isSignalREndpoint) {
      req = req.clone({
        setHeaders: {
          Authorization: `Bearer ${token}`
        }
      });
    }
  }

  // The Injector, not AuthService itself: inject() only works synchronously here, while the
  // error arrives later, and asking for AuthService on every request would construct it (and its
  // own HttpClient dependency) for requests that never fail.
  const injector = inject(Injector);

  return next(req).pipe(
    catchError((error: unknown) => {
      if (!isBrowser || !(error instanceof HttpErrorResponse) || error.status !== 401) {
        return throwError(() => error);
      }

      // The account's sessions were ended server-side while this browser was away — an admin
      // changed its role. Nothing here can be retried: the same revoke dropped the refresh
      // token. Clear the stored session and land on the login page, which is what the admin
      // making that change expects to have happened.
      if (error.headers?.get(SESSION_REVOKED_HEADER)) {
        try {
          resetRefreshState();
          injector.get(AuthService).logout();
        } catch {
          // Mid-teardown, or AuthService itself failed: report the original error rather than
          // burying it under a logout failure.
        }
        return throwError(() => error);
      }

      // Nothing to renew, or renewing IS what failed. Refreshing a login attempt would be
      // circular, and SignalR carries its own token on the query string.
      if (isAuthEndpoint || isSignalREndpoint || isAuthUrl(req.url) || isSignalRUrl(req.url)) {
        return throwError(() => error);
      }

      let auth: AuthService;
      try {
        auth = injector.get(AuthService);
      } catch {
        return throwError(() => error);
      }

      // A 401 on an endpoint nobody is signed in for is just a 401 — a guest payment link, say.
      // Only a session that believes it exists is worth renewing.
      if (!auth.isLoggedIn()) {
        return throwError(() => error);
      }

      return refreshOnce(auth).pipe(
        switchMap(token => next(applyToken(req, token, useCookieAuth))),
        catchError(refreshError => recoverOrEndSession(req, next, auth, useCookieAuth, refreshError))
      );
    })
  );
}

/**
 * Runs at most one refresh at a time, hands every waiting request the same result, and — for
 * `REFRESH_SETTLE_WINDOW_MS` after one succeeds — answers without calling the API at all.
 *
 * `shareReplay(1)` is what makes the eleven queued requests await the one call instead of each
 * starting their own; the subscription is dropped on both completion and failure so the NEXT
 * expiry starts a fresh attempt rather than replaying a stale answer. The settle window on top of
 * it is what covers the 401s that were already on the wire when that refresh landed — without it
 * they queue up a SECOND rotation, and on a browser that is really two tabs a third and a fourth.
 *
 * Exported so `TokenRefreshService` renews through the same queue: a periodic refresh that called
 * `AuthService.refreshToken()` directly would be one more racer for the same rotating token.
 */
export function refreshOnce(auth: AuthService): Observable<string | null> {
  if (refreshInFlight$) return refreshInFlight$;

  // Somebody already renewed, just now. The request that 401'd was simply sent with credentials
  // older than the ones this browser holds; asking for another rotation is what breaks it.
  if (refreshedRecently()) return of(null);

  let source: Observable<any>;
  try {
    source = auth.refreshToken();
  } catch (err) {
    // refreshToken() throws SYNCHRONOUSLY when there is nothing to refresh with.
    return throwError(() => err);
  }

  refreshInFlight$ = source.pipe(
    map((response: any) => (response?.token as string | undefined) ?? null),
    tap({
      next: () => { markRefreshed(); refreshInFlight$ = null; },
      error: () => { refreshInFlight$ = null; }
    }),
    shareReplay({ bufferSize: 1, refCount: false })
  );

  return refreshInFlight$;
}

/**
 * A FAILED REFRESH IS NOT PROOF THE SESSION IS GONE (2026-09).
 *
 * This used to call `logout()` the moment a refresh failed. Under cookie auth `logout()` posts
 * `/auth/logout`, which DELETES both cookies server-side — so one request losing a race did not
 * just fail, it destroyed the session every other tab was happily using, and the admin was
 * bounced to /login mid-task for no reason they could see.
 *
 * The refresh token is single-use and rotating, so "Invalid refresh token" is the EXPECTED answer
 * for the loser of a race. Before ending anything, ask the server directly whether the session is
 * alive. If it is, the renewal already happened somewhere else and the original request just needs
 * sending again. Only a probe that is itself refused ends the session.
 *
 * The probe goes through `next`, not `HttpClient`, so it cannot re-enter this interceptor and
 * cannot start a refresh of its own.
 */
function recoverOrEndSession(
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
  auth: AuthService,
  useCookieAuth: boolean,
  refreshError: unknown
): Observable<HttpEvent<unknown>> {
  const endSession = () => {
    try {
      resetRefreshState();
      auth.logout();
    } catch {
      // Mid-teardown, or AuthService itself failed: report the original error rather than
      // burying it under a logout failure.
    }
    return throwError(() => refreshError);
  };

  // An explicitly revoked session is not worth probing — the probe would be refused too, and the
  // admin who revoked it expects the person out now.
  if (refreshError instanceof HttpErrorResponse && refreshError.headers?.get(SESSION_REVOKED_HEADER)) {
    return endSession();
  }

  return probeSession(next, useCookieAuth).pipe(
    switchMap(alive => {
      if (!alive) return endSession();

      // Something else renewed us. Treat that as this tab's renewal too, so the rest of the burst
      // skips the refresh entirely instead of arriving here one at a time.
      markRefreshed();
      return next(applyToken(req, null, useCookieAuth));
    })
  );
}

/** GET /auth/current-user with whatever credentials this browser holds right now. */
function probeSession(next: HttpHandlerFn, useCookieAuth: boolean): Observable<boolean> {
  let probe = new HttpRequest<unknown>('GET', `${environment.apiUrl}/auth/current-user`);
  probe = applyToken(probe, null, useCookieAuth);

  return next(probe).pipe(
    filter(event => event.type === HttpEventType.Response),
    take(1),
    map(() => true),
    // A stream that ends without a response at all must read as "could not tell", never as an
    // answer — `switchMap` would otherwise never fire and the caller's request would hang.
    defaultIfEmpty(false),
    catchError(() => of(false))
  );
}

/**
 * Re-attaches auth to the retried request.
 *
 * Reads localStorage rather than trusting the token the refresh returned: `attemptTokenRecovery`
 * inside AuthService can succeed through a different endpoint and store a token the response
 * never carried, and the stored one is by definition the current one.
 */
function applyToken(
  req: HttpRequest<unknown>, token: string | null, useCookieAuth: boolean
): HttpRequest<unknown> {
  if (useCookieAuth) return req.clone({ withCredentials: true });

  let current = token;
  try {
    current = localStorage.getItem('token') ?? token;
  } catch { /* storage unavailable — fall back to what the refresh returned */ }

  return current
    ? req.clone({ setHeaders: { Authorization: `Bearer ${current}` } })
    : req;
}

/**
 * ⚠ NOT REGISTERED. `app.config.ts` provides only the functional `authInterceptor` above.
 *
 * Kept because it is the DI-style interceptor an `withInterceptorsFromDi()` setup would use, but
 * nothing in this app reaches it — which is precisely how the refresh-on-401 logic below sat here
 * looking implemented while expired tokens went unrenewed for months. If you are about to fix
 * something in `handle401Error`, fix it in `authInterceptor` instead: that is the one that runs.
 *
 * Do NOT register both. Two interceptors refreshing the same rotating refresh token is the
 * failure `refreshOnce` exists to prevent.
 */
@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  private isBrowser: boolean;
  private isRefreshing = false;
  private refreshTokenSubject: BehaviorSubject<any> = new BehaviorSubject<any>(null);
  private useCookieAuth = environment.useCookieAuth || false;

  constructor(
    @Inject(PLATFORM_ID) platformId: Object,
    private authService: AuthService,
    private router: Router
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  intercept(request: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    // Skip auth checks for auth endpoints (don't attach Bearer token to login/register requests)
    const isAuthEndpoint = request.url.includes('/auth/login') ||
                          request.url.includes('/auth/register') ||
                          request.url.includes('/auth/refresh-token') ||
                          request.url.includes('/auth/google') ||
                          request.url.includes('/auth/apple-login');

    // Skip for SignalR endpoints
    const isSignalREndpoint = request.url.includes('/userManagementHub') ||
                             request.url.includes('/negotiate') ||
                             (request.url.includes('?id=') && request.url.includes('access_token='));

    // 2FA: attach trusted-device token on login requests (see authInterceptor above).
    const isLoginRequest = request.url.includes('/auth/login')
                         || request.url.includes('/auth/google-login')
                         || request.url.includes('/auth/apple-login')
                         || request.url.includes('/auth/verify-login-otp');
    if (this.isBrowser && isLoginRequest) {
      try {
        const deviceTokens = deviceTokenHeaderValue();
        if (deviceTokens) {
          request = request.clone({ setHeaders: { 'X-Device-Token': deviceTokens } });
        }
      } catch { /* non-fatal */ }
    }

    if (!isAuthEndpoint && !isSignalREndpoint) {
      // Check if user has been inactive for 30 days (only for non-auth/non-SignalR endpoints)
      if (this.isBrowser && !this.useCookieAuth && this.checkInactivity()) {
        this.authService.logout();
        return throwError(() => new Error('Session expired due to inactivity'));
      }

      // Update last activity time
      if (this.isBrowser && !this.useCookieAuth) {
        localStorage.setItem('lastActivity', Date.now().toString());
      }
    }

    // Handle based on auth method
    if (this.useCookieAuth) {
      // For cookie auth, always include credentials
      request = request.clone({
        withCredentials: true
      });
    } else {
      // For localStorage auth, add bearer token
      let token: string | null = null;
      
      if (this.isBrowser) {
        try {
          token = localStorage.getItem('token');
        } catch (error) {
          // Handle any localStorage access errors
          console.warn('Error accessing localStorage:', error);
          token = null;
        }
      }

      // Add token to request headers if available
      if (token && !isAuthEndpoint && !isSignalREndpoint) {
        request = this.addToken(request, token);
      }
    }

    return next.handle(request).pipe(
      catchError(error => {
        // Don't handle 401 for SignalR endpoints
        if (error instanceof HttpErrorResponse && error.status === 401 && !isAuthEndpoint && !isSignalREndpoint) {
          return this.handle401Error(request, next);
        }
        return throwError(() => error);
      })
    );
  }

  private checkInactivity(): boolean {
    try {
      // Only check inactivity if user is logged in
      const token = localStorage.getItem('token');
      if (!token) {
        // No token means not logged in, so no inactivity check needed
        return false;
      }

      const lastActivity = localStorage.getItem('lastActivity');
      if (!lastActivity) {
        // User is logged in but no activity recorded yet, set it now
        localStorage.setItem('lastActivity', Date.now().toString());
        return false;
      }
      
      const lastActivityTime = parseInt(lastActivity);
      const currentTime = Date.now();
      const thirtyDays = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds
      
      return (currentTime - lastActivityTime) > thirtyDays;
    } catch (error) {
      console.warn('Error checking inactivity:', error);
      return false;
    }
  }

  private addToken(request: HttpRequest<any>, token: string): HttpRequest<any> {
    return request.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`
      }
    });
  }

  private handle401Error(request: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    // Don't try to refresh for auth endpoints
    if (request.url.includes('/auth/')) {
      this.authService.logout();
      return throwError(() => new Error('Authentication failed'));
    }

    if (!this.isRefreshing) {
      this.isRefreshing = true;
      this.refreshTokenSubject.next(null);

      return this.authService.refreshToken().pipe(
        switchMap((response: any) => {
          this.isRefreshing = false;
          
          if (this.useCookieAuth) {
            // For cookie auth, just retry the request
            return next.handle(request);
          } else {
            // For localStorage auth, add new token
            this.refreshTokenSubject.next(response.token);
            return next.handle(this.addToken(request, response.token));
          }
        }),
        catchError((err) => {
          this.isRefreshing = false;
          console.error('Token refresh failed:', err);
          
          // Check if it's a refresh token validation error
          if (err.error && err.error.message && 
              (err.error.message.includes('Invalid refresh token') || 
               err.error.message.includes('Refresh token expired'))) {
            
            // The auth service should have already attempted recovery
            // If we get here, recovery failed, so logout
            this.authService.logout();
          } else {
            // Other types of errors, also logout
            this.authService.logout();
          }
          
          return throwError(() => err);
        })
      );
    } else {
      // If already refreshing, wait for the new token
      return this.refreshTokenSubject.pipe(
        filter(token => token != null),
        take(1),
        switchMap(token => {
          if (this.useCookieAuth) {
            // For cookie auth, just retry
            return next.handle(request);
          } else {
            // For localStorage auth, add token
            return next.handle(this.addToken(request, token));
          }
        })
      );
    }
  }
}