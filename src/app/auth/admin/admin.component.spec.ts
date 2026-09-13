import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ActivatedRoute, convertToParamMap } from '@angular/router';

import { AdminComponent } from './admin.component';

import { testProviders } from '../../../testing/test-providers';

describe('AdminComponent', () => {
  let component: AdminComponent;
  let fixture: ComponentFixture<AdminComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [...testProviders],
      imports: [AdminComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AdminComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // The Services tab edits the price catalogue every quote is built from, so it is gated on the
  // ROLE, not on canView (which regular Admins and Moderators both hold).
  describe('the Services tab is SuperAdmin-only', () => {
    const viewPermissions = (role: string) => ({
      role,
      permissions: {
        canView: true,
        canCreate: true,
        canUpdate: true,
        canDelete: true,
        canActivate: true,
        canDeactivate: true
      }
    });

    afterEach(() => {
      sessionStorage.removeItem('adminActiveTab');
    });

    it('does not render the Services button for a regular Admin who can view', () => {
      component.userRole = 'Admin';
      component.userPermissions = viewPermissions('Admin');
      fixture.detectChanges();

      const labels = Array.from(
        fixture.nativeElement.querySelectorAll('.admin-tabs .tab-btn')
      ).map((b) => (b as HTMLElement).textContent?.trim());

      expect(labels).not.toContain('Services');
      expect(labels).toContain('Orders');
    });

    it('renders the Services button for a SuperAdmin', () => {
      component.userRole = 'SuperAdmin';
      component.userPermissions = viewPermissions('SuperAdmin');
      fixture.detectChanges();

      const labels = Array.from(
        fixture.nativeElement.querySelectorAll('.admin-tabs .tab-btn')
      ).map((b) => (b as HTMLElement).textContent?.trim());

      expect(labels).toContain('Services');
    });

    it('falls back to Orders when a non-SuperAdmin asks for the Services tab', () => {
      component.userRole = 'Admin';

      component.setActiveTab('booking-services');

      expect(component.activeTab).toBe('orders');
      expect(sessionStorage.getItem('adminActiveTab')).toBe('orders');
    });

    it('lets a SuperAdmin open it', () => {
      component.userRole = 'SuperAdmin';

      component.setActiveTab('booking-services');

      expect(component.activeTab).toBe('booking-services');
    });

    // The tab is restored from sessionStorage before the role is known, so an admin demoted
    // since their last visit would otherwise land straight back on it.
    it('drops a restored Services tab once the role turns out not to be SuperAdmin', () => {
      component.activeTab = 'booking-services';
      component.userRole = '';

      expect(component.canOpenTab('booking-services')).toBeFalse();

      component.userRole = 'Admin';
      if (!component.canOpenTab(component.activeTab)) {
        component.setActiveTab('orders');
      }

      expect(component.activeTab).toBe('orders');
    });

    it('leaves every other tab alone', () => {
      component.userRole = 'Admin';

      for (const tab of ['orders', 'users', 'discounts', 'scheduling', 'audit-history']) {
        expect(component.canOpenTab(tab)).toBeTrue();
      }
    });
  });

  // Bubble Rewards moved out of the header dropdown into this panel (2026-09). Same gate as
  // Services and for the same kind of reason: the settings behind it set the points economy
  // every customer earns and spends against, not one account's balance.
  describe('the Rewards tab is SuperAdmin-only', () => {
    const viewPermissions = (role: string) => ({
      role,
      permissions: {
        canView: true,
        canCreate: true,
        canUpdate: true,
        canDelete: true,
        canActivate: true,
        canDeactivate: true
      }
    });

    const tabLabels = () =>
      Array.from(fixture.nativeElement.querySelectorAll('.admin-tabs .tab-btn'))
        .map((b) => (b as HTMLElement).textContent?.trim());

    afterEach(() => {
      sessionStorage.removeItem('adminActiveTab');
    });

    it('does not render the Rewards button for a regular Admin who can view', () => {
      component.userRole = 'Admin';
      component.userPermissions = viewPermissions('Admin');
      fixture.detectChanges();

      expect(tabLabels()).not.toContain('Rewards');
    });

    it('renders it for a SuperAdmin', () => {
      component.userRole = 'SuperAdmin';
      component.userPermissions = viewPermissions('SuperAdmin');
      fixture.detectChanges();

      expect(tabLabels()).toContain('Rewards');
    });

    it('falls back to Orders when a non-SuperAdmin asks for it', () => {
      component.userRole = 'Admin';

      component.setActiveTab('rewards');

      expect(component.activeTab).toBe('orders');
      expect(sessionStorage.getItem('adminActiveTab')).toBe('orders');
    });

    it('lets a SuperAdmin open it', () => {
      component.userRole = 'SuperAdmin';

      component.setActiveTab('rewards');

      expect(component.activeTab).toBe('rewards');
      expect(component.canOpenTab('rewards')).toBeTrue();
    });

    // /admin/rewards redirects here as ?tab=rewards, so the old bookmark has to land on the tab
    // rather than on whatever tab was last used.
    const openWithTab = async (tab: string) => {
      // Specs run in a random order and several of them leave a tab behind, so the saved-tab
      // branch has to be taken out of the picture here: the whole point of these two is what
      // ?tab= does on its own, and a leftover 'users' made the unknown-tab fallback read as
      // one that had resolved to something.
      sessionStorage.removeItem('adminActiveTab');
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        providers: [
          ...testProviders,
          {
            provide: ActivatedRoute,
            useValue: { snapshot: { queryParamMap: convertToParamMap({ tab }) } },
          },
        ],
        imports: [AdminComponent],
      }).compileComponents();

      const fresh = TestBed.createComponent(AdminComponent);
      fresh.componentInstance.ngOnInit();
      return fresh.componentInstance;
    };

    it('opens the tab named by ?tab=', async () => {
      expect((await openWithTab('rewards')).activeTab).toBe('rewards');
    });

    it('ignores a ?tab= naming something that is not a tab', async () => {
      expect((await openWithTab('not-a-tab')).activeTab).toBe('orders');
    });
  });

  /**
   * DEEP LINKS INTO USERS (2026-09).
   *
   * The Orders panel's "View User" used to send every order to Users → Customers, so opening an
   * invoice-billed cleaning showed a plain customer record with none of the billing entity,
   * contracts or invoices the admin had come to see. It now names the sub-tab, and for a
   * commercial order it names the client.
   */
  describe('?usersTab= and ?clientId=', () => {
    const openWith = async (params: Record<string, string>) => {
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        providers: [
          ...testProviders,
          {
            provide: ActivatedRoute,
            useValue: { snapshot: { queryParamMap: convertToParamMap(params) } },
          },
        ],
        imports: [AdminComponent],
      }).compileComponents();

      const fresh = TestBed.createComponent(AdminComponent);
      fresh.componentInstance.ngOnInit();
      return fresh.componentInstance;
    };

    it('opens Users → Business Clients on the client a link names', async () => {
      const c = await openWith({ clientId: '7' });

      // A client id can only mean Business Clients, so the link does not have to say so twice.
      expect(c.activeTab).toBe('users');
      expect(c.initialUsersTab).toBe('business-clients');
      expect(c.pendingClientId).toBe(7);
    });

    it('opens Users → Customers with the account a link names', async () => {
      const c = await openWith({ userId: '42', usersTab: 'customers' });

      expect(c.activeTab).toBe('users');
      expect(c.pendingUserId).toBe(42);
      expect(c.initialUsersTab).toBe('customers');
    });

    it('lands on Users even when only the sub-tab is named', async () => {
      // Without this the final branch would restore the last sessionStorage tab straight over
      // the top of the link.
      sessionStorage.setItem('adminActiveTab', 'discounts');
      const c = await openWith({ usersTab: 'cleaners' });

      expect(c.activeTab).toBe('users');
      expect(c.initialUsersTab).toBe('cleaners');
      sessionStorage.removeItem('adminActiveTab');
    });

    it('ignores a sub-tab that is not one', async () => {
      const c = await openWith({ userId: '42', usersTab: 'nonsense' });

      expect(c.activeTab).toBe('users');
      expect(c.initialUsersTab).toBeNull();
    });
  });
});
