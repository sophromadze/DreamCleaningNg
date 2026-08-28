import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';

import { OutgoingPaymentsComponent } from './outgoing-payments.component';
import {
  OutgoingPaymentCleaner,
  OutgoingPaymentList,
  OutgoingPaymentOrder
} from '../../../services/outgoing-payment.service';

/**
 * Outgoing Payments page.
 *
 * The behaviours pinned here are the ones that would cost real money if they regressed: a paid
 * line must be frozen, "reset to automatic" must CLEAR the overrides rather than re-send the
 * current values, the panel must survive the reload that follows a payment, and the page must
 * never recompute a figure the server sent.
 */
describe('OutgoingPaymentsComponent', () => {
  let fixture: ComponentFixture<OutgoingPaymentsComponent>;
  let component: OutgoingPaymentsComponent;
  let httpMock: HttpTestingController;

  const cleaner = (over: Partial<OutgoingPaymentCleaner> = {}): OutgoingPaymentCleaner => ({
    orderCleanerId: 1,
    cleanerId: 11,
    firstName: 'Irma',
    lastName: 'Xaratishvili',
    paymentMethod: 'Zelle',
    paymentDetails: '6465550134',
    billableMinutes: 270,
    hoursOverridden: false,
    hourlyRate: 21,
    rateOverridden: false,
    rateDiffersFromDefault: false,
    salary: 94.5,
    tips: 0,
    payout: 94.5,
    isPaid: false,
    ...over
  });

  const order = (over: Partial<OutgoingPaymentOrder> = {}): OutgoingPaymentOrder => ({
    orderId: 501,
    serviceTypeName: 'Residential Cleaning',
    isCustomServiceType: false,
    rawServiceTypeName: 'Residential Cleaning',
    customServiceDisplayName: null,
    isDeepCleaning: false,
    serviceDate: '2026-08-24T00:00:00',
    serviceTime: '10:00',
    status: 'Done',
    paymentMethod: 'Normal',
    isPaidByCustomer: true,
    customerName: 'Jane Doe',
    serviceAddress: '1 Main St',
    city: 'Brooklyn',
    subTotal: 537,
    tax: 42.89,
    totalWithoutTips: 579.89,
    tips: 0,
    total: 579.89,
    totalDuration: 540,
    automaticMinutesPerCleaner: 270,
    maidsCount: 2,
    orderHourlyRate: 21,
    expectedHourlyRate: 21,
    totalSalary: 189,
    totalPayout: 189,
    cleaners: [cleaner(), cleaner({ orderCleanerId: 2, cleanerId: 12, firstName: 'Maia', lastName: 'Niauri' })],
    warnings: [],
    isFullyPaid: false,
    isPartiallyPaid: false,
    ...over
  });

  const list = (orders: OutgoingPaymentOrder[], totalCount?: number): OutgoingPaymentList => ({
    orders,
    summary: {
      orderCount: orders.length,
      cleanerLineCount: orders.reduce((n, o) => n + o.cleaners.length, 0),
      totalSalary: 189,
      totalTips: 0,
      totalPayout: 189,
      unpaidPayout: 189,
      paidPayout: 0,
      unpaidCleanerCount: 2,
      ordersWithWarnings: orders.filter(o => o.warnings.length > 0).length
    },
    totalCount: totalCount ?? orders.length,
    page: 1,
    pageSize: 20
  });

  /** Answers the initial load (and any reload the action under test triggers). */
  function flushLoad(payload: OutgoingPaymentList): void {
    const requests = httpMock.match(r => r.method === 'GET' && r.url.includes('/outgoing-payments'));
    requests.forEach(r => r.flush(payload));
  }

  /** Loads the page with the given orders and renders it. */
  function render(orders: OutgoingPaymentOrder[] = [order()]): void {
    fixture.detectChanges();
    flushLoad(list(orders));
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OutgoingPaymentsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])]
    }).compileComponents();

    fixture = TestBed.createComponent(OutgoingPaymentsComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('renders the month\'s finished jobs as compact rows', () => {
    render();

    const rows = fixture.nativeElement.querySelectorAll('table.data-table tbody tr');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('501');
  });

  it('asks for 20 a page, matching the Orders tab', () => {
    fixture.detectChanges();
    const req = httpMock.expectOne(r => r.method === 'GET');
    expect(req.request.params.get('pageSize')).toBe('20');
    req.flush(list([]));
  });

  describe('the slide-in panel', () => {
    beforeEach(() => render());

    it('stays closed until a row is clicked', () => {
      expect(component.selectedOrder).toBeNull();
      expect(fixture.nativeElement.querySelector('.order-detail-panel.open')).toBeNull();
    });

    it('opens on the clicked order and shows the full breakdown', () => {
      fixture.nativeElement.querySelector('table.data-table tbody tr').click();
      fixture.detectChanges();

      expect(component.selectedOrderId).toBe(501);
      const panel = fixture.nativeElement.querySelector('.order-detail-panel.open');
      expect(panel).not.toBeNull();
      // The per-cleaner working exists only in the panel, never in the row.
      expect(panel.textContent).toContain('$21 × 4.50 = $94.50');
    });

    /**
     * A write reloads the list, and under the Unpaid filter the order being paid legitimately
     * drops out of it. The panel holds its own copy so it cannot be slammed shut mid-job.
     */
    it('keeps the panel open on the refreshed order after a write', () => {
      component.openPanel(component.data!.orders[0]);
      const o = component.selectedOrder!;

      component.openPayCleaner(o, o.cleaners[0]);
      component.confirmPay();

      const paid = order({
        cleaners: [cleaner({ isPaid: true }), cleaner({ orderCleanerId: 2, cleanerId: 12 })],
        isPartiallyPaid: true
      });
      httpMock.expectOne(r => r.method === 'POST').flush(paid);
      // The reload comes back with the order filtered out of the list entirely.
      flushLoad(list([]));

      expect(component.selectedOrderId).toBe(501);
      expect(component.selectedOrder!.cleaners[0].isPaid).toBe(true);
    });
  });

  describe('the payment status pill', () => {
    it('reads Unpaid in amber — outstanding work, not an error', () => {
      const o = order();
      expect(component.payStatusLabel(o)).toBe('Unpaid');
      expect(component.payStatusClass(o)).toBe('status-pending');
      expect(component.payStatusTitle(o)).toBe('2 of 2 cleaner(s) still to pay');
    });

    it('reads Part paid when some but not all cleaners are settled', () => {
      const o = order({
        isPartiallyPaid: true,
        cleaners: [cleaner({ isPaid: true }), cleaner({ orderCleanerId: 2 })]
      });
      expect(component.payStatusLabel(o)).toBe('Part paid');
      expect(component.payStatusClass(o)).toBe('status-active');
    });

    it('reads Paid once everybody is settled', () => {
      const o = order({ isFullyPaid: true, cleaners: [cleaner({ isPaid: true })] });
      expect(component.payStatusLabel(o)).toBe('Paid');
      expect(component.payStatusClass(o)).toBe('status-done');
    });

    it('says so plainly when nobody is assigned', () => {
      expect(component.payStatusLabel(order({ cleaners: [] }))).toBe('No cleaners');
    });
  });

  describe('the order hourly rate', () => {
    beforeEach(() => render());

    it('seeds the editor with the order rate in force', () => {
      component.startEditOrderRate(component.data!.orders[0]);
      expect(component.editingOrderRate).toBe(true);
      expect(component.orderRateInput).toBe(21);
    });

    it('writes the new rate through to the order', () => {
      const o = component.data!.orders[0];
      component.startEditOrderRate(o);
      component.orderRateInput = 25;
      component.saveOrderRate(o);

      const req = httpMock.expectOne(r => r.method === 'PUT' && r.url.endsWith('/hourly-rate'));
      expect(req.request.body).toEqual({ hourlyRate: 25 });

      req.flush(order({ orderHourlyRate: 25, totalSalary: 225 }));
      flushLoad(list([order({ orderHourlyRate: 25 })]));

      expect(component.editingOrderRate).toBe(false);
    });

    it('rejects a negative rate before it reaches the server', () => {
      const o = component.data!.orders[0];
      component.startEditOrderRate(o);
      component.orderRateInput = -1;
      component.saveOrderRate(o);

      httpMock.expectNone(r => r.method === 'PUT');
      expect(component.error).toContain('zero or more');
    });

    /**
     * The hint has to be honest about reach: a cleaner carrying their own rate is deliberately
     * NOT moved by a change to the order's default.
     */
    it('counts how many cleaners the order rate actually moves', () => {
      const o = order({
        cleaners: [cleaner(), cleaner({ orderCleanerId: 2, rateOverridden: true, hourlyRate: 25 })]
      });

      expect(component.cleanersOnOrderRate(o)).toBe(1);
      expect(component.cleanersWithOwnRate(o)).toBe(1);
    });
  });

  describe('the service type column', () => {
    it('shortens residential to Regular or Deep, like the Orders tab', () => {
      expect(component.serviceTypeShort(order())).toBe('Regular');
      expect(component.serviceTypeShort(order({ isDeepCleaning: true }))).toBe('Deep');
    });

    it('drops the word Cleaning and collapses the long category names', () => {
      expect(component.serviceTypeShort(order({ rawServiceTypeName: 'Move In/Out Cleaning' })))
        .toBe('Move In/Out');
      expect(component.serviceTypeShort(order({ rawServiceTypeName: 'Heavy Conditional Cleaning' })))
        .toBe('Heavy');
      expect(component.serviceTypeShort(order({ rawServiceTypeName: 'Post Construction Cleaning' })))
        .toBe('Construction');
      expect(component.serviceTypeShort(order({ rawServiceTypeName: 'Office Cleaning' })))
        .toBe('Office');
    });

    it('shows a custom order\'s own label bare', () => {
      const o = order({
        isCustomServiceType: true,
        rawServiceTypeName: 'Pre-Arranged Cleaning',
        customServiceDisplayName: 'Deep'
      });
      expect(component.serviceTypeShort(o)).toBe('Deep');
    });

    it('falls back to Arranged for a legacy custom order with no label', () => {
      const o = order({
        isCustomServiceType: true,
        rawServiceTypeName: 'Pre-Arranged Cleaning',
        customServiceDisplayName: null
      });
      expect(component.serviceTypeShort(o)).toBe('Arranged');
    });
  });

  describe('copying a cleaner\'s payment details', () => {
    beforeEach(() => render());

    /**
     * A Zelle number gets pasted into a banking app. Copying "Zelle · 6465550134" would make the
     * paste useless, so only the destination itself travels.
     */
    it('copies the destination alone, without the method prefix', async () => {
      const writeText = jasmine.createSpy('writeText').and.returnValue(Promise.resolve());
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

      const c = component.data!.orders[0].cleaners[0];
      component.copyPaymentDetails(c);
      await Promise.resolve();

      expect(writeText).toHaveBeenCalledWith('6465550134');
      expect(component.payoutDestination(c)).toBe('Zelle · 6465550134');
    });

    it('confirms on the copied line only', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: () => Promise.resolve() },
        configurable: true
      });

      const [first, second] = component.data!.orders[0].cleaners;
      component.copyPaymentDetails(first);
      await Promise.resolve();

      expect(component.isCopied(first)).toBe(true);
      expect(component.isCopied(second)).toBe(false);
    });

    it('does nothing when there is no destination on file', () => {
      const writeText = jasmine.createSpy('writeText');
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

      component.copyPaymentDetails({ ...cleaner(), paymentDetails: null });

      expect(writeText).not.toHaveBeenCalled();
      expect(component.copiedCleanerId).toBeNull();
    });
  });

  describe('the cleaners column', () => {
    it('abbreviates surnames to keep the narrow column on one line', () => {
      expect(component.cleanerNamesShort(order())).toBe('Irma Xar., Maia Nia.');
    });

    it('keeps the full names for the tooltip', () => {
      expect(component.cleanerNamesFull(order())).toBe('Irma Xaratishvili, Maia Niauri');
    });

    it('leaves a short surname alone rather than abbreviating it to nothing', () => {
      const o = order({ cleaners: [cleaner({ firstName: 'Nato', lastName: 'Kvar' })] });
      expect(component.cleanerNamesShort(o)).toBe('Nato Kvar');
    });
  });

  describe('the payout working', () => {
    it('reads "$21 × 4.50 = $94.50", the shape the WhatsApp messages used', () => {
      expect(component.salaryWorking(cleaner())).toBe('$21 × 4.50 = $94.50');
    });

    it('keeps cents on a rate that has them', () => {
      expect(component.salaryWorking(cleaner({ hourlyRate: 22.5, salary: 101.25 })))
        .toBe('$22.50 × 4.50 = $101.25');
    });

    it('names the payout destination from the cleaner\'s saved method', () => {
      expect(component.payoutDestination(cleaner())).toBe('Zelle · 6465550134');
    });

    it('says nothing rather than something misleading when no method is on file', () => {
      expect(component.payoutDestination(cleaner({ paymentMethod: null, paymentDetails: null }))).toBe('');
    });
  });

  describe('status labels', () => {
    it('shows DoneM for a Done order settled outside Stripe', () => {
      expect(component.statusLabel(order({ paymentMethod: 'Cash' }))).toBe('DoneM');
      expect(component.customerPaymentNote(order({ paymentMethod: 'Cash' }))).toBe('Paid by cash');
    });

    it('shows plain Done for a card order, with no payment note', () => {
      expect(component.statusLabel(order())).toBe('Done');
      expect(component.customerPaymentNote(order())).toBe('');
    });
  });

  describe('editing a cleaner\'s pay', () => {
    beforeEach(() => render());

    it('refuses to open an editor on an already-paid line', () => {
      component.startEdit(order(), cleaner({ isPaid: true }));
      expect(component.editingKey).toBeNull();
    });

    it('seeds the editor with the rate and hours IN FORCE, not with the override', () => {
      const o = order();
      component.startEdit(o, o.cleaners[0]);

      expect(component.editRate).toBe(21);
      expect(component.editHours).toBe(4.5);
    });

    it('sends hours as minutes and applies both fields', () => {
      const o = component.data!.orders[0];
      component.startEdit(o, o.cleaners[0]);
      component.editRate = 25;
      component.editHours = 5;
      component.saveEdit(o, o.cleaners[0]);

      const req = httpMock.expectOne(r => r.method === 'PUT');
      expect(req.request.body).toEqual({
        hourlyRate: 25,
        billableMinutes: 300,
        updateHourlyRate: true,
        updateBillableMinutes: true
      });

      req.flush(order({ totalSalary: 219.5 }));
      flushLoad(list([order()]));
    });

    /**
     * "Reset to automatic" has to send NULLs. Re-sending the values currently on screen would
     * pin them, which looks identical today and diverges the moment the order is re-priced.
     */
    it('clears both overrides rather than re-sending the current values', () => {
      const o = component.data!.orders[0];
      component.resetToAutomatic(o, o.cleaners[0]);

      const req = httpMock.expectOne(r => r.method === 'PUT');
      expect(req.request.body).toEqual({
        hourlyRate: null,
        billableMinutes: null,
        updateHourlyRate: true,
        updateBillableMinutes: true
      });

      req.flush(order());
      flushLoad(list([order()]));
    });

    it('rejects a negative rate before it reaches the server', () => {
      const o = component.data!.orders[0];
      component.startEdit(o, o.cleaners[0]);
      component.editRate = -5;
      component.saveEdit(o, o.cleaners[0]);

      httpMock.expectNone(r => r.method === 'PUT');
      expect(component.error).toContain('zero or more');
    });
  });

  describe('marking paid', () => {
    beforeEach(() => render());

    it('defaults the method to the cleaner\'s saved one', () => {
      const o = component.data!.orders[0];
      component.openPayCleaner(o, o.cleaners[0]);
      expect(component.payVia).toBe('Zelle');
      expect(component.payModalTotal).toBe(94.5);
      component.closePayModal();
    });

    it('sends the chosen method as its numeric enum value', () => {
      const o = component.data!.orders[0];
      component.openPayCleaner(o, o.cleaners[0]);
      component.payVia = 'Check';
      component.confirmPay();

      const req = httpMock.expectOne(r => r.method === 'POST' && r.url.endsWith('/pay'));
      expect(req.request.body.paidVia).toBe(3);

      req.flush(order());
      flushLoad(list([order()]));
    });

    /**
     * A "pay all" is one action, not one channel — each cleaner is recorded against their own
     * saved method, so the modal must not send a single method for everybody.
     */
    it('sends no method when paying the whole order', () => {
      const o = component.data!.orders[0];
      component.openPayOrder(o);
      expect(component.payVia).toBe('');
      expect(component.payModalTotal).toBe(189);

      component.confirmPay();

      const req = httpMock.expectOne(r => r.method === 'POST' && r.url.endsWith(`/order/${o.orderId}/pay`));
      expect(req.request.body.paidVia).toBeUndefined();

      req.flush(order({ isFullyPaid: true }));
      flushLoad(list([order()]));
    });

    it('only offers the unpaid cleaners in the pay-all modal', () => {
      const o = order({
        cleaners: [cleaner({ isPaid: true }), cleaner({ orderCleanerId: 2, cleanerId: 12 })],
        isPartiallyPaid: true
      });
      component.openPayOrder(o);

      expect(component.unpaidInPayOrder.length).toBe(1);
      expect(component.payModalTotal).toBe(94.5);
      component.closePayModal();
    });
  });

  describe('filters and paging', () => {
    beforeEach(() => render());

    it('opens on the current month', () => {
      expect(component.isCurrentMonth).toBe(true);
    });

    it('sends the month as local yyyy-MM-dd, not a UTC-shifted ISO string', () => {
      component.monthAnchor = new Date(2026, 7, 1); // August 2026
      component.load();

      const req = httpMock.expectOne(r => r.method === 'GET');
      expect(req.request.params.get('from')).toBe('2026-08-01');
      expect(req.request.params.get('to')).toBe('2026-08-31');
      req.flush(list([]));
    });

    it('debounces the search box and resets to the first page', fakeAsync(() => {
      component.page = 3;
      component.onSearchChange('Irma');
      httpMock.expectNone(r => r.method === 'GET');

      tick(300);
      const req = httpMock.expectOne(r => r.method === 'GET');
      expect(req.request.params.get('search')).toBe('Irma');
      expect(component.page).toBe(1);
      req.flush(list([]));
    }));

    it('pages a 60-cleaning month into three pages of 20', () => {
      component.data = list([order()], 60);
      expect(component.totalPages).toBe(3);
      expect(component.pageWindow).toEqual([1, 2, 3]);
    });

    it('windows the pager to 7 buttons around the current page on a long range', () => {
      component.data = list([order()], 400); // 20 pages
      component.page = 10;
      expect(component.pageWindow).toEqual([7, 8, 9, 10, 11, 12, 13]);
    });
  });
});
