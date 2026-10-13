import { secureCookieAttribute } from './cookie-security';
import { writeUiHintCookie } from './ui-hint-cookie';
import { AttributionService } from '../../services/attribution.service';
import { TestBed } from '@angular/core/testing';

/**
 * Every cookie the browser app writes is Secure on https (2026-10): dc_attribution and dc_session
 * were the two without it. Plain-http local dev gets no Secure, or Safari / a phone on a LAN
 * address would drop the cookie and attribution would silently stop being kept.
 */
describe('secureCookieAttribute', () => {
  const doc = (protocol: string) => ({ location: { protocol } }) as unknown as Document;

  it('is "; Secure" on https and nothing on http', () => {
    expect(secureCookieAttribute(doc('https:'))).toBe('; Secure');
    expect(secureCookieAttribute(doc('http:'))).toBe('');
    expect(secureCookieAttribute(null)).toBe('');
  });

  it('dc_ui carries it, with SameSite=Lax and Path=/ unchanged', () => {
    const written: string[] = [];
    const fake = { location: { protocol: 'https:' }, get cookie() { return ''; }, set cookie(v: string) { written.push(v); } } as unknown as Document;
    writeUiHintCookie(fake, { signedIn: true, admin: false, pointsBadge: true });
    expect(written[0]).toMatch(/^dc_ui=[^;]+; Path=\/; SameSite=Lax; Secure; Max-Age=2592000$/);
  });

  it('dc_attribution and dc_session keep path, max-age and SameSite=Lax (no Secure on the http test page)', () => {
    const writes: string[] = [];
    const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')!;
    const spy = vi.spyOn(document, 'cookie', 'set').mockImplementation(v => { writes.push(v); desc.set!.call(document, v); });
    // captureSession counts a new session with a beacon; nothing leaves the test.
    const beacon = vi.spyOn(AttributionService.prototype as any, 'logSession').mockImplementation(() => {});
    try {
      const service = TestBed.inject(AttributionService);
      service.captureFirstTouch();
      service.captureSession();
    } finally {
      spy.mockRestore();
      beacon.mockRestore();
    }
    const attribution = writes.find(w => w.startsWith('dc_attribution='))!;
    const session = writes.find(w => w.startsWith('dc_session='))!;
    expect(attribution).toMatch(/; path=\/; max-age=7776000; SameSite=Lax$/);
    expect(session).toMatch(/; path=\/; max-age=86400; SameSite=Lax$/);
    expect(location.protocol).toBe('http:');
  });
});
