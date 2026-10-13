import {
  PERMANENT_REDIRECTS,
  isBookingPage,
  isMissingFileRequest,
  isStaticFileRequest,
  permanentRedirectLocation,
  staticCacheControl
} from './server-routing';

// Every expectation below is what the Express 4 server answered (routes '*.*', '*' and the
// PERMANENT_REDIRECTS keys as route strings) before the Express 5 upgrade.
describe('server-routing (server.ts request routing, Express 4 behaviour)', () => {
  it('hands every path with a dot to express.static, and nothing else', () => {
    for (const path of [
      '/robots.txt', '/sitemap.xml', '/site.webmanifest', '/favicon.ico', '/main-ABC123.js',
      '/styles-XYZ.css', '/images/hero.webp', '/img/responsive/x-640.webp', '/fonts/poppins-v1.woff2',
      '/fontawesome.css', '/.well-known/security.txt', '/.htaccess', '/blog/v1.2-release',
      '/robots.txt/', '/a.', '/.', '/.well-known'
    ]) {
      expect(isStaticFileRequest(path), path).toBe(true);
    }
    for (const path of ['/', '/pricing-and-discounts', '/images', '/images/', '/blog/some-post', '/x%2Ejs']) {
      expect(isStaticFileRequest(path), path).toBe(false);
    }
  });

  it('404s missing files and /.well-known/*, never a page route', () => {
    for (const path of [
      '/chunk-DOESNOTEXIST.js', '/nope.txt', '/llms-full.txt', '/ai-catalog.json', '/images/nope.png',
      '/IMAGES/NOPE.PNG', '/x.jpeg', '/x.jpg', '/x.woff', '/x.woff2', '/x.map', '/x.mjs', '/x.pdf',
      '/x.webm', '/x.md', '/.well-known/ai-plugin.json', '/.well-known/anything', '/.well-known/'
    ]) {
      expect(isMissingFileRequest(path), path).toBe(true);
    }
    for (const path of [
      '/', '/pricing-and-discounts', '/blog/some-post', '/blog/v1.2-release', '/robots.txt/',
      '/.well-known', '/x.html', '/x.php', '/images', '/services/deep-cleaning'
    ]) {
      expect(isMissingFileRequest(path), path).toBe(false);
    }
  });

  it('keeps the guard\'s any-character match before the extension (paths it has always 404\'d)', () => {
    expect(isMissingFileRequest('/sitemap')).toBe(true);
    expect(isMissingFileRequest('/blog/learn-js')).toBe(true);
    expect(isMissingFileRequest('/js')).toBe(true);
  });

  it('301s the retired URLs case-insensitively, with one optional trailing slash, keeping the query', () => {
    expect(permanentRedirectLocation('/services', '/services')).toBe('/service-page');
    expect(permanentRedirectLocation('/services/', '/services/')).toBe('/service-page');
    expect(permanentRedirectLocation('/SERVICES', '/SERVICES')).toBe('/service-page');
    expect(permanentRedirectLocation('/Commercial-Cleaning/', '/Commercial-Cleaning/')).toBe('/services/commercial-cleaning');
    expect(permanentRedirectLocation('/services', '/services?utm_source=x&b=%20y')).toBe('/service-page?utm_source=x&b=%20y');
    expect(permanentRedirectLocation('/services', '/services?')).toBe('/service-page?');
  });

  it('does not 301 anything else', () => {
    for (const path of [
      '/services//', '/services/deep-cleaning', '/service', '/servicesx', '/x/services', '/services.json',
      '/servic%65s', '/', '/constructor', '/__proto__', '/hasOwnProperty', '/toString'
    ]) {
      expect(permanentRedirectLocation(path, path), path).toBeNull();
    }
  });

  it('only holds lowercase keys without a trailing slash (the lookup normalises to that form)', () => {
    for (const key of Object.keys(PERMANENT_REDIRECTS)) {
      expect(key).toBe(key.toLowerCase());
      expect(key.startsWith('/')).toBe(true);
      expect(key.endsWith('/')).toBe(false);
    }
  });

  it('gives unhashed text files an hour, /images a day, and everything else express.static\'s year', () => {
    for (const rel of ['robots.txt', 'sitemap.xml', 'sitemap-pages.xml', 'site.webmanifest', 'fontawesome.css', 'media\\fontawesome.css', 'ROBOTS.TXT']) {
      expect(staticCacheControl(rel), rel).toBe('public, max-age=3600');
    }
    for (const rel of ['images/hero.webp', 'images\\hero.webp', 'images/sub/x.png']) {
      expect(staticCacheControl(rel), rel).toBe('public, max-age=86400');
    }
    for (const rel of ['main-ABC.js', 'styles-X.css', 'img/responsive/x-640.webp', 'fonts/poppins.woff2', 'favicon.ico', 'nyc-zip-codes.json', 'media/images/x.png', 'IMAGES/x.png']) {
      expect(staticCacheControl(rel), rel).toBeNull();
    }
  });
});

describe('isBookingPage (the one route rendered with the visitor\'s session, always private)', () => {
  it('matches the booking page only', () => {
    expect(isBookingPage('/booking')).toBe(true);
    expect(isBookingPage('/booking/')).toBe(true);
    for (const other of ['/', '/booking-confirmation', '/booking-success/12', '/bookings', '/admin/booking', '/Booking']) {
      expect(isBookingPage(other), other).toBe(false);
    }
  });
});
