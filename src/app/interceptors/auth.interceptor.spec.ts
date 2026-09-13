import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse, HttpHeaders, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { SocialAuthServiceConfig } from '@abacritt/angularx-social-login';
import { of, throwError, Subject } from 'rxjs';

import { authInterceptor, SESSION_REVOKED_HEADER } from './auth.interceptor';
import { AuthService } from '../services/auth.service';

/**
 * A ROLE CHANGE LOGS THE ACCOUNT OUT EVEN IF NOBODY IS AT THE SCREEN (2026-09).
 *
 * The SignalR "RoleChanged" notice only reaches a browser that has the page open. An offline
 * user kept a signed token carrying the OLD role until it expired, up to a week later. The API
 * now refuses that token (User.TokenVersion) and marks the 401 it returns with
 * X-Session-Revoked, and this interceptor is what turns that into an actual logout the next
 * time the person opens the site.
 *
 * The header is the whole point of the design: a bare "401 means log out" rule would sign a
 * perfectly valid admin out the first time some unrelated endpoint answered 401 for its own
 * reasons.
 */
describe('authInterceptor — revoked sessions', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let logout: jasmine.Spy;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: 'SocialAuthServiceConfig',
          useValue: { autoLogin: false, providers: [], onError: () => {} } as SocialAuthServiceConfig,
        },
      ],
    });

    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
    logout = spyOn(TestBed.inject(AuthService), 'logout').and.stub();
  });

  afterEach(() => backend.verify());

  it('logs out when the API says the session was revoked', () => {
    http.get('/api/order').subscribe({ next: () => {}, error: () => {} });

    backend.expectOne('/api/order').flush(
      { message: 'Unauthorized' },
      { status: 401, statusText: 'Unauthorized', headers: new HttpHeaders({ [SESSION_REVOKED_HEADER]: '1' }) }
    );

    expect(logout).toHaveBeenCalled();
  });

  it('leaves an ordinary 401 alone', () => {
    // e.g. a stale guest payment token on one endpoint. The signed-in user is fine and must
    // stay signed in.
    http.get('/api/order').subscribe({ next: () => {}, error: () => {} });

    backend.expectOne('/api/order').flush(
      { message: 'Unauthorized' },
      { status: 401, statusText: 'Unauthorized' }
    );

    expect(logout).not.toHaveBeenCalled();
  });

  it('leaves other failures alone', () => {
    http.get('/api/order').subscribe({ next: () => {}, error: () => {} });

    backend.expectOne('/api/order').flush({ message: 'Nope' }, { status: 403, statusText: 'Forbidden' });

    expect(logout).not.toHaveBeenCalled();
  });

  it('still reports the original error to the caller', () => {
    // Logging out must not swallow the failure the caller was waiting on.
    let received: unknown;
    http.get('/api/order').subscribe({ next: () => {}, error: (err) => (received = err) });

    backend.expectOne('/api/order').flush(
      { message: 'Unauthorized' },
      { status: 401, statusText: 'Unauthorized', headers: new HttpHeaders({ [SESSION_REVOKED_HEADER]: '1' }) }
    );

    expect(received instanceof HttpErrorResponse).toBeTrue();
    expect((received as HttpErrorResponse).status).toBe(401);
  });
});

/**
 * AN EXPIRED TOKEN IS RENEWED, ONCE (2026-09).
 *
 * The access token lives 30 days and nothing renewed it: the refresh-on-401 logic lived in the
 * class-based `AuthInterceptor`, which `app.config.ts` never registered. So when the token expired
 * mid-session every request 401'd — the admin panel rendered empty tables with an error under each
 * one — and the session only actually ended on the next page load. "No data, console errors, then
 * I refresh and I am logged out" was that, exactly.
 *
 * The single-flight half is not a nicety. The backend ROTATES the refresh token on every use, so a
 * panel that fires a dozen requests at once would send the same refresh token a dozen times: the
 * first rotates it and the other eleven are told "Invalid refresh token", ending the session that
 * had just been renewed successfully.
 */
