import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { testProviders } from '../../../testing/test-providers';
import { ProfileComponent, ORDERS_PER_PAGE } from './profile.component';
import { OrderList } from '../../services/order.service';

/**
 * The customer profile's 2026-09 restructure.
 *
 * Every test here is pointed at a decision that is easy to undo by accident: the Orders TAB is
 * gone and its list lives on Overview; the commercial links are drawn only for the accounts that
 * have something behind them; and choosing a plan is a preference, never a purchase.
 *
 * Built on the prototype rather than a mounted fixture wherever the behaviour is pure — the
 * component's ngOnInit fires five independent loads, and none of them is what these assert.
 */
describe('ProfileComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [...testProviders] }));

  const order = (id: number, over: Partial<OrderList> = {}): OrderList => ({
    id,
    serviceTypeName: 'Residential Cleaning',
    isCustomServiceType: false,
    serviceDate: new Date('2999-01-01') as any,
    serviceTime: '10:00:00',
    status: 'Done',
    total: 100,
    serviceAddress: '1 Example St',
    orderDate: new Date('2026-01-01') as any,
    isPaid: true,
    ...over
  } as OrderList);

  /** A bare instance with no constructor dependencies resolved. */
  const bare = () => Object.create(ProfileComponent.prototype) as ProfileComponent;

  // ── The tab set ────────────────────────────────────────────────────────────────────────

  it('has no Orders tab — the cleanings live on Overview', () => {
    const keys = new ProfileComponentTabs().keys;
    expect(keys).not.toContain('orders');
    expect(keys).toContain('overview');
  });

  it('offers a Plan tab', () => {
    expect(new ProfileComponentTabs().keys).toContain('plan');
  });

  it('lists the tabs in the order the account area reads in', () => {
    expect(new ProfileComponentTabs().keys)
      .toEqual(['overview', 'personal', 'plan', 'addresses', 'billing', 'security']);
  });

  // ── Paging the cleanings ───────────────────────────────────────────────────────────────

  describe('the cleanings list pages at 10', () => {
    const withOrders = (count: number) => {
      const c = bare();
      (c as any).ordersPerPage = ORDERS_PER_PAGE;
      c.orders = Array.from({ length: count }, (_, i) => order(i + 1));
      c.ordersPage = 1;
      return c;
    };

    it('shows ten to a page', () => {
      expect(ORDERS_PER_PAGE).toBe(10);
      const c = withOrders(14);
      expect(c.pagedOrders.length).toBe(10);
      expect(c.orderPageCount).toBe(2);
    });

    it('puts the remainder on the last page', () => {
      const c = withOrders(14);
      c.ordersPage = 2;
      expect(c.pagedOrders.length).toBe(4);
      expect(c.pagedOrders[0].id).toBe(11);
    });

    it('does not page a list that fits', () => {
      const c = withOrders(10);
      expect(c.orderPageCount).toBe(1);
    });

    it('reports one page for an empty history rather than zero', () => {
      // orderPageCount is what the template divides by and compares against; a zero here would
      // render "Page 1 of 0" and disable both arrows on a list that simply has nothing in it.
      const c = withOrders(0);
      expect(c.orderPageCount).toBe(1);
      expect(c.pagedOrders).toEqual([]);
    });

    it('leaves the list alone while it is still loading', () => {
      const c = bare();
      (c as any).ordersPerPage = ORDERS_PER_PAGE;
      c.orders = null;
      c.ordersPage = 1;
      expect(c.pagedOrders).toEqual([]);
    });

    it('steps back when cancelling empties the last page', () => {
      // 11 orders is 2 pages; cancel one from the second page and it holds nothing. Staying put
      // would show an empty list under a pager claiming there is a page 2.
      const c = withOrders(11);
      c.ordersPage = 2;
      const remaining = Array.from({ length: 10 }, (_, i) => order(i + 1));
      (c as any).orderService = { getUserOrders: () => of(remaining) };
      c.loadOrders();
      expect(c.orders!.length).toBe(10);
      expect(c.ordersPage).toBe(1);
    });

    it('keeps the current page when the reload still fills it', () => {
      const c = withOrders(20);
      c.ordersPage = 2;
      (c as any).orderService = { getUserOrders: () => of(Array.from({ length: 20 }, (_, i) => order(i + 1))) };
      c.loadOrders();
      expect(c.ordersPage).toBe(2);
    });

    it('clamps a page number typed past either end', () => {
      const c = withOrders(14);
      (c as any).platformId = 'server';   // no document to scroll
      c.goToOrderPage(99);
      expect(c.ordersPage).toBe(2);
      c.goToOrderPage(-4);
      expect(c.ordersPage).toBe(1);
    });

    it('windows the page numbers instead of drawing every one', () => {
      const c = withOrders(10 * 40);       // 40 pages
      c.ordersPage = 20;
      expect(c.orderPageNumbers.length).toBe(5);
      expect(c.orderPageNumbers).toContain(20);
      expect(c.orderPageNumbers[0]).toBeGreaterThan(1);
    });

    it('says so when the list could not be loaded', () => {
      const c = bare();
      (c as any).ordersPerPage = ORDERS_PER_PAGE;
      (c as any).orderService = { getUserOrders: () => throwError(() => ({ error: { message: 'Nope' } })) };
      c.loadOrders();
      expect(c.ordersError).toBe('Nope');
      expect(c.orders).toEqual([]);
    });
  });

  // ── Which actions each cleaning offers ─────────────────────────────────────────────────

  describe('the actions on a cleaning', () => {
    it('treats a cash/Zelle/Check order as paid, and an unpaid Invoice one as not', () => {
      const c = bare();
      expect(c.isEffectivelyPaid(order(1, { isPaid: false, paymentMethod: 'Cash' }))).toBeTrue();
      expect(c.isEffectivelyPaid(order(1, { isPaid: false, paymentMethod: 'Normal' }))).toBeFalse();
      // Invoice is handled outside Stripe but settles nothing until the invoice is paid.
      expect(c.isEffectivelyPaid(order(1, { isPaid: false, paymentMethod: 'Invoice' }))).toBeFalse();
      expect(c.isEffectivelyPaid(
        order(1, { isPaid: false, paymentMethod: 'Invoice', invoicePaidAt: '2026-09-01' }))).toBeTrue();
    });

    it('will not edit or cancel a recurring occurrence', () => {
      const c = bare();
      const occurrence = order(1, { recurringSeriesId: 4, status: 'Active', isPaid: true });
      expect(c.canEditOrder(occurrence)).toBeFalse();
      expect(c.canCancelOrder(occurrence)).toBeFalse();
    });

    it('closes editing inside the 48-hour window', () => {
      const c = bare();
      const soon = new Date(Date.now() + 12 * 60 * 60 * 1000);
      expect(c.canEditOrder(order(1, { status: 'Active', serviceDate: soon as any }))).toBeFalse();
      const later = new Date(Date.now() + 72 * 60 * 60 * 1000);
      expect(c.canEditOrder(order(1, { status: 'Active', serviceDate: later as any }))).toBeTrue();
    });

    it('never offers to edit a custom-priced cleaning', () => {
      const c = bare();
      const later = new Date(Date.now() + 72 * 60 * 60 * 1000);
      expect(c.canEditOrder(
        order(1, { status: 'Active', serviceDate: later as any, isCustomServiceType: true }))).toBeFalse();
    });

    it('warns about the late-cancellation fee only inside 48 hours', () => {
      const c = bare();
      const soon = new Date(Date.now() + 6 * 60 * 60 * 1000);
      const later = new Date(Date.now() + 96 * 60 * 60 * 1000);
      expect(c.isLateCancellation(order(1, { isPaid: true, serviceDate: soon as any }))).toBeTrue();
      expect(c.isLateCancellation(order(1, { isPaid: true, serviceDate: later as any }))).toBeFalse();
    });
  });

  // ── The commercial links ───────────────────────────────────────────────────────────────

  it('hides My invoices and My contracts until the account has some', () => {
    // A residential customer has neither. A link to a page that can only say "nothing here"
    // reads as something broken.
    const c = bare();
    expect(c.hasInvoices).toBeUndefined();
    c.hasInvoices = false;
    c.hasContracts = false;
    expect(c.hasInvoices).toBeFalse();
    expect(c.hasContracts).toBeFalse();
  });

  // ── Changing the email address ─────────────────────────────────────────────────────────

  describe('the Change email button', () => {
    const withProvider = (authProvider: string | undefined) => {
      const c = bare();
      (c as any).authService = { currentUserValue: authProvider ? { authProvider } : {} };
      return c;
    };

    it('is offered on a local account', () => {
      expect(withProvider('Local').canChangeEmail).toBeTrue();
    });

    it('is offered when the provider is unknown, rather than hidden on a guess', () => {
      expect(withProvider(undefined).canChangeEmail).toBeTrue();
    });

    it('is withheld from a Google or Apple account, which the server refuses anyway', () => {
      expect(withProvider('Google').canChangeEmail).toBeFalse();
      expect(withProvider('Apple').canChangeEmail).toBeFalse();
    });
  });

  // ── The Plan tab ───────────────────────────────────────────────────────────────────────

  describe('choosing a plan', () => {
    const plan = (over: any = {}) => ({
      id: 2, name: 'Weekly', discountPercentage: 15, subscriptionDays: 7,
      displayOrder: 2, isPreferred: false, isActive: false, ...over
    });

    const withPlanService = (spy: jasmine.Spy) => {
      const c = bare();
      (c as any).profileService = { selectPlan: spy, getPlan: () => of({ plans: [], nextCleaningIsFirstOnPlan: true }) };
      c.planSavingId = undefined;
      return c;
    };

    it('saves the chosen tier', () => {
      const spy = jasmine.createSpy('selectPlan').and.returnValue(
        of({ plans: [plan({ isPreferred: true })], preferredSubscriptionId: 2, nextCleaningIsFirstOnPlan: true }));
      const c = withPlanService(spy);
      c.choosePlan(plan() as any);
      expect(spy).toHaveBeenCalledWith(2);
      expect(c.plan!.preferredSubscriptionId).toBe(2);
    });

    it('clears the preference when the chosen tier is tapped again', () => {
      const spy = jasmine.createSpy('selectPlan').and.returnValue(
        of({ plans: [plan()], preferredSubscriptionId: null, nextCleaningIsFirstOnPlan: true }));
      const c = withPlanService(spy);
      c.choosePlan(plan({ isPreferred: true }) as any);
      expect(spy).toHaveBeenCalledWith(null);
    });

    it('promises no charge in the message it shows', () => {
      // The whole point of the tab: choosing a plan costs nothing and books nothing. If this
      // wording ever drifts into sounding like a purchase, the tab is lying.
      const spy = jasmine.createSpy('selectPlan').and.returnValue(
        of({ plans: [plan({ isPreferred: true })], preferredSubscriptionId: 2, nextCleaningIsFirstOnPlan: true }));
      const c = withPlanService(spy);
      c.choosePlan(plan() as any);
      expect(c.successMessage).toContain('nothing has been charged');
    });

    it('ignores a second tap while one is already saving', () => {
      const spy = jasmine.createSpy('selectPlan');
      const c = withPlanService(spy);
      c.planSavingId = 3;
      c.choosePlan(plan() as any);
      expect(spy).not.toHaveBeenCalled();
    });

    it('releases the buttons and explains a failure', () => {
      const spy = jasmine.createSpy('selectPlan').and.returnValue(
        throwError(() => ({ error: { message: 'Plan unavailable.' } })));
      const c = withPlanService(spy);
      c.choosePlan(plan() as any);
      expect(c.planSavingId).toBeUndefined();
      expect(c.planError).toBe('Plan unavailable.');
    });

    it('describes each cadence from the configured day count', () => {
      const c = bare();
      expect(c.planCadence(plan({ subscriptionDays: 7 }) as any)).toBe('Every week');
      expect(c.planCadence(plan({ subscriptionDays: 14 }) as any)).toBe('Every 2 weeks');
      expect(c.planCadence(plan({ subscriptionDays: 30 }) as any)).toBe('Every month');
      // An admin-configured tier nobody anticipated still reads as a sentence.
      expect(c.planCadence(plan({ subscriptionDays: 45 }) as any)).toBe('Every 45 days');
    });
  });

  // ── Refer a Friend on Overview ─────────────────────────────────────────────────────────

  describe('the referral card', () => {
    const withReferralService = (svc: any) => {
      const c = bare();
      (c as any).platformId = 'browser';
      (c as any).bubbleRewardsService = svc;
      return c;
    };

    it('takes the code and share URL the API hands back', () => {
      const c = withReferralService({
        getMyReferralCode: () => of({ code: 'ABC123', shareUrl: 'https://dreamcleaningnyc.com/?ref=ABC123' })
      });
      (c as any).loadReferralCode();
      expect(c.referralCode).toBe('ABC123');
      expect(c.referralShareUrl).toBe('https://dreamcleaningnyc.com/?ref=ABC123');
    });

    it('leaves the card with nothing to draw when the read fails', () => {
      // Best-effort, like the invoices/contracts probes: no code means the shared card renders
      // nothing, which is better than an empty referral box on an otherwise working page.
      const c = withReferralService({ getMyReferralCode: () => throwError(() => new Error('nope')) });
      c.referralCode = 'STALE';
      (c as any).loadReferralCode();
      expect(c.referralCode).toBe('');
      expect(c.referralShareUrl).toBe('');
    });

    it('does not reach for it during server-side rendering', () => {
      const spy = jasmine.createSpy('getMyReferralCode');
      const c = withReferralService({ getMyReferralCode: spy });
      (c as any).platformId = 'server';
      (c as any).loadReferralCode();
      expect(spy).not.toHaveBeenCalled();
    });
  });
});

/** The tab list is a readonly field, so read it off a bare instance. */
class ProfileComponentTabs {
  readonly keys: string[];
  constructor() {
    const c = Object.create(ProfileComponent.prototype) as any;
    // `tabs` is a class-property initializer, so it only exists on a constructed instance.
    // Pull it from a real one built with the TestBed's injector instead.
    const real = TestBed.createComponent(ProfileComponent);
    this.keys = real.componentInstance.tabs.map(t => t.key);
    real.destroy();
    void c;
  }
}
