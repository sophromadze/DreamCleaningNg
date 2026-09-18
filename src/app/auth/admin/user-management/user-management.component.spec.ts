import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { UserManagementComponent } from './user-management.component';
import { testProviders } from '../../../../testing/test-providers';

/**
 * PANEL-ONLY MODE (2026-09).
 *
 * Business Clients shows the customer behind a linked client as a second tab of its own panel,
 * and what it shows there has to be the REAL record — every tab, every action, the same
 * permission gates. So it mounts this component with `embeddedUserId` rather than lifting the
 * panel's 850 lines of markup into a shared child: the panel's styles live in this component's
 * stylesheet, which Cleaners and Business Clients both list FIRST in their own styleUrls, so an
 * extraction would take those rules away from two other panels that render the same classes.
 *
 * What is pinned here is the boundary of the mode — it decides what is DRAWN and nothing else.
 */
describe('UserManagementComponent — panel-only mode', () => {
  let fixture: ComponentFixture<UserManagementComponent>;
  let component: UserManagementComponent;
  let httpMock: HttpTestingController;

  const CUSTOMER = {
    id: 55, firstName: 'Casey', lastName: 'Client', email: 'casey@chicktastic.invalid',
    phone: '7185550100', role: 'Customer', isActive: true, isBusiness: true,
    hasActiveBusinessClient: true, createdAt: '2025-03-04T12:00:00'
  };

  const OTHER = {
    id: 8, firstName: 'Robin', lastName: 'Regular', email: 'robin@example.invalid',
    role: 'Customer', isActive: true
  };

  beforeEach(async () => {
    sessionStorage.clear();

    await TestBed.configureTestingModule({
      imports: [UserManagementComponent],
      providers: [...testProviders]
    }).compileComponents();

    fixture = TestBed.createComponent(UserManagementComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  /**
   * The panel fires a request per section once it opens. They are incidental to everything these
   * specs assert, but each needs a shape its own subscriber can read — flushing `{}` at one that
   * reads `response.permissions.canCreate` throws inside the component and takes the run down.
   */
  function drain(): void {
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
      } else if (url.endsWith('/admin/users')) {
        request.flush({ users: [CUSTOMER, OTHER], currentUserRole: 'Admin' });
      } else {
        request.flush([]);
      }
    }
  }

  afterEach(() => {
    drain();
    httpMock.verify();
    sessionStorage.clear();
  });

  it('draws the panel and none of the list', fakeAsync(() => {
    fixture.componentRef.setInput('embeddedUserId', 55);
    fixture.detectChanges();
    drain();
    tick(200);
    fixture.detectChanges();
    drain();

    // The host has its own list; a second one under it is not a smaller version of this screen,
    // it is two lists of different things on top of each other.
    expect(fixture.nativeElement.querySelector('.user-management-section')).toBeNull();
    expect(fixture.nativeElement.querySelector('.detail-panel.open')).not.toBeNull();
    expect(component.selectedUser?.id).toBe(55);

    tick(500);
  }));

  it('opens through the same path the ?userId= deep link uses', () => {
    fixture.componentRef.setInput('embeddedUserId', 55);
    fixture.detectChanges();

    // Not a second way for a record to arrive in the panel — the deep-link seat, taken.
    expect(component.openUserId).toBe(55);
    expect(component.isEmbedded).toBeTrue();

    drain();
  });

  it('leaves the click-away overlay to the host', fakeAsync(() => {
    fixture.componentRef.setInput('embeddedUserId', 55);
    fixture.detectChanges();
    drain();
    tick(200);
    fixture.detectChanges();
    drain();

    // The host already has one up for the panel this one replaced; a second would sit on top of
    // the first and swallow the click.
    expect(fixture.nativeElement.querySelector('.detail-overlay')).toBeNull();

    tick(500);
  }));

  it('tells the host when it is closed from the inside', () => {
    fixture.componentRef.setInput('embeddedUserId', 55);
    let closed = 0;
    component.closed.subscribe(() => closed++);
    fixture.detectChanges();

    component.dismissDetailPanel();

    expect(closed).toBe(1);
    expect(component.selectedUser).toBeNull();

    drain();
  });

  it('does not report a reload as a close', () => {
    // `loadUsers` empties the panel on every refresh. Sharing a handler with the ✕ would tell an
    // embedding host to unmount on this component's very first load.
    fixture.componentRef.setInput('embeddedUserId', 55);
    let closed = 0;
    component.closed.subscribe(() => closed++);

    fixture.detectChanges();
    drain();

    expect(closed).toBe(0);
  });

  it('still lists when no account is named — the Users tab is unchanged', () => {
    fixture.detectChanges();
    drain();

    expect(component.isEmbedded).toBeFalse();
    expect(fixture.nativeElement.querySelector('.user-management-section')).not.toBeNull();
  });
});

/**
 * THE CTO'S SUPERADMIN ROLE IS LOCKED FOR EVERYONE.
 *
 * Mirrors CtoRoleLockPolicy on the server, which refuses the change on both role-change endpoints
 * whatever this component decides. What is pinned here is that the lock is checked BEFORE the role
 * hierarchy — a SuperAdmin passes every hierarchy test, so a lock evaluated after them would never
 * fire for the very caller it exists to stop.
 */
describe('UserManagementComponent — the CTO role lock', () => {
  let fixture: ComponentFixture<UserManagementComponent>;
  let component: UserManagementComponent;
  let httpMock: HttpTestingController;

  const CTO = { id: 3, firstName: 'Nia', lastName: 'Officer', role: 'SuperAdmin', orgTitle: 'CTO' };
  const CEO = { id: 4, firstName: 'Sam', lastName: 'Chief', role: 'SuperAdmin', orgTitle: 'CEO' };
  const PLAIN_SUPERADMIN = { id: 5, firstName: 'Lee', lastName: 'Plain', role: 'SuperAdmin', orgTitle: 'None' };

  beforeEach(async () => {
    sessionStorage.clear();

    await TestBed.configureTestingModule({
      imports: [UserManagementComponent],
      providers: [...testProviders]
    }).compileComponents();

    fixture = TestBed.createComponent(UserManagementComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);

    // These are pure predicates on the component; detectChanges would put the panel's whole
    // request fan-out on the wire for nothing.
    component.currentUserRole = 'SuperAdmin';
    component.canUpdate = true;
  });

  afterEach(() => {
    httpMock.verify();
    sessionStorage.clear();
  });

  it('refuses a SuperAdmin — the caller the lock exists for', () => {
    expect(component.canModifyUserRole(CTO)).toBeFalse();
    expect(component.canChangeUserRole(CTO as any, 'Admin')).toBeFalse();
  });

  it('says why, instead of leaving the panel with no Role control at all', () => {
    expect(component.getRoleButtonTooltip(CTO)).toBe(component.ctoRoleLockReason);
  });

  it('locks on the TITLE, not on being a SuperAdmin', () => {
    // A CEO and an untitled SuperAdmin stay exactly as demotable as they were. Only CTO carries
    // the lock, because only CTO governs who may hold a title at all.
    expect(component.canModifyUserRole(CEO)).toBeTrue();
    expect(component.canModifyUserRole(PLAIN_SUPERADMIN)).toBeTrue();
  });

  it('leaves a CTO on the Admin role alone', () => {
    // There is no SuperAdmin to protect there, and locking an ordinary Admin's role would be a
    // surprise nobody asked for.
    expect(component.isCtoRoleLocked({ role: 'Admin', orgTitle: 'CTO' } as any)).toBeFalse();
  });

  it('drops the lock the moment the title is cleared', () => {
    // The only way out, and it is the officer title rather than an override on the role itself.
    expect(component.isCtoRoleLocked({ ...CTO, orgTitle: 'None' } as any)).toBeFalse();
  });
});
