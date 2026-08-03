import { TestBed } from '@angular/core/testing';

import { AdminService } from './admin.service';

import { testProviders } from '../../testing/test-providers';

describe('AdminService', () => {
  let service: AdminService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [...testProviders],
    });
    service = TestBed.inject(AdminService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
