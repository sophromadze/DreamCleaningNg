import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse, provideHttpClient, withInterceptors, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TimeoutError } from 'rxjs';

import {
  GATEWAY_UNREACHABLE_STATUSES, NETWORK_RETRY_DELAY_MS, isAuthRejection, isBackendUnreachable,
  networkRetryInterceptor, withRetryWhenUnreachable
} from './backend-reachability';

/**
 * A DEPLOY RESTARTS THE API (2026-10). For those seconds the browser's background checks
 * (has-contracts, has-invoices, the blog pending count...) failed together with
 * net::ERR_CONNECTION_CLOSED, and the header dropped its links and counts. An opted-in GET / HEAD
 * now waits NETWORK_RETRY_DELAY_MS and asks once more; nothing else is ever retried.
 */
describe('networkRetryInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  const opted = { context: withRetryWhenUnreachable() };
  const fail = (url: string, status: number) =>
    backend.expectOne(url).flush('down', { status, statusText: 'Down' });
  const drop = (url: string) => backend.expectOne(url).error(new ProgressEvent('error'), { status: 0 });

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withXhr(), withInterceptors([networkRetryInterceptor])), provideHttpClientTesting()]
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    backend.verify();
    vi.useRealTimers();
  });

  it('retries an opted-in GET once, after the delay, when the connection was closed (status 0)', () => {
    let body: unknown;
    http.get('/api/my-contracts/has-contracts', opted).subscribe({ next: b => (body = b), error: () => {} });

    drop('/api/my-contracts/has-contracts');
    // Not at once: a restarting backend needs the moment.
    vi.advanceTimersByTime(NETWORK_RETRY_DELAY_MS - 1);
    backend.expectNone('/api/my-contracts/has-contracts');
    vi.advanceTimersByTime(1);
    backend.expectOne('/api/my-contracts/has-contracts').flush({ hasContracts: true });

    expect(body).toEqual({ hasContracts: true });
  });

  for (const status of GATEWAY_UNREACHABLE_STATUSES) {
    it(`retries an opted-in GET once on a gateway ${status}`, () => {
      let body: unknown;
      http.get('/api/my-invoices/has-invoices', opted).subscribe({ next: b => (body = b), error: () => {} });

      fail('/api/my-invoices/has-invoices', status);
      vi.advanceTimersByTime(NETWORK_RETRY_DELAY_MS);
      backend.expectOne('/api/my-invoices/has-invoices').flush({ hasInvoices: false });

      expect(body).toEqual({ hasInvoices: false });
    });
  }

  it('retries HEAD the same way', () => {
    http.head('/api/health', opted).subscribe({ next: () => {}, error: () => {} });
    fail('/api/health', 503);
    vi.advanceTimersByTime(NETWORK_RETRY_DELAY_MS);
    backend.expectOne('/api/health').flush(null);
  });

  it('retries only ONCE: a second failure reaches the caller', () => {
    let error: unknown;
    http.get('/api/admin/blog/pending-count', opted).subscribe({ next: () => {}, error: e => (error = e) });

    drop('/api/admin/blog/pending-count');
    vi.advanceTimersByTime(NETWORK_RETRY_DELAY_MS);
    drop('/api/admin/blog/pending-count');
    vi.advanceTimersByTime(NETWORK_RETRY_DELAY_MS * 4);

    backend.expectNone('/api/admin/blog/pending-count');
    expect((error as HttpErrorResponse).status).toBe(0);
  });

  for (const status of [400, 401, 403, 404, 409, 429, 500, 501]) {
    it(`never retries a ${status} - the backend answered`, () => {
      let error: unknown;
      http.get('/api/order', opted).subscribe({ next: () => {}, error: e => (error = e) });

      fail('/api/order', status);
      vi.advanceTimersByTime(NETWORK_RETRY_DELAY_MS * 4);

      backend.expectNone('/api/order');
      expect((error as HttpErrorResponse).status).toBe(status);
    });
  }

  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    it(`never retries a ${method}, even opted in - it may already have reached the server`, () => {
      let error: unknown;
      http.request(method, '/api/orders/7/mark-viewed', { body: {}, ...opted }).subscribe({ next: () => {}, error: e => (error = e) });

      drop('/api/orders/7/mark-viewed');
      vi.advanceTimersByTime(NETWORK_RETRY_DELAY_MS * 4);

      backend.expectNone('/api/orders/7/mark-viewed');
      expect((error as HttpErrorResponse).status).toBe(0);
    });
  }

  it('leaves a GET that did not opt in alone', () => {
    let error: unknown;
    http.get('/api/profile').subscribe({ next: () => {}, error: e => (error = e) });

    drop('/api/profile');
    vi.advanceTimersByTime(NETWORK_RETRY_DELAY_MS * 4);

    backend.expectNone('/api/profile');
    expect((error as HttpErrorResponse).status).toBe(0);
  });
});

describe('isBackendUnreachable / isAuthRejection', () => {
  const http = (status: number) => new HttpErrorResponse({ status });

  it('reads "no response" and gateway answers as unreachable, and nothing else', () => {
    for (const status of [0, 502, 503, 504, 520, 521, 522, 523, 524]) expect(isBackendUnreachable(http(status))).toBe(true);
    for (const status of [200, 400, 401, 403, 404, 500, 501, 505, 525]) expect(isBackendUnreachable(http(status))).toBe(false);
    expect(isBackendUnreachable(new TimeoutError())).toBe(true);
    expect(isBackendUnreachable(new Error('boom'))).toBe(false);
  });

  it('treats only 401 / 403 as an answer about the session', () => {
    expect(isAuthRejection(http(401))).toBe(true);
    expect(isAuthRejection(http(403))).toBe(true);
    for (const status of [0, 400, 404, 500, 502, 503]) expect(isAuthRejection(http(status))).toBe(false);
    expect(isAuthRejection(new TimeoutError())).toBe(false);
  });
});
