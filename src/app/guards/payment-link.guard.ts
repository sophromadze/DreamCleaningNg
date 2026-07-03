import { CanActivateFn } from '@angular/router';

/**
 * Wrapper for the /order/:id/pay guard stack.
 *
 * Payment links sent by email/SMS carry a secret token (?t=...). A visitor presenting the
 * token may open the payment page WITHOUT logging in — the backend re-validates the token on
 * every API call and only while something is unpaid, so the guard's only job here is to skip
 * the login redirect. Without a token the wrapped guard runs exactly as before.
 */
export function skipWhenPaymentToken(guard: CanActivateFn): CanActivateFn {
  return (route, state) => {
    if (route.queryParamMap.get('t')) {
      return true;
    }
    return guard(route, state);
  };
}
