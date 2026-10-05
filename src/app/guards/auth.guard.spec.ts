import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot } from '@angular/router';
import { BehaviorSubject, Observable, firstValueFrom } from 'rxjs';

import { authGuard } from './auth.guard';
import { AuthService } from '../services/auth.service';

describe('authGuard', () => {
  let loggedIn: boolean;
  let navigate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    loggedIn = false;
    navigate = vi.fn().mockResolvedValue(true);
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { isInitialized$: new BehaviorSubject(true), isLoggedIn: () => loggedIn } },
        { provide: Router, useValue: { navigate } },
      ],
    });
  });

  afterEach(() => vi.useRealTimers());

  const run = () => TestBed.runInInjectionContext(() =>
    authGuard({} as ActivatedRouteSnapshot, { url: '/rewards' } as RouterStateSnapshot)) as Observable<boolean>;

  it('lets a signed-in user through at once', async () => {
    loggedIn = true;
    await expect(firstValueFrom(run())).resolves.toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('redirects a visitor to login after the short shimmer delay', async () => {
    vi.useFakeTimers();
    const result = firstValueFrom(run());
    await vi.advanceTimersByTimeAsync(199);
    expect(navigate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe(false);
    expect(navigate).toHaveBeenCalledWith(['/login'], { queryParams: { returnUrl: '/rewards' } });
  });

  // Server rendering and hydration wait for a stable app. Without zone.js nothing tracks a bare
  // timer, so the guard has to keep the app marked busy until it has decided where to send the visitor.
  it('keeps the app busy until the redirect has fired', async () => {
    vi.useFakeTimers();
    const appRef = TestBed.inject(ApplicationRef);
    const result = firstValueFrom(run());
    await vi.advanceTimersByTimeAsync(100);
    let stable = false;
    const sub = appRef.isStable.subscribe(s => stable = s);
    expect(stable).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    await result;
    await vi.advanceTimersByTimeAsync(10);
    expect(stable).toBe(true);
    sub.unsubscribe();
  });
});
