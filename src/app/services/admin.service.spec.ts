import { TestBed } from '@angular/core/testing';

import { AdminService } from './admin.service';

import { testProviders } from '../../testing/test-providers';
import { HttpTestingController } from '@angular/common/http/testing';
import { AuthService } from './auth.service';

describe('AdminService', () => {
  let service: AdminService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [...testProviders],
    });
    service = TestBed.inject(AdminService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});

/**
 * /admin used to fetch the signed-in user's permissions and the full order list twice on every
 * load: the admin shell and the Orders tab asked for permissions on their own, and the global
 * order-reminder feed fetched the list the Orders tab was fetching at the same moment.
 */
describe('AdminService shared start-up requests', () => {
  let service: AdminService;
  let http: HttpTestingController;
  let user: any;

  beforeEach(() => {
    user = { id: 5, role: 'Admin' };
    TestBed.configureTestingModule({
      providers: [...testProviders, { provide: AuthService, useValue: { get currentUserValue() { return user; } } }]
    });
    service = TestBed.inject(AdminService);
    http = TestBed.inject(HttpTestingController);
  });

  it('asks for permissions once per user, however many parts of the page ask', () => {
    const answers: string[] = [];
    service.getUserPermissions().subscribe(p => answers.push(p.role));
    service.getUserPermissions().subscribe(p => answers.push(p.role));
    http.expectOne(r => r.url.endsWith('/admin/permissions')).flush({ role: 'Admin' });
    service.getUserPermissions().subscribe(p => answers.push(p.role));

    http.expectNone(r => r.url.endsWith('/admin/permissions'));
    expect(answers).toEqual(['Admin', 'Admin', 'Admin']);
  });

  it('asks again for a different user, and after a failure', () => {
    service.getUserPermissions().subscribe({ error: () => {} });
    http.expectOne(r => r.url.endsWith('/admin/permissions')).flush('down', { status: 503, statusText: 'Down' });
    service.getUserPermissions().subscribe();
    http.expectOne(r => r.url.endsWith('/admin/permissions')).flush({ role: 'Admin' });

    user = { id: 6, role: 'SuperAdmin' };
    service.getUserPermissions().subscribe();
    http.expectOne(r => r.url.endsWith('/admin/permissions'));
  });

  it('start-up callers share one order-list request; a reload always asks the server', () => {
    service.getAllOrders(false, { reuseMs: 10_000 }).subscribe();
    service.getAllOrders(false, { reuseMs: 10_000 }).subscribe();
    http.expectOne(r => r.url.endsWith('/admin/orders')).flush([]);
    service.getAllOrders(false, { reuseMs: 10_000 }).subscribe();
    http.expectNone(r => r.url.endsWith('/admin/orders'));

    service.getAllOrders().subscribe();
    http.expectOne(r => r.url.endsWith('/admin/orders'));
  });

  it('never hands the hidden-orders view the ordinary list (or the reverse)', () => {
    service.getAllOrders(false, { reuseMs: 10_000 }).subscribe();
    service.getAllOrders(true, { reuseMs: 10_000 }).subscribe();

    expect(http.match(r => r.url.endsWith('/admin/orders')).length).toBe(2);
  });
});
