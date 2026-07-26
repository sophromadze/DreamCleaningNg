import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { environment } from '../../environments/environment';

/**
 * First-touch acquisition attribution, GA4 Default Channel Group style.
 *
 * On the first visit we classify how the user arrived (paid search / AI assistant / email / social /
 * organic / referral / direct) and stash it in a non-httpOnly `dc_attribution` cookie (~30 days) so it can
 * be attached to the eventual booking. First-touch means we NEVER overwrite an existing cookie —
 * a later visit with different UTMs does not clobber the original source of the customer.
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
}

/** Internal shape of the dc_session cookie: the session's channel + a sliding-window timestamp (ms). */
interface SessionAttribution {
  channel: string;
  source: string;
  medium: string;
  campaign: string;
  ts: number;
}

@Injectable({ providedIn: 'root' })
export class AttributionService {
  private static readonly COOKIE_NAME = 'dc_attribution';
  private static readonly MAX_AGE_DAYS = 30;

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

  private static readonly PAID_MEDIUMS = ['cpc', 'ppc', 'paid'];
  private static readonly EMAIL_MEDIUMS = ['email', 'e-mail', 'newsletter'];
  private static readonly SOCIAL_MEDIUMS = ['social', 'social-media', 'social_media', 'social-network', 'sm'];

  private readonly isBrowser: boolean;

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  /** Run once on app init (browser only). No-op if a first-touch cookie already exists. */
  captureFirstTouch(): void {
    if (!this.isBrowser) return;
    try {
      if (this.readCookie(AttributionService.COOKIE_NAME)) return; // preserve first touch
      const attribution = this.classify();
      this.writeCookie(AttributionService.COOKIE_NAME, JSON.stringify(attribution),
        AttributionService.MAX_AGE_DAYS);
    } catch {
      // Attribution is best-effort analytics — never let it break app startup.
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

    const gclid = params.get('gclid');
    const utmSource = this.clean(params.get('utm_source'));
    const utmMedium = (params.get('utm_medium') || '').trim().toLowerCase();
    const utmCampaign = this.clean(params.get('utm_campaign'));
    const hasUtm = !!(utmSource || utmMedium || utmCampaign);

    const referrerHost = this.hostOf(document.referrer);
    const ownHost = this.bareHost(url.hostname);

    const isPaid = !!gclid || AttributionService.PAID_MEDIUMS.includes(utmMedium);
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

    return {
      channel,
      source,
      medium,
      campaign,
      landingPage: url.pathname,
      timestamp: new Date().toISOString()
    };
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
    if (p.get('gclid') || p.get('utm_source') || p.get('utm_medium') || p.get('utm_campaign')) return true;
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
    this.writeCookie(AttributionService.SESSION_COOKIE, JSON.stringify(session), 1);
  }

  private readCookie(name: string): string | null {
    const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  private writeCookie(name: string, value: string, maxAgeDays: number): void {
    const maxAge = maxAgeDays * 24 * 60 * 60;
    // Not httpOnly (JS-set cookies can't be) and SameSite=Lax so it survives ad-click navigations.
    document.cookie =
      `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax`;
  }
}
