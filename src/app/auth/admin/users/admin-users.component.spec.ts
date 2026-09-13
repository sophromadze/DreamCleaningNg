import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { AdminUsersComponent } from './admin-users.component';
import { testProviders } from '../../../../testing/test-providers';

/**
 * ADMIN → USERS: one area, four sub-tabs.
 *
 * These specs pin the two things the requirement is specific about — the NAMES and the ORDER —
 * and the one thing that would otherwise bite every admin at once: the old top-level Cleaners tab
 * still has to resolve, because its key is sitting in everybody's sessionStorage.
 */
describe('AdminUsersComponent', () => {
  let fixture: ComponentFixture<AdminUsersComponent>;
  let component: AdminUsersComponent;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    sessionStorage.clear();

    await TestBed.configureTestingModule({
      imports: [AdminUsersComponent],
      providers: [...testProviders]
    }).compileComponents();

    fixture = TestBed.createComponent(AdminUsersComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  /**
   * The mounted child fires its own list/permission requests. This suite is about the SHELL, so
   * they are drained — but with a SHAPE each caller can actually read: flushing `{}` at a
   * subscriber that reads `response.permissions.canCreate` throws inside the child and takes the
   * whole run down, which is exactly what happened the first time.
   */
  function drainChildRequests(): void {
    for (const request of httpMock.match(() => true)) {
      const url = request.request.url;

      if (url.includes('/admin/permissions')) {
        request.flush({
          role: 'Admin',
          permissions: {
            canView: true, canCreate: true, canUpdate: true,
            canDelete: false, canActivate: true, canDeactivate: true
          }
        });
      } else if (url.includes('/admin/users')) {
        request.flush({ users: [], currentUserRole: 'Admin' });
      } else {
        request.flush([]);
      }
    }
  }

  afterEach(() => {
    drainChildRequests();
    httpMock.verify();
    sessionStorage.clear();
  });

  it('shows exactly four sub-tabs, in the required order', () => {
    expect(component.tabs.map(t => t.label))
      .toEqual(['Customers', 'Cleaners', 'Business Clients', 'Staff']);
  });

  it('opens on Customers', () => {
    fixture.detectChanges();
    expect(component.activeTab).toBe('customers');
  });

  it('renders the four labels in the strip', () => {
    fixture.detectChanges();

    const labels: string[] = Array.from(
      fixture.nativeElement.querySelectorAll('.admin-users-tabs .tab-btn') as NodeListOf<HTMLElement>
    ).map(b => (b.textContent || '').trim());

    expect(labels).toEqual(['Customers', 'Cleaners', 'Business Clients', 'Staff']);
  });

  it('remembers the tab for the session', () => {
    fixture.detectChanges();
    component.setActiveTab('staff');

    expect(sessionStorage.getItem('adminUsersTab')).toBe('staff');
  });

  it('ignores a stale or hand-edited stored tab rather than rendering nothing', () => {
    sessionStorage.setItem('adminUsersTab', 'not-a-tab');
    fixture.detectChanges();

    expect(component.activeTab).toBe('customers');
  });

  it('honours the legacy Cleaners deep link', () => {
    // The old top-level tab's key. It is in bookmarks and in every admin's sessionStorage, so it
    // has to land on Users → Cleaners rather than be discarded.
    fixture.componentRef.setInput('initialTab', 'cleaners');
    fixture.detectChanges();

    expect(component.activeTab).toBe('cleaners');
  });

  it('mounts ONE child at a time', () => {
    fixture.detectChanges();

    // *ngIf rather than [hidden]: several of these fire their own list requests on init, and
    // mounting all four would put four of them on the wire every time Users is opened.
    expect(fixture.nativeElement.querySelector('app-user-management')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-cleaner-accounts')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-commercial-clients')).toBeNull();
  });

  it('puts Business Clients on the COMMERCIAL client component, not the user list', () => {
    fixture.detectChanges();
    component.setActiveTab('business-clients');
    fixture.detectChanges();

    // ContractClient is the source of truth: standalone commercial clients with no website
    // account belong here too, and a User-backed list could not show them.
    expect(fixture.nativeElement.querySelector('app-commercial-clients')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-user-management')).toBeNull();
  });

  it('reuses the existing cleaner-accounts component for Cleaners', () => {
    fixture.detectChanges();
    component.setActiveTab('cleaners');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-cleaner-accounts')).not.toBeNull();
  });
});