describe('authInterceptor — renewing an expired token', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let auth: AuthService;
  let logout: jasmine.Spy;
  let refresh: jasmine.Spy;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: 'SocialAuthServiceConfig',
          useValue: { autoLogin: false, providers: [], onError: () => {} } as SocialAuthServiceConfig,
        },
      ],
    });

    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);

    logout = spyOn(auth, 'logout').and.stub();
    spyOn(auth, 'isLoggedIn').and.returnValue(true);
    refresh = spyOn(auth, 'refreshToken').and.returnValue(of({ token: 'fresh-token' } as any));
  });

  afterEach(() => backend.verify());

  it('refreshes and retries the request that hit the expired token', () => {
    let body: unknown;
    http.get('/api/admin/orders').subscribe({ next: (b) => (body = b), error: () => {} });

    backend.expectOne('/api/admin/orders').flush(
      { message: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });

    // The retry — the caller never sees the 401, which is the whole point: the admin panel
    // renders its data instead of an error.
    backend.expectOne('/api/admin/orders').flush({ orders: [] });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(body).toEqual({ orders: [] } as any);
    expect(logout).not.toHaveBeenCalled();
  });

  it('refreshes ONCE for a burst of simultaneous 401s', () => {
    // A PENDING refresh, because that is the real situation: the network call is in flight while
    // the other 401s arrive. This is the case that matters — the backend rotates the refresh
    // token, so a second concurrent refresh is answered "Invalid refresh token" and ends the
    // session that the first one had just renewed.
    const pending = new Subject<any>();
    refresh.and.returnValue(pending.asObservable());

    const urls = ['/api/admin/orders', '/api/admin/users', '/api/admin/permissions'];

    for (const url of urls) http.get(url).subscribe({ next: () => {}, error: () => {} });
    for (const url of urls) {
      backend.expectOne(url).flush({ message: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });
    }

    expect(refresh).toHaveBeenCalledTimes(1);

    // One renewal, and every queued request goes again with it.
    pending.next({ token: 'fresh-token' });
    pending.complete();

    for (const url of urls) backend.expectOne(url).flush({});

    expect(logout).not.toHaveBeenCalled();
  });

  it('logs out when the refresh itself fails', () => {
    refresh.and.returnValue(throwError(() => new HttpErrorResponse({ status: 401 })));

    let received: unknown;
    http.get('/api/admin/orders').subscribe({ next: () => {}, error: (err) => (received = err) });

    backend.expectOne('/api/admin/orders').flush(
      { message: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });

    expect(logout).toHaveBeenCalled();
    // Ending the session must not swallow the failure the caller was waiting on.
    expect(received).toBeTruthy();
  });

  it('never tries to refresh the refresh call itself', () => {
    // Circular by construction, and it is also how a genuinely dead session would loop forever.
    http.post('/api/auth/refresh-token', {}).subscribe({ next: () => {}, error: () => {} });

    backend.expectOne('/api/auth/refresh-token').flush(
      { message: 'Invalid refresh token' }, { status: 401, statusText: 'Unauthorized' });

    expect(refresh).not.toHaveBeenCalled();
  });

  it('leaves a revoked session alone — that one cannot be renewed', () => {
    // The same revoke dropped the refresh token server-side, so retrying would only produce a
    // second failure on the way to the same logout.
    http.get('/api/admin/orders').subscribe({ next: () => {}, error: () => {} });

    backend.expectOne('/api/admin/orders').flush(
      { message: 'Unauthorized' },
      { status: 401, statusText: 'Unauthorized', headers: new HttpHeaders({ [SESSION_REVOKED_HEADER]: '1' }) }
    );

    expect(refresh).not.toHaveBeenCalled();
    expect(logout).toHaveBeenCalled();
  });
});
