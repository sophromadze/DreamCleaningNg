import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { CleanerAccountsComponent } from './cleaner-accounts.component';
import { AdminService, CleanerAccount, LinkableCleaner } from '../../../services/admin.service';
import { testProviders } from '../../../../testing/test-providers';

/**
 * ADMIN -> CLEANERS.
 *
 * The tab pairs a login account with a cleaner record. The rules worth pinning:
 *
 *  - Read/write is decided by the PERMISSION map (GET api/admin/permissions), not a local role
 *    test - that map is what [RequirePermission] enforces server-side, and a second copy of it
 *    here would be free to drift. Admins hold Update and do everything here; Moderators hold View
 *    and must not be able to re-link anybody.
 *  - Promotion and demotion go through the SAME users/{id}/role endpoint the Users tab uses, so
 *    the audit row and the role-change notification are identical however the change was made.
 *  - The cleaner picker searches on the SERVER, so a roster bigger than one response is still
 *    fully searchable.
 *  - A cleaner already attached to a different account cannot be picked - and is still SHOWN,
 *    named, because "why is she not in the list" has to be answerable from the list.
 *  - The list pages at 20, and the page is computed in `applyFilters` rather than in a getter -
 *    a getter that assigns totalPages while the template reads it is an NG0100.
 */
