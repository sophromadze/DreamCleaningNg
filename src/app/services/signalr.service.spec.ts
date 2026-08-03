import { TestBed } from '@angular/core/testing';

import { SignalRService } from './signalr.service';

import { testProviders } from '../../testing/test-providers';

describe('SignalRService', () => {
  let service: SignalRService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [...testProviders],
    });
    service = TestBed.inject(SignalRService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
