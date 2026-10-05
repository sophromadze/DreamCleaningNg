import type { Mock, MockedObject } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { firstValueFrom, of, throwError } from 'rxjs';

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
  let orders: MockedObject<OrderService>;
  let auth: { isLoggedIn: Mock };
  let router: Router;

  function run(orderId = '7', paymentSuccess = false) {
    vi.spyOn(router, 'getCurrentNavigation').mockReturnValue({ extras: { state: paymentSuccess ? { paymentSuccess: true } : {} } } as any);
    const route = { paramMap: new Map([['orderId', orderId]]) } as unknown as ActivatedRouteSnapshot;
    return TestBed.runInInjectionContext(() =>
      bookingSuccessGuard(route, {} as RouterStateSnapshot)
    );
  }

  beforeEach(() => {
    orders = { getOrderById: vi.fn().mockName('OrderService.getOrderById') } as unknown as MockedObject<OrderService>;
    auth = { isLoggedIn: vi.fn().mockName('isLoggedIn').mockReturnValue(true) };

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
    expect(run('7', true)).toBe(true);
    expect(orders.getOrderById).not.toHaveBeenCalled();
  });

  it('admits the owner opening their paid order in a new tab', async () => {
    orders.getOrderById.mockReturnValue(of({ id: 7, isPaid: true } as any));

    const result: boolean | UrlTree = await firstValueFrom(run('7') as any);
    expect(result).toBe(true);
    expect(orders.getOrderById).toHaveBeenCalledWith(7);
  });

  it('admits an order settled outside Stripe, which keeps isPaid false by design', async () => {
    orders.getOrderById.mockReturnValue(of({ id: 7, isPaid: false, paymentMethod: 'Cash' } as any));

    const result: boolean | UrlTree = await firstValueFrom(run('7') as any);
    expect(result).toBe(true);
  });

  it('sends an UNPAID order to its own page — never to a payment', async () => {
    orders.getOrderById.mockReturnValue(of({ id: 7, isPaid: false, paymentMethod: 'Normal' } as any));

    const result: boolean | UrlTree = await firstValueFrom(run('7') as any);
    expect(result.toString()).toBe('/order/7');
  });

  it('sends somebody else\'s order home (the endpoint answers 404 for it)', async () => {
    orders.getOrderById.mockReturnValue(throwError(() => ({ status: 404 })));

    const result: boolean | UrlTree = await firstValueFrom(run('7') as any);
    expect(result.toString()).toBe('/');
  });

  it('sends a signed-out visitor home without asking for any order', () => {
    auth.isLoggedIn.mockReturnValue(false);

    const result = run('7');

    expect(result.toString()).toBe('/');
    expect(orders.getOrderById).not.toHaveBeenCalled();
  });
});
