import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/core';
import { provideRouter } from '@angular/router';
import { NotFoundComponent } from './not-found.component';
import { SSR_RESPONSE_CONTEXT, SsrResponseContext } from '../shared/ssr/ssr-response.token';
import { routes } from '../app.routes';

describe('NotFoundComponent', () => {
  let doc: Document;

  function setHead(): void {
    doc.head.querySelectorAll('link[rel="canonical"], meta[name="description"], meta[name="robots"]')
      .forEach(el => el.remove());
    doc.head.insertAdjacentHTML('beforeend',
      '<link rel="canonical" href="https://dreamcleaningnyc.com/about" />' +
      '<meta name="description" content="About us" />' +
      '<meta name="robots" content="index, follow" />');
  }

  afterEach(() => {
    // Unset when the route-config test (no TestBed) runs first in random order.
    doc?.head.querySelectorAll('link[rel="canonical"], meta[name="description"], meta[name="robots"]')
      .forEach(el => el.remove());
  });

  describe('in the browser (no SSR response context)', () => {
    beforeEach(() => {
      TestBed.configureTestingModule({
        imports: [NotFoundComponent],
        providers: [provideRouter([])]
      });
      doc = TestBed.inject(DOCUMENT);
      setHead();
    });

    it('switches robots to noindex and takes out the canonical link and description', () => {
      TestBed.createComponent(NotFoundComponent);

      expect(doc.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex');
      expect(doc.head.querySelector('link[rel="canonical"]')).toBeNull();
      expect(doc.head.querySelector('meta[name="description"]')).toBeNull();
    });

    it('puts the head back as it was on destroy', () => {
      const fixture = TestBed.createComponent(NotFoundComponent);
      fixture.destroy();

      expect(doc.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('index, follow');
      expect(doc.head.querySelector('link[rel="canonical"]')?.getAttribute('href'))
        .toBe('https://dreamcleaningnyc.com/about');
      expect(doc.head.querySelector('meta[name="description"]')?.getAttribute('content')).toBe('About us');
    });

    it('restores the real values after landing on an SSR-rendered 404 (head already rewritten)', () => {
      doc.head.querySelectorAll('link[rel="canonical"], meta[name="description"], meta[name="robots"]')
        .forEach(el => el.remove());
      doc.head.insertAdjacentHTML('beforeend',
        '<meta name="robots" content="noindex" data-not-found="" data-restore-robots="index, follow"' +
        ' data-restore-description="Site default">');

      const fixture = TestBed.createComponent(NotFoundComponent);
      expect(doc.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex');
      fixture.destroy();

      const robots = doc.head.querySelector('meta[name="robots"]')!;
      expect(robots.getAttribute('content')).toBe('index, follow');
      expect(robots.hasAttribute('data-not-found')).toBeFalse();
      expect(robots.hasAttribute('data-restore-robots')).toBeFalse();
      expect(robots.hasAttribute('data-restore-description')).toBeFalse();
      expect(doc.head.querySelector('meta[name="description"]')?.getAttribute('content')).toBe('Site default');
    });

    it('records what it replaced on the robots tag, for the browser to read after SSR', () => {
      TestBed.createComponent(NotFoundComponent);

      const robots = doc.head.querySelector('meta[name="robots"]')!;
      expect(robots.getAttribute('data-restore-robots')).toBe('index, follow');
      expect(robots.getAttribute('data-restore-description')).toBe('About us');
    });

    it('does not add a second description when the next page already set its own', () => {
      const fixture = TestBed.createComponent(NotFoundComponent);
      doc.head.insertAdjacentHTML('beforeend', '<meta name="description" content="Next page" />');
      fixture.destroy();

      const descriptions = doc.head.querySelectorAll('meta[name="description"]');
      expect(descriptions.length).toBe(1);
      expect(descriptions[0].getAttribute('content')).toBe('Next page');
    });

    it('links to Home, Book Online, Services, Pricing and Contact with real anchors', () => {
      const fixture = TestBed.createComponent(NotFoundComponent);
      fixture.detectChanges();

      const hrefs = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('a'))
        .map(a => a.getAttribute('href'));
      expect(hrefs).toEqual(['/', '/booking', '/service-page', '/pricing-and-discounts', '/contact']);
    });
  });

  describe('during SSR', () => {
    it('turns the response into a 404', () => {
      const context: SsrResponseContext = { statusCode: null };
      TestBed.configureTestingModule({
        imports: [NotFoundComponent],
        providers: [provideRouter([]), { provide: SSR_RESPONSE_CONTEXT, useValue: context }]
      });
      doc = TestBed.inject(DOCUMENT);
      setHead();

      TestBed.createComponent(NotFoundComponent);

      expect(context.statusCode).toBe(404);
    });
  });

  describe('the wildcard route', () => {
    it('is the 404 page, not a redirect, and keeps the canonical out', () => {
      const wildcard = routes[routes.length - 1];

      expect(wildcard.path).toBe('**');
      expect(wildcard.redirectTo).toBeUndefined();
      expect(wildcard.loadComponent).toBeDefined();
      expect(wildcard.data?.['title']).toBe('Page not found | Dream Cleaning');
      expect(wildcard.data?.['noCanonical']).toBeTrue();
    });
  });
});
