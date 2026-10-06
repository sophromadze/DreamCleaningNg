import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { AttributionService, Attribution } from './attribution.service';

/**
 * First-touch capture (2026-10): the raw signals the backend classifies orders from — ad click
 * ids (gclid / gbraid / wbraid / msclkid), the external referrer without its query string, the
 * landing path — and a 90-day lifetime counted from the FIRST visit.
 */
describe('AttributionService first-touch capture', () => {
  const COOKIE = 'dc_attribution';
  let service: AttributionService;
  let originalUrl: string;

  function setReferrer(value: string): void {
    Object.defineProperty(document, 'referrer', { value, configurable: true });
  }

  function land(pathAndQuery: string, referrer = ''): void {
    window.history.replaceState({}, '', pathAndQuery);
    setReferrer(referrer);
  }

  function stored(): Attribution | null {
    return service.getAttribution();
  }

  beforeEach(() => {
    originalUrl = window.location.pathname + window.location.search;
    TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: 'browser' }] });
    service = TestBed.inject(AttributionService);
  });

  afterEach(() => {
    document.cookie = `${COOKIE}=; path=/; max-age=0`;
    window.history.replaceState({}, '', originalUrl);
    setReferrer('');
  });

  for (const id of ['gclid', 'gbraid', 'wbraid', 'msclkid']) {
    it(`files a ${id} click as Paid Search and keeps the click id`, () => {
      land(`/deep-cleaning?${id}=Cj0-abc_123`, 'https://www.google.com/');
      service.captureFirstTouch();

      const a = stored()!;
      expect(a.channel).toBe('Paid Search');
      expect(a.clickIdType).toBe(id);
      expect(a.clickId).toBe('Cj0-abc_123');
      expect(a.landingPage).toBe('/deep-cleaning');
    });
  }

  it('keeps the referrer without its query string', () => {
    land('/', 'https://www.bing.com/search?q=maid+service+brooklyn');
    service.captureFirstTouch();

    const a = stored()!;
    expect(a.channel).toBe('Organic Search');
    expect(a.referrer).toBe('https://www.bing.com/search');
    expect(a.clickIdType).toBeUndefined();
  });

  it('records no referrer for a direct visit', () => {
    land('/pricing');
    service.captureFirstTouch();

    const a = stored()!;
    expect(a.channel).toBe('Direct');
    expect(a.referrer).toBeUndefined();
  });

  it('never overwrites the first touch', () => {
    land('/', 'https://www.google.com/');
    service.captureFirstTouch();
    land('/?gclid=later');
    service.captureFirstTouch();

    expect(stored()!.channel).toBe('Organic Search');
    expect(stored()!.clickId).toBeUndefined();
  });

  it('gives a cookie written under the old 30-day lifetime 90 days from its own first visit', () => {
    const firstVisit = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    const legacy = { channel: 'Referral', source: 'yelp.com', medium: 'referral', campaign: '(none)', landingPage: '/', timestamp: firstVisit };
    document.cookie = `${COOKIE}=${encodeURIComponent(JSON.stringify(legacy))}; path=/; max-age=${10 * 24 * 60 * 60}`;
    const writes: string[] = [];
    const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')!;
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => descriptor.get!.call(document),
      set: (v: string) => { writes.push(v); descriptor.set!.call(document, v); }
    });
    try {
      service.captureFirstTouch();
    } finally {
      delete (document as any).cookie;
    }

    expect(stored()).toEqual(legacy);   // content untouched
    const maxAge = Number(/max-age=(\d+)/.exec(writes[0])![1]);
    const seventyDays = 70 * 24 * 60 * 60;
    expect(Math.abs(maxAge - seventyDays)).toBeLessThan(120);
  });

  it('does nothing on the server', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: 'server' }] });
    const server = TestBed.inject(AttributionService);
    land('/?gclid=x');
    server.captureFirstTouch();

    expect(server.getAttribution()).toBeNull();
    expect(document.cookie).not.toContain(COOKIE);
  });
});
