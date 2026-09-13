import { TestBed } from '@angular/core/testing';

import { TokenRefreshService } from './token-refresh.service';

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
        expect(delay)
          .withContext(`${name} would overflow setInterval and fire in a loop`)
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
});
