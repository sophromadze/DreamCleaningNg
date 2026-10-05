import { TestBed } from '@angular/core/testing';

import { HttpTestingController } from '@angular/common/http/testing';

import { BookingService } from './booking.service';

import { testProviders } from '../../testing/test-providers';

describe('BookingService', () => {
  let service: BookingService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [...testProviders],
    });
    service = TestBed.inject(BookingService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  // The home hero opts its SSR request out of the HTTP transfer cache (it ships a trimmed copy
  // through TransferState). Every other caller must keep the default, full, cacheable request.
  it('getServiceTypes() keeps the default transfer-cache behaviour unless told otherwise', () => {
    const http = TestBed.inject(HttpTestingController);
    service.getServiceTypes().subscribe();
    service.getServiceTypes({ transferCache: false }).subscribe();

    const [plain, optedOut] = http.match(r => r.url.endsWith('/booking/service-types'));
    expect(plain.request.transferCache).toBeUndefined();
    expect(optedOut.request.transferCache).toBeFalse();
  });
});
