import { isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID, inject, DOCUMENT, Service } from '@angular/core';
import { SSR_RESPONSE_CONTEXT } from './ssr-response.token';
import { UiHint, readUiHint, uiHintForUser, writeUiHintCookie } from './ui-hint-cookie';

/**
 * The layout hint (see ui-hint-cookie.ts) for THIS render, read once.
 *
 * `initial` is what the first render draws from, on the server (request cookie) and in the
 * browser (document.cookie) alike, so hydration finds the HTML it expects. Components switch to
 * the real auth state only after hydration - the header once showAuthUI flips, the hero once
 * auth has initialized after its first render.
 */
@Service()
export class UiHintService {
  private readonly doc = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly initial: UiHint;
  private pointsBadge: boolean;

  constructor() {
    const ssrContext = inject(SSR_RESPONSE_CONTEXT, { optional: true });
    this.initial = readUiHint(this.isBrowser ? this.doc.cookie : ssrContext?.requestCookies);
    // HTML drawn from one visitor's cookie must never be stored by a shared cache.
    if (!this.isBrowser && this.initial.signedIn && ssrContext) ssrContext.renderedFromCookie = true;
    // A visitor not yet hinted as signed in gets the badge on their first signed-in render; only
    // the points system reporting "off" turns it off (setPointsBadge).
    this.pointsBadge = this.initial.signedIn ? this.initial.pointsBadge : true;
  }

  /**
   * Browser only: rewrites the hint from the resolved auth state. Called with null once auth has
   * initialized with nobody signed in, which deletes it. Before initialization nothing is written,
   * so a slow session check can never wipe a good hint.
   */
  syncUser(user: { role?: string | null } | null): void {
    if (!this.isBrowser) return;
    writeUiHintCookie(this.doc, uiHintForUser(user, this.pointsBadge));
  }

  /** The points badge just loaded (or was found switched off): remembered for the next render. */
  setPointsBadge(enabled: boolean, user: { role?: string | null } | null): void {
    this.pointsBadge = enabled;
    this.syncUser(user);
  }

  /** Logout: the next render is anonymous. */
  clear(): void {
    if (!this.isBrowser) return;
    this.pointsBadge = true;
    writeUiHintCookie(this.doc, uiHintForUser(null, true));
  }
}
