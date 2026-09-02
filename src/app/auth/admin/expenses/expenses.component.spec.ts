import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { SocialAuthServiceConfig } from '@abacritt/angularx-social-login';

import { ExpensesComponent } from './expenses.component';
import { Expense, ExpenseStaffMember } from '../../../services/expense.service';
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
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: 'SocialAuthServiceConfig',
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

    expect(component.isSalaryForm).toBeTrue();
    // '' is "not answered", which is not the same claim as "nobody" — saving must be refused.
    expect(component.staffChoice).toBe('');
    component.save();
    expect(component.error).toBe('Pick who this salary is for');
    httpMock.expectNone(r => r.method === 'POST');
  });

  it('names the row from the picked staff member and sends the link', () => {
    component.openAddForm(SALARIES_CATEGORY_ID);
    component.staffChoice = 7;
    component.form.amount = 900;

    // The name field gives way to the account's own name — there is nothing left to type.
    expect(component.showsNameField).toBeFalse();
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
    component.staffChoice = 'custom';

    expect(component.showsNameField).toBeTrue();
    component.form.name = 'Weekend receptionist';
    component.form.amount = 200;
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

    expect(component.staffChoice).toBe('custom');
    expect(component.showsNameField).toBeTrue();
    expect(component.form.name).toBe('Old payroll line');
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
    expect(component.staffChoice).toBe(7);

    component.form.categoryId = 1; // Supplies
    component.onCategoryChange();

    // The server refuses to store a link on any other category; the form must agree with it.
    expect(component.staffChoice).toBe('');
    expect(component.form.staffUserId).toBeNull();
    expect(component.showsNameField).toBeTrue();
  });

  it('does not ask a non-salary expense who it was paid to', () => {
    component.openAddForm(1);
    expect(component.isSalaryForm).toBeFalse();
    expect(component.showsNameField).toBeTrue();
    expect(component.selectedStaff).toBeNull();
  });

  // ─── currency ──────────────────────────────────────────────────────────────

  it('offers a currency choice on salaries only', () => {
    // A supplier invoice or an ad bill arrives in dollars; a toggle there is an invitation to
    // mis-tag one and report it at roughly 2.7x its real cost.
    component.openAddForm(SALARIES_CATEGORY_ID);
    expect(component.canChooseCurrency).toBeTrue();

    component.openAddForm(1); // Supplies
    expect(component.canChooseCurrency).toBeFalse();
  });

  it('defaults a new expense to USD and sends what was picked', () => {
    component.openAddForm(SALARIES_CATEGORY_ID);
    expect(component.formCurrency).toBe('USD');

    component.staffChoice = 7;
    component.form.amount = 1800;
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

    component.form.categoryId = 1; // Supplies
    component.onCategoryChange();

    // The server forces USD on every other category; the form must agree rather than showing a
    // lari amount that is about to be reported as dollars.
    expect(component.formCurrency).toBe('USD');
    expect(component.canChooseCurrency).toBeFalse();
  });

  it('reopens a saved salary in the currency it was entered in', () => {
    component.openEditForm(salaryRow({ currency: 'GEL', amount: 1800 }));
    expect(component.formCurrency).toBe('GEL');
    expect(component.form.amount).toBe(1800);
    expect(component.symbolFor(component.formCurrency)).toBe('₾');
  });

  it('forces USD on a non-salary expense even if the form somehow holds GEL', () => {
    component.openAddForm(1);
    component.form.currency = 'GEL';   // not reachable through the UI, but the DTO must not carry it
    component.form.name = 'Vacuum bags';
    component.form.amount = 40;
    component.save();

    const req = httpMock.expectOne(r => r.method === 'POST' && r.url.endsWith('/expenses'));
    expect(req.request.body.currency).toBe('USD');
    req.flush(salaryRow({ categoryId: 1, currency: 'USD' }));

    httpMock.match(() => true).forEach(r => r.flush([]));
  });
});
