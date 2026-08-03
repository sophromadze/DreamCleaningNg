import { TestBed } from '@angular/core/testing';

import { SpecialOfferService } from './special-offer.service';

import { testProviders } from '../../testing/test-providers';

describe('SpecialOfferService', () => {
  let service: SpecialOfferService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [...testProviders],
    });
    service = TestBed.inject(SpecialOfferService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
