import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { of, throwError } from 'rxjs';

import { bookingSuccessGuard } from './booking-success.guard';
import { AuthService } from '../services/auth.service';
import { OrderService } from '../services/order.service';
import { testProviders } from '../../testing/test-providers';

/**
 * The success page is a receipt: it shows an order and can never start or repeat a payment.
 *
 * It used to admit only the navigation that follows a payment, so a customer opening their own
 * confirmation in a NEW TAB was sent to the home page (2026-09). It now verifies the order
 * instead — through the owner-scoped endpoint, which answers 404 for anybody else's order.
 */
describe('bookingSuccessGuard', () => {
  let orders: jasmine.SpyObj<OrderService>;
  let auth: { isLoggedIn: jasmine.Spy };
  let router: Router;

  function run(orderId = '7', paymentSuccess = false) {
    spyOn(router, 'getCurrentNavigation').and.returnValue(
      { extras: { state: paymentSuccess ? { paymentSuccess: true } : {} } } as any
    );
    const route = { paramMap: new Map([['orderId', orderId]]) } as unknown as ActivatedRouteSnapshot;
    return TestBed.runInInjectionContext(() =>
      bookingSuccessGuard(route, {} as RouterStateSnapshot)
    );
  }

  beforeEach(() => {
    orders = jasmine.createSpyObj<OrderService>('OrderService', ['getOrderById']);
    auth = { isLoggedIn: jasmine.createSpy('isLoggedIn').and.returnValue(true) };

    TestBed.configureTestingModule({
      providers: [
        ...testProviders,
        { provide: OrderService, useValue: orders },
        { provide: AuthService, useValue: auth }
      ]
    });
    router = TestBed.inject(Router);
  });

  it('admits the navigation that follows a payment without asking the server', () => {
    expect(run('7', true)).toBeTrue();
    expect(orders.getOrderById).not.toHaveBeenCalled();
  });

  it('admits the owner opening their paid order in a new tab', (done) => {
    orders.getOrderById.and.returnValue(of({ id: 7, isPaid: true } as any));

    (run('7') as any).subscribe((result: boolean | UrlTree) => {
      expect(result).toBeTrue();
      expect(orders.getOrderById).toHaveBeenCalledWith(7);
      done();
    });
  });

  it('admits an order settled outside Stripe, which keeps isPaid false by design', (done) => {
    orders.getOrderById.and.returnValue(of({ id: 7, isPaid: false, paymentMethod: 'Cash' } as any));

    (run('7') as any).subscribe((result: boolean | UrlTree) => {
      expect(result).toBeTrue();
      done();
    });
  });

  it('sends an UNPAID order to its own page — never to a payment', (done) => {
    orders.getOrderById.and.returnValue(of({ id: 7, isPaid: false, paymentMethod: 'Normal' } as any));

    (run('7') as any).subscribe((result: boolean | UrlTree) => {
      expect(result.toString()).toBe('/order/7');
      done();
    });
  });

  it('sends somebody else\'s order home (the endpoint answers 404 for it)', (done) => {
    orders.getOrderById.and.returnValue(throwError(() => ({ status: 404 })));

    (run('7') as any).subscribe((result: boolean | UrlTree) => {
      expect(result.toString()).toBe('/');
      done();
    });
  });

  it('sends a signed-out visitor home without asking for any order', () => {
    auth.isLoggedIn.and.returnValue(false);

    const result = run('7');

    expect(result.toString()).toBe('/');
    expect(orders.getOrderById).not.toHaveBeenCalled();
  });
});
