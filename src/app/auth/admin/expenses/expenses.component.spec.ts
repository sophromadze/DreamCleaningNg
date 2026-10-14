import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Location } from '@angular/common';
import { provideLocationMocks } from '@angular/common/testing';
import { SOCIAL_AUTH_CONFIG, SocialAuthServiceConfig } from '@abacritt/angularx-social-login';

import { ExpensesComponent, formatMonthParam, parseMonthParam } from './expenses.component';
import { Expense, ExpenseStaffMember, GroupedExpenses, GroupedName } from '../../../services/expense.service';
import { SALARIES_CATEGORY_ID } from '../../../shared/admin/salary-expense.rules';

// A salary names a person. These cover the three states the picker distinguishes — a staff member,
// somebody typed by hand, and nothing answered yet — plus the leaver case the feature exists for.
describe('ExpensesComponent — salaries are paid to a named person', () => {
  let fixture: ComponentFixture<ExpensesComponent>;
  let component: ExpensesComponent;
  let httpMock: HttpTestingController;

  const staff: ExpenseStaffMember[] = [
    { id: 7, fullName: 'Nino Beridze', email: 'nino@example.com', role: 'Admin', isActive: true, isFormer: false, salaryEntryCount: 3 },
    { id: 9, fullName: 'Luka Tabidze', email: 'luka@example.com', role: 'Moderator', isActive: false, isFormer: false, salaryEntryCount: 0 },
    { id: 12, fullName: 'Mariam Kapanadze', email: null, role: null, isActive: false, isFormer: true, salaryEntryCount: 5 }
  ];

  function salaryRow(overrides: Partial<Expense> = {}): Expense {
    return {
      id: 100,
      name: 'Nino Beridze',
      amount: 900,
      currency: 'GEL',
      categoryId: SALARIES_CATEGORY_ID,
      categoryName: 'Salaries',
      staffUserId: 7,
      staffUserRemoved: false,
      startDate: '2026-08-01T00:00:00',
      isRecurring: true,
      frequencyMonths: 1,
      endDate: null,
      prorateByDay: false,
      notes: null,
      createdByUserId: 1,
      createdByUserName: 'Owner',
      createdAt: '2026-08-01T00:00:00',
      updatedAt: '2026-08-01T00:00:00',
      ...overrides
    };
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ExpensesComponent],
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: SOCIAL_AUTH_CONFIG,
          useValue: { autoLogin: false, providers: [], onError: () => {} } as SocialAuthServiceConfig
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ExpensesComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);

    // The page loads three things at once; only the staff list matters here.
    fixture.detectChanges();
    httpMock.match(r => r.url.includes('/expenses/grouped'))
      .forEach(r => r.flush({ year: 2026, month: 9, monthLabel: 'September 2026', monthTotal: 0, categories: [] }));
    httpMock.match(r => r.url.includes('/expenses/categories')).forEach(r => r.flush([]));
    httpMock.match(r => r.url.includes('/expenses/staff')).forEach(r => r.flush(staff));
  });

  afterEach(() => httpMock.verify());

  it('asks who a new salary is for instead of assuming', () => {
    component.openAddForm(SALARIES_CATEGORY_ID);

    expect(component.isSalaryForm).toBe(true);
    // '' is "not answered", which is not the same claim as "nobody" — saving must be refused.
    expect(component.staffChoice()).toBe('');
    component.save();
    expect(component.error()).toBe('Pick who this salary is for');
    httpMock.expectNone(r => r.method === 'POST');
  });

  it('names the row from the picked staff member and sends the link', () => {
    component.openAddForm(SALARIES_CATEGORY_ID);
    component.staffChoice.set(7);
    component.form().amount = 900;
    component.form.set(component.form());

    // The name field gives way to the account's own name — there is nothing left to type.
    expect(component.showsNameField).toBe(false);
    expect(component.selectedStaff?.fullName).toBe('Nino Beridze');

    component.save();
    const req = httpMock.expectOne(r => r.method === 'POST' && r.url.endsWith('/expenses'));
    expect(req.request.body.staffUserId).toBe(7);
    expect(req.request.body.name).toBe('Nino Beridze');
    req.flush(salaryRow());

    httpMock.match(() => true).forEach(r => r.flush([]));
  });

  it('still allows a salary for somebody with no account', () => {
    component.openAddForm(SALARIES_CATEGORY_ID);
    component.staffChoice.set('custom');

    expect(component.showsNameField).toBe(true);
    component.form().name = 'Weekend receptionist';
    component.form.set(component.form());
    component.form().amount = 200;
    component.form.set(component.form());
    component.save();

    const req = httpMock.expectOne(r => r.method === 'POST' && r.url.endsWith('/expenses'));
    expect(req.request.body.staffUserId).toBeNull();
    expect(req.request.body.name).toBe('Weekend receptionist');
    req.flush(salaryRow({ staffUserId: null, name: 'Weekend receptionist' }));

    httpMock.match(() => true).forEach(r => r.flush([]));
  });

  it('opens a pre-picker salary row as a typed name rather than blanking it', () => {
    // Every salary written before this feature has no link. Editing one must not lose its name.
    component.openEditForm(salaryRow({ staffUserId: null, name: 'Old payroll line' }));

    expect(component.staffChoice()).toBe('custom');
    expect(component.showsNameField).toBe(true);
    expect(component.form().name).toBe('Old payroll line');
  });

  it('keeps a departed staff member pickable, so their last payment can still be entered', () => {
    // The reason the list is not just "current admins": the final salary is usually paid AFTER
    // somebody leaves, and their earlier rows have to stay on the same line.
    expect(component.formerStaff.map(s => s.id)).toEqual([12]);
    expect(component.staffOptionLabel(component.formerStaff[0])).toContain('no longer staff');
  });

  it('marks a blocked staff member without hiding them', () => {
    const blocked = component.currentStaff.find(s => s.id === 9)!;
    expect(component.staffOptionLabel(blocked)).toBe('Luka Tabidze (Moderator · blocked)');
  });

  it('drops the staff link when the row is moved out of Salaries', () => {
    component.openEditForm(salaryRow());
    expect(component.staffChoice()).toBe(7);

    component.form().categoryId = 1;
    component.form.set(component.form()); // Supplies
    component.onCategoryChange();

    // The server refuses to store a link on any other category; the form must agree with it.
    expect(component.staffChoice()).toBe('');
    expect(component.form().staffUserId).toBeNull();
    expect(component.showsNameField).toBe(true);
  });

  it('does not ask a non-salary expense who it was paid to', () => {
    component.openAddForm(1);
    expect(component.isSalaryForm).toBe(false);
    expect(component.showsNameField).toBe(true);
    expect(component.selectedStaff).toBeNull();
  });

  // ─── currency ──────────────────────────────────────────────────────────────

  it('offers a currency choice on salaries only', () => {
    // A supplier invoice or an ad bill arrives in dollars; a toggle there is an invitation to
    // mis-tag one and report it at roughly 2.7x its real cost.
    component.openAddForm(SALARIES_CATEGORY_ID);
    expect(component.canChooseCurrency).toBe(true);

    component.openAddForm(1); // Supplies
    expect(component.canChooseCurrency).toBe(false);
  });

  it('defaults a new expense to USD and sends what was picked', () => {
    component.openAddForm(SALARIES_CATEGORY_ID);
    expect(component.formCurrency).toBe('USD');

    component.staffChoice.set(7);
    component.form().amount = 1800;
    component.form.set(component.form());
    component.setCurrency('GEL');
    component.save();

    const req = httpMock.expectOne(r => r.method === 'POST' && r.url.endsWith('/expenses'));
    // The amount goes over as ENTERED — conversion is the server's job, at the month's rate.
    expect(req.request.body.currency).toBe('GEL');
    expect(req.request.body.amount).toBe(1800);
    req.flush(salaryRow());

    httpMock.match(() => true).forEach(r => r.flush([]));
  });

  it('drops a foreign currency when the row is moved out of Salaries', () => {
    component.openEditForm(salaryRow({ currency: 'GEL' }));
    expect(component.formCurrency).toBe('GEL');

    component.form().categoryId = 1;
    component.form.set(component.form()); // Supplies
    component.onCategoryChange();

    // The server forces USD on every other category; the form must agree rather than showing a
    // lari amount that is about to be reported as dollars.
    expect(component.formCurrency).toBe('USD');
    expect(component.canChooseCurrency).toBe(false);
  });

  it('reopens a saved salary in the currency it was entered in', () => {
    component.openEditForm(salaryRow({ currency: 'GEL', amount: 1800 }));
    expect(component.formCurrency).toBe('GEL');
    expect(component.form().amount).toBe(1800);
    expect(component.symbolFor(component.formCurrency)).toBe('₾');
  });

  it('forces USD on a non-salary expense even if the form somehow holds GEL', () => {
    component.openAddForm(1);
    component.form().currency = 'GEL';
    component.form.set(component.form());   // not reachable through the UI, but the DTO must not carry it
    component.form().name = 'Vacuum bags';
    component.form.set(component.form());
    component.form().amount = 40;
    component.form.set(component.form());
    component.save();

    const req = httpMock.expectOne(r => r.method === 'POST' && r.url.endsWith('/expenses'));
    expect(req.request.body.currency).toBe('USD');
    req.flush(salaryRow({ categoryId: 1, currency: 'USD' }));

    httpMock.match(() => true).forEach(r => r.flush([]));
  });

  // ── Commercial bonus (2026-10) ──

  it('offers a commercial bonus on a staff member\'s salary line only', () => {
    component.canEdit = true;
    expect(component.canAddCommercialBonus(SALARIES_CATEGORY_ID, { staffUserId: 7 })).toBe(true);
    expect(component.canAddCommercialBonus(SALARIES_CATEGORY_ID, { staffUserId: null })).toBe(false);
    expect(component.canAddCommercialBonus(1, { staffUserId: 7 })).toBe(false);
    component.canEdit = false;
    expect(component.canAddCommercialBonus(SALARIES_CATEGORY_ID, { staffUserId: 7 })).toBe(false);
  });

  it('adds a one-time named bonus in lari by default, on the day picked', () => {
    component.openCommercialBonus({ staffUserId: 7, name: 'Nino Beridze' });
    expect(component.bonusCurrency()).toBe('GEL');

    component.bonusLabel.set('Onyx commercial bonus');
    component.bonusAmount.set(500);
    component.bonusDate.set('2026-10-12');
    component.saveCommercialBonus();

    const req = httpMock.expectOne(r => r.method === 'POST' && r.url.endsWith('/expenses'));
    expect(req.request.body).toEqual(expect.objectContaining({
      categoryId: SALARIES_CATEGORY_ID, staffUserId: 7, bonusLabel: 'Onyx commercial bonus',
      amount: 500, currency: 'GEL', startDate: '2026-10-12', isRecurring: false
    }));
    req.flush(salaryRow({ id: 101, bonusLabel: 'Onyx commercial bonus', isRecurring: false }));
    httpMock.match(() => true).forEach(r => r.flush([]));
    expect(component.bonusLine()).toBeNull();
  });

  it('needs a name and an amount above zero before sending anything', () => {
    component.openCommercialBonus({ staffUserId: 7, name: 'Nino Beridze' });
    component.bonusAmount.set(500);
    component.saveCommercialBonus();
    component.bonusLabel.set('Onyx');
    component.bonusAmount.set(0);
    component.saveCommercialBonus();

    httpMock.expectNone(r => r.method === 'POST');
  });

  it('edits a saved bonus in its own form, keeping its name and currency', () => {
    component.openEditForm(salaryRow({
      id: 101, bonusLabel: 'Onyx commercial bonus', amount: 40, currency: 'USD',
      isRecurring: false, frequencyMonths: null, startDate: '2026-10-12T00:00:00'
    }));

    expect(component.showForm()).toBe(false);
    expect(component.bonusEditingId()).toBe(101);
    expect(component.bonusLabel()).toBe('Onyx commercial bonus');
    expect(component.bonusCurrency()).toBe('USD');
    expect(component.bonusDate()).toBe('2026-10-12');

    component.saveCommercialBonus();
    const req = httpMock.expectOne(r => r.method === 'PUT' && r.url.endsWith('/expenses/101'));
    expect(req.request.body.bonusLabel).toBe('Onyx commercial bonus');
    req.flush(salaryRow({ id: 101 }));
    httpMock.match(() => true).forEach(r => r.flush([]));
  });

  it('labels a bonus entry as a bonus, not a plain one-time charge', () => {
    expect(component.recurrenceLabel(salaryRow({ bonusLabel: 'Onyx', isRecurring: false }))).toBe('Bonus');
  });
});

