import { Injectable, inject, DOCUMENT } from '@angular/core';


/** `id` of the site-wide @graph block in index.html (LocalBusiness + Organization + WebSite). */
export const SITE_SCHEMA_ID = 'site-schema';
/** `@id` of the one LocalBusiness node every page refers to. */
export const BUSINESS_NODE_ID = 'https://dreamcleaningnyc.com/#business';

/**
 * The ONLY way a component puts JSON-LD on the page.
 *
 * Every block is keyed by a stable element `id`, and writing one REPLACES the block with that id
 * instead of appending another. That is what keeps each entity on the page once: a prerendered
 * page arrives with the server's blocks already in `<head>`, Angular never hydrates `<head>`, and
 * the browser then runs the same component code again - with createElement + appendChild that
 * second run added a copy of every block. Google read the home page's two copies as one business
 * with two AggregateRatings ("Review has multiple aggregate ratings").
 */
@Injectable({ providedIn: 'root' })
export class StructuredDataService {
  private readonly document = inject(DOCUMENT);

  /** Creates or replaces the JSON-LD block with this id. */
  set(id: string, schema: unknown): void {
    const json = JSON.stringify(schema);
    let el = this.find(id);
    if (!el) {
      el = this.document.createElement('script');
      el.id = id;
      el.type = 'application/ld+json';
      this.document.head.appendChild(el);
    }
    if (el.textContent !== json) {
      el.textContent = json;
    }
  }

  /** Removes the JSON-LD block with this id, if there is one. */
  remove(id: string): void {
    const el = this.find(id);
    el?.parentNode?.removeChild(el);
  }

  /**
   * Sets (or, with undefined, clears) `aggregateRating` on the #business node of the site-wide
   * @graph in index.html. Pages that show the business's own rating write it there rather than in
   * a block of their own, so the page carries exactly one LocalBusiness node and one rating.
   * Every page that sets it must clear it in ngOnDestroy - the @graph block outlives the page.
   */
  setBusinessRating(aggregateRating: Record<string, string> | undefined): void {
    const el = this.find(SITE_SCHEMA_ID);
    if (!el?.textContent) return;
    let data: { '@graph'?: Array<Record<string, unknown>> };
    try {
      data = JSON.parse(el.textContent);
    } catch {
      return;
    }
    const business = data['@graph']?.find(node => node['@id'] === BUSINESS_NODE_ID);
    if (!business) return;
    if (aggregateRating) {
      if (JSON.stringify(business['aggregateRating']) === JSON.stringify(aggregateRating)) return;
      business['aggregateRating'] = aggregateRating;
    } else {
      if (!('aggregateRating' in business)) return;
      delete business['aggregateRating'];
    }
    el.textContent = JSON.stringify(data);
  }

  private find(id: string): HTMLScriptElement | null {
    return this.document.head?.querySelector<HTMLScriptElement>(`script#${id}[type="application/ld+json"]`) ?? null;
  }
}
