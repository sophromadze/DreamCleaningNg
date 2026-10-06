import { TestBed } from '@angular/core/testing';
import { testProviders } from '../../../../testing/test-providers';
import { AdminCustomerInvoicesComponent } from './admin-customer-invoices.component';
import { CustomerInvoiceOrderOption } from '../../../services/customer-invoice.service';
import { AdminBookingPaymentOptions, adminMethodIsSettled } from '../../../booking/booking.component';
import { CustomerInvoicePageComponent } from '../../../invoice/customer-invoice/customer-invoice-page.component';

/**
 * Regular customer invoices (Admin → Invoices, 2026-09). The server owns every rule; these pin the
 * form's own arithmetic and the choices it offers, on an instance built outside any template (its
 * state lives in signals, which only exist once the field initializers have run).
 */
describe('AdminCustomerInvoicesComponent (create form)', () => {
  const order = (over: Partial<CustomerInvoiceOrderOption> = {}): CustomerInvoiceOrderOption => ({
    orderId: 7, serviceTypeName: 'Regular Cleaning', serviceDate: '2026-10-07', status: 'Pending',
    total: 2743.65, amountDue: 2743.65, availableToInvoice: 2743.65, canInvoice: true,
    cannotInvoiceReason: null, openInvoiceNumbers: [], ...over
  });

  beforeEach(() => TestBed.configureTestingModule({ providers: [...testProviders] }));

  const bare = (): AdminCustomerInvoicesComponent => {
    const c = TestBed.runInInjectionContext(() => new AdminCustomerInvoicesComponent());
    c.orderOptions.set([order()]);
    c.selectedOrderId.set(7);
    c.splitMode.set(false);
    c.splitAmounts.set([null, null]);
    c.creating.set(false);
    return c;
  };

  it('bills the whole balance by default', () => {
    const c = bare();
    expect(c.isSplit).toBe(false);
    expect(c.canSubmitCreate).toBe(true);
  });

  it('fills the last split with whatever is not allocated yet', () => {
    const c = bare();
    c.splitMode.set(true);
    c.splitAmounts.set([1000, null]);
    c.fillRemainder(1);
    expect(c.splitAmounts()[1]).toBe(1743.65);
    expect(c.splitTotal).toBe(2743.65);
    expect(c.splitUnallocated).toBe(0);
    expect(c.canSubmitCreate).toBe(true);
  });

  it('refuses a split that asks for more than is owed, or a slice under the $0.50 card minimum', () => {
    const c = bare();
    c.splitMode.set(true);
    c.splitAmounts.set([2000, 1000]);
    expect(c.splitUnallocated).toBeLessThan(0);
    expect(c.canSubmitCreate).toBe(false);

    c.splitAmounts.set([2743.40, 0.25]);
    expect(c.canSubmitCreate).toBe(false);
  });

  it('keeps splitting an order that already carries a split invoice — never a whole-balance one beside it', () => {
    const c = bare();
    c.orderOptions.set([order({ openInvoiceNumbers: ['DCR-2026-12345678'], availableToInvoice: 1743.65 })]);
    c.splitMode.set(false);
    expect(c.isSplit).toBe(true);
  });

  it('cannot submit an order the server said cannot be invoiced', () => {
    const c = bare();
    c.orderOptions.set([order({ canInvoice: false, cannotInvoiceReason: 'Already invoiced in full.' })]);
    expect(c.canSubmitCreate).toBe(false);
  });
});

describe('booking page admin payment choices', () => {
  it('offers Invoice to everybody and Commercial invoice only to a business customer', () => {
    const regular = AdminBookingPaymentOptions(false).map(o => o.value);
    expect(regular).toContain('RegularInvoice');
    expect(regular).not.toContain('Invoice');

    const business = AdminBookingPaymentOptions(true);
    expect(business.map(o => o.value)).toContain('Invoice');
    expect(business.find(o => o.value === 'RegularInvoice')?.label).toBe('Invoice');
  });

  it('never treats a regular invoice as money already received', () => {
    expect(adminMethodIsSettled('RegularInvoice')).toBe(false);
    expect(adminMethodIsSettled('Invoice')).toBe(false);
    expect(adminMethodIsSettled('Zelle')).toBe(true);
  });
});

describe('CustomerInvoicePageComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [...testProviders] }));

  const page = (status: string, amountDue: number) => {
    const c = TestBed.runInInjectionContext(() => new CustomerInvoicePageComponent());
    c.invoice.set({ status, amountDue, kind: 'Full' } as any);
    return c;
  };

  it('offers payment only while the invoice is owed', () => {
    expect(page('Sent', 100).isPayable).toBe(true);
    expect(page('NotSent', 100).isPayable).toBe(true);
    expect(page('Paid', 0).isPayable).toBe(false);
    expect(page('Void', 100).isPayable).toBe(false);
    expect(page('Cancelled', 100).isPayable).toBe(false);
  });

  it('reads a service time as a 12-hour clock', () => {
    const c = page('Sent', 1);
    expect(c.formatTime('14:30')).toBe('2:30 PM');
    expect(c.formatTime('09:00')).toBe('9:00 AM');
  });
});
