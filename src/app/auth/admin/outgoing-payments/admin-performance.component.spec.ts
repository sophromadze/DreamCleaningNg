import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { AdminPerformanceComponent, matchesAdminSearch, periodRange } from './admin-performance.component';
import { AdminPerformanceList, AdminPerformanceRow } from '../../../services/outgoing-payment.service';

/**
 * Outgoing Payments → Admins: the period chips turn into the right inclusive dates, the search
 * finds an admin by "first last" WITH the space (or by email), and the table shows the server's
 * figures without recomputing any of them.
 */
describe('AdminPerformanceComponent', () => {
  const row = (o: Partial<AdminPerformanceRow> = {}): AdminPerformanceRow => ({
    adminId: 1, firstName: 'Ana', lastName: 'Beridze', email: 'ana@example.invalid',
    position: 'Administrator', isActive: true, completedOrders: 3,
    ordersTotal: 653.25, netIncome: 288.9, salesTax: 53.25, cleanerWages: 300, staffBonuses: 11.1,
    newCustomerOrders: 1, returningCustomerOrders: 2, ordersTotalNew: 217.75, ordersTotalReturning: 435.5,
    netIncomeNew: 96.3, netIncomeReturning: 192.6,
    ...o
  });

  describe('periods', () => {
    it('names inclusive service-date ranges counted from today', () => {
      expect(periodRange('this-month', '2026-10-14')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
      expect(periodRange('last-month', '2026-10-14')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
      expect(periodRange('this-year', '2026-10-14')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
      expect(periodRange('all-time', '2026-10-14')).toEqual({ from: null, to: null });
      expect(periodRange('custom', '2026-10-14', { from: '2026-10-03', to: '2026-10-09' }))
        .toEqual({ from: '2026-10-03', to: '2026-10-09' });
    });

    it('rolls last month back over the new year, and knows February', () => {
      expect(periodRange('last-month', '2027-01-05')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
      expect(periodRange('this-month', '2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    });
  });

  describe('search', () => {
    it('finds an admin by first and last name typed with a space, in any case', () => {
      expect(matchesAdminSearch(row(), 'Ana Beridze')).toBe(true);
      expect(matchesAdminSearch(row(), '  ana   berid ')).toBe(true);
      expect(matchesAdminSearch(row(), 'Beridze Ana')).toBe(true);
      expect(matchesAdminSearch(row(), 'Ana Kapanadze')).toBe(false);
    });

    it('finds an admin by email', () => {
      expect(matchesAdminSearch(row(), 'ana@example')).toBe(true);
      expect(matchesAdminSearch(row(), '')).toBe(true);
    });
  });

  describe('the table', () => {
    let fixture: ComponentFixture<AdminPerformanceComponent>;
    let http: HttpTestingController;

    beforeEach(async () => {
      await TestBed.configureTestingModule({
        imports: [AdminPerformanceComponent],
        providers: [provideHttpClient(withXhr()), provideHttpClientTesting()]
      }).compileComponents();
      fixture = TestBed.createComponent(AdminPerformanceComponent);
      http = TestBed.inject(HttpTestingController);
    });

    afterEach(() => http.verify());

    function answer(list: AdminPerformanceList): void {
      const req = http.expectOne(r => r.url.endsWith('/outgoing-payments/admins'));
      req.flush(list);
      fixture.detectChanges();
    }

    it('asks for this month first and renders each admin with a totals line', () => {
      fixture.detectChanges();
      const req = http.expectOne(r => r.url.endsWith('/outgoing-payments/admins'));
      expect(req.request.params.get('from')).toMatch(/^\d{4}-\d{2}-01$/);
      req.flush({ admins: [row(), row({ adminId: 2, firstName: 'Gio', lastName: 'Kapanadze', email: 'gio@example.invalid',
        completedOrders: 1, ordersTotal: 100, netIncome: 40 })] });
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const rows = el.querySelectorAll('tbody tr');
      expect(rows.length).toBe(2);
      expect(rows[0].textContent).toContain('Ana Beridze');
      expect(rows[0].textContent).toContain('$653.25');
      expect(rows[0].textContent).toContain('$288.90');
      // Split by new and returning customers.
      expect(rows[0].textContent).toContain('$217.75');
      expect(rows[0].textContent).toContain('$435.50');
      expect(rows[0].textContent).toContain('$192.60');
      expect(el.querySelectorAll('thead .sub-row th').length).toBe(9);
      expect(el.querySelector('tfoot')!.textContent).toContain('4');
      expect(el.querySelector('tfoot')!.textContent).toContain('$753.25');
    });

    it('asks for everything when All time is chosen', () => {
      fixture.detectChanges();
      answer({ admins: [] });

      fixture.componentInstance.setPeriod('all-time');
      const req = http.expectOne(r => r.url.endsWith('/outgoing-payments/admins'));
      expect(req.request.params.has('from')).toBe(false);
      expect(req.request.params.has('to')).toBe(false);
      req.flush({ admins: [] });
    });

    it('filters the visible rows and the totals by the search', () => {
      fixture.detectChanges();
      answer({ admins: [row(), row({ adminId: 2, firstName: 'Gio', lastName: 'Kapanadze', email: 'gio@example.invalid' })] });

      fixture.componentInstance.search.set('gio kapa');
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelectorAll('tbody tr').length).toBe(1);
      expect(el.querySelector('tbody')!.textContent).toContain('Gio Kapanadze');
    });
  });
});
