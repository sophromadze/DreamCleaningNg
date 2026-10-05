import { TestBed } from '@angular/core/testing';

import { GooglePlacesService, aggregateRatingSchema, formatRating, formatReviewCount, googleAvatarUrl } from './google-reviews.service';

import { testProviders } from '../../testing/test-providers';

describe('GooglePlacesService', () => {
  let service: GooglePlacesService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [...testProviders],
    });
    service = TestBed.inject(GooglePlacesService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});

describe('review formatting helpers', () => {
  it('formats the exact count with no "+"', () => {
    expect(formatReviewCount(153)).toBe('153 Google reviews');
    expect(formatReviewCount(1)).toBe('1 Google review');
  });

  it('formats the rating to one decimal', () => {
    expect(formatRating(5)).toBe('5.0');
    expect(formatRating(4.86)).toBe('4.9');
  });

  it('builds AggregateRating from the stats', () => {
    expect(aggregateRatingSchema({ rating: 5, total: 153 })).toEqual({
      '@type': 'AggregateRating',
      'ratingValue': '5.0',
      'reviewCount': '153',
      'bestRating': '5'
    });
  });

  it('omits AggregateRating when there are no stats', () => {
    expect(aggregateRatingSchema(null)).toBeUndefined();
    expect(aggregateRatingSchema({ rating: 0, total: 0 })).toBeUndefined();
  });
});

describe('googleAvatarUrl', () => {
  const base = 'https://lh3.googleusercontent.com/a/ACg8ocIx';

  it('swaps only the size token and keeps the other options', () => {
    expect(googleAvatarUrl(base + '=s120-c-rp-mo-br100')).toBe(base + '=s96-c-rp-mo-br100');
    expect(googleAvatarUrl(base + '=s120-c-rp-mo-ba12-br100', 64)).toBe(base + '=s64-c-rp-mo-ba12-br100');
  });

  it('adds a size when the URL has none', () => {
    expect(googleAvatarUrl(base)).toBe(base + '=s96');
    expect(googleAvatarUrl(base + '=c-rp')).toBe(base + '=s96-c-rp');
  });

  it('leaves non-Google and empty URLs alone', () => {
    expect(googleAvatarUrl('https://example.com/a=s120.png')).toBe('https://example.com/a=s120.png');
    expect(googleAvatarUrl('')).toBe('');
  });
});
