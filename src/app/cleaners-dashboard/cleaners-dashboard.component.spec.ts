import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

import { CleanersDashboardComponent } from './cleaners-dashboard.component';
import { testProviders } from '../../testing/test-providers';
import { AuthService } from '../services/auth.service';

/**
 * Cleaners dashboard.
 *
 * The main job of this spec is to COMPILE the template — it is one of the larger ones in the app
 * and had no coverage at all, so a broken binding shipped silently. Beyond that it pins the
 * payment fields, which the Outgoing Payments page sends real money against, and the two-tab split
 * that brought "All Cleanings" onto this page.
 */
describe('CleanersDashboardComponent', () => {
  let fixture: ComponentFixture<CleanersDashboardComponent>;
  let component: CleanersDashboardComponent;
  let httpMock: HttpTestingController;
  let queryParams$: BehaviorSubject<any>;
  let navigate: jasmine.Spy;

  /** Signs the viewer in as `role` before the component initializes. */
  const asRole = (role: string) => {
    spyOnProperty(TestBed.inject(AuthService), 'currentUserValue', 'get')
      .and.returnValue({ role } as any);
  };

  beforeEach(async () => {
    queryParams$ = new BehaviorSubject<any>(convertToParamMap({}));

    await TestBed.configureTestingModule({
      imports: [CleanersDashboardComponent],
      providers: [
        ...testProviders,
        { provide: ActivatedRoute, useValue: { queryParamMap: queryParams$.asObservable(), snapshot: {} } }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(CleanersDashboardComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
  });

  afterEach(() => {
    // The dashboard fires its own loads on init; this spec is not asserting on them.
    httpMock.match(() => true).forEach(r => r.flush([]));
  });

  it('creates and renders', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  /**
   * TWO HALVES OF ONE SUBJECT (2026-09): the Dashboard tab is the PEOPLE, the Portal tab is every
   * CLEANING. They used to be two header links, which meant two doors into the cleaners section.
   */
  describe('the Dashboard / Portal tabs', () => {
    it('opens on the Dashboard, and offers the Portal to an Admin', () => {
      asRole('Admin');
      fixture.detectChanges();

      expect(component.activeTab).toBe('dashboard');
      expect(component.canSeePortal).toBeTrue();
    });

    it('offers it to a SuperAdmin too', () => {
      asRole('SuperAdmin');
      fixture.detectChanges();
      expect(component.canSeePortal).toBeTrue();
    });

    /**
     * A Moderator reaches this page but not the schedule — the endpoints behind the Portal tab are
     * Admin + SuperAdmin. They get no tab strip rather than a tab that 403s.
     */
    it('hides the Portal from a Moderator, and refuses to switch to it', () => {
      asRole('Moderator');
      fixture.detectChanges();

      expect(component.canSeePortal).toBeFalse();

      component.setTab('portal');
      expect(component.activeTab).toBe('dashboard');
      expect(navigate).not.toHaveBeenCalled();
    });

    /** `?tab=portal` is where an old /cleaner-portal bookmark is forwarded — see cleanerPortalGuard. */
    it('lands on the Portal tab when the URL asks for it', () => {
      asRole('Admin');
      queryParams$.next(convertToParamMap({ tab: 'portal' }));
      fixture.detectChanges();

      expect(component.activeTab).toBe('portal');
    });

    it('ignores that param for somebody who may not read it', () => {
      asRole('Moderator');
      queryParams$.next(convertToParamMap({ tab: 'portal' }));
      fixture.detectChanges();

      expect(component.activeTab).toBe('dashboard');
    });

    /**
     * The tab is written to the URL, not just to a field: it survives a reload and is linkable,
     * which a working calendar earns. The query-param subscription is the ONE thing that moves
     * `activeTab`, so there is a single path in.
     */
    it('switches by writing the URL, and clears the param going back', () => {
      asRole('Admin');
      fixture.detectChanges();

      component.setTab('portal');
      expect(navigate).toHaveBeenCalled();
      expect(navigate.calls.mostRecent().args[1].queryParams).toEqual({ tab: 'portal' });

      queryParams$.next(convertToParamMap({ tab: 'portal' }));
      component.setTab('dashboard');
      expect(navigate.calls.mostRecent().args[1].queryParams).toEqual({ tab: null });
    });

    it('closes what was open on the dashboard on the way out', () => {
      asRole('Admin');
      fixture.detectChanges();

      component.selectedDetail = { id: 4, firstName: 'Nino' } as any;
      component.formOpen = true;

      component.setTab('portal');

      // A detail panel or a half-filled form still sitting there on the way back is state nobody
      // asked to keep.
      expect(component.selectedDetail).toBeNull();
      expect(component.formOpen).toBeFalse();
    });
  });

  /**
   * A cleaner who has a login account has their email SET FROM that account: linking on the admin
   * Cleaners tab copies the address across so the assignment mail reaches whoever reads the
   * portal. Editing it here afterwards would break that silently - the FK keeps the portal
   * working, only the mail goes astray - so the field is read-only and the server refuses the
   * write. The flag is the SERVER's answer and is never re-derived here.
   */
  describe('the email of a cleaner with a login account', () => {
    const detail = (over: any = {}) => ({
      id: 4, firstName: 'Nino', lastName: 'Beridze', email: 'nino@example.com',
      isActive: true, createdAt: '2026-01-01T00:00:00Z', notes: [], assignedOrders: [],
      vacations: [], busyDaysOfWeek: [], ...over
    }) as any;

    it('locks the field when the server says the account owns the address', () => {
      component.openEdit(detail({
        linkedUserId: 11,
        linkedAccountName: 'Nino B',
        linkedAccountEmail: 'nino@example.com',
        isEmailManagedByAccount: true
      }));

      expect(component.emailLockedByAccount).toBeTrue();
      expect(component.lockedAccountEmail).toBe('nino@example.com');
      // The value still round-trips - the server compares it against what it holds, so a blanked
      // payload would read as an attempt to clear the address.
      expect(component.formModel.email).toBe('nino@example.com');
    });

    it('leaves it editable for a cleaner with no account', () => {
      component.openEdit(detail());
      expect(component.emailLockedByAccount).toBeFalse();
    });

    /**
     * A linked account with no sendable address never had an email copied onto the record, so that
     * record's email is its own contact detail - locking it would strand the only address anybody
     * has. The server decides this; the component must not second-guess the flag from linkedUserId.
     */
    it('leaves it editable when the linked account has no email', () => {
      component.openEdit(detail({
        linkedUserId: 11, linkedAccountEmail: null, isEmailManagedByAccount: false
      }));
      expect(component.emailLockedByAccount).toBeFalse();
    });

    it('never carries the lock into another form', () => {
      component.openEdit(detail({ linkedUserId: 11, linkedAccountEmail: 'a@b.com', isEmailManagedByAccount: true }));
      expect(component.emailLockedByAccount).toBeTrue();

      component.closeForm();
      expect(component.emailLockedByAccount).toBeFalse();

      // A brand-new cleaner has no account at all.
      component.openEdit(detail({ linkedUserId: 11, linkedAccountEmail: 'a@b.com', isEmailManagedByAccount: true }));
      component.openCreate();
      expect(component.emailLockedByAccount).toBeFalse();
      expect(component.lockedAccountEmail).toBeNull();
    });

    it('names who signs in, however much of the account we know', () => {
      expect(component.linkedAccountLabel(detail({ linkedUserId: 11, linkedAccountName: 'Nino B', linkedAccountEmail: 'n@x.com' })))
        .toBe('Nino B (n@x.com)');
      expect(component.linkedAccountLabel(detail({ linkedUserId: 11, linkedAccountEmail: 'n@x.com' })))
        .toBe('n@x.com');
      expect(component.linkedAccountLabel(detail({ linkedUserId: 11 }))).toBe('a login account');
      // No account: the row is not rendered at all.
      expect(component.linkedAccountLabel(detail())).toBe('');
    });
  });

  describe('the payment fields', () => {
    it('starts blank — a cleaner with no recorded payout method is normal', () => {
      expect(component.formModel.paymentMethod).toBeNull();
      expect(component.formModel.paymentDetails).toBeNull();
    });

    /**
     * "Zelle number or email" and "Check payable to" are different enough that one generic
     * prompt would read as a mistake.
     */
    it('labels the details box after the chosen method', () => {
      expect(component.paymentDetailsLabel).toBe('Payment details');

      component.formModel.paymentMethod = 'Zelle';
      expect(component.paymentDetailsLabel).toBe('Zelle number or email');

      component.formModel.paymentMethod = 'Check';
      expect(component.paymentDetailsLabel).toBe('Check payable to');
    });

    it('summarises method and destination together for the detail panel', () => {
      expect(component.paymentSummary({ paymentMethod: 'Zelle', paymentDetails: '6465550134' }))
        .toBe('Zelle · 6465550134');
      expect(component.paymentSummary({ paymentMethod: 'Cash', paymentDetails: null })).toBe('Cash');
      expect(component.paymentSummary({ paymentMethod: null, paymentDetails: null })).toBe('');
    });

    /** The destination is pasted into a banking app, so the method must not travel with it. */
    it('copies the destination alone, without the method prefix', async () => {
      const writeText = jasmine.createSpy('writeText').and.returnValue(Promise.resolve());
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

      component.formModel.paymentMethod = 'Zelle';
      component.formModel.paymentDetails = '6465550134';
      component.copyFormPaymentDetails();
      await Promise.resolve();

      expect(writeText).toHaveBeenCalledWith('6465550134');
      expect(component.paymentDetailsCopied).toBe(true);
    });

    it('does nothing when the box is empty', () => {
      const writeText = jasmine.createSpy('writeText');
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

      component.formModel.paymentDetails = null;
      component.copyFormPaymentDetails();

      expect(writeText).not.toHaveBeenCalled();
      expect(component.paymentDetailsCopied).toBe(false);
    });
  });
});
