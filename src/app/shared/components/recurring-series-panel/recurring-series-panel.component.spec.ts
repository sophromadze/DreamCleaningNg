import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { RecurringSeriesPanelComponent, nextRecurrenceDateAfter } from './recurring-series-panel.component';
import { RecurrenceIntervalUnit, RecurringSeries } from '../../../services/recurring-order.service';
import { environment } from '../../../../environments/environment';
import { testProviders } from '../../../../testing/test-providers';

const FOR_ORDER = (id: number) => `${environment.apiUrl}/admin/recurring-series/for-order/${id}`;
const CREATE = (id: number) => `${environment.apiUrl}/admin/recurring-series/from-order/${id}`;
const GENERATE = (id: number) => `${environment.apiUrl}/admin/recurring-series/${id}/generate`;

/**
 * The Recurrence card in the admin order panel.
 *
 * The two rules worth a spec are the two an admin would otherwise have to discover: copying
 * cleaners onto generated orders notifies NOBODY, and daily recurrence is refused rather than
 * half-supported.
 */
describe('RecurringSeriesPanelComponent', () => {
  let fixture: ComponentFixture<RecurringSeriesPanelComponent>;
  let component: RecurringSeriesPanelComponent;
  let httpMock: HttpTestingController;

  function series(overrides: Partial<RecurringSeries> = {}): RecurringSeries {
    return {
      id: 3, userId: 8, customerName: 'Cus Tomer', templateOrderId: 41,
      intervalValue: 2, intervalUnit: RecurrenceIntervalUnit.Weeks, intervalLabel: 'Every 2 weeks',
      anchorDate: '2026-10-04T00:00:00', serviceTime: '09:00:00', endDate: null,
      isActive: true, copyCleanerAssignments: true, autoRequestPayment: false,
      generatedThroughDate: '2026-11-03T00:00:00', notes: null,
      createdAt: '2026-10-01T00:00:00', createdByName: 'Admin One',
      occurrences: [
        {
          orderId: 41, serviceDate: '2026-10-04T00:00:00', serviceTime: '09:00:00',
          occurrenceDate: '2026-10-04T00:00:00', status: 'Active', total: 150, isPaid: true,
          isTemplate: true, wasGenerated: false, paymentMethod: 'Normal',
          autoAssignedNotNotifiedCount: 0, assignedCleanerCount: 2
        },
        {
          orderId: 42, serviceDate: '2999-10-18T00:00:00', serviceTime: '09:00:00',
          occurrenceDate: '2999-10-18T00:00:00', status: 'Pending', total: 150, isPaid: false,
          isTemplate: false, wasGenerated: true, paymentMethod: 'Normal',
          autoAssignedNotNotifiedCount: 2, assignedCleanerCount: 2
        }
      ],
      pendingDates: [],
      ...overrides
    };
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RecurringSeriesPanelComponent],
      providers: [...testProviders]
    }).compileComponents();

    fixture = TestBed.createComponent(RecurringSeriesPanelComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    // Opening the form also asks which commercial contracts the order could be linked to — an
    // ordinary residential order has none.
    httpMock.match(r => r.url.endsWith('/contracts')).forEach(r => r.flush({ contracts: [] }));
    httpMock.verify();
  });

  function open(existing: RecurringSeries | null = series()): void {
    fixture.componentRef.setInput('orderId', 41);
    fixture.componentRef.setInput('canCreate', true);
    fixture.componentRef.setInput('canUpdate', true);
    // The host always passes the order's own date — a new weekly plan starts on that weekday.
    fixture.componentRef.setInput('orderServiceDate', '2026-10-04T00:00:00');
    fixture.detectChanges();

    httpMock.expectOne(FOR_ORDER(41)).flush(existing);
    fixture.detectChanges();
  }

  it('starts a fresh plan from the stopped source using creation and refreshes the orders list', () => {
    const stopped = series({ stoppedAt: '2026-09-10T00:00:00', isActive: false, occurrences: [] });
    open(stopped);
    const button = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find(b => b.textContent?.includes('Start new recurring plan'))!;
    expect(button).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('no automatic payment requests are sent for this stopped plan');
    button.click();
    httpMock.expectOne(CREATE(41) + '/preview').flush({ sourceDiscounts: [], baseCleaning: 100, loyaltyPercent: 0, loyaltySource: 'None', loyaltyAmount: 0, tax: 8.88, tips: 0, total: 108.88 });
    expect(component.startingNew).toBe(true); expect(component.isActive).toBe(true);
    expect(component.anchorDate).toBe('2026-10-18'); // suggested: the next fortnightly Sunday after the source expect(component.needsFutureOrdersChoice).toBeFalse();
    vi.spyOn(component.ordersGenerated, 'emit').mockReturnValue(undefined);
    component.save();
    const request = httpMock.expectOne(CREATE(41));
    expect(request.request.method).toBe('POST'); expect(request.request.body.isActive).toBe(true);
    request.flush(series({ id: 4 }));
    expect(component.series?.id).toBe(4); expect(component.startingNew).toBe(false);
    expect(component.ordersGenerated.emit).toHaveBeenCalled();
    expect(stopped.stoppedAt).toBeTruthy();
  });

  it('canceling new setup leaves the stopped plan intact', () => {
    open(series({ stoppedAt: '2026-09-10T00:00:00', isActive: false, occurrences: [] }));
    component.startSetup(true);
    httpMock.expectOne(CREATE(41) + '/preview').flush({ sourceDiscounts: [] });
    component.cancelEdit();
    expect(component.editing).toBe(false); expect(component.startingNew).toBe(false);
    expect(component.series?.id).toBe(3); expect(component.isActive).toBe(false);
    httpMock.expectNone(CREATE(41));
  });

  it('does not offer a replacement without create permission or from a generated cleaning', () => {
    open(series({ stoppedAt: '2026-09-10T00:00:00', isActive: false }));
    fixture.componentRef.setInput('canCreate', false); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Start new recurring plan');
    component.startSetup(true); expect(component.editing).toBe(false);
    component.canCreate = true; component.series!.templateOrderId = 99; fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Start new recurring plan');
    component.startSetup(true); expect(component.editing).toBe(false);
  });

  it('says a one-off cleaning is a one-off cleaning', () => {
    open(null);

    expect(component.series).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('one-off cleaning');
  });

  // ── Daily is out of scope, and is REFUSED rather than half-supported ────────────────────

  it('refuses an interval of one day, and says so before Save is pressed', () => {
    open(null);
    component.startSetup();
    httpMock.expectOne(CREATE(41) + '/preview').flush({ sourceDiscounts: [], baseCleaning: 100, loyaltyPercent: 0, loyaltySource: 'None', loyaltyAmount: 0, tax: 8.88, tips: 0, total: 108.88, commercialLoyaltyExcluded: false });
    component.intervalValue = 1;
    component.intervalUnit = RecurrenceIntervalUnit.Days;
    fixture.detectChanges();

    expect(component.dailyNotSupported).toBe(true);
    expect(component.validationError).toContain('Daily recurrence is not supported');
    expect(fixture.nativeElement.textContent).toContain('Daily cleaning is not supported yet');
  });

  it('does not submit a daily series even if Save is called directly', () => {
    open(null);
    component.startSetup();
    httpMock.expectOne(CREATE(41) + '/preview').flush({ sourceDiscounts: [], baseCleaning: 100, loyaltyPercent: 0, loyaltySource: 'None', loyaltyAmount: 0, tax: 8.88, tips: 0, total: 108.88, commercialLoyaltyExcluded: false });
    component.intervalValue = 1;
    component.intervalUnit = RecurrenceIntervalUnit.Days;

    component.save();

    httpMock.expectNone(CREATE(41));
    expect(component.errorMessage).toContain('Daily recurrence is not supported');
  });

  it('allows two days and up', () => {
    open(null);
    component.startSetup();
    httpMock.expectOne(CREATE(41) + '/preview').flush({ sourceDiscounts: [], baseCleaning: 100, loyaltyPercent: 0, loyaltySource: 'None', loyaltyAmount: 0, tax: 8.88, tips: 0, total: 108.88, commercialLoyaltyExcluded: false });
    component.intervalUnit = RecurrenceIntervalUnit.Days;
    component.intervalValue = 3;

    expect(component.dailyNotSupported).toBe(false);
    expect(component.validationError).toBeNull();
  });

  it('allows every one WEEK — that is not the daily case', () => {
    open(null);
    component.startSetup();
    httpMock.expectOne(CREATE(41) + '/preview').flush({ sourceDiscounts: [], baseCleaning: 100, loyaltyPercent: 0, loyaltySource: 'None', loyaltyAmount: 0, tax: 8.88, tips: 0, total: 108.88, commercialLoyaltyExcluded: false });
    component.intervalUnit = RecurrenceIntervalUnit.Weeks;
    component.intervalValue = 1;

    expect(component.validationError).toBeNull();
  });

  // ── Copying cleaners never notifies them ────────────────────────────────────────────────

  it('states that copied cleaners are NOT emailed or texted', () => {
    open();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('no email or SMS is sent');
  });

  it('counts the upcoming cleanings whose auto-assigned cleaners are still unnotified', () => {
    open();

    expect(component.unnotifiedOccurrenceCount).toBe(1);
    expect(fixture.nativeElement.textContent)
      .toContain('auto-assigned cleaners who have not been notified');
  });

  it('says nothing is requested automatically when that switch is off', () => {
    open();

    expect(fixture.nativeElement.textContent).toContain('nothing is sent automatically');
  });

  it('states the 24-hour rule when automatic requests ARE on', () => {
    open(series({ autoRequestPayment: true }));

    expect(fixture.nativeElement.textContent)
      .toContain('never sooner than 24 hours after the previous cleaning');
  });

  // ── Generation is idempotent, and says so ───────────────────────────────────────────────

  it('reports a no-op pass rather than looking like it failed', () => {
    open();

    component.generateNow();
    httpMock.expectOne(GENERATE(3)).flush({
      seriesId: 3, createdCount: 0, createdOrderIds: [],
      skippedExistingDates: ['2026-10-18', '2026-11-01'], warnings: []
    });

    // Pressing it twice must not read as a broken button — the skipped dates ARE the result.
    expect(component.noticeMessage).toContain('already exists');

    httpMock.expectOne(`${environment.apiUrl}/admin/recurring-series/3`).flush(series());
  });

  it('reports what a real pass created', () => {
    open();

    component.generateNow();
    httpMock.expectOne(GENERATE(3)).flush({
      seriesId: 3, createdCount: 2, createdOrderIds: [43, 44],
      skippedExistingDates: [], warnings: []
    });

    expect(component.noticeMessage).toContain('2 cleaning(s) created');

    httpMock.expectOne(`${environment.apiUrl}/admin/recurring-series/3`).flush(series());
  });

  it('shows original mixed discounts as non-recurring and estimates only the explicit series discount', () => {
    open(null); component.startSetup();
    const initial = httpMock.expectOne(CREATE(41) + '/preview');
    expect(initial.request.body.recurringLoyaltyDiscountPercent).toBeNull();
    const preview = { sourceDiscounts: [{ label: 'Promo Code ORIGINAL20', amount: 20 }, { label: 'Bubble Points', amount: 10 },
      { label: 'One-time Loyalty', amount: 22, percent: 22 }], baseCleaning: 100, loyaltyPercent: 0, loyaltySource: 'None',
      loyaltyAmount: 0, tax: 8.88, tips: 0, total: 108.88, commercialLoyaltyExcluded: false };
    initial.flush(preview); fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    for (const value of ['Promo Code ORIGINAL20', 'Bubble Points', 'One-time Loyalty', 'do not', 'carry over', '$108.88']) expect(text).toContain(value);
    component.recurringLoyaltyDiscountPercent = 15; component.refreshPricePreview();
    const request = httpMock.expectOne(CREATE(41) + '/preview');
    expect(request.request.body.recurringLoyaltyDiscountPercent).toBe(15);
    request.flush({ ...preview, loyaltyPercent: 15, loyaltySource: 'Recurring Series', loyaltyAmount: 15, tax: 7.54, total: 92.54 });
    fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain('$92.54');
    component.save(); const save = httpMock.expectOne(CREATE(41));
    expect(save.request.body.recurringLoyaltyDiscountPercent).toBe(15);
    save.flush(series({ recurringLoyaltyDiscountPercent: 15, generationWarnings: ['Saved; retry generation.'] }));
    expect(component.noticeMessage).toContain('retry generation');
  });

  /**
   * The discount may be written as a percentage or as a fixed amount, and the two are ONE
   * agreement — so only the field belonging to the chosen mode is ever sent. The server refuses
   * both at once, and a silent conversion between them would change what was agreed.
   */
  it('defaults to a percentage and sends only the figure belonging to the chosen mode', () => {
    open(null); component.startSetup();
    expect(component.loyaltyDiscountMode).toBe('percent');
    httpMock.expectOne(CREATE(41) + '/preview').flush({ sourceDiscounts: [], total: 100 });

    component.recurringLoyaltyDiscountPercent = 15;
    component.setLoyaltyDiscountMode('fixed');

    // Switching clears the other figure rather than converting it — 15% is not $15.
    expect(component.recurringLoyaltyDiscountPercent).toBeNull();
    const cleared = httpMock.expectOne(CREATE(41) + '/preview');
    expect(cleared.request.body.recurringLoyaltyDiscountPercent).toBeNull();
    expect(cleared.request.body.recurringLoyaltyDiscountAmount).toBeNull();
    cleared.flush({ sourceDiscounts: [], total: 100 });

    component.recurringLoyaltyDiscountAmount = 50;
    component.refreshPricePreview();
    const priced = httpMock.expectOne(CREATE(41) + '/preview');
    expect(priced.request.body.recurringLoyaltyDiscountAmount).toBe(50);
    expect(priced.request.body.recurringLoyaltyDiscountPercent).toBeNull();
    priced.flush({ sourceDiscounts: [], baseCleaning: 563, loyaltyPercent: 8.88, loyaltySource: 'Recurring Series',
      loyaltyAmount: 50, tax: 45.53, tips: 0, total: 558.53, commercialLoyaltyExcluded: false, loyaltyIsFixedAmount: true });
    fixture.detectChanges();

    // A fixed amount's percentage is derived, so the estimate says "fixed" rather than quoting
    // a percentage nobody typed.
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('$50.00');
    expect(text).toContain('fixed');
    expect(text).toContain('$558.53');

    component.save();
    const save = httpMock.expectOne(CREATE(41));
    expect(save.request.body.recurringLoyaltyDiscountAmount).toBe(50);
    expect(save.request.body.recurringLoyaltyDiscountPercent).toBeNull();
    save.flush(series({ recurringLoyaltyDiscountAmount: 50, recurringLoyaltyDiscountPercent: null }));

    // Reopened, the form comes back in the mode the series was saved in.
    expect(component.loyaltyDiscountMode).toBe('fixed');
    expect(component.recurringLoyaltyDiscountAmount).toBe(50);
  });

  it('treats switching a saved series from a percentage to a fixed amount as a rule change', () => {
    open(series({ recurringLoyaltyDiscountPercent: 10, recurringLoyaltyDiscountAmount: null }));
    component.startSetup();
    expect(component.loyaltyDiscountMode).toBe('percent');
    httpMock.expectOne(CREATE(41) + '/preview').flush({ sourceDiscounts: [], total: 100 });

    component.setLoyaltyDiscountMode('fixed');
    httpMock.expectOne(CREATE(41) + '/preview').flush({ sourceDiscounts: [], total: 100 });
    component.recurringLoyaltyDiscountAmount = 25;

    expect(component.needsFutureOrdersChoice).toBe(true);
    component.save();
    httpMock.expectNone(environment.apiUrl + '/admin/recurring-series/3');

    component.futureOrdersAction = 'Regenerate'; component.save();
    const request = httpMock.expectOne(environment.apiUrl + '/admin/recurring-series/3');
    expect(request.request.body.recurringLoyaltyDiscountAmount).toBe(25);
    expect(request.request.body.recurringLoyaltyDiscountPercent).toBeNull();
    request.flush(series({ recurringLoyaltyDiscountAmount: 25, recurringLoyaltyDiscountPercent: null }));
  });

  it('rejects a negative fixed amount before anything is sent', () => {
    open(null); component.startSetup();
    httpMock.expectOne(CREATE(41) + '/preview').flush({ sourceDiscounts: [], total: 100 });
    component.setLoyaltyDiscountMode('fixed');
    httpMock.expectOne(CREATE(41) + '/preview').flush({ sourceDiscounts: [], total: 100 });

    component.recurringLoyaltyDiscountAmount = -5;
    expect(component.validationError).toContain('cannot be negative');
    component.save();
    httpMock.expectNone(CREATE(41));
  });

  it('requires Keep or Regenerate for a discount edit and sends the chosen rule', () => {
    open(series({ recurringLoyaltyDiscountPercent: null })); component.startSetup();
    httpMock.expectOne(CREATE(41) + '/preview').flush({ sourceDiscounts: [], total: 100 });
    component.recurringLoyaltyDiscountPercent = 15; component.save();
    expect(component.needsFutureOrdersChoice).toBe(true);
    httpMock.expectNone(environment.apiUrl + '/admin/recurring-series/3');
    component.futureOrdersAction = 'Regenerate'; component.save();
    const request = httpMock.expectOne(environment.apiUrl + '/admin/recurring-series/3');
    expect(request.request.method).toBe('PUT'); expect(request.request.body.futureOrdersAction).toBe('Regenerate');
    expect(request.request.body.recurringLoyaltyDiscountPercent).toBe(15);
    request.flush(series({ recurringLoyaltyDiscountPercent: 15 }));
  });

  for (const state of ['pause', 'resume', 'stop'] as const) {
    it('sends ' + state + ' to the lifecycle route', () => {
      open(); component.pendingAction = { kind: state }; component.confirmAction();
      const request = httpMock.expectOne(environment.apiUrl + '/admin/recurring-series/3/state/' + state);
      expect(request.request.method).toBe('POST'); request.flush(series());
      httpMock.expectOne(environment.apiUrl + '/admin/recurring-series/3').flush(series());
    });
  }

  // ── Service days, days of month and the upcoming-cleanings count (2026-10) ─────────────

  const PREVIEW = { sourceDiscounts: [], baseCleaning: 100, loyaltyPercent: 0, loyaltySource: 'None', loyaltyAmount: 0, tax: 8.88, tips: 0, total: 108.88, commercialLoyaltyExcluded: false };
  const CONTRACTS = (id: number) => CREATE(id) + '/contracts';

  function startNew(contracts: object = { contracts: [] }): void {
    open(null);
    component.startSetup();
    httpMock.expectOne(CREATE(41) + '/preview').flush(PREVIEW);
    httpMock.expectOne(CONTRACTS(41)).flush(contracts);
    fixture.detectChanges();
  }

  function chip(label: string): HTMLButtonElement {
    return Array.from(fixture.nativeElement.querySelectorAll('.rsp-day') as NodeListOf<HTMLButtonElement>)
      .find(b => b.textContent?.trim() === label)!;
  }

  it('starts a new weekly plan on the order\'s own weekday and sends any combination of days', () => {
    startNew();
    expect(component.serviceDaysOfWeek).toEqual([0]); // Sunday 4 October
    expect(component.upcomingOccurrenceTarget).toBe(12);

    for (const label of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) { chip(label).click(); }
    fixture.detectChanges();
    expect(chip('Sat').getAttribute('aria-pressed')).toBe('false');

    component.save();
    const body = httpMock.expectOne(CREATE(41)).request.body;
    expect(body.serviceDaysOfWeek).toEqual([0, 1, 2, 3, 4, 5]);
    expect(body.serviceDaysOfMonth).toBeNull();
    expect(body.upcomingOccurrenceTarget).toBe(12);
  });

  it('lets Saturday — or every day — be chosen; nothing is hard-coded away', () => {
    startNew();
    component.toggleWeekday(0);
    for (const day of [6, 2]) component.toggleWeekday(day);
    expect(component.serviceDaysOfWeek).toEqual([2, 6]);
    for (const day of [0, 1, 3, 4, 5]) component.toggleWeekday(day);
    expect(component.serviceDaysOfWeek).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(component.validationError).toBeNull();
  });

  it('requires at least one service day for a new weekly plan', () => {
    startNew();
    component.toggleWeekday(0);
    expect(component.validationError).toBe('Choose at least one service day.');
    component.save();
    httpMock.expectNone(CREATE(41));
  });

  it('switching to months seeds the first cleaning\'s day and sends the chosen days of the month', () => {
    startNew();
    component.intervalUnit = RecurrenceIntervalUnit.Months;
    component.onIntervalUnitChange();
    fixture.detectChanges();
    expect(component.serviceDaysOfMonth).toEqual([4]);
    expect(fixture.nativeElement.textContent).toContain('is skipped that month');

    component.toggleMonthDay(4); component.toggleMonthDay(31); component.toggleMonthDay(15); component.toggleMonthDay(1);
    component.save();
    const body = httpMock.expectOne(CREATE(41)).request.body;
    expect(body.serviceDaysOfMonth).toEqual([1, 15, 31]);
    expect(body.serviceDaysOfWeek).toBeNull();
  });

  it('validates the upcoming-cleanings count: required, whole, 1 to 60', () => {
    startNew();
    for (const bad of [null, 0, 61, 2.5]) {
      component.upcomingOccurrenceTarget = bad;
      expect(component.validationError, String(bad)).toContain('upcoming cleanings');
    }
    component.upcomingOccurrenceTarget = 6;
    expect(component.validationError).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Keep this many future cleaning orders ready.');
  });

  it('keeps an older plan as it was: no days chosen, blank count allowed, 30-day wording', () => {
    open(series({ upcomingOccurrenceTarget: null, serviceDaysOfWeek: [] }));
    expect(fixture.nativeElement.textContent).toContain('the next 30 days are generated');
    component.startSetup();
    httpMock.expectOne(CREATE(41) + '/preview').flush(PREVIEW);
    expect(component.isLegacyPattern).toBe(true);
    expect(component.validationError).toBeNull();
    component.notes = 'just a note';
    component.save();
    const request = httpMock.expectOne(environment.apiUrl + '/admin/recurring-series/3');
    expect(request.request.body.serviceDaysOfWeek).toBeNull();
    expect(request.request.body.upcomingOccurrenceTarget).toBeNull();
    request.flush(series({ upcomingOccurrenceTarget: null }));
  });

  it('says what stays and what the new days will use when a schedule with future cleanings changes', () => {
    open(series({ serviceDaysOfWeek: [0], upcomingOccurrenceTarget: 6 }));
    component.startSetup();
    httpMock.expectOne(CREATE(41) + '/preview').flush(PREVIEW);
    component.toggleWeekday(1); component.toggleWeekday(3);
    fixture.detectChanges();
    expect(component.needsFutureOrdersChoice).toBe(true);
    const text = (fixture.nativeElement.textContent as string).replace(/\s+/g, ' ');
    expect(text).toContain('1 future cleaning(s) are already generated');
    expect(text).toContain('on Sun, Mon, Wed');
    expect(text).toContain('Nothing already created is moved or deleted automatically');
  });

  // ── Weekly flat fee contracts ───────────────────────────────────────────────────────────

  const WEEKLY = {
    id: 40, contractNumber: 'DCC-2026-12918497', status: 'FullySigned', contractClientId: 7,
    serviceAddress: '1 Commerce St, New York, NY 10001', pricingBasis: 'WeeklyFlatFee', isWeeklyFlatFee: true,
    visitsPerWeek: 6, preTaxPrice: 875, salesTaxAmount: 77.66, totalPrice: 952.66, weekDefinition: 'Sunday through Saturday'
  };

  it('a weekly flat fee contract controls billing: no per-cleaning estimate and no automatic requests', () => {
    startNew({ contractClientId: 7, contracts: [WEEKLY], suggestedContractId: 40 });

    expect(component.contractId).toBe(40);
    expect(component.billingControlledByContract).toBe(true);
    const text = (fixture.nativeElement.textContent as string).replace(/\s+/g, ' ');
    expect(text).toContain('Billing is controlled by the linked commercial contract');
    expect(text).toContain('do not represent separate customer charges');
    expect(text).not.toContain('Estimated recurring cleaning');
    expect(text).not.toContain('Request payment automatically');

    component.autoRequestPayment = true;
    component.save();
    const body = httpMock.expectOne(CREATE(41)).request.body;
    expect(body.contractId).toBe(40);
    expect(body.autoRequestPayment).toBe(false);
  });

  it('an ordinary residential plan keeps its estimate and its automatic-request switch', () => {
    startNew();
    const text = fixture.nativeElement.textContent as string;
    expect(component.billingControlledByContract).toBe(false);
    expect(text).toContain('Estimated recurring cleaning');
    expect(text).toContain('Request payment automatically');
  });

  it('an existing weekly-flat-fee plan states who bills it and shows no per-visit prices', () => {
    open(series({ contract: WEEKLY, billingControlledByContract: true, upcomingOccurrenceTarget: 12, upcomingCount: 12 }));
    const text = (fixture.nativeElement.textContent as string).replace(/\s+/g, ' ');
    expect(text).toContain('billed by DCC-2026-12918497\'s weekly invoice');
    expect(text).toContain('keeps 12 generated (12 now)');
    expect(fixture.nativeElement.querySelector('.rsp-occ-total')).toBeNull();
  });

  // ── Suggested first recurring cleaning (new plans only) ─────────────────────────────────

  it('suggests the next scheduled day after the source order: Sunday Oct 4 + Sun–Fri → Monday Oct 5', () => {
    startNew();
    component.intervalValue = 1; component.refreshSuggestedFirstCleaning();
    for (const day of [1, 2, 3, 4, 5]) component.toggleWeekday(day);
    expect(component.anchorDate).toBe('2026-10-05');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('First recurring cleaning');
    expect(fixture.nativeElement.textContent).toContain('The source order already exists');

    component.save();
    expect(httpMock.expectOne(CREATE(41)).request.body.anchorDate).toBe('2026-10-05');
  });

  it('never overwrites a date the admin chose, and a blank date stays blank', () => {
    startNew();
    component.anchorDate = '2026-11-02'; component.onAnchorDateChange();
    component.toggleWeekday(3);
    expect(component.anchorDate).toBe('2026-11-02');
    component.anchorDate = ''; component.onAnchorDateChange();
    component.toggleWeekday(4);
    expect(component.anchorDate).toBe('');
  });

  it('an existing plan keeps its stored first date exactly as it is', () => {
    open(series({ anchorDate: '2026-10-04T00:00:00', serviceDaysOfWeek: [0], upcomingOccurrenceTarget: 6 }));
    component.startSetup();
    httpMock.expectOne(CREATE(41) + '/preview').flush(PREVIEW);
    component.toggleWeekday(1);
    expect(component.anchorDate).toBe('2026-10-04');
  });

  it('the generate-upcoming count is a compact input with the short hint', () => {
    startNew();
    const input = fixture.nativeElement.querySelector('input[aria-label="Generate upcoming cleanings"]') as HTMLInputElement;
    expect(input.type).toBe('number');
    expect(input.getBoundingClientRect().width).toBeLessThan(120);
    expect(fixture.nativeElement.textContent).toContain('Keep this many future cleaning orders ready.');
  });

  describe('nextRecurrenceDateAfter', () => {
    const W = RecurrenceIntervalUnit.Weeks, M = RecurrenceIntervalUnit.Months, D = RecurrenceIntervalUnit.Days;
    it('weekly, every week', () => expect(nextRecurrenceDateAfter('2026-10-04', W, 1, [0, 1, 2, 3, 4, 5], [], 0)).toBe('2026-10-05'));
    it('every 2 weeks stays in the source week, then skips a week', () => {
      expect(nextRecurrenceDateAfter('2026-10-05', W, 2, [1, 3], [], 0)).toBe('2026-10-07');
      expect(nextRecurrenceDateAfter('2026-10-07', W, 2, [1, 3], [], 0)).toBe('2026-10-19');
    });
    it('follows a Monday-start contract week', () =>
      // Sunday Oct 4 closes its Monday-start week; with every 2 weeks the next cycle is Oct 12.
      expect(nextRecurrenceDateAfter('2026-10-04', W, 2, [0, 1], [], 1)).toBe('2026-10-12'));
    it('month days skip a day the month lacks', () => {
      expect(nextRecurrenceDateAfter('2027-01-15', M, 1, [], [15, 30], 0)).toBe('2027-01-30');
      expect(nextRecurrenceDateAfter('2027-01-30', M, 1, [], [15, 30], 0)).toBe('2027-02-15');
      expect(nextRecurrenceDateAfter('2027-01-31', M, 1, [], [31], 0)).toBe('2027-03-31');
    });
    it('no days chosen: one interval later', () => {
      expect(nextRecurrenceDateAfter('2026-10-04', W, 2, [], [], 0)).toBe('2026-10-18');
      expect(nextRecurrenceDateAfter('2027-01-31', M, 1, [], [], 0)).toBe('2027-02-28');
      expect(nextRecurrenceDateAfter('2026-10-04', D, 3, [], [], 0)).toBe('2026-10-07');
    });
  });
});
