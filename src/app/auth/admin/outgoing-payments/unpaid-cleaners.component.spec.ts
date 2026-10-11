import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';

import { UnpaidCleanersComponent, todayInNewYork } from './unpaid-cleaners.component';
import { UnpaidCleanersList } from '../../../services/outgoing-payment.service';
import { environment } from '../../../../environments/environment';

const BASE = `${environment.apiUrl}/admin/outgoing-payments`;

/**
 * Unpaid cleaners: who is owed, selectable, payable in one action — with the total following the
 * selection and the pay request carrying exactly the amounts the confirmation showed.
 */
describe('UnpaidCleanersComponent', () => {
  let fixture: ComponentFixture<UnpaidCleanersComponent>;
  let component: UnpaidCleanersComponent;
  let http: HttpTestingController;

  const list = (): UnpaidCleanersList => ({
    totalOutstanding: 189,
    lineCount: 3,
    unassignedOutstanding: 52.5,
    unassignedSlotCount: 1,
    cleaners: [
      {
        cleanerId: 418, firstName: 'Ana', lastName: 'Reyes', isActive: true,
        paymentMethod: 1, paymentDetails: '6465550134', totalOutstanding: 147, topUpOutstanding: 21,
        lines: [
          line(10, 900, 105, false), line(11, 901, 21, true)
        ]
      },
      {
        cleanerId: 419, firstName: 'Ben', lastName: 'Okafor', isActive: true,
        paymentMethod: null, paymentDetails: null, totalOutstanding: 42, topUpOutstanding: 0,
        lines: [line(12, 901, 42, false)]
      }
    ]
  });

  function line(orderCleanerId: number, orderId: number, outstanding: number, isTopUp: boolean) {
    return {
      orderCleanerId, orderId, serviceDate: '2026-08-14T00:00:00', serviceTime: '09:00',
      serviceTypeName: 'Regular Cleaning', rawServiceTypeName: 'Regular Cleaning', customServiceDisplayName: null,
      isCustomServiceType: false, isDeepCleaning: false, customerName: 'Maia Kv',
      billableMinutes: 300, hourlyRate: 21, payout: isTopUp ? 126 : outstanding,
      alreadyPaid: isTopUp ? 105 : 0, outstanding, isTopUp
    };
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UnpaidCleanersComponent],
      providers: [provideHttpClient(withXhr()), provideHttpClientTesting()]
    }).compileComponents();

    fixture = TestBed.createComponent(UnpaidCleanersComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne(`${BASE}/cleaners/unpaid`).flush(list());
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('lists each cleaner owed with the amount, and the grand total', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Ana Reyes');
    expect(text).toContain('$147.00');
    expect(text).toContain('Ben Okafor');
    expect(text).toContain('$189.00');
    expect(text).toContain('Zelle');
    expect(text).toContain('6465550134');
    expect(text).toContain('No payment method on file');
    // Unassigned slots are owed too, but not payable here — said so rather than hidden.
    expect(text).toContain('$52.50 is owed to 1 staffing slot');
  });

  it('expands to the orders behind a cleaner, showing a top-up as only the difference', () => {
    component.toggleExpanded(component.cleaners()[0]);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('#900');
    expect(text).toContain('#901');
    expect(text).toContain('top-up · $105.00 paid before');
  });

  it('totals the selection live', () => {
    component.toggle(component.cleaners()[1], true);
    expect(component.selectedTotal()).toBe(42);

    component.toggleAll(true);
    expect(component.selectedTotal()).toBe(189);
    expect(component.allSelected()).toBe(true);

    component.toggle(component.cleaners()[0], false);
    expect(component.selectedTotal()).toBe(42);
    expect(component.someSelected()).toBe(true);
  });

  it('pays exactly the lines and amounts the confirmation showed, under one key', () => {
    const paid = vi.fn();
    component.paid.subscribe(paid);

    component.toggleAll(true);
    component.openConfirm();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Mark 2 cleaners paid');
    expect(component.paidOn()).toBe(todayInNewYork());

    component.paidVia.set('Cash');
    component.reference.set('ZELLE-77');
    component.confirmPay();

    const request = http.expectOne(`${BASE}/cleaners/pay`);
    expect(request.request.body.cleaners).toEqual([
      { cleanerId: 418, lines: [{ orderCleanerId: 10, amount: 105 }, { orderCleanerId: 11, amount: 21 }] },
      { cleanerId: 419, lines: [{ orderCleanerId: 12, amount: 42 }] }
    ]);
    expect(request.request.body.paidVia).toBe(2);
    expect(request.request.body.reference).toBe('ZELLE-77');
    expect(request.request.body.idempotencyKey.length).toBeGreaterThanOrEqual(8);
    request.flush({ payoutIds: [1, 2], cleanerCount: 2, totalPaid: 189, alreadyRecorded: false });

    expect(paid).toHaveBeenCalled();
    expect(component.selected().size).toBe(0);
    expect(component.success()).toContain('$189.00');
    http.expectOne(`${BASE}/cleaners/unpaid`).flush({ ...list(), cleaners: [], totalOutstanding: 0, lineCount: 0 });
  });

  it('on a conflict pays nothing, says why and reloads the list', () => {
    component.toggleAll(true);
    component.openConfirm();
    component.confirmPay();

    http.expectOne(`${BASE}/cleaners/pay`).flush(
      { message: 'Some of these amounts changed after the confirmation opened.' },
      { status: 409, statusText: 'Conflict' });

    expect(component.error()).toContain('changed after the confirmation opened');
    expect(component.confirming()).toBe(false);
    http.expectOne(`${BASE}/cleaners/unpaid`).flush(list());
  });

  describe('the name filter', () => {
    const typeName = (value: string) => {
      const input = fixture.nativeElement.querySelector('#unpaidNameFilter') as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };

    it('matches a first name, a surname, or both typed with a space', () => {
      typeName('ana');
      expect(component.cleaners().map(c => c.cleanerId)).toEqual([418]);

      typeName('Ben Oka');
      expect(component.cleaners().map(c => c.cleanerId)).toEqual([419]);
      expect(fixture.nativeElement.textContent).not.toContain('Ana Reyes');

      typeName('Ana Okafor');
      expect(component.cleaners()).toEqual([]);
      expect(fixture.nativeElement.textContent).toContain('No cleaner owed money matches');
    });

    it('selects, totals and pays only the cleaners on screen', () => {
      component.toggleAll(true);
      typeName('Ben');

      expect(component.selectedCleaners().map(c => c.cleanerId)).toEqual([419]);
      expect(component.selectedTotal()).toBe(42);
      expect(component.visibleTotal()).toBe(42);

      component.openConfirm();
      component.confirmPay();
      const request = http.expectOne(`${BASE}/cleaners/pay`);
      expect(request.request.body.cleaners.map((c: { cleanerId: number }) => c.cleanerId)).toEqual([419]);
      request.flush({ payoutIds: [1], cleanerCount: 1, totalPaid: 42, alreadyRecorded: false });
      http.expectOne(`${BASE}/cleaners/unpaid`).flush(list());
    });
  });

  it('copies the payment details alone, and confirms it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    (fixture.nativeElement.querySelector('.copy-btn') as HTMLButtonElement).click();
    await Promise.resolve();
    fixture.detectChanges();

    expect(writeText).toHaveBeenCalledWith('6465550134');
    expect(component.isCopied(component.cleaners()[0])).toBe(true);
    // Ben has nothing on file, so there is no button to press for him.
    expect(fixture.nativeElement.querySelectorAll('.copy-btn').length).toBe(1);
  });

  it('asks for the month the page is showing, and again when it moves', () => {
    fixture.componentRef.setInput('from', '2026-08-01');
    fixture.componentRef.setInput('to', '2026-08-31');
    fixture.detectChanges();

    const req = http.expectOne(r => r.url === `${BASE}/cleaners/unpaid`);
    expect(req.request.params.get('from')).toBe('2026-08-01');
    expect(req.request.params.get('to')).toBe('2026-08-31');
    req.flush(list());
  });

  it('works out today in New York, not in the browser\'s zone', () => {
    // 02:30 UTC on Oct 7 is still Oct 6 in New York.
    expect(todayInNewYork(new Date('2026-10-07T02:30:00Z'))).toBe('2026-10-06');
  });
});
