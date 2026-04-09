import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

export const bookingSuccessGuard: CanActivateFn = (route, state) => {
  const router = inject(Router);
  const navigation = router.getCurrentNavigation();
  const paymentSuccess = navigation?.extras?.state?.['paymentSuccess'];

  if (paymentSuccess === true) {
    return true;
  }

  // Not a legitimate payment completion - redirect to home
  router.navigate(['/']);
  return false;
};
