import { TestBed } from '@angular/core/testing';

import { GooglePlacesService } from './google-reviews.service';

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
