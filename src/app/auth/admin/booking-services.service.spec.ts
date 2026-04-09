import { TestBed } from '@angular/core/testing';

import { BookingServicesService } from './booking-services.service';

describe('BookingServicesService', () => {
  let service: BookingServicesService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(BookingServicesService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
