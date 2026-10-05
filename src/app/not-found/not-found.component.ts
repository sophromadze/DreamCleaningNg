import { Component, OnDestroy, inject, DOCUMENT } from '@angular/core';

import { Meta } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../shared/icons/icon.component';
import { SSR_RESPONSE_CONTEXT } from '../shared/ssr/ssr-response.token';
import { faHouse } from '../shared/icons/glyphs/faHouse';
import { faCalendarCheck } from '../shared/icons/glyphs/faCalendarCheck';
import { faBroom } from '../shared/icons/glyphs/faBroom';
import { faTag } from '../shared/icons/glyphs/faTag';
import { faEnvelope } from '../shared/icons/glyphs/faEnvelope';

/** Attributes on the robots tag that carry what an SSR-rendered 404 replaced (see constructor). */
const NOT_FOUND_MARKER = 'data-not-found';
const RESTORE_ROBOTS = 'data-restore-robots';
const RESTORE_DESCRIPTION = 'data-restore-description';

/** Head elements this page takes out while it is shown, with where they sat. */
interface RemovedHeadElement {
  element: Element;
  parent: Node;
  next: Node | null;
}

/**
 * The wildcard ('**') page. During SSR it turns the response into a real HTTP 404 through
 * SSR_RESPONSE_CONTEXT (same pattern as an unknown blog slug); server.ts then adds
 * Cache-Control: no-store and X-Robots-Tag: noindex. The title comes from route data
 * (app.routes.ts) like every other page.
 *
 * Head handling: robots is switched to noindex, and the canonical link and meta description are
 * taken out (a canonical pointing at a URL that does not exist contradicts the 404). AppComponent
 * skips its canonical update for routes with data.noCanonical. Everything is put back on destroy,
 * so the next page starts from the same head it would have had without visiting this one.
 *
 * No JSON-LD on purpose, and no full-viewport height: the card sits between header and footer.
 */
@Component({
  selector: 'app-not-found',
  standalone: true,
  imports: [RouterLink, IconComponent],
  template: `
    <section class="not-found-page" aria-labelledby="not-found-title">
      <div class="not-found-card">
        <p class="not-found-code" aria-hidden="true">404</p>
        <h1 id="not-found-title">Page not found</h1>
        <p class="not-found-text">
          Sorry, we couldn't find that page. It may have been moved, or the link may be mistyped.
          Here are a few places to start instead.
        </p>

        <div class="not-found-actions">
          <a routerLink="/" class="btn-primary">
            <i [appIcon]="icons.faHouse" aria-hidden="true"></i>
            Home
          </a>
          <a routerLink="/booking" class="btn-brand">
            <i [appIcon]="icons.faCalendarCheck" aria-hidden="true"></i>
            Book Online
          </a>
        </div>

        <nav class="not-found-links" aria-label="Helpful pages">
          <a routerLink="/service-page">
            <i [appIcon]="icons.faBroom" aria-hidden="true"></i>
            Services
          </a>
          <a routerLink="/pricing-and-discounts">
            <i [appIcon]="icons.faTag" aria-hidden="true"></i>
            Pricing
          </a>
          <a routerLink="/contact">
            <i [appIcon]="icons.faEnvelope" aria-hidden="true"></i>
            Contact
          </a>
        </nav>
      </div>
    </section>
  `,
  styles: [`
    .not-found-page {
      background: var(--page-bg);
      padding: 4rem 1rem 5rem;
    }

    .not-found-card {
      max-width: 640px;
      margin: 0 auto;
      background: var(--surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-lg);
      box-shadow: 0 10px 30px var(--shadow-color);
      padding: 2.5rem 2rem;
      text-align: center;
    }

    .not-found-code {
      margin: 0 0 0.5rem;
      font-size: 5.5rem;
      font-weight: var(--fw-black);
      line-height: 1;
      color: var(--primary-color-text);
    }

    h1 {
      margin: 0 0 0.75rem;
      font-size: 2rem;
      font-weight: var(--fw-bold);
      color: var(--text-primary);
    }

    .not-found-text {
      margin: 0 auto 2rem;
      max-width: 34rem;
      font-size: 1.0625rem;
      line-height: 1.6;
      color: var(--text-secondary);
    }

    .not-found-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 0.75rem;
      margin-bottom: 2rem;
    }

    .not-found-actions a {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      min-width: 10rem;
      font-weight: var(--fw-semibold);
    }

    .not-found-links {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 0.5rem 1.5rem;
      padding-top: 1.5rem;
      border-top: 1px solid var(--border-color);
    }

    .not-found-links a {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.25rem;
      color: var(--primary-text);
      font-weight: var(--fw-medium);
      text-decoration: none;
    }

    .not-found-links a:hover {
      color: var(--primary-color-hover);
      text-decoration: underline;
    }

    .not-found-links a:focus-visible {
      outline: 2px solid var(--primary-color);
      outline-offset: 2px;
      border-radius: var(--radius-sm);
    }

    @media (max-width: 480px) {
      .not-found-page {
        padding: 2.5rem 1rem 3rem;
      }

      .not-found-card {
        padding: 2rem 1.25rem;
      }

      .not-found-code {
        font-size: 4.5rem;
      }

      h1 {
        font-size: 1.625rem;
      }

      .not-found-actions a {
        flex: 1 1 100%;
      }
    }
  `]
})
export class NotFoundComponent implements OnDestroy {
  protected readonly icons = { faHouse, faCalendarCheck, faBroom, faTag, faEnvelope };

