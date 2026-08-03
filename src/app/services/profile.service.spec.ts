import { TestBed } from '@angular/core/testing';

import { ProfileService } from './profile.service';

import { testProviders } from '../../testing/test-providers';

describe('ProfileService', () => {
  let service: ProfileService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [...testProviders],
    });
    service = TestBed.inject(ProfileService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
