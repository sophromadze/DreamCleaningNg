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

/**
 * THE HISTORY TAB IS A RECORD, NOT A STATISTIC (2026-10).
 *
 * `GET admin/users/{id}/orders` used to drop cancelled orders server-side, so an admin opening a
 * customer who had cancelled twice saw a clean history. It now returns every order, and this tab
 * shows each one with the Orders tab's own pill. What must NOT move is the panel's derived
 * totals: they still leave cancelled orders out, exactly as before.
 */
describe('UserManagementComponent — History lists cancelled and refunded orders', () => {
  let fixture: ComponentFixture<UserManagementComponent>;
  let component: UserManagementComponent;
  let httpMock: HttpTestingController;

  const CUSTOMER = {
    id: 55, firstName: 'Casey', lastName: 'Client', email: 'casey@example.invalid',
    role: 'Customer', isActive: true, createdAt: '2025-03-04T12:00:00'
  };

  const order = (id: number, status: string, extra: Record<string, unknown> = {}) => ({
    id, status, total: 100 + id, serviceTypeName: 'Residential Cleaning', isCustomServiceType: false,
    serviceDate: `2026-09-0${id}`, serviceTime: '10:00', serviceAddress: '1 Main St',
    orderDate: `2026-09-0${id}T10:00:00`, ...extra
  });

  let PROFILE_FAILS = false;

  const ORDERS = [
    order(1, 'Done'),
    order(2, 'Cancelled'),
    order(3, 'Refunded', { totalRefundedAmount: 103 }),
    // Cancelled with the $70 fee kept: still Cancelled in the database, RefundH on screen.
    order(4, 'Cancelled', { totalRefundedAmount: 34 }),
  ];

  beforeEach(async () => {
    sessionStorage.clear();
    PROFILE_FAILS = false;
    await TestBed.configureTestingModule({
      imports: [UserManagementComponent],
      providers: [...testProviders]
    }).compileComponents();

    fixture = TestBed.createComponent(UserManagementComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

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
        request.flush({ users: [CUSTOMER], currentUserRole: 'Admin' });
      } else if (url.endsWith('/users/55/orders')) {
        request.flush(ORDERS);
      } else if (url.endsWith('/users/55/profile')) {
        // The server's figures: order 1 is the only real job; order 4's part refund is irrelevant
        // because the order is cancelled. PROFILE_FAILS simulates a failed statistics read.
        if (PROFILE_FAILS) request.flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });
        else request.flush({ ...CUSTOMER, totalOrders: 1, totalSpent: 659.70 });
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

  function openHistory(): HTMLElement {
    fixture.componentRef.setInput('embeddedUserId', 55);
    fixture.detectChanges();
    drain();
    tick(200);
    fixture.detectChanges();
    drain();
    fixture.detectChanges();
    component.setDetailTab('history');
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows every order with the Orders tab pill', fakeAsync(() => {
    const el = openHistory();

    const rows = Array.from(el.querySelectorAll('.history-row'));
    expect(rows.length).toBe(4);

    const pills = rows.map(r => r.querySelector('.status-badge') as HTMLElement);
    expect(pills.map(p => p.textContent!.trim())).toEqual(['Done', 'Cancel', 'Refund', 'RefundH']);
    expect(pills[1].classList).toContain('status-cancelled');
    expect(pills[2].classList).toContain('status-refunded');
    expect(pills[3].classList).toContain('status-refund-partial');
    // RefundH hides the stored status, so the tooltip names it.
    expect(pills[3].title).toContain('Cancelled');

    // Cancelled and refunded rows are dimmed; the part-refunded one is still a cancellation.
    expect(rows.map(r => r.classList.contains('cancelled'))).toEqual([false, true, true, true]);

    tick(500);
  }));

  const historyTab = (el: HTMLElement) => Array.from(el.querySelectorAll('.detail-tabs .tab'))
    .find(t => t.textContent!.includes('History')) as HTMLElement;
  const stat = (el: HTMLElement, label: string) => Array.from(el.querySelectorAll('.stat'))
    .find(s => s.querySelector('.stat-label')!.textContent!.trim() === label)!
    .querySelector('.stat-value')!.textContent!.trim();

  it('counts only real orders on the History tab, with no cancelled/refunded note (2026-10)', fakeAsync(() => {
    const el = openHistory();

    const tab = historyTab(el);
    expect(tab.querySelector('.badge')!.textContent!.trim()).toBe('1');
    expect(tab.textContent).not.toContain('cancelled');
    expect(tab.textContent).not.toContain('refunded');
    // ...while the list itself still shows all four.
    expect(el.querySelectorAll('.history-row').length).toBe(4);

    tick(500);
  }));

  it('shows Total Jobs and Total Spent from the server, which excludes cancelled and refunded money', fakeAsync(() => {
    const el = openHistory();
    component.setDetailTab('details');
    fixture.detectChanges();

    expect(stat(el, 'Total Jobs')).toBe('1');
    expect(stat(el, 'Total Spent')).toContain('659.70');

    tick(500);
  }));

  it('still counts real orders when the statistics read fails', fakeAsync(() => {
    PROFILE_FAILS = true;
    const el = openHistory();
    component.setDetailTab('details');
    fixture.detectChanges();

    expect(stat(el, 'Total Jobs')).toBe('1');

    tick(500);
  }));

  it('offers Recreate on cancelled and refunded rows too', fakeAsync(() => {
    const el = openHistory();
    expect(el.querySelectorAll('.history-row .history-recreate').length).toBe(4);
    tick(500);
  }));

  it('no longer counts the refunded order in the totals (2026-10)', fakeAsync(() => {
    openHistory();
    // Only the Done order is a real job; the refunded $103 was not spent. The browser used to
    // add Done + Refunded itself (2 jobs, $204) - the figures now come from the server.
    expect(component.selectedUser!.totalOrders).toBe(1);
    expect(component.selectedUser!.totalSpent).toBe(659.70);
    tick(500);
  }));
});

describe('UserManagementComponent — points taken back (2026-10)', () => {
  it('lists only refund/cancellation reversals, with their full admin record', () => {
    const c = Object.create(UserManagementComponent.prototype) as UserManagementComponent;
    (c as any).userRewardsSummary = {
      pointsHistory: [
        { points: 120, type: 'OrderEarned', description: 'earned', createdAt: '2026-09-01' },
        { points: -120, type: 'RefundReversal', description: 'Refund/cancellation of order #10 (full refund ...)', createdAt: '2026-10-05' },
        { points: -60, type: 'CancellationCorrection', description: 'Refund/cancellation of order #12 (cancelled ...)', createdAt: '2026-10-06' },
        { points: 0, type: 'RefundCorrection', description: 'Refund/cancellation of order #20 (... 0 of 90 ...)', createdAt: '2026-10-06' },
        { points: -50, type: 'Redemption', description: 'redeemed', createdAt: '2026-09-02' }
      ]
    };
    expect(c.pointsReversals.map(h => h.points)).toEqual([-120, -60, 0]);
    expect(c.pointsReversals[0].description).toContain('order #10');
  });
});
