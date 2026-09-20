import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { testProviders } from '../../testing/test-providers';
import { InvoiceFormComponent } from '../auth/admin/commercial/invoices/invoice-form.component';
import { InvoiceDetailComponent } from '../auth/admin/commercial/invoices/invoice-detail.component';
import { InvoiceDetail, InvoiceStatus, InvoiceTaxType, InvoiceDiscountType } from '../services/invoice.service';
import { RecurringSeriesPanelComponent } from './components/recurring-series-panel/recurring-series-panel.component';
import { RecurringOrderService, RecurringSeries, RecurrenceIntervalUnit } from '../services/recurring-order.service';
import { UserManagementComponent } from '../auth/admin/user-management/user-management.component';
import { ProfileComponent } from '../auth/profile/profile.component';
import { OrderDetailsComponent } from '../auth/profile/order-details/order-details.component';

describe('Recurring and commercial refinement', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [...testProviders] }));

  function invoice(): InvoiceDetail {
    return {
      id: 1, status: InvoiceStatus.Draft, invoiceNumber: 'DCI-2026-12345678',
      draftWarnings: ['Current contract pricing differs.', 'Current contract tax rate differs.'],
      currentContractUnitPrice: 1000, currentContractTaxType: InvoiceTaxType.Included,
      currentContractTaxRate: 9, items: [], paymentAttempts: [], payments: [], emailHistory: [], activity: []
    } as unknown as InvoiceDetail;
  }

  function form(): InvoiceFormComponent {
    const component = TestBed.runInInjectionContext(() => new InvoiceFormComponent());
    component.existing = invoice();
    component.lines = [{ description: 'Cleaning', quantity: 1, unitPrice: 925.43 }];
    component.taxType = InvoiceTaxType.Included; component.taxRate = 8.875;
    component.discountType = InvoiceDiscountType.None;
    return component;
  }

  it('keeps cloned price until an explicit choice and acknowledges only its warning', () => {
    const c = form(); expect(c.totals.total).toBe(925.43);
    c.chooseDrift(c.existing!.draftWarnings[0], false);
    expect(c.totals.total).toBe(925.43);
    expect(c.existing!.draftWarnings).toEqual(['Current contract tax rate differs.']);
    expect(c.driftChoices).toEqual(['KeepPrice']);
  });

  it('uses current contract pricing only on request without saving or sending', () => {
    const c = form(); spyOn(c, 'saveDraft');
    c.chooseDrift(c.existing!.draftWarnings[0], true);
    expect(c.totals.total).toBe(1000); expect(c.taxRate).toBe(8.875);
    expect(c.driftChoices).toEqual(['CurrentPrice']); expect(c.saveDraft).not.toHaveBeenCalled();
  });

  it('keeps cloned tax unchanged when acknowledged', () => {
    const c = form(); c.chooseDrift(c.existing!.draftWarnings[1], false);
    expect(c.taxRate).toBe(8.875); expect(c.totals.taxAmount).toBe(75.44);
    expect(c.driftChoices).toEqual(['KeepTax']);
    expect(c.existing!.draftWarnings).toEqual(['Current contract pricing differs.']);
  });

  it('uses current contract tax and preserves a tax-inclusive total exactly', () => {
    const c = form(); c.chooseDrift(c.existing!.draftWarnings[1], true);
    expect(c.taxRate).toBe(9); expect(c.totals.total).toBe(925.43);
    expect(c.totals.taxAmount).toBe(76.41);
    expect(c.totals.total - c.totals.taxAmount).toBeCloseTo(849.02, 2);
    expect(c.driftChoices).toEqual(['CurrentTax']);
  });

  it('defaults payment requests on for new series and keeps explicit false on edit', () => {
    const c = new RecurringSeriesPanelComponent({} as RecurringOrderService);
    c.startSetup(); expect(c.autoRequestPayment).toBeTrue();
    c.series = { autoRequestPayment: false, anchorDate: '', serviceTime: '', intervalValue: 2,
      intervalUnit: RecurrenceIntervalUnit.Weeks } as RecurringSeries;
    c.cancelEdit(); expect(c.autoRequestPayment).toBeFalse();
  });

  it('requires Keep or Regenerate when editing a populated future schedule', () => {
    const service = jasmine.createSpyObj('recurring', ['update']);
    const c = new RecurringSeriesPanelComponent(service); c.orderId = 1;
    c.series = { id: 1, intervalValue: 1, intervalUnit: RecurrenceIntervalUnit.Weeks,
      anchorDate: '2026-10-01', serviceTime: '09:00:00', endDate: null,
      occurrences: [{ orderId: 2, wasGenerated: true, serviceDate: '2999-10-01', status: 'Pending' }] } as RecurringSeries;
    c.cancelEdit(); c.intervalValue = 2; c.save();
    expect(service.update).not.toHaveBeenCalled(); expect(c.errorMessage).toContain('keep or regenerate');
    service.update.and.returnValue(of(c.series)); c.futureOrdersAction = 'Keep'; c.save();
    expect(service.update.calls.mostRecent().args[1].futureOrdersAction).toBe('Keep');
  });

  it('excludes business accounts from Customers while preserving the staff scope', () => {
    const c = Object.create(UserManagementComponent.prototype) as any;
    // #5 is the "Move to Customers" case: the business flag is off and the linked client was
    // deactivated rather than deleted, so the account belongs back under Customers. It used to
    // vanish from every tab, because the old flag only asked whether a client row existed.
    c.users = [{ id: 1, role: 'Customer' },
               { id: 2, role: 'Customer', isBusiness: true, hasActiveBusinessClient: true },
               { id: 3, role: 'Admin' },
               { id: 4, role: 'Customer', hasActiveBusinessClient: true },
               { id: 5, role: 'Customer', isBusiness: false, hasActiveBusinessClient: false }];
    c.scope = 'customers'; expect(c.scopedUsers.map((u: any) => u.id)).toEqual([1, 5]);
    c.scope = 'staff'; expect(c.scopedUsers.map((u: any) => u.id)).toEqual([3]);
    expect(c.users.length).toBe(5);
  });

  it('moves a row off Customers the moment the business flag is turned on', () => {
    // The tab membership the filter reads is the SERVER's hasActiveBusinessClient, so the
    // optimistic flag flip alone left the account sitting under Customers until the next full
    // list load - it looked as though the toggle had not taken.
    const c = Object.create(UserManagementComponent.prototype) as any;
    const row = { id: 9, role: 'Customer', isBusiness: false, hasActiveBusinessClient: false };
    c.users = [row]; c.scope = 'customers';
    c.contractPermissions = { toggleBusinessFlag: true };

    c.contractService = { setBusinessFlag: () => of({ isBusiness: true, message: 'Flagged.' }) };
    c.toggleBusinessFlag(row, true);
    expect(row.hasActiveBusinessClient).toBeTrue();
    expect(c.scopedUsers.length).toBe(0);

    c.contractService = { setBusinessFlag: () => of({ isBusiness: false, message: 'Unflagged.' }) };
    c.toggleBusinessFlag(row, false);
    expect(c.scopedUsers.map((u: any) => u.id)).toEqual([9]);
  });

  it('puts the row back on Customers when the flag change fails', () => {
    // The server refuses to unflag an account a live contract depends on. The optimistic removal
    // has to come back with the flag, or the customer is hidden by a change that never happened.
    const c = Object.create(UserManagementComponent.prototype) as any;
    const row = { id: 9, role: 'Customer', isBusiness: false, hasActiveBusinessClient: false };
    c.users = [row]; c.scope = 'customers';
    c.contractPermissions = { toggleBusinessFlag: true };
    c.contractService = { setBusinessFlag: () => throwError(() => ({ status: 400 })) };

    c.toggleBusinessFlag(row, true);

    expect(row.isBusiness).toBeFalse();
    expect(row.hasActiveBusinessClient).toBeFalse();
    expect(c.scopedUsers.map((u: any) => u.id)).toEqual([9]);
  });

  it('keeps a business-flagged account visible somewhere when its link is not active', () => {
    // The flag and the link are separate columns. If the flag outlives an active client - a
    // failed auto-create, a client deactivated by another route - Business Clients cannot show
    // the account (that list is active-only), so Customers must.
    const c = Object.create(UserManagementComponent.prototype) as any;
    c.users = [{ id: 7, role: 'Customer', isBusiness: true, hasActiveBusinessClient: false }];
    c.scope = 'customers'; expect(c.scopedUsers.map((u: any) => u.id)).toEqual([7]);
  });

  it('blocks recurring customer edits and cancellation but retains ordinary behavior', () => {
    // The customer's order list moved onto the profile's Overview tab (2026-09); the two rules
    // under test came with it.
    const list = Object.create(ProfileComponent.prototype);
    const order = { recurringSeriesId: 1, status: 'Active', isPaid: true, serviceDate: '2999-10-01' };
    expect(list.canEditOrder(order)).toBeFalse(); expect(list.canCancelOrder(order)).toBeFalse();
    const detail = Object.create(OrderDetailsComponent.prototype); detail.order = order;
    expect(detail.canEditOrder()).toBeFalse(); expect(detail.canCancelOrder()).toBeFalse();
    order.recurringSeriesId = 0;
    expect(list.canEditOrder(order)).toBeTrue(); expect(list.canCancelOrder(order)).toBeTrue();
  });

  it('shows Cleanings Covered read-only only when allocations exist', () => {
    spyOn(InvoiceDetailComponent.prototype, 'ngOnInit').and.stub();
    const fixture = TestBed.createComponent(InvoiceDetailComponent);
    const c = fixture.componentInstance;
    c.loading = false; c.invoice = invoice();
    c.invoice.cleaningsCovered = [{ orderId: 4, serviceDate: '2026-10-04', serviceAddress: '1579 Flatbush Ave.',
      allocatedAmount: 875, orderStatus: 'Pending' } as any];
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Cleanings Covered'); expect(text).toContain('1579 Flatbush Ave.');
    expect(text).toContain('$875.00'); expect(text).toContain('Order #4');
    c.invoice.cleaningsCovered = []; fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Cleanings Covered');
  });
});
