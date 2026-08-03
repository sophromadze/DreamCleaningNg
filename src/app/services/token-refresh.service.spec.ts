import { TestBed } from '@angular/core/testing';

import { TokenRefreshService } from './token-refresh.service';

import { testProviders } from '../../testing/test-providers';

describe('TokenRefreshService', () => {
  let service: TokenRefreshService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [...testProviders],
    });
    service = TestBed.inject(TokenRefreshService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
