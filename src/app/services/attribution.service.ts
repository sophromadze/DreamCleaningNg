import { PLATFORM_ID, inject, Service } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { environment } from '../../environments/environment';

/**
 * First-touch acquisition attribution, GA4 Default Channel Group style.
 *
 * On the first visit we classify how the user arrived (paid search / AI assistant / email / social /
 * organic / referral / direct) and stash it in a non-httpOnly `dc_attribution` cookie (90 days from
 * that first visit) so it can be attached to the eventual booking. First-touch means we NEVER overwrite
 * an existing cookie's content — a later visit with different UTMs does not clobber the original source.
 *
 * Alongside the browser's own channel verdict the cookie carries the RAW signals (2026-10): which ad
 * click id the landing URL had (gclid / gbraid / wbraid / msclkid) and its value, the external
 * referrer (no query string) and the landing path. The backend classifies orders from those
 * (OrderSourceClassifier) rather than trusting this file's verdict.
 *
 * Nothing here reads or writes Google's own `_gcl_*` cookies or touches the URL, so the GTM /
 * Google Ads conversion linker keeps working exactly as before.
 *
 * Browser-only: everything here touches document.referrer / document.cookie / window.location, so
 * every method no-ops under SSR/prerender (the app runs @angular/ssr). The booking form reads
 * getAttribution() right before submit; the backend re-validates and clamps whatever we send.
 */
export interface Attribution {
  channel: string;
  source: string;
  medium: string;
  campaign: string;
  landingPage: string;
  timestamp: string;
  /** gclid / gbraid / wbraid / msclkid — the ad click id the landing URL carried, if any. */
  clickIdType?: string;
  clickId?: string;
  /** External referrer, scheme + host + path only. Absent for direct and internal visits. */
  referrer?: string;
}

/** Internal shape of the dc_session cookie: the session's channel + a sliding-window timestamp (ms). */
interface SessionAttribution {
  channel: string;
  source: string;
  medium: string;
  campaign: string;
  ts: number;
}

@Service()
export class AttributionService {
  private platformId = inject<Object>(PLATFORM_ID);

  private static readonly COOKIE_NAME = 'dc_attribution';
  // Counted from the FIRST visit (the stored timestamp), not slid forward on every visit.
  private static readonly MAX_AGE_DAYS = 90;
  private static readonly DAY_MS = 24 * 60 * 60 * 1000;

  /** URL parameters only an ad click puts on a landing page. Order = precedence when several appear. */
  private static readonly CLICK_ID_PARAMS = ['gclid', 'gbraid', 'wbraid', 'msclkid'];

  // Converting-session tracking (parallel to first-touch above). The session cookie is re-evaluated
  // each visit — a GA4-style 30-min inactivity window, and any fresh acquisition signal (gclid / utm
  // / new external referrer) starts a new session so a returning visitor's converting channel updates.
  private static readonly SESSION_COOKIE = 'dc_session';
  private static readonly SESSION_TIMEOUT_MS = 30 * 60 * 1000;

  // Web hosts of AI assistants. Checked BEFORE search engines because some (gemini.google.com)
  // are subdomains of a search-engine domain. Note: most AI traffic (native apps, pasted links)
  // arrives with no referrer and correctly falls through to Direct — this is a floor, not a census.
  private static readonly AI_HOSTS = [
    'chat.openai.com', 'chatgpt.com', 'gemini.google.com', 'claude.ai',
    'perplexity.ai', 'copilot.microsoft.com', 'grok.com', 'x.ai', 'chat.deepseek.com'
  ];

  // Substrings that mark a search-engine referrer host (e.g. "www.google.com" → "google.").
  private static readonly SEARCH_HOSTS = ['google.', 'bing.', 'yahoo.', 'duckduckgo.', 'baidu.'];

  // Social-network referrer hosts (matched like AI hosts: exact or a subdomain). Note x.com is
  // Twitter (Social); the AI list uses x.ai, so there's no clash. Facebook/Instagram use l./lm.
  // link-wrapper subdomains, which the endsWith('.'+h) check covers.
  private static readonly SOCIAL_HOSTS = [
    'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 't.co', 'linkedin.com', 'lnkd.in',
    'tiktok.com', 'pinterest.com', 'reddit.com', 'youtube.com', 'threads.net', 'snapchat.com',
    'wa.me', 't.me'
  ];

  // Kept in step with OrderSourceClassifier.PaidMediums on the backend.
  private static readonly PAID_MEDIUMS = [
    'cpc', 'ppc', 'paid', 'paidsearch', 'paid_search', 'paid-search', 'sem', 'cpm', 'display',
    'paid_social', 'paid-social', 'paidsocial'
  ];
  private static readonly EMAIL_MEDIUMS = ['email', 'e-mail', 'newsletter'];
  private static readonly SOCIAL_MEDIUMS = ['social', 'social-media', 'social_media', 'social-network', 'sm'];

