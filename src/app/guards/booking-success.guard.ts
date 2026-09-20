import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';

import { AuthService } from '../services/auth.service';
import { OrderService } from '../services/order.service';

/**
 * Who may see a booking-success page.
 *
 * The page is a receipt: it displays an order and never starts, repeats or confirms a payment.
 *
 * It used to admit ONLY the navigation that follows a payment (`state.paymentSuccess`), which is
 * absent in a new tab, from a bookmark or from a pasted link — so a customer opening their own
 * confirmation a second way was bounced to the home page (2026-09).
 *
 * Now, without that flag, the page is opened only after the ORDER ITSELF is verified through the
 * owner-scoped endpoint (`GET /api/order/{id}` answers 404 for anybody else's order):
 *   • paid → show it;
 *   • not paid → the order's own page, never a payment page;
 *   • not theirs, missing, or nobody signed in → home, exactly as before.
 */
export const bookingSuccessGuard: CanActivateFn = (route, state) => {
  const router = inject(Router);
  const navigation = router.getCurrentNavigation();

  if (navigation?.extras?.state?.['paymentSuccess'] === true) return true;

  const auth = inject(AuthService);
  const orders = inject(OrderService);
  const orderId = Number(route.paramMap.get('orderId'));

  if (!auth.isLoggedIn() || !Number.isFinite(orderId) || orderId <= 0) {
    return router.parseUrl('/');
  }

  return orders.getOrderById(orderId).pipe(
    map(order => {
      if (!order) return router.parseUrl('/');
      // Money handled outside Stripe (cash, Zelle, a paid invoice) keeps isPaid=false by design,
      // so "settled" is the wider question here — the receipt is just as real. Mirrors
      // Helpers/OrderPaymentFilter.
      const settled = order.isPaid === true
        || !!order.invoicePaidAt
        || (!!order.paymentMethod && order.paymentMethod !== 'Normal');
      return settled ? true : router.parseUrl(`/order/${orderId}`);
    }),
    catchError(() => of(router.parseUrl('/')))
  );
};