  private readonly meta = inject(Meta);
  private readonly document = inject(DOCUMENT);
  private readonly previousRobots: string | null;
  private readonly previousDescription: string | null;
  private readonly removedHead: RemovedHeadElement[] = [];

  constructor() {
    // Absent in the browser (only server.ts provides it).
    const ssrResponse = inject(SSR_RESPONSE_CONTEXT, { optional: true });
    if (ssrResponse) {
      ssrResponse.statusCode = 404;
    }

    // When this page is the SSR landing page, the head the browser receives is the one this page
    // already rewrote: robots reads noindex and the description is gone. What they replaced
    // travels on the robots tag itself (data-restore-*), so leaving still restores the real values.
    const robots = this.meta.getTag('name="robots"');
    const rewrittenBySsr = robots?.hasAttribute(NOT_FOUND_MARKER) ?? false;
    this.previousRobots = rewrittenBySsr
      ? robots!.getAttribute(RESTORE_ROBOTS)
      : robots?.content ?? null;
    this.previousDescription = rewrittenBySsr
      ? robots!.getAttribute(RESTORE_DESCRIPTION)
      : this.meta.getTag('name="description"')?.content ?? null;

    this.meta.updateTag({
      name: 'robots',
      content: 'noindex',
      [NOT_FOUND_MARKER]: '',
      ...(this.previousRobots !== null ? { [RESTORE_ROBOTS]: this.previousRobots } : {}),
      ...(this.previousDescription !== null ? { [RESTORE_DESCRIPTION]: this.previousDescription } : {})
    });

    this.removeFromHead('link[rel="canonical"]');
    this.removeFromHead('meta[name="description"]');
  }

  ngOnDestroy(): void {
    const robots = this.meta.getTag('name="robots"');
    for (const attribute of [NOT_FOUND_MARKER, RESTORE_ROBOTS, RESTORE_DESCRIPTION]) {
      robots?.removeAttribute(attribute);
    }
    if (this.previousRobots !== null) {
      this.meta.updateTag({ name: 'robots', content: this.previousRobots });
    } else {
      this.meta.removeTag('name="robots"');
    }

    // Put back what was taken out, unless the next page already added its own.
    for (const { element, parent, next } of this.removedHead) {
      const selector = element.tagName === 'LINK' ? 'link[rel="canonical"]' : 'meta[name="description"]';
      if (!this.document.head.querySelector(selector)) {
        parent.insertBefore(element, next && next.parentNode === parent ? next : null);
      }
    }
    this.removedHead.length = 0;

    // SSR landing: there was no element to keep, only the value carried on the robots tag.
    if (this.previousDescription !== null && !this.meta.getTag('name="description"')) {
      this.meta.addTag({ name: 'description', content: this.previousDescription });
    }
  }

  private removeFromHead(selector: string): void {
    const element = this.document.head.querySelector(selector);
    if (element?.parentNode) {
      this.removedHead.push({ element, parent: element.parentNode, next: element.nextSibling });
      element.remove();
    }
  }
}
