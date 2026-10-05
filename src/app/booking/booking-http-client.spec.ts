import { TestBed } from '@angular/core/testing';
import { HttpInterceptorFn, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { SocialAuthServiceConfig } from '@abacritt/angularx-social-login';

import { BookingComponent } from './booking.component';
import { BookingService } from '../services/booking.service';

/**
 * REGRESSION: the booking page's own BookingService bypassed the app's interceptors.
 *
 * BookingComponent provides BookingService at component level, and it also listed
 * HttpClientModule in its standalone `imports`. That module gave the component a PRIVATE
 * HttpClient with no interceptors, and the component-level service resolved to it — so its
 * calls (subscription, promo code, admin create-for-user, blocked slots...) never reached
 * `authInterceptor`: no refresh when the access token had expired, no session-revoked handling.
 * A subscriber whose token expired on /booking silently lost their plan discount (the 401 reads
 * as "no subscription"), and an admin's "book for customer" failed instead of renewing.
 *
 * The interceptor below stands in for authInterceptor: whatever app.config registers through
 * provideHttpClient(withInterceptors(...)) must see every request this page makes.
 */
describe('BookingComponent — HTTP goes through the app HttpClient', () => {
  let seen: string[];
  const recordingInterceptor: HttpInterceptorFn = (req, next) => {
    seen.push(req.url);
    return next(req);
  };

  beforeEach(async () => {
    seen = [];
    sessionStorage.clear();
    await TestBed.configureTestingModule({
      imports: [BookingComponent],
      providers: [
        provideHttpClient(withInterceptors([recordingInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: 'SocialAuthServiceConfig',
          useValue: { autoLogin: false, providers: [], onError: () => {} } as SocialAuthServiceConfig
        }
      ]
    }).compileComponents();
  });

  it("routes the page-level BookingService's requests through the app interceptors", () => {
    const fixture = TestBed.createComponent(BookingComponent);
    fixture.detectChanges();

    // The component's OWN instance (providers: [BookingService]), not the root one.
    const pageService = fixture.debugElement.injector.get(BookingService);
    pageService.getUserSubscription().subscribe();

    expect(seen.some(u => u.includes('/booking/user-subscription')))
      .withContext(`interceptor saw: ${seen.join(', ')}`).toBeTrue();
    // ...and the startup catalogue load went the same way.
    expect(seen.some(u => u.includes('/booking/service-types'))).toBeTrue();

    // Both reached the testing backend rather than a real network.
    const http = TestBed.inject(HttpTestingController);
    expect(http.match(r => r.url.includes('/booking/service-types')).length).toBeGreaterThan(0);
  });
});