  private readonly isBrowser: boolean;

  constructor() {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  /** Run once on app init (browser only). No-op if a first-touch cookie already exists. */
  captureFirstTouch(): void {
    if (!this.isBrowser) return;
    try {
      const existing = this.readCookie(AttributionService.COOKIE_NAME);
      if (existing) {
        // Preserve first touch — but give a cookie written under the old 30-day lifetime the
        // full 90 days from its OWN first visit. Re-writing with the remaining time keeps the
        // expiry fixed at first touch + 90 days instead of sliding it forward on every visit.
        this.extendToFullLifetime(existing);
        return;
      }
      const attribution = this.classify();
      this.writeCookieSeconds(AttributionService.COOKIE_NAME, JSON.stringify(attribution),
        AttributionService.MAX_AGE_DAYS * AttributionService.DAY_MS / 1000);
    } catch {
      // Attribution is best-effort analytics — never let it break app startup.
    }
  }

  private extendToFullLifetime(raw: string): void {
    try {
      const stored = JSON.parse(raw) as Partial<Attribution>;
      const firstTouch = stored.timestamp ? Date.parse(stored.timestamp) : NaN;
      if (!Number.isFinite(firstTouch)) return;
      const remainingMs = firstTouch + AttributionService.MAX_AGE_DAYS * AttributionService.DAY_MS - Date.now();
      if (remainingMs <= 0) return;
      this.writeCookieSeconds(AttributionService.COOKIE_NAME, raw, Math.floor(remainingMs / 1000));
    } catch {
      // Unreadable cookie: leave it exactly as it is.
    }
  }

  /** Returns the stored first-touch attribution, or null if none/unreadable/SSR. */
  getAttribution(): Attribution | null {
    if (!this.isBrowser) return null;
    try {
      const raw = this.readCookie(AttributionService.COOKIE_NAME);
      return raw ? JSON.parse(raw) as Attribution : null;
    } catch {
      return null;
    }
  }

  /**
   * Re-evaluates the converting session (browser only). Starts a NEW session — reclassifying the
   * current visit — when there is no active session, the last one is older than the 30-min window,
   * or this load carries a fresh acquisition signal (new campaign/referrer). Otherwise it just
   * slides the window forward, keeping the session's original channel. Run once on app init.
   */
  captureSession(): void {
    if (!this.isBrowser) return;
    try {
      const url = new URL(window.location.href);
      const now = Date.now();
      const existing = this.readSession();
      const active = !!existing && (now - existing.ts) <= AttributionService.SESSION_TIMEOUT_MS;

      if (!active || this.hasFreshAcquisitionSignal(url)) {
        const a = this.classify();
        this.writeSession({
          channel: a.channel, source: a.source, medium: a.medium, campaign: a.campaign, ts: now
        });
        this.logSession(a); // count this new session (fire-and-forget; never blocks/booking)
      } else {
        this.writeSession({ ...existing!, ts: now }); // continuing session — slide the window
      }
    } catch {
      // Best-effort analytics — never break startup.
    }
  }

  /** Returns the current converting-session attribution, or null if none/unreadable/SSR. */
  getConvertingAttribution(): Attribution | null {
    if (!this.isBrowser) return null;
    const s = this.readSession();
    if (!s) return null;
    return {
      channel: s.channel,
      source: s.source,
      medium: s.medium,
      campaign: s.campaign,
      landingPage: '',
      timestamp: new Date(s.ts).toISOString()
    };
  }

  // ── Classification ──

  private classify(): Attribution {
    const url = new URL(window.location.href);
    const params = url.searchParams;

    const clickIdType = AttributionService.CLICK_ID_PARAMS.find(p => !!params.get(p));
    const clickId = clickIdType ? this.clean(params.get(clickIdType)).slice(0, 255) : '';
    const utmSource = this.clean(params.get('utm_source'));
    const utmMedium = (params.get('utm_medium') || '').trim().toLowerCase();
    const utmCampaign = this.clean(params.get('utm_campaign'));
    const hasUtm = !!(utmSource || utmMedium || utmCampaign);

    const referrerHost = this.hostOf(document.referrer);
    const ownHost = this.bareHost(url.hostname);

    // Any ad click id is paid — gbraid / wbraid are what Google Ads puts on iOS clicks instead of
    // a gclid, and msclkid is Microsoft Ads. Missing them used to file those visits as Organic.
    const isPaid = !!clickIdType || AttributionService.PAID_MEDIUMS.includes(utmMedium);
    const isAi = !!referrerHost && AttributionService.AI_HOSTS.some(
      h => referrerHost === h || referrerHost.endsWith('.' + h));
    const isEmail = AttributionService.EMAIL_MEDIUMS.includes(utmMedium);
    const isSocial = AttributionService.SOCIAL_MEDIUMS.includes(utmMedium)
      || (!!referrerHost && AttributionService.SOCIAL_HOSTS.some(
        h => referrerHost === h || referrerHost.endsWith('.' + h)));
    const isSearch = !!referrerHost && AttributionService.SEARCH_HOSTS.some(
      h => referrerHost.includes(h));
    const isOwn = !!referrerHost && this.bareHost(referrerHost) === ownHost;

    let channel: string;
    if (isPaid) channel = 'Paid Search';
    else if (isAi) channel = 'AI Assistant';
    else if (isEmail) channel = 'Email';
    else if (isSocial) channel = 'Social';
    else if (isSearch) channel = 'Organic Search';
    else if (referrerHost && !isOwn) channel = 'Referral';
    else if (!document.referrer && !hasUtm) channel = 'Direct';
    else channel = 'Unassigned';

    // Raw UTM wins; else the referrer host; else the (direct)/(none) placeholders GA uses.
    const source = utmSource || referrerHost || '(direct)';
    const medium = utmMedium || (referrerHost ? 'referral' : '(none)');
    const campaign = utmCampaign || '(none)';

    const attribution: Attribution = {
      channel,
      source,
      medium,
      campaign,
      landingPage: url.pathname,
      timestamp: new Date().toISOString()
    };
    if (clickIdType && clickId) {
      attribution.clickIdType = clickIdType;
      attribution.clickId = clickId;
    }
    const referrer = !isOwn ? this.referrerWithoutQuery(document.referrer) : '';
    if (referrer) attribution.referrer = referrer;
    return attribution;
  }

  // The referrer's scheme + host + path: its query string can carry search terms or tokens, and
  // nothing downstream needs them.
  private referrerWithoutQuery(rawUrl: string): string {
    if (!rawUrl) return '';
    try {
      const u = new URL(rawUrl);
      return (u.origin + u.pathname).slice(0, 300);
    } catch {
      return '';
    }
  }

  // Reports a newly-started session to the aggregated counter. Fire-and-forget: sendBeacon (which
  // survives page navigation and never blocks), falling back to keepalive fetch. Every failure path
  // (blocked by an ad blocker, offline, 429, 500) is swallowed — booking never depends on this.
  private logSession(a: Attribution): void {
    try {
      const url = `${environment.apiUrl}/attribution/session`;
      const body = JSON.stringify({ channel: a.channel, source: a.source, medium: a.medium, campaign: a.campaign });
      const beacon = (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function')
        ? navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))
        : false;
      if (!beacon) {
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true
        }).catch(() => { /* swallow */ });
      }
    } catch {
      // Never let analytics logging surface an error.
    }
  }

  // ── Helpers ──

  private hostOf(rawUrl: string): string {
    if (!rawUrl) return '';
    try { return new URL(rawUrl).hostname.toLowerCase(); } catch { return ''; }
  }

  private bareHost(host: string): string {
    return (host || '').toLowerCase().replace(/^www\./, '');
  }

  private clean(value: string | null): string {
    return (value || '').trim();
  }

  // A load "starts a new session" when it carries a fresh acquisition signal — a paid click, any
  // UTM, or an external referrer that isn't our own domain. Internal navigations don't reset it.
  private hasFreshAcquisitionSignal(url: URL): boolean {
    const p = url.searchParams;
    if (AttributionService.CLICK_ID_PARAMS.some(id => !!p.get(id))) return true;
    if (p.get('utm_source') || p.get('utm_medium') || p.get('utm_campaign')) return true;
    const refHost = this.hostOf(document.referrer);
    return !!refHost && this.bareHost(refHost) !== this.bareHost(url.hostname);
  }

  private readSession(): SessionAttribution | null {
    try {
      const raw = this.readCookie(AttributionService.SESSION_COOKIE);
      return raw ? JSON.parse(raw) as SessionAttribution : null;
    } catch {
      return null;
    }
  }

  private writeSession(session: SessionAttribution): void {
    // 1-day max-age so a brief tab close survives; the 30-min ts window governs session identity.
    this.writeCookieSeconds(AttributionService.SESSION_COOKIE, JSON.stringify(session), 24 * 60 * 60);
  }

  private readCookie(name: string): string | null {
    const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  private writeCookieSeconds(name: string, value: string, maxAgeSeconds: number): void {
    // Not httpOnly (JS-set cookies can't be) and SameSite=Lax so it survives ad-click navigations.
    // Raw values travel URI-encoded; reading decodes them again.
    document.cookie =
      `${name}=${encodeURIComponent(value)}; path=/; max-age=${Math.max(0, Math.floor(maxAgeSeconds))}; SameSite=Lax`;
  }
}
