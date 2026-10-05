import { TestBed } from '@angular/core/testing';
import { BUSINESS_NODE_ID, SITE_SCHEMA_ID, StructuredDataService } from './structured-data.service';

describe('StructuredDataService', () => {
  let service: StructuredDataService;

  const blocks = () => Array.from(document.head.querySelectorAll('script[type="application/ld+json"]'));
  const siteGraph = () => JSON.parse(document.getElementById(SITE_SCHEMA_ID)!.textContent!)['@graph'];
  const RATING = { '@type': 'AggregateRating', 'ratingValue': '5.0', 'reviewCount': '153', 'bestRating': '5' };

  beforeEach(() => {
    blocks().forEach(el => el.remove());
    const site = document.createElement('script');
    site.id = SITE_SCHEMA_ID;
    site.type = 'application/ld+json';
    site.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'LocalBusiness', '@id': BUSINESS_NODE_ID, 'name': 'Dream Cleaning' },
        { '@type': 'Organization', '@id': 'https://dreamcleaningnyc.com/#organization' }
      ]
    });
    document.head.appendChild(site);
    service = TestBed.inject(StructuredDataService);
  });

  afterEach(() => blocks().forEach(el => el.remove()));

  // The prerendered page already carries the server's block when the browser runs the same
  // component code again; appending there is what put two ratings on the home page.
  it('replaces a block with the same id instead of adding a second one', () => {
    service.set('ld-test', { '@type': 'Service', 'name': 'server' });
    service.set('ld-test', { '@type': 'Service', 'name': 'client' });

    const matching = blocks().filter(el => el.id === 'ld-test');
    expect(matching.length).toBe(1);
    expect(JSON.parse(matching[0].textContent!).name).toBe('client');
  });

  it('removes only the block with that id', () => {
    service.set('ld-a', { '@type': 'Service' });
    service.set('ld-b', { '@type': 'FAQPage' });
    service.remove('ld-a');

    expect(blocks().map(el => el.id)).toEqual([SITE_SCHEMA_ID, 'ld-b']);
  });

  it('writes the rating onto the #business node of the site graph, once', () => {
    service.setBusinessRating(RATING);
    service.setBusinessRating(RATING);

    expect(blocks().length).toBe(1);
    const businesses = siteGraph().filter((n: any) => n['@type'] === 'LocalBusiness');
    expect(businesses.length).toBe(1);
    expect(businesses[0].aggregateRating).toEqual(RATING);
  });

  it('clears the rating again, leaving the rest of the graph as it was', () => {
    service.setBusinessRating(RATING);
    service.setBusinessRating(undefined);

    const graph = siteGraph();
    expect(graph.length).toBe(2);
    expect('aggregateRating' in graph[0]).toBeFalse();
  });
});
