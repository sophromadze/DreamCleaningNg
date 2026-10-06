import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';

import { CleanerPayoutHistoryComponent } from './cleaner-payout-history.component';
import { CleanerPayout, CleanerPayoutHistory } from '../../../services/outgoing-payment.service';
import { environment } from '../../../../environments/environment';

const BASE = `${environment.apiUrl}/admin/outgoing-payments`;

/** Paid cleaners: the payout history, filterable, expandable, and revertable with a reason. */
describe('CleanerPayoutHistoryComponent', () => {
  let fixture: ComponentFixture<CleanerPayoutHistoryComponent>;
  let component: CleanerPayoutHistoryComponent;
  let http: HttpTestingController;

  const payout = (overrides: Partial<CleanerPayout> = {}): CleanerPayout => ({
    id: 5, cleanerId: 418, cleanerName: 'Ana Reyes', amount: 147, activeAmount: 147,
    paidOn: '2026-09-20T00:00:00', paidVia: 1, reference: 'ZELLE-77', note: 'August run',
    createdByName: 'Olga Owner', createdAt: '2026-09-20T15:00:00Z', isImported: false,
    status: 'Active', canRevert: true,
    lines: [
      { id: 1, orderId: 900, serviceDate: '2026-08-14T00:00:00', serviceTypeName: 'Regular Cleaning',
        rawServiceTypeName: 'Regular Cleaning', isCustomServiceType: false, isDeepCleaning: false,
        customerName: 'Maia Kv', amount: 105, isTopUp: false, isReverted: false },
      { id: 2, orderId: 901, serviceDate: '2026-08-20T00:00:00', serviceTypeName: 'Regular Cleaning',
        rawServiceTypeName: 'Regular Cleaning', isCustomServiceType: false, isDeepCleaning: true,
        customerName: 'Maia Kv', amount: 42, isTopUp: true, isReverted: false }
    ],
    ...overrides
  });

  const history = (payouts: CleanerPayout[] = [payout()]): CleanerPayoutHistory => ({
    payouts, totalCount: payouts.length, page: 1, pageSize: 20,
    totalPaid: payouts.reduce((s, p) => s + p.activeAmount, 0),
    cleanerOptions: [{ cleanerId: 418, name: 'Ana Reyes' }, { cleanerId: 419, name: 'Ben Okafor' }]
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CleanerPayoutHistoryComponent],
      providers: [provideHttpClient(withXhr()), provideHttpClientTesting()]
    }).compileComponents();

    fixture = TestBed.createComponent(CleanerPayoutHistoryComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne(r => r.url === `${BASE}/payouts`).flush(history());
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('shows each payout with who, when, how and how much', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Ana Reyes');
    expect(text).toContain('Sep 20, 2026');
    expect(text).toContain('Zelle');
    expect(text).toContain('ZELLE-77');
    expect(text).toContain('$147.00');
  });

  it('expands to the orders the payout covered', () => {
    component.toggleExpanded(component.data()!.payouts[0]);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('#900');
    expect(text).toContain('#901');
    expect(text).toContain('top-up');
    expect(text).toContain('by Olga Owner');
  });

  it('filters by the day paid and by cleaner, from page one', () => {
    component.page.set(3);
    component.from.set('2026-09-01');
    component.to.set('2026-09-30');
    component.cleanerId.set(418);
    component.onFilterChange();

    const request = http.expectOne(r => r.url === `${BASE}/payouts`);
    expect(request.request.params.get('from')).toBe('2026-09-01');
    expect(request.request.params.get('to')).toBe('2026-09-30');
    expect(request.request.params.get('cleanerId')).toBe('418');
    expect(request.request.params.get('page')).toBe('1');
    request.flush(history());
  });

  it('reverts a payout only with a reason, then tells the page to reload', () => {
    const changed = vi.fn();
    component.changed.subscribe(changed);

    component.openRevert(component.data()!.payouts[0]);
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('.btn-danger') as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    component.revertReason.set('Sent to the wrong account');
    component.confirmRevert();

    const request = http.expectOne(`${BASE}/payouts/5/revert`);
    expect(request.request.body).toEqual({ reason: 'Sent to the wrong account' });
    request.flush(payout({ status: 'Reverted', activeAmount: 0, canRevert: false, revertReason: 'Sent to the wrong account' }));

    expect(changed).toHaveBeenCalled();
    expect(component.success()).toContain('back under Unpaid cleaners');
    http.expectOne(r => r.url === `${BASE}/payouts`).flush(history([
      payout({ status: 'Reverted', activeAmount: 0, canRevert: false })
    ]));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Reverted');
  });
});
