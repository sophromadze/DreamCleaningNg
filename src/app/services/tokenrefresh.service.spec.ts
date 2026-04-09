import { TestBed } from '@angular/core/testing';

import { TokenrefreshService } from './tokenrefresh.service';

describe('TokenrefreshService', () => {
  let service: TokenrefreshService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(TokenrefreshService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
