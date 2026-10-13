import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, provideRouter } from '@angular/router';
import { SOCIAL_AUTH_CONFIG, SocialAuthServiceConfig } from '@abacritt/angularx-social-login';
import { Observable } from 'rxjs';

import { AuthService, UserDto } from './auth.service';
import { authGuard } from '../guards/auth.guard';
import { environment } from '../../environments/environment';
import { NETWORK_RETRY_DELAY_MS, networkRetryInterceptor } from '../shared/http/backend-reachability';

import { testProviders } from '../../testing/test-providers';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [...testProviders],
    });
    service = TestBed.inject(AuthService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});

/**
 * A PAGE LOADED WHILE THE BACKEND RESTARTS KEEPS ITS SESSION (2026-10, cookie auth).
 *
 * The start-up GET auth/current-user used to read ANY failure as "not signed in": a page opened
 * during a deploy showed "Sign in" and bounced protected pages to /login. Only a 401 / 403 says
 * that now. Without an answer the cached user stays signed in; with no cached user the session is
 * UNKNOWN - auth stays uninitialized (header shimmer, guards wait) and asks again until it hears.
 */
describe('AuthService start-up session check (cookie auth, backend unreachable)', () => {
  const USER = { id: 7, firstName: 'Ana', lastName: 'Kay', email: 'ana@example.invalid', role: 'Customer', firstTimeOrder: false } as UserDto;
  const url = `${environment.apiUrl}/auth/current-user`;
  const cookieAuthBefore = environment.useCookieAuth;
  let backend: HttpTestingController;
  let navigate: ReturnType<typeof vi.spyOn>;

  const start = (cachedUser: UserDto | null) => {
    localStorage.setItem('sessionExists', 'true');
    if (cachedUser) localStorage.setItem('headerUserCache', JSON.stringify({ user: cachedUser, timestamp: Date.now() }));
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr(), withInterceptors([networkRetryInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: SOCIAL_AUTH_CONFIG, useValue: { autoLogin: false, providers: [], onError: () => {} } as SocialAuthServiceConfig },
      ],
    });
    backend = TestBed.inject(HttpTestingController);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    return TestBed.inject(AuthService);
  };
  const unreachableTwice = (first = 0, second = 502) => {
    const answer = (status: number) => status === 0
      ? backend.expectOne(url).error(new ProgressEvent('error'), { status: 0 })
      : backend.expectOne(url).flush('down', { status, statusText: 'Down' });
    answer(first);
    vi.advanceTimersByTime(NETWORK_RETRY_DELAY_MS);
    answer(second);
  };
  const initialized = (auth: AuthService) => {
    let value = false;
    auth.isInitialized$.subscribe(v => (value = v)).unsubscribe();
    return value;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    (environment as { useCookieAuth: boolean }).useCookieAuth = true;
  });

  afterEach(() => {
    backend.verify();
    (environment as { useCookieAuth: boolean }).useCookieAuth = cookieAuthBefore;
    localStorage.removeItem('sessionExists');
    localStorage.removeItem('headerUserCache');
    vi.useRealTimers();
  });

  it('keeps a cached user signed in when current-user cannot be reached (after its one retry)', () => {
    const auth = start(USER);

    unreachableTwice(0, 503);

    expect(auth.currentUserValue?.id).toBe(7);
    expect(auth.isLoggedIn()).toBe(true);
    expect(initialized(auth)).toBe(true);
    // Nothing the next load relies on was cleared.
    expect(localStorage.getItem('sessionExists')).toBe('true');
    expect(localStorage.getItem('headerUserCache')).not.toBeNull();
    expect(navigate).not.toHaveBeenCalled();

    // It confirms the session once the backend is back.
    vi.advanceTimersByTime(2000);
    backend.expectOne(url).flush(USER);
    expect(auth.currentUserValue?.id).toBe(7);
  });

  it('with no cached user: session unknown - not signed out, guards wait instead of redirecting', async () => {
    const auth = start(null);

    unreachableTwice(522, 0);

    expect(initialized(auth)).toBe(false);
    expect(auth.currentUserValue).toBeNull();
    expect(localStorage.getItem('sessionExists')).toBe('true');

    // A protected page asks: no redirect to /login while nobody knows.
    let allowed: boolean | undefined;
    TestBed.runInInjectionContext(() =>
      (authGuard({} as ActivatedRouteSnapshot, { url: '/profile' } as RouterStateSnapshot) as Observable<boolean>)
        .subscribe(v => (allowed = v)));
    await vi.advanceTimersByTimeAsync(1000);
    expect(allowed).toBeUndefined();
    expect(navigate).not.toHaveBeenCalled();

    // The re-check finds the backend back (2 s): signed in, and the page opens.
    await vi.advanceTimersByTimeAsync(1000);
    backend.expectOne(url).flush(USER);
    expect(initialized(auth)).toBe(true);
    expect(auth.currentUserValue?.id).toBe(7);
    expect(allowed).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps asking with backoff while the backend stays away', () => {
    const auth = start(null);
    unreachableTwice();

    // 2 s, then 4 s (each attempt has its own one retry).
    vi.advanceTimersByTime(2000);
    unreachableTwice(503, 503);
    vi.advanceTimersByTime(3999);
    backend.expectNone(url);
    vi.advanceTimersByTime(1);
    backend.expectOne(url).flush(USER);

    expect(auth.currentUserValue?.id).toBe(7);
  });

  it('asks again at once on the next navigation', () => {
    start(null);
    unreachableTwice();

    TestBed.inject(Router).navigateByUrl('/anywhere').catch(() => {});
    backend.expectOne(url).flush({ message: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });
  });

  it('still signs out on a real 401: initialized, nobody, session hints cleared', () => {
    const auth = start(USER);

    backend.expectOne(url).flush({ message: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });

    expect(auth.currentUserValue).toBeNull();
    expect(initialized(auth)).toBe(true);
    expect(localStorage.getItem('sessionExists')).toBeNull();
    // No re-check loop after a definite answer.
    vi.advanceTimersByTime(60_000);
    backend.expectNone(url);
  });

  it('checkCurrentUserSession keeps the user (and stored tokens) when the backend does not answer', () => {
    const auth = start(USER);
    backend.expectOne(url).flush(USER);

    let result: UserDto | null | undefined;
    auth.checkCurrentUserSession().subscribe(u => (result = u));
    unreachableTwice(504, 500);

    expect(result?.id).toBe(7);
    expect(auth.currentUserValue?.id).toBe(7);
  });

  it('checkCurrentUserSession still clears on 403', () => {
    const auth = start(USER);
    backend.expectOne(url).flush(USER);

    let result: UserDto | null | undefined = USER;
    auth.checkCurrentUserSession().subscribe(u => (result = u));
    backend.expectOne(url).flush({ message: 'Forbidden' }, { status: 403, statusText: 'Forbidden' });

    expect(result).toBeNull();
    expect(auth.currentUserValue).toBeNull();
  });
});

