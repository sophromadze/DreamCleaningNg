import { TestBed } from '@angular/core/testing';

import { FormPersistenceService } from './form-persistence.service';

describe('FormPersistenceService', () => {
  let service: FormPersistenceService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(FormPersistenceService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
