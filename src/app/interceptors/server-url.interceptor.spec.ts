import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { serverUrlInterceptor } from './server-url.interceptor';
import { environment } from '../../environments/environment';
import { environment as productionEnvironment } from '../../environments/environment.prod';

/**
 * SERVER-SIDE renders send API calls to environment.ssrApiOrigin (2026-10). `ng serve` renders with
 * Angular's own dev-server SSR (server.ts is never loaded), so the origin cannot stay hard-coded:
 * production's http://localhost:5000 is nothing on a dev machine, and every render fell back to the
 * placeholder hero form with a warning.
 */
describe('serverUrlInterceptor', () => {
  function setup(platform: 'server' | 'browser') {
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: platform },
        provideHttpClient(withInterceptors([serverUrlInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    return { http: TestBed.inject(HttpClient), backend: TestBed.inject(HttpTestingController) };
  }

  it('production keeps the VPS loopback', () => {
    expect(productionEnvironment.ssrApiOrigin).toBe('http://localhost:5000');
  });

  it('sends relative and public-domain API calls to ssrApiOrigin during SSR', () => {
    const { http, backend } = setup('server');
    http.get('/api/booking/service-types').subscribe();
    http.get('https://dreamcleaningnyc.com/api/blog/status').subscribe();
    backend.expectOne(`${environment.ssrApiOrigin}/api/booking/service-types`).flush([]);
    backend.expectOne(`${environment.ssrApiOrigin}/api/blog/status`).flush({});
    backend.verify();
  });

  it('leaves browser requests alone', () => {
    const { http, backend } = setup('browser');
    http.get('/api/booking/service-types').subscribe();
    backend.expectOne('/api/booking/service-types').flush([]);
    backend.verify();
  });
});