// ─── the selected month decides everything on the page ───────────────────────────────────────

describe('ExpensesComponent — the month is the period', () => {
  let harness: RouterTestingHarness;
  let httpMock: HttpTestingController;
  let location: Location;

  function groupedFor(year: number, month: number, overrides: Partial<GroupedExpenses> = {}): GroupedExpenses {
    const label = new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    return { year, month, monthLabel: label, monthTotal: 0, chargedToDate: null, toDate: null, categories: [], ...overrides };
  }

  /** Answers the page's three loads and returns what the grouped request asked for. */
  function flushLoad(build: (year: number, month: number) => GroupedExpenses = groupedFor) {
    const req = httpMock.expectOne(r => r.url.includes('/expenses/grouped'));
    const year = Number(req.request.params.get('year'));
    const month = Number(req.request.params.get('month'));
    const today = req.request.params.get('today');
    req.flush(build(year, month));
    httpMock.match(r => r.url.includes('/expenses/categories')).forEach(r => r.flush([]));
    httpMock.match(r => r.url.includes('/expenses/staff')).forEach(r => r.flush([]));
    return { year, month, today };
  }

  function open(url: string): Promise<ExpensesComponent> {
    return harness.navigateByUrl(url, ExpensesComponent);
  }

  /** Back: the router answers a popstate on a setTimeout, which whenStable alone does not wait for. */
  async function goBack(): Promise<void> {
    location.back();
    await new Promise(resolve => setTimeout(resolve));
    await settle();
  }

  async function settle(): Promise<void> {
    await harness.fixture.whenStable();
    harness.fixture.detectChanges();
  }

  function page(): HTMLElement {
    return harness.routeNativeElement as HTMLElement;
  }

  function text(): string {
    return page().textContent?.replace(/\s+/g, ' ') ?? '';
  }

  const adsLine: GroupedName = {
    name: 'Google Ads Spend', staffUserId: null, staffUserRemoved: false,
    monthTotal: 30, allTimeTotal: 2510, monthTotalInCurrency: null, allTimeTotalInCurrency: null, currency: null,
    entries: [9, 8, 7].map(day => ({
      id: day, name: 'Google Ads Spend', amount: 10, currency: 'USD' as const, categoryId: 10, categoryName: 'Google Ads',
      staffUserId: null, staffUserRemoved: false, startDate: `2026-10-0${day}T00:00:00`, isRecurring: false,
      frequencyMonths: null, endDate: null, prorateByDay: false, notes: null, createdByUserId: 1,
      createdByUserName: null, createdAt: '2026-10-01T00:00:00', updatedAt: '2026-10-01T00:00:00'
    }))
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        provideRouter([{ path: 'admin/company/expenses', component: ExpensesComponent }]),
        provideLocationMocks(),
        {
          provide: SOCIAL_AUTH_CONFIG,
          useValue: { autoLogin: false, providers: [], onError: () => {} } as SocialAuthServiceConfig
        }
      ]
    });
    harness = await RouterTestingHarness.create();
    // The app starts the popstate listener at bootstrap, which TestBed never runs — without it
    // Back would change the address and nothing else.
    TestBed.inject(Router).setUpLocationChangeListener();
    httpMock = TestBed.inject(HttpTestingController);
    location = TestBed.inject(Location);
  });

  afterEach(() => httpMock.verify());

  it('reads and writes the month as yyyy-MM, refusing anything else', () => {
    expect(parseMonthParam('2026-10')).toEqual({ year: 2026, month: 10 });
    expect(parseMonthParam('2026-01')).toEqual({ year: 2026, month: 1 });
    for (const bad of [null, '', '2026-13', '2026-00', '2026-1', '26-10', '2026-10-01', 'abc', '1999-12', '2101-01']) {
      expect(parseMonthParam(bad)).toBeNull();
    }
    expect(formatMonthParam(2026, 3)).toBe('2026-03');
  });

  it("opens on the current month and sends the browser's own date for the charged-so-far figure", async () => {
    await open('/admin/company/expenses');
    const asked = flushLoad();

    const now = new Date();
    expect(asked.year).toBe(now.getFullYear());
    expect(asked.month).toBe(now.getMonth() + 1);
    const day = String(now.getDate()).padStart(2, '0');
    expect(asked.today).toBe(`${formatMonthParam(now.getFullYear(), now.getMonth() + 1)}-${day}`);
  });

  it('opens on the month named in the URL', async () => {
    const component = await open('/admin/company/expenses?month=2026-03');
    expect(flushLoad()).toEqual(expect.objectContaining({ year: 2026, month: 3 }));
    expect(component.selYear()).toBe(2026);
    expect(component.selMonth()).toBe(3);
  });

  it('puts every month switch in the URL, and Back walks back through them', async () => {
    const component = await open('/admin/company/expenses?month=2026-10');
    flushLoad();

    component.prevMonth();
    await settle();
    expect(location.path()).toBe('/admin/company/expenses?month=2026-09');
    expect(flushLoad()).toEqual(expect.objectContaining({ year: 2026, month: 9 }));

    component.prevMonth();
    await settle();
    expect(flushLoad()).toEqual(expect.objectContaining({ year: 2026, month: 8 }));

    await goBack();
    expect(location.path()).toBe('/admin/company/expenses?month=2026-09');
    expect(flushLoad()).toEqual(expect.objectContaining({ year: 2026, month: 9 }));
    expect(component.selMonth()).toBe(9);

    await goBack();
    expect(flushLoad()).toEqual(expect.objectContaining({ year: 2026, month: 10 }));
  });

  it('crosses the year boundary in both directions', async () => {
    const component = await open('/admin/company/expenses?month=2026-01');
    flushLoad();

    component.prevMonth();
    await settle();
    expect(location.path()).toBe('/admin/company/expenses?month=2025-12');
    flushLoad();

    component.nextMonth();
    await settle();
    flushLoad();
    component.nextMonth();
    await settle();
    expect(location.path()).toBe('/admin/company/expenses?month=2026-02');
    flushLoad();
  });

  it('replaces a malformed month with the current one instead of loading it', async () => {
    const component = await open('/admin/company/expenses?month=2026-13');
    await settle();

    expect(location.path()).toBe('/admin/company/expenses');
    const asked = flushLoad();
    const now = new Date();
    expect(asked.month).toBe(now.getMonth() + 1);
    expect(component.selMonth()).toBe(now.getMonth() + 1);
  });

  it('ignores a slow answer for a month the user has already left', async () => {
    const component = await open('/admin/company/expenses?month=2026-10');
    const october = httpMock.expectOne(r => r.url.includes('/expenses/grouped'));
    httpMock.match(r => !r.url.includes('/expenses/grouped')).forEach(r => r.flush([]));

    component.prevMonth();
    await settle();
    flushLoad();                                   // September arrives first…
    october.flush(groupedFor(2026, 10));           // …then the stale October answer.

    expect(component.grouped()!.month).toBe(9);
    expect(component.loading()).toBe(false);
  });

  it('labels the total with the month on screen and lists only what the server listed for it', async () => {
    const component = await open('/admin/company/expenses?month=2026-10');
    flushLoad((y, m) => groupedFor(y, m, {
      monthTotal: 30,
      categories: [
        { categoryId: 10, categoryName: 'Google Ads', displayOrder: 0, monthTotal: 30, names: [adsLine] },
        { categoryId: 12, categoryName: 'Office', displayOrder: 2, monthTotal: 0, names: [] }
      ]
    }));
    await settle();

    expect(text()).toContain('October 2026 total');
    expect(text()).not.toContain('This month');
    // A category with nothing in the month is not shown at all.
    expect(page().querySelectorAll('.category-block').length).toBe(1);

    component.toggleCategory(10);
    component.toggleName(10, 'Google Ads Spend');
    await settle();

    expect(page().querySelectorAll('.entry-table tbody tr').length).toBe(3);
    // The all-time figure survives only as clearly labelled context, never as the line's total.
    expect(text()).toContain('All time through October 2026: $ 2,510.00');
    expect(text()).not.toContain('Total to date across all entries');
    expect(page().querySelector('.name-total')!.textContent).toContain('30.00');
    expect(page().querySelector('.category-total')!.textContent).toContain('30.00');
  });

  it('shows the charged-so-far line only when the server sends one (the running month)', async () => {
    const component = await open('/admin/company/expenses?month=2026-10');
    flushLoad((y, m) => groupedFor(y, m, { monthTotal: 320, chargedToDate: 20, toDate: '2026-10-09T00:00:00' }));
    await settle();
    expect(text()).toContain('$ 320.00');
    expect(text()).toContain('Charged through Oct 9: $ 20.00');

    component.prevMonth();
    await settle();
    flushLoad((y, m) => groupedFor(y, m, { monthTotal: 50 }));
    await settle();
    expect(text()).not.toContain('Charged through');
  });

  it('says the month is empty rather than showing nothing', async () => {
    await open('/admin/company/expenses?month=2026-01');
    flushLoad((y, m) => groupedFor(y, m, {
      categories: [{ categoryId: 10, categoryName: 'Google Ads', displayOrder: 0, monthTotal: 0, names: [] }]
    }));
    await settle();

    expect(text()).toContain('No expenses in January 2026.');
  });
});
