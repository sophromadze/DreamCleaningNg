import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import {
  AdminUserSearchComponent,
  USER_LIST_SETTLE_MS,
  USER_SEARCH_DEBOUNCE_MS,
  USER_SEARCH_MAX_RESULTS,
  USER_SEARCH_MIN_CHARS
} from './admin-user-search.component';
import { AdminService, UserAdmin } from '../../services/admin.service';

import { testProviders } from '../../../testing/test-providers';

/** Minimal customer row — only the fields the search box reads. */
function customer(id: number, firstName: string, lastName: string, email: string): UserAdmin {
  return { id, firstName, lastName, email, role: 'Customer', isActive: true } as UserAdmin;
}

describe('AdminUserSearchComponent', () => {
  let component: AdminUserSearchComponent;
  let fixture: ComponentFixture<AdminUserSearchComponent>;
  let adminService: jasmine.SpyObj<AdminService>;

  const users = [
    customer(1, 'Smith', 'Adams', 'smith.adams@example.com'),
    customer(2, 'Samuel', 'Smithers', 'sam@example.com'),
    customer(3, 'Jane', 'Doe', 'jane@example.com')
  ];

  beforeEach(async () => {
    adminService = jasmine.createSpyObj<AdminService>('AdminService', ['getUsers']);
    adminService.getUsers.and.returnValue(of(users as any));

    await TestBed.configureTestingModule({
      providers: [...testProviders, { provide: AdminService, useValue: adminService }],
      imports: [AdminUserSearchComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(AdminUserSearchComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  /** Type a term and let the debounce elapse, as a real keystroke would. */
  function search(term: string): void {
    component.onSearchInput(term);
    tick(USER_SEARCH_DEBOUNCE_MS);
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  /**
   * Regression (2026-08): an admin clicked a search result at the exact moment the list changed
   * under the cursor and created a booking for the wrong customer. A row that appeared
   * milliseconds ago is not one the admin read, so the click is refused rather than honoured.
   */
  describe('settle guard on the result click', () => {
    it('refuses a click landing within the settle window of a list change', fakeAsync(() => {
      search('smith');
      expect(component.filteredUsers.length).toBeGreaterThan(0);

      // The list just changed — this is the mis-click the guard exists for.
      component.lastListChangedAt = Date.now();
      spyOn(component.userSelected, 'emit');

      component.selectUser(component.filteredUsers[0]);

      expect(component.userSelected.emit).not.toHaveBeenCalled();
      expect(component.clickRejected).toBeTrue();
      // The term must survive so the admin can simply click again.
      expect(component.userSearchTerm).toBe('smith');
    }));

    it('accepts the same click once the list has settled', fakeAsync(() => {
      search('smith');
      const target = component.filteredUsers[0];

      component.lastListChangedAt = Date.now() - (USER_LIST_SETTLE_MS + 50);
      spyOn(component.userSelected, 'emit');

      component.selectUser(target);

      expect(component.userSelected.emit).toHaveBeenCalledOnceWith(target);
      expect(component.clickRejected).toBeFalse();
    }));

    it('clears the rejection notice on the next keystroke', fakeAsync(() => {
      search('smith');
      component.lastListChangedAt = Date.now();
      component.selectUser(component.filteredUsers[0]);
      expect(component.clickRejected).toBeTrue();

      search('smithe');

      expect(component.clickRejected).toBeFalse();
    }));

    it('does not stamp the change time when a re-filter produces the same rows', fakeAsync(() => {
      search('smith');
      const stampAfterFirstFilter = component.lastListChangedAt;

      tick(50);
      component.applyFilter(); // identical result set

      // An unchanged list must never lock the admin out of clicking.
      expect(component.lastListChangedAt).toBe(stampAfterFirstFilter);
    }));

    it('stamps the change time when a late user-list response replaces the rows', fakeAsync(() => {
      search('smith');
      const stampAfterFirstFilter = component.lastListChangedAt;

      tick(50);
      component.availableUsers = [customer(9, 'Smithson', 'Kaur', 'kaur@example.com')];
      component.applyFilter();

      expect(component.lastListChangedAt).toBeGreaterThan(stampAfterFirstFilter);
    }));
  });

  describe('list size and debounce', () => {
    it('renders nothing below the minimum character count', fakeAsync(() => {
      search('s');

      expect(component.needsMoreCharacters).toBeTrue();
      expect(component.filteredUsers).toEqual([]);
    }));

    it('never dumps the whole customer base for an empty box', fakeAsync(() => {
      search('');

      expect(component.filteredUsers).toEqual([]);
    }));

    it('does not filter until the debounce elapses', fakeAsync(() => {
      component.onSearchInput('smith');
      expect(component.filteredUsers).toEqual([]);

      tick(USER_SEARCH_DEBOUNCE_MS);

      expect(component.filteredUsers.length).toBeGreaterThan(0);
    }));

    it('caps the rendered rows and reports the remainder', fakeAsync(() => {
      const many = Array.from({ length: USER_SEARCH_MAX_RESULTS + 7 }, (_, i) =>
        customer(100 + i, 'Zed', `Test${i}`, `zed${i}@example.com`)
      );
      component.availableUsers = many;

      search('zed');

      expect(component.filteredUsers.length).toBe(USER_SEARCH_MAX_RESULTS);
      expect(component.totalMatchCount).toBe(many.length);
      expect(component.hiddenMatchCount).toBe(7);
    }));

    it('matches on name, email and id', fakeAsync(() => {
      search('jane@example.com');
      expect(component.filteredUsers.map(u => u.id)).toEqual([3]);

      search('doe');
      expect(component.filteredUsers.map(u => u.id)).toEqual([3]);
    }));

    it('exposes the minimum as at least two characters', () => {
      expect(USER_SEARCH_MIN_CHARS).toBeGreaterThanOrEqual(2);
    });
  });

  /**
   * Only one request is made today (the endpoint returns the whole table), but a second load
   * must never be able to overwrite a newer one's results.
   */
  describe('load generation token', () => {
    it('ignores a response from a superseded load', () => {
      component.availableUsers = [];
      const stale = [customer(50, 'Stale', 'Row', 'stale@example.com')];
      const fresh = [customer(60, 'Fresh', 'Row', 'fresh@example.com')];

      // Two loads in flight: the first resolves last and must be discarded.
      const subjects: Array<(value: any) => void> = [];
      adminService.getUsers.and.returnValue({
        pipe: () => ({
          subscribe: (handlers: any) => {
            subjects.push(handlers.next);
            return { unsubscribe: () => {} };
          }
        })
      } as any);

      component.loadUsers(); // generation 2
      component.loadUsers(); // generation 3

      subjects[1](fresh);
      subjects[0](stale); // late arrival from the older request

      expect(component.availableUsers.map(u => u.id)).toEqual([60]);
    });
  });

  /**
   * A customer registered from the booking page's header must be bookable IMMEDIATELY — the
   * admin is on the phone and cannot be told to reload the page. The host owns the list of
   * customers it created (the search box lives inside the admin-mode *ngIf and is destroyed
   * whenever Admin Mode is toggled off), and hands them over as `seedUsers`.
   */
  describe('seedUsers — a just-registered customer is searchable without a reload', () => {
    const fresh = customer(99, 'Nino', 'Beridze', 'nino@example.com');

    it('is searchable as soon as the input changes, with no refetch', fakeAsync(() => {
      adminService.getUsers.calls.reset();

      fixture.componentRef.setInput('seedUsers', [fresh]);
      fixture.detectChanges();
      search('Beridze');

      expect(component.filteredUsers.map(u => u.id)).toEqual([99]);
      expect(adminService.getUsers).not.toHaveBeenCalled();
    }));

    it('is present when the box is created with seeds already waiting', fakeAsync(() => {
      // Registering with Admin Mode OFF destroys nothing — this box did not exist yet.
      const later = TestBed.createComponent(AdminUserSearchComponent);
      later.componentRef.setInput('seedUsers', [fresh]);
      later.detectChanges();

      later.componentInstance.onSearchInput('Nino');
      tick(USER_SEARCH_DEBOUNCE_MS);

      expect(later.componentInstance.filteredUsers.map(u => u.id)).toEqual([99]);
    }));

    it('ranks seeds ahead of the server list so the render cap cannot hide them', fakeAsync(() => {
      fixture.componentRef.setInput('seedUsers', [fresh]);
      fixture.detectChanges();

      expect(component.availableUsers[0].id).toBe(99);
      expect(component.availableUsers.length).toBe(users.length + 1);
    }));

    /** The seed is a stand-in, not a second record. */
    it('drops the seed once the server list carries that id', fakeAsync(() => {
      const canonical = customer(99, 'Nino', 'Beridze', 'nino@example.com');
      adminService.getUsers.and.returnValue(of([...users, canonical] as any));

      fixture.componentRef.setInput('seedUsers', [fresh]);
      fixture.detectChanges();
      component.loadUsers(true);
      search('Beridze');

      expect(component.filteredUsers.map(u => u.id)).toEqual([99]);
      expect(component.availableUsers.filter(u => u.id === 99).length).toBe(1);
      expect(component.availableUsers[0].id).not.toBe(99);
    }));

    /**
     * The customer exists on the server either way; a load that failed is a reason to keep
     * showing them, not to drop them.
     */
    it('keeps seeds when the reload fails', fakeAsync(() => {
      fixture.componentRef.setInput('seedUsers', [fresh]);
      fixture.detectChanges();
      adminService.getUsers.and.returnValue(throwError(() => new Error('offline')));

      component.loadUsers(true);
      search('Beridze');

      expect(component.filteredUsers.map(u => u.id)).toEqual([99]);
    }));

    /**
     * GET /api/admin/users is an ordinary cacheable GET, so a reload triggered by a WRITE has to
     * bypass the cache or it can hand back the list from before the POST — the exact "I have to
     * reload the page to see the new customer" symptom.
     */
    it('bypasses the HTTP cache on a reload triggered by a registration', () => {
      adminService.getUsers.calls.reset();

      component.loadUsers(true);

      expect(adminService.getUsers).toHaveBeenCalledWith(true);
    });

    it('leaves the ordinary first load cacheable', () => {
      adminService.getUsers.calls.reset();

      component.loadUsers();

      expect(adminService.getUsers).toHaveBeenCalledWith(false);
    });
  });

  it('trackBy keys rows by user id so matching rows are reused', () => {
    expect(component.trackByUserId(0, users[2])).toBe(3);
  });
});
