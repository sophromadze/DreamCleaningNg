import { TestBed } from '@angular/core/testing';

import { CleanerService } from './cleaner.service';

import { testProviders } from '../../testing/test-providers';

describe('CleanerService', () => {
  let service: CleanerService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [...testProviders],
    });
    service = TestBed.inject(CleanerService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
