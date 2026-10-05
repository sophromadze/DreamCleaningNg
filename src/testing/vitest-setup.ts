/**
 * Global setup for `ng test` (angular.json -> test.options.setupFiles), loaded before every spec
 * file. Runs after the polyfills (zone.js) and the Angular TestBed initialisation.
 *
 * 1. NO REAL NETWORK. Karma ran in a real browser and jsdom implements XMLHttpRequest for real,
 *    so an HttpClient call that escaped HttpTestingController would leave the machine (the local
 *    backend on :5107, or whatever an absolute URL names). Every transport a spec could reach is
 *    replaced by one that throws, AND each attempt is recorded and fails the test that made it in
 *    afterEach — app code often catches HTTP errors, which would otherwise hide the throw.
 *    HttpTestingController never touches these: it replaces the HttpBackend itself.
 *    In the Chromium "browser" configuration only XMLHttpRequest (what HttpClient uses here) and
 *    EventSource are blocked: Vitest's browser runner talks to the page over fetch/WebSocket.
 *
 * 2. jsdom GAPS that the app's own code calls. Each stub is a no-op with the browser's shape and
 *    is installed only when the environment lacks it, so the Chromium "browser" configuration
 *    keeps the real implementation. Specs that assert on these still spy on them as before.
 */

import { getTestBed } from '@angular/core/testing';

/**
 * Fails the test that just finished. Vitest skips the after-hooks still to run once one throws —
 * Angular's TestBed reset among them — so reset first, or the NEXT test fails too with "Cannot
 * configure the test module when the test module has already been instantiated".
 */
function failFinishedTest(message: string): never {
  getTestBed().resetTestingModule();
  throw new Error(message);
}

// Every spec FILE starts from empty storage. Files share one jsdom window per worker (isolate:
// false, as in Karma's single page), and which files share one depends on scheduling — so a login
// one file left behind could change how an unrelated file starts, run to run. (This hook runs once
// per file; tests inside a file still share storage the way they always did.)
beforeAll(() => {
  localStorage.clear();
  sessionStorage.clear();
});

const networkAttempts: string[] = [];

function refuse(api: string): never {
  networkAttempts.push(api);
  throw new Error(`Real network access from a unit test (${api}). Mock it (HttpTestingController / a spy) instead.`);
}

const inRealBrowser = typeof navigator !== 'undefined' && /HeadlessChrome|Chrome\//.test(navigator.userAgent);

Object.assign(globalThis, {
  XMLHttpRequest: class BlockedXMLHttpRequest {
    constructor() { refuse('XMLHttpRequest'); }
  },
  EventSource: class BlockedEventSource {
    constructor(url: string | URL) { refuse(`EventSource ${url}`); }
  },
});
// AttributionService reports sessions with sendBeacon; Karma's Chrome really sent it to :5107.
if (typeof navigator !== 'undefined') {
  Object.defineProperty(navigator, 'sendBeacon', {
    configurable: true,
    writable: true,
    value: (url: string | URL) => refuse(`sendBeacon ${url}`),
  });
}
if (!inRealBrowser) {
  Object.assign(globalThis, {
    WebSocket: class BlockedWebSocket {
      constructor(url: string | URL) { refuse(`WebSocket ${url}`); }
    },
    fetch: (input: unknown) => {
      try { refuse(`fetch ${String(input)}`); } catch (e) { return Promise.reject(e); }
    },
  });
}

// Registered after Angular's TestBed hooks, so (hooks run in reverse) this runs while the test's
// fixture is still alive — where fakeAsync's own end-of-test flush ran.
afterEach(async () => {
  // Specs converted from fakeAsync switch to fake timers with vi.useFakeTimers(). Keep fakeAsync's
  // end-of-test rules ({flush: true}, its default): one-shot timers still queued are run, up to 20
  // turns, and a test that leaves something re-arming (an interval, a polling loop) fails —
  // vi.clearAllTimers() is the old discardPeriodicTasks(). Real timers come back whatever happened.
  if (vi.isFakeTimers()) {
    try {
      for (let turn = 0; turn < 20 && vi.getTimerCount() > 0; turn++) await vi.runOnlyPendingTimersAsync();
      const left = vi.getTimerCount();
      if (left) failFinishedTest(`${left} periodic timer(s) still queued at the end of the test (fakeAsync would have failed).`);
    } finally {
      vi.useRealTimers();
    }
  }
});

afterEach(() => {
  if (networkAttempts.length) {
    const attempts = networkAttempts.splice(0);
    failFinishedTest(`Real network access from this test: ${attempts.join(', ')}`);
  }
});

if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

// Every query reports "no match": what Karma's headless Chrome (800x600, mouse, no reduced-motion
// preference) answered for each query the app asks — the chat widget's <=550px full-screen query
// and prefers-reduced-motion. A spec that needs a match spies on window.matchMedia.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (media: string): MediaQueryList => ({
    media,
    matches: false,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}
