import { TestBed } from '@angular/core/testing';

import { GiftCardService } from './gift-card.service';

import { testProviders } from '../../testing/test-providers';

describe('GiftCardService', () => {
  let service: GiftCardService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [...testProviders],
    });
    service = TestBed.inject(GiftCardService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
