import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { filter, take, map } from 'rxjs/operators';

/** The landing page for a Cleaner-role account. Their whole app is this one section. */
export const CLEANER_PORTAL_PATH = '/cleaner-portal';

/** True for accounts whose only authenticated view is the cleaner portal. */
export function isCleanerRole(role: string | null | undefined): boolean {
  return role === 'Cleaner';
}

/** Roles that see EVERY cleaning rather than one person's - mirrors CleanerAccountLink. */
export function isSystemWideRole(role: string | null | undefined): boolean {
  return role === 'Admin' || role === 'SuperAdmin';
}

/** Where an Admin / SuperAdmin now reads every cleaning: the Cleaners section's Portal tab. */
export const CLEANERS_PORTAL_TAB_PATH = '/cleaners-dashboard';

/**
 * Guards the portal route. It now serves ONE audience:
 *   Cleaner - their own jobs, minimal detail.
 *
 * Admin / SuperAdmin still see every cleaning, but since 2026-09 they see it as the Portal TAB of
 * /cleaners-dashboard — the people and the schedule are one subject and had no business being two
 * header links. So a system-wide role asking for this route is FORWARDED there rather than shown a
 * second, orphaned copy of the same calendar; an old "All Cleanings" bookmark lands on the right
 * tab. (The tab renders the portal component directly, so this redirect never fires for it.)
 *
 * Everyone else is turned away rather than shown an empty page. All of this is convenience; the
 * endpoints carry their own [Authorize] and the system-wide reads are role-gated server-side, so a
 * guard that was somehow bypassed still yields nothing.
 */
export const cleanerPortalGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.isInitialized$.pipe(
    filter(initialized => initialized),
    take(1),
    map(() => {
      const role = authService.currentUserValue?.role;
      if (isCleanerRole(role)) return true;
      if (isSystemWideRole(role)) {
        router.navigate([CLEANERS_PORTAL_TAB_PATH], { queryParams: { tab: 'portal' } });
        return false;
      }
      router.navigate(['/']);
      return false;
    })
  );
};

/**
 * The mirror image: keeps Cleaner-role accounts OUT of the ordinary authenticated customer views
 * (profile, order history, an individual order, rewards, and the rest of the account area).
 *
 * A cleaner's account is a work login. It has no orders of its own, no rewards balance and no
 * booking history, so those pages would render as an unexplained set of empty screens even before
 * the question of what they should be able to see. They are sent to the portal instead of the
 * homepage, because the portal is where their work is and a bounce to '/' reads as an error.
 *
 * Applied on the AUTHENTICATED customer routes only. Public marketing pages stay public - a
 * cleaner reading the services page is nobody's problem, and blocking it would be a strange thing
 * for the app to do.
 */
export const notCleanerGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.isInitialized$.pipe(
    filter(initialized => initialized),
    take(1),
    map(() => {
      if (!isCleanerRole(authService.currentUserValue?.role)) return true;
      router.navigate([CLEANER_PORTAL_PATH]);
      return false;
    })
  );
};
