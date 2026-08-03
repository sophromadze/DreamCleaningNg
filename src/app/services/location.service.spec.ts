import { TestBed } from '@angular/core/testing';

import { LocationService } from './location.service';

import { testProviders } from '../../testing/test-providers';

describe('LocationService', () => {
  let service: LocationService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [...testProviders],
    });
    service = TestBed.inject(LocationService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
