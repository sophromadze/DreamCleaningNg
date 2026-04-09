import { TestBed } from '@angular/core/testing';

import { CleanerService } from './cleaner.service';

describe('CleanerService', () => {
  let service: CleanerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CleanerService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
