import type { MockedObject } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { CanActivateFn, Router } from '@angular/router';
import { BehaviorSubject, firstValueFrom, of } from 'rxjs';

import { cleanerPortalGuard, notCleanerGuard, isCleanerRole, CLEANER_PORTAL_PATH } from './cleaner-portal.guard';
import { AuthService } from '../services/auth.service';

/**
 * WHERE A CLEANER ACCOUNT MAY GO.
 *
 * A cleaner's login is a work login. It opens the read-only portal and nothing else, and every
 * authenticated CUSTOMER page has to send it back there rather than to the homepage - the portal
 * is where their work is, and a bounce to '/' reads as something having gone wrong.
 *
 * The pair is symmetric on purpose, and both halves are tested here because getting one right and
 * the other wrong produces a redirect loop: cleanerPortalGuard lets cleaners and the staff who run
 * the schedule (Admin, SuperAdmin) in, notCleanerGuard keeps cleaners out of everything else.
 */
describe('cleaner portal guards', () => {
  let router: MockedObject<Router>;
  let currentUser: any;

  const run = (guard: CanActivateFn) =>
    TestBed.runInInjectionContext(() => guard({} as any, {} as any));

  beforeEach(() => {
    currentUser = null;
    router = { navigate: vi.fn().mockName('Router.navigate') } as any;

    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: router },
        {
          provide: AuthService,
          useValue: {
            // The guards wait for auth to settle before deciding; an always-true subject is the
            // settled state.
            isInitialized$: new BehaviorSubject(true),
            get currentUserValue() { return currentUser; }
          }
        }
      ]
    });
  });

  const expectResult = async (guard: CanActivateFn, expected: boolean) => {
    const result: any = run(guard);
    expect(await firstValueFrom(result.subscribe ? result : of(result))).toBe(expected);
  };

  it('identifies the cleaner role and nothing else', () => {
    expect(isCleanerRole('Cleaner')).toBe(true);
    expect(isCleanerRole('Customer')).toBe(false);
    expect(isCleanerRole('SuperAdmin')).toBe(false);
    expect(isCleanerRole(null)).toBe(false);
    expect(isCleanerRole(undefined)).toBe(false);
  });

  describe('cleanerPortalGuard', () => {
    it('lets a cleaner in', async () => {
      currentUser = { role: 'Cleaner' };
      await expectResult(cleanerPortalGuard, true);
    });

    /**
     * MOVED 2026-09: the system-wide calendar is now the Portal tab of /cleaners-dashboard, because
     * the people and the schedule are one subject and were two header links. The route forwards
     * rather than allowing, so an old "All Cleanings" bookmark lands on the right tab instead of
     * opening a second, orphaned copy of the same calendar.
     */
    it('forwards a SuperAdmin to the Cleaners section Portal tab', async () => {
      currentUser = { role: 'SuperAdmin' };
      const allowed = await firstValueFrom(run(cleanerPortalGuard) as any);
      expect(allowed).toBe(false);
      expect(router.navigate).toHaveBeenCalledWith(['/cleaners-dashboard'], { queryParams: { tab: 'portal' } });
    });

    it('turns a customer away rather than showing an empty page', async () => {
      currentUser = { role: 'Customer' };
      const allowed = await firstValueFrom(run(cleanerPortalGuard) as any);
      expect(allowed).toBe(false);
      expect(router.navigate).toHaveBeenCalledWith(['/']);
    });

    it('forwards an Admin the same way - they read the schedule, just not at this URL', async () => {
      // Admins staff the jobs and chase the day, so the calendar is theirs; it simply lives on the
      // Cleaners page now. A bounce to '/' here would read as "you are not allowed", which is wrong.
      currentUser = { role: 'Admin' };
      const allowed = await firstValueFrom(run(cleanerPortalGuard) as any);
      expect(allowed).toBe(false);
      expect(router.navigate).toHaveBeenCalledWith(['/cleaners-dashboard'], { queryParams: { tab: 'portal' } });
    });

    it('still turns a Moderator away - View-only, and they do not run the schedule', async () => {
      currentUser = { role: 'Moderator' };
      await expectResult(cleanerPortalGuard, false);
    });
  });

  describe('notCleanerGuard', () => {
    it('sends a cleaner to the portal, not to the homepage', async () => {
      currentUser = { role: 'Cleaner' };
      const allowed = await firstValueFrom(run(notCleanerGuard) as any);
      expect(allowed).toBe(false);
      expect(router.navigate).toHaveBeenCalledWith([CLEANER_PORTAL_PATH]);
    });

    it('leaves customers alone', async () => {
      currentUser = { role: 'Customer' };
      await expectResult(notCleanerGuard, true);
    });

    it('leaves staff alone', async () => {
      currentUser = { role: 'SuperAdmin' };
      await expectResult(notCleanerGuard, true);
    });

    it('leaves a logged-out visitor to authGuard rather than redirecting them itself', async () => {
      currentUser = null;
      await expectResult(notCleanerGuard, true);
    });
  });
});
