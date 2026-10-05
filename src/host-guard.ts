/**
 * Which requests server.ts answers at all (2026-10, Angular 20+ upgrade).
 *
 * Since @angular/platform-server 20.3.17 / 21.1.5 (advisory GHSA-x288-3778-4hhx, an SSRF through
 * the Host header), renderApplication refuses to render a URL whose host is not in its
 * `allowedHosts` list - by THROWING, which Express would answer with a 500 and a stack trace.
 * So the same list is checked here first, before any route, and anything else gets a plain 400.
 *
 * In production the only client is Apache on the same box (ProxyPreserveHost On, so Host is the
 * visitor's; mod_proxy adds X-Forwarded-Host, and the vhost adds X-Forwarded-Proto/Port).
 * Cloudflare sits in front of Apache. The retired domain (dreamcleaningnearme.com) is 301'd by
 * Apache and never reaches Node. localhost / 127.0.0.1 are local runs.
 *
 * The forwarded headers are validated even though Express only trusts them from loopback: they
 * build the render URL (req.protocol), and a value that is not a plain host / scheme / port is
 * never something Apache sends.
 */
export const ALLOWED_HOSTS: readonly string[] = [
  'dreamcleaningnyc.com',
  'www.dreamcleaningnyc.com',
  'localhost',
  '127.0.0.1'
];

export interface ForwardingHeaders {
  host?: string;
  forwardedHost?: string;
  forwardedProto?: string;
  forwardedPort?: string;
}

/** The header that disqualifies the request, or null when it may be served. */
export function rejectedHeader(
  headers: ForwardingHeaders,
  allowedHosts: readonly string[] = ALLOWED_HOSTS
): 'host' | 'x-forwarded-host' | 'x-forwarded-proto' | 'x-forwarded-port' | null {
  const isAllowedHost = (value: string) => {
    const name = hostnameOf(value);
    return name !== null && allowedHosts.includes(name);
  };
  if (!headers.host || !isAllowedHost(headers.host)) return 'host';
  if (headers.forwardedHost !== undefined && !everyValue(headers.forwardedHost, isAllowedHost)) {
    return 'x-forwarded-host';
  }
  if (headers.forwardedProto !== undefined && !everyValue(headers.forwardedProto, v => /^https?$/i.test(v))) {
    return 'x-forwarded-proto';
  }
  if (headers.forwardedPort !== undefined && !everyValue(headers.forwardedPort, v => /^\d{1,5}$/.test(v))) {
    return 'x-forwarded-port';
  }
  return null;
}

/** `name` or `name:port`, lowercased; null for anything else (paths, userinfo, IPv6, a trailing dot). */
function hostnameOf(value: string): string | null {
  const match = /^([a-z0-9-]+(?:\.[a-z0-9-]+)*)(?::\d{1,5})?$/i.exec(value);
  return match ? match[1].toLowerCase() : null;
}

/** Node joins repeated X-Forwarded-* headers with ", " - every hop's value must pass. */
function everyValue(header: string, test: (value: string) => boolean): boolean {
  return header.split(',').every(value => test(value.trim()));
}
