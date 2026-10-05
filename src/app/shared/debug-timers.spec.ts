import { debugTimersPaused } from './debug-timers';

describe('debugTimersPaused', () => {
  afterEach(() => localStorage.removeItem('dc_debug_pause_timers'));

  it('is off unless the debug flag is set', () => {
    expect(debugTimersPaused()).toBe(false);
  });

  it('is on when the flag is "1" (tests run in dev mode)', () => {
    localStorage.setItem('dc_debug_pause_timers', '1');
    expect(debugTimersPaused()).toBe(true);
  });

  it('ignores any other flag value', () => {
    localStorage.setItem('dc_debug_pause_timers', 'true');
    expect(debugTimersPaused()).toBe(false);
  });
});
