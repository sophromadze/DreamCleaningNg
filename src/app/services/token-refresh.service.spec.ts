import { TestBed } from '@angular/core/testing';

import { TokenRefreshService } from './token-refresh.service';
import { AuthService } from './auth.service';

import { testProviders } from '../../testing/test-providers';

describe('TokenRefreshService', () => {
  let service: TokenRefreshService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [...testProviders],
    });
    service = TestBed.inject(TokenRefreshService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  /**
   * TIMER DELAYS CAN NEVER OVERFLOW setInterval (2026-09).
   *
   * `setTimeout`/`setInterval` coerce their delay to a SIGNED 32-BIT integer. A delay above
   * 2,147,483,647 ms (~24.8 days) wraps negative and is then clamped to 0, so the timer fires
   * every few milliseconds instead of never.
   *
   * `TOKEN_REFRESH_INTERVAL` was 29 days — 2,505,600,000 ms — which is exactly that. In
   * production the "refresh once every 29 days" timer became a tight loop that machine-gunned
   * `POST /api/auth/refresh-token` and filled the console with failures that could not be
   * stopped without closing the tab.
   *
   * These assert the invariant rather than the specific figure: any interval is fine as long as
   * it cannot wrap.
   */
  describe('browser timer delays', () => {
    const MAX_TIMER_DELAY = 2147483647; // int32 max, the ceiling setInterval will accept

    it('schedules no interval longer than a signed 32-bit millisecond delay', () => {
      const internals = service as any;

      for (const name of ['TOKEN_REFRESH_INTERVAL', 'INACTIVITY_CHECK_INTERVAL']) {
        const delay = internals[name];

        expect(typeof delay).toBe('number');
        // > 0 as well as <= the ceiling: a 0 or negative delay is the same tight loop by a
        // different route.
        expect(delay).toBeGreaterThan(0);
        expect(delay, `${name} would overflow setInterval and fire in a loop`)
          .toBeLessThanOrEqual(MAX_TIMER_DELAY);
      }
    });

    it('still refreshes before the 30-day token expiry', () => {
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;

      expect((service as any).TOKEN_REFRESH_INTERVAL).toBeLessThan(thirtyDays);
    });

    it('pins an overflowing delay to the ceiling instead of letting it wrap', () => {
      const clamp = (service as any).clampTimerDelay.bind(service);

      // The exact value that caused the production loop.
      expect(clamp(29 * 24 * 60 * 60 * 1000)).toBe(MAX_TIMER_DELAY);
      expect(clamp(Number.MAX_SAFE_INTEGER)).toBe(MAX_TIMER_DELAY);
      // A negative delay clamps to 0 rather than being passed through.
      expect(clamp(-1)).toBe(0);
      // Anything already in range is untouched.
      expect(clamp(60_000)).toBe(60_000);
    });
  });

  /**
   * THE DELAYED START BELONGS TO THE SERVICE'S LIFECYCLE (2026-10).
   *
   * `startTokenRefresh()` waits a second before it starts its two intervals (refresh +
   * inactivity). `stopTokenRefresh()` used to cancel only the intervals, so the wait it had already
   * queued still fired: signing out in that first second started both timers for a signed-out
   * tab, and a stop + start inside it queued a second wait — two sets of timers racing the same
   * rotating refresh token. Nothing stopped the service on destroy either. Found by the Vitest
   * migration: a start left behind by one spec fired inside a later spec's fake clock.
   */
  describe('lifecycle of the delayed start', () => {
    const START_DELAY_MS = 1000;
    const TIMERS_PER_START = 2; // the refresh interval + the inactivity interval

    beforeEach(() => {
      vi.useFakeTimers();
      vi.spyOn(TestBed.inject(AuthService), 'isLoggedIn').mockReturnValue(true);
      // The start-up expiry check talks to the server; it is not what these tests are about.
      vi.spyOn(service as any, 'checkTokenExpiry').mockImplementation(() => {});
    });

    it('starts both timers a second after a signed-in start', async () => {
      service.startTokenRefresh();
      await vi.advanceTimersByTimeAsync(START_DELAY_MS);

      expect(vi.getTimerCount()).toBe(TIMERS_PER_START);
      service.stopTokenRefresh();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('starts nothing when the user signs out within the first second', async () => {
      service.startTokenRefresh();
      service.stopTokenRefresh();
      await vi.advanceTimersByTimeAsync(START_DELAY_MS * 5);

      expect(vi.getTimerCount()).toBe(0);
    });

    it('runs ONE set of timers after a stop + start within the first second', async () => {
      service.startTokenRefresh();
      service.stopTokenRefresh();
      service.startTokenRefresh();
      await vi.advanceTimersByTimeAsync(START_DELAY_MS * 5);

      expect(vi.getTimerCount()).toBe(TIMERS_PER_START);
      service.stopTokenRefresh();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('runs ONE set of timers when start is called twice', async () => {
      service.startTokenRefresh();
      service.startTokenRefresh();
      await vi.advanceTimersByTimeAsync(START_DELAY_MS * 5);
      service.startTokenRefresh();

      expect(vi.getTimerCount()).toBe(TIMERS_PER_START);
      service.stopTokenRefresh();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('stops everything when it is destroyed, pending start included', async () => {
      service.startTokenRefresh();
      TestBed.resetTestingModule(); // destroys the root injector, and the service with it
      await vi.advanceTimersByTimeAsync(START_DELAY_MS * 5);

      expect(vi.getTimerCount()).toBe(0);
    });

    it('stops its running timers when it is destroyed', async () => {
      service.startTokenRefresh();
      await vi.advanceTimersByTimeAsync(START_DELAY_MS);
      expect(vi.getTimerCount()).toBe(TIMERS_PER_START);

      TestBed.resetTestingModule();

      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