describe('CleanerAccountsComponent', () => {
  let component: CleanerAccountsComponent;
  let fixture: ComponentFixture<CleanerAccountsComponent>;
  let admin: jasmine.SpyObj<AdminService>;

  const account = (over: Partial<CleanerAccount> = {}): CleanerAccount => ({
    userId: 12,
    firstName: 'Maria',
    lastName: 'K',
    email: 'maria@example.com',
    phone: '5551234567',
    isActive: true,
    createdAt: '2026-01-04T00:00:00Z',
    cleanerId: null,
    cleanerName: null,
    cleanerEmail: null,
    cleanerIsActive: false,
    assignedOrdersCount: 0,
    ...over
  });

  const cleaner = (over: Partial<LinkableCleaner> = {}): LinkableCleaner => ({
    cleanerId: 5,
    name: 'Maria K',
    email: null,
    phone: null,
    isActive: true,
    linkedUserId: null,
    linkedUserEmail: null,
    ...over
  });

  const permissions = (canUpdate: boolean) => ({
    role: canUpdate ? 'Admin' : 'Moderator',
    permissions: {
      canView: true, canCreate: canUpdate, canUpdate,
      canDelete: false, canActivate: canUpdate, canDeactivate: canUpdate
    }
  });

  beforeEach(async () => {
    admin = jasmine.createSpyObj('AdminService', [
      'getUserPermissions', 'getCleanerAccounts', 'getLinkableCleaners',
      'getPromotableUsers', 'linkCleanerAccount', 'unlinkCleanerAccount', 'updateUserRole'
    ]);

    admin.getUserPermissions.and.returnValue(of(permissions(true) as any));
    admin.getCleanerAccounts.and.returnValue(of([account()]));
    admin.getLinkableCleaners.and.returnValue(of([cleaner()]));
    admin.getPromotableUsers.and.returnValue(of([]));
    admin.linkCleanerAccount.and.returnValue(of(account({ cleanerId: 5, cleanerName: 'Maria K', cleanerEmail: 'maria@example.com' })));
    admin.unlinkCleanerAccount.and.returnValue(of(account()));
    admin.updateUserRole.and.returnValue(of({}));

    await TestBed.configureTestingModule({
      imports: [CleanerAccountsComponent],
      providers: [...testProviders, { provide: AdminService, useValue: admin }]
    }).compileComponents();

    fixture = TestBed.createComponent(CleanerAccountsComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  describe('who may change anything', () => {
    it('follows the permission map, not the role name', () => {
      fixture.detectChanges();
      expect(component.canUpdate).toBeTrue();
    });

    it('leaves a Moderator read-only', () => {
      admin.getUserPermissions.and.returnValue(of(permissions(false) as any));
      fixture.detectChanges();

      expect(component.canUpdate).toBeFalse();

      // Every write is refused client-side too, so a stray call cannot reach the API.
      component.startLinking(component.accounts[0]);
      expect(component.linkingUserId).toBeNull();

      component.promote({ userId: 3, firstName: 'A', lastName: 'B', email: null, phone: null, role: 'Customer' });
      expect(admin.updateUserRole).not.toHaveBeenCalled();
    });
  });

  describe('linking', () => {
    it('opens the picker on the full roster', () => {
      fixture.detectChanges();
      admin.getLinkableCleaners.calls.reset();

      component.startLinking(component.accounts[0]);

      // A blank term, so the box below only ever narrows what is already on screen.
      expect(admin.getLinkableCleaners).toHaveBeenCalledWith('');
      expect(component.cleanerResults.length).toBe(1);
    });

    it('searches the roster on the SERVER, debounced', fakeAsync(() => {
      fixture.detectChanges();
      component.startLinking(component.accounts[0]);
      admin.getLinkableCleaners.calls.reset();

      component.onCleanerSearchChanged('mar');
      component.onCleanerSearchChanged('maria');
      tick(300);

      // One request for the settled term - the roster is the authority on who exists, so this is
      // never a filter over whatever the client already happened to hold.
      expect(admin.getLinkableCleaners.calls.count()).toBe(1);
      expect(admin.getLinkableCleaners).toHaveBeenCalledWith('maria');
    }));

    it('refuses a cleaner already attached to another account, but still shows them', () => {
      fixture.detectChanges();

      const taken = cleaner({ cleanerId: 9, linkedUserId: 44, linkedUserEmail: 'someone@else.com' });
      expect(component.isCleanerTaken(taken, 12)).toBeTrue();

      // Picking one is refused too, not merely styled as unavailable.
      component.linkCleanerChoice = null;
      component.chooseCleaner(taken, 12);
      expect(component.linkCleanerChoice as number | null).toBeNull();

      // Their own current link is not "taken" - re-opening the editor must show the row selected.
      const own = cleaner({ cleanerId: 5, linkedUserId: 12 });
      expect(component.isCleanerTaken(own, 12)).toBeFalse();
      component.chooseCleaner(own, 12);
      expect(component.linkCleanerChoice as number | null).toBe(5);
    });

    it('patches the row in place and closes the editor after a link', () => {
      fixture.detectChanges();
      component.startLinking(component.accounts[0]);
      component.linkCleanerChoice = 5;

      component.saveLink(component.accounts[0]);

      expect(admin.linkCleanerAccount).toHaveBeenCalledWith(12, 5);
      expect(component.accounts[0].cleanerId).toBe(5);
      expect(component.pagedAccounts[0].cleanerId).toBe(5);
      expect(component.linkingUserId).toBeNull();
      // The stale roster is dropped rather than kept: a wrong availability flag means somebody
      // gets linked twice, and the next open re-reads it anyway.
      expect(component.cleanerResults.length).toBe(0);
    });

    it('does nothing when no cleaner was chosen', () => {
      fixture.detectChanges();
      component.startLinking(component.accounts[0]);
      component.linkCleanerChoice = null;

      component.saveLink(component.accounts[0]);

      expect(admin.linkCleanerAccount).not.toHaveBeenCalled();
    });

    it('surfaces the server message when a link is refused', () => {
      fixture.detectChanges();
      admin.linkCleanerAccount.and.returnValue(
        throwError(() => ({ error: { message: 'That cleaner is already linked to another account.' } }))
      );
      component.startLinking(component.accounts[0]);
      component.linkCleanerChoice = 5;

      component.saveLink(component.accounts[0]);

      expect(component.errorMessage).toContain('already linked');
      expect(component.savingLinkUserId).toBeNull();
    });
  });

  describe('role changes', () => {
    it('promotes through the same endpoint the Users tab uses', () => {
      fixture.detectChanges();

      component.promote({ userId: 3, firstName: 'Ana', lastName: 'P', email: 'ana@x.com', phone: null, role: 'Customer' });

      expect(admin.updateUserRole).toHaveBeenCalledWith(3, 'Cleaner');
      // Reloaded rather than optimistically inserted - the new row needs its link state.
      expect(admin.getCleanerAccounts.calls.count()).toBeGreaterThan(1);
    });

    it('drops a demoted account out of this tab straight away', () => {
      fixture.detectChanges();
      spyOn(window, 'confirm').and.returnValue(true);

      component.demote(component.accounts[0]);

      expect(admin.updateUserRole).toHaveBeenCalledWith(12, 'Customer');
      expect(component.accounts.length).toBe(0);
      expect(component.pagedAccounts.length).toBe(0);
    });

    it('does not demote when the confirmation is declined', () => {
      fixture.detectChanges();
      spyOn(window, 'confirm').and.returnValue(false);

      component.demote(component.accounts[0]);

      expect(admin.updateUserRole).not.toHaveBeenCalled();
    });
  });

  describe('promote search', () => {
    it('debounces, and asks for nothing under two characters', fakeAsync(() => {
      fixture.detectChanges();

      component.onPromoteSearchChanged('a');
      tick(300);
      expect(admin.getPromotableUsers).not.toHaveBeenCalled();

      component.onPromoteSearchChanged('an');
      component.onPromoteSearchChanged('ana');
      tick(300);

      expect(admin.getPromotableUsers.calls.count()).toBe(1);
      expect(admin.getPromotableUsers).toHaveBeenCalledWith('ana');
    }));
  });

  describe('filters and paging', () => {
    const many = (count: number): CleanerAccount[] =>
      Array.from({ length: count }, (_, i) => account({
        userId: i + 1,
        firstName: `Cleaner${i + 1}`,
        lastName: 'X',
        email: `c${i + 1}@example.com`,
        phone: `555000${i + 1}`,
        isActive: i % 5 !== 0,
        cleanerId: i % 3 === 0 ? null : 100 + i,
        cleanerName: i % 3 === 0 ? null : `Record ${i}`
      }));

    it('shows 20 accounts a page', () => {
      admin.getCleanerAccounts.and.returnValue(of(many(45)));
      fixture.detectChanges();

      expect(component.pagedAccounts.length).toBe(20);
      expect(component.totalPages).toBe(3);

      component.goToPage(3);
      expect(component.pagedAccounts.length).toBe(5);
      expect(component.pagedAccounts[0].userId).toBe(41);
    });

    it('never leaves the viewer stranded past the last page after a filter narrows the list', () => {
      admin.getCleanerAccounts.and.returnValue(of(many(45)));
      fixture.detectChanges();

      component.goToPage(3);
      component.searchTerm = 'Cleaner7';
      component.onFilterChanged();

      expect(component.currentPage).toBe(1);
      expect(component.pagedAccounts.every(a => a.firstName.startsWith('Cleaner7'))).toBeTrue();
    });

    it('filters by status and by whether a cleaner record is linked', () => {
      admin.getCleanerAccounts.and.returnValue(of(many(9)));
      fixture.detectChanges();

      component.statusFilter = 'inactive';
      component.onFilterChanged();
      expect(component.pagedAccounts.every(a => !a.isActive)).toBeTrue();

      component.statusFilter = 'all';
      component.linkFilter = 'unlinked';
      component.onFilterChanged();
      expect(component.pagedAccounts.length).toBeGreaterThan(0);
      expect(component.pagedAccounts.every(a => !a.cleanerId)).toBeTrue();
    });

    it('searches the account name, email, phone, linked cleaner and id', () => {
      admin.getCleanerAccounts.and.returnValue(of([
        account({ userId: 1, firstName: 'Nino', lastName: 'B', email: 'nino@x.com', phone: '5550001', cleanerId: 7, cleanerName: 'Nino Beridze' }),
        account({ userId: 2, firstName: 'Giorgi', lastName: 'T', email: 'giorgi@y.com', phone: '5559999', cleanerId: null, cleanerName: null })
      ]));
      fixture.detectChanges();

      for (const term of ['nino', 'nino@x', '5550001', 'Beridze', '1']) {
        component.searchTerm = term;
        component.onFilterChanged();
        expect(component.pagedAccounts.some(a => a.userId === 1))
          .withContext(`"${term}" should match account #1`).toBeTrue();
      }
    });

    it('searches the linked cleaner record\'s phone as well as the account\'s own', () => {
      // The row can be SHOWING the record's number (see the block below), so an admin must be able
      // to search for the number they can read.
      admin.getCleanerAccounts.and.returnValue(of([
        account({ userId: 1, phone: null, cleanerId: 80, cleanerName: 'Teo Akhobadze', cleanerPhone: '7185731923' })
      ]));
      fixture.detectChanges();

      component.searchTerm = '7185731923';
      component.onFilterChanged();
      expect(component.pagedAccounts.length).toBe(1);
    });
  });

  /**
   * A cleaner who registered her OWN login left the optional phone field blank (and a Google or
   * Apple sign-in never supplies one), so the account carries no number while her mobile sits on
   * her cleaner record. The row used to print "-" beside a linked record whose number the same
   * admin had just typed into the Cleaners Dashboard, which reads as a bug in the panel.
   */
  describe('phone', () => {
    it('falls back to the linked cleaner record when the account has no phone', () => {
      const resolved = component.resolvePhone(
        account({ phone: null, cleanerId: 80, cleanerPhone: '7185731923' }));

      expect(resolved.value).toBe('7185731923');
      expect(resolved.fromCleanerRecord).toBeTrue();
    });

    it('prefers the account\'s own phone - the two are allowed to differ', () => {
      const resolved = component.resolvePhone(
        account({ phone: '5551234567', cleanerId: 80, cleanerPhone: '7185731923' }));

      expect(resolved.value).toBe('5551234567');
      expect(resolved.fromCleanerRecord).toBeFalse();
    });

    it('reports no phone when neither side has one', () => {
      expect(component.resolvePhone(account({ phone: null, cleanerPhone: null })).value).toBeNull();
      // Whitespace is not a phone number - it would render as a blank cell with no dash.
      expect(component.resolvePhone(account({ phone: '  ', cleanerPhone: '  ' })).value).toBeNull();
    });
  });
});
