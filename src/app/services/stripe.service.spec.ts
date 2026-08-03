import { TestBed } from '@angular/core/testing';

import { StripeService } from './stripe.service';

import { testProviders } from '../../testing/test-providers';

describe('StripeService', () => {
  let service: StripeService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [...testProviders],
    });
    service = TestBed.inject(StripeService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
