import { ALLOWED_HOSTS, rejectedHeader } from './host-guard';

describe('host-guard (server.ts request allowlist)', () => {
  it('serves the live domains and local runs, with or without a port', () => {
    for (const host of ['dreamcleaningnyc.com', 'www.dreamcleaningnyc.com', 'localhost:4000', '127.0.0.1:4000', 'DreamCleaningNYC.com']) {
      expect(rejectedHeader({ host }), host).toBeNull();
    }
  });

  it('serves what Apache forwards for a visitor', () => {
    expect(rejectedHeader({
      host: 'dreamcleaningnyc.com',
      forwardedHost: 'dreamcleaningnyc.com',
      forwardedProto: 'https',
      forwardedPort: '443'
    })).toBeNull();
  });

  it('refuses a missing or unknown Host', () => {
    expect(rejectedHeader({})).toBe('host');
    expect(rejectedHeader({ host: '' })).toBe('host');
    expect(rejectedHeader({ host: 'evil.example' })).toBe('host');
    expect(rejectedHeader({ host: 'dreamcleaningnyc.com.evil.example' })).toBe('host');
    expect(rejectedHeader({ host: 'evil-dreamcleaningnyc.com' })).toBe('host');
  });

  it('refuses the retired domain (Apache 301s it before Node)', () => {
    expect(rejectedHeader({ host: 'dreamcleaningnearme.com' })).toBe('host');
    expect(rejectedHeader({ host: 'www.dreamcleaningnearme.com' })).toBe('host');
  });

  it('refuses hosts that are not a plain name[:port]', () => {
    for (const host of ['dreamcleaningnyc.com.', 'dreamcleaningnyc.com/evil', 'user@dreamcleaningnyc.com', '[::1]:4000', 'dreamcleaningnyc.com:http', 'dreamcleaningnyc.com:123456']) {
      expect(rejectedHeader({ host }), host).toBe('host');
    }
  });

  it('refuses a forwarded host the allowlist does not hold, on any hop', () => {
    expect(rejectedHeader({ host: 'dreamcleaningnyc.com', forwardedHost: 'evil.example' })).toBe('x-forwarded-host');
    expect(rejectedHeader({ host: 'dreamcleaningnyc.com', forwardedHost: 'dreamcleaningnyc.com, evil.example' })).toBe('x-forwarded-host');
    expect(rejectedHeader({ host: 'dreamcleaningnyc.com', forwardedHost: 'dreamcleaningnyc.com/x' })).toBe('x-forwarded-host');
  });

  it('refuses a forwarded scheme or port that is not a scheme or port', () => {
    expect(rejectedHeader({ host: 'localhost', forwardedProto: 'javascript' })).toBe('x-forwarded-proto');
    expect(rejectedHeader({ host: 'localhost', forwardedProto: 'https, http' })).toBeNull();
    expect(rejectedHeader({ host: 'localhost', forwardedPort: '443abc' })).toBe('x-forwarded-port');
    expect(rejectedHeader({ host: 'localhost', forwardedPort: '443, 80' })).toBeNull();
  });

  it('keeps the list to the hosts this site answers', () => {
    expect([...ALLOWED_HOSTS]).toEqual(['dreamcleaningnyc.com', 'www.dreamcleaningnyc.com', 'localhost', '127.0.0.1']);
  });
});
