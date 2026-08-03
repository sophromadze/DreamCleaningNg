import { TestBed } from '@angular/core/testing';

import { PollService } from './poll.service';

import { testProviders } from '../../testing/test-providers';

describe('PollService', () => {
  let service: PollService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [...testProviders],
    });
    service = TestBed.inject(PollService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
