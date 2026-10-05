import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { testProviders } from '../../../../../testing/test-providers';
import { InvoiceFormComponent } from './invoice-form.component';
import {
  InvoiceDetail, InvoiceDiscountType, InvoiceEligibleOrder, InvoiceStatus, InvoiceTaxType
} from '../../../../services/invoice.service';

/**
 * Linking cleanings under a WEEKLY FLAT FEE contract (2026-10). The bug this guards: "Use current
 * contract price" with six linked cleanings typed an agreed total of 6 × the weekly fee.
 */
describe('InvoiceFormComponent — weekly flat fee', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [...testProviders] });
    httpMock = TestBed.inject(HttpTestingController);
  });

  function order(id: number, overrides: Partial<InvoiceEligibleOrder> = {}): InvoiceEligibleOrder {
    return {
      orderId: id, serviceDate: `2026-10-0${id + 3}T00:00:00`, serviceTime: '09:00:00',
      serviceTypeName: 'Commercial cleaning', serviceAddress: '1 Commerce St', status: 'Pending',
      total: 952.66, contactName: 'Onyx', isOnThisInvoice: false, canSelect: true,
      contractId: 40, contractNumber: 'DCC-2026-12918497', assignedCleaners: 'Ana Lopez',
      occurrenceDate: `2026-10-0${id + 3}T00:00:00`, ...overrides
    };
  }

  function form(weekly: boolean): InvoiceFormComponent {
    const c = TestBed.runInInjectionContext(() => new InvoiceFormComponent());
    c.clientId = 7;
    c.clients = [{
      id: 7, legalEntityName: 'Onyx LLC', locations: [],
      contracts: [{ id: 40, contractNumber: 'DCC-2026-12918497', statusLabel: 'FullySigned',
        pricingBasis: weekly ? 'WeeklyFlatFee' : 'PerVisit', agreedAmount: 952.66 }]
    }] as any;
    c.existing = {
      id: 1, status: InvoiceStatus.Draft, invoiceNumber: 'DCI-2026-12345678',
      draftWarnings: ['Current contract pricing differs.'],
      currentContractUnitPrice: weekly ? 952.66 : 150, currentContractTaxType: InvoiceTaxType.Included,
      currentContractTaxRate: 8.875, currentContractIsWeeklyFlatFee: weekly,
      items: [], paymentAttempts: [], payments: [], emailHistory: [], activity: []
    } as unknown as InvoiceDetail;
    c.taxType = InvoiceTaxType.Included; c.taxRate = 8.875;
    c.discountType = InvoiceDiscountType.None;
    c.eligibleOrders = [1, 2, 3, 4, 5, 6].map(id => order(id));
    c.selectedOrderIds = [1, 2, 3, 4, 5, 6];
    return c;
  }

  afterEach(() => httpMock.match(() => true));

  it('"use current contract price" never multiplies the weekly fee by the number of cleanings', () => {
    const c = form(true);
    c.contractId = 40;
    c.chooseDrift(c.existing!.draftWarnings[0], true);

    // The server prices the weeks from the contract; no 6 × $952.66 agreed total is typed.
    expect(c.negotiatingTotal).toBe(false);
    expect(c.negotiatedGroupTotal).toBeNull();
    const preview = httpMock.expectOne(r => r.url.endsWith('/orders/preview'));
    expect(preview.request.body.negotiatedGroupTotal).toBeNull();
    expect(preview.request.body.orderIds).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('per-visit contracts keep their existing visits × price behaviour', () => {
    const c = form(false);
    c.contractId = 40;
    c.chooseDrift(c.existing!.draftWarnings[0], true);

    expect(c.negotiatingTotal).toBe(true);
    expect(c.negotiatedGroupTotal).toBe(900);
  });

  it('shows the server\'s weekly pricing: one fee per service week, never the cleanings\' own totals', () => {
    const c = form(true);
    c.contractId = 40;
    expect(c.contractIsWeeklyFlatFee).toBe(true);
    c.previewAllocation();
    httpMock.expectOne(r => r.url.endsWith('/orders/preview')).flush({
      serviceDates: c.eligibleOrders.map(o => o.serviceDate), invoiceId: 0, invoiceNumber: '',
      defaultTotal: 5715.96, invoiceTotal: 952.66, allocations: [], warnings: [],
      items: [{ description: 'Weekly commercial cleaning service fee - 6 scheduled visits per week', quantity: 1, unitPrice: 952.66 }],
      pricedAsWeeklyFlatFee: true, serviceWeekCount: 1
    });
    expect(c.pricedAsWeeklyFlatFee).toBe(true);
    expect(c.serviceWeekCount).toBe(1);
    expect(c.lines.length).toBe(1);
    expect(c.totals.total).toBe(952.66);
  });

  it('surfaces the partial-week warning without blocking the save', () => {
    const c = form(true);
    c.contractId = 40;
    c.selectedOrderIds = [2, 3, 4];
    c.previewAllocation();
    httpMock.expectOne(r => r.url.endsWith('/orders/preview')).flush({
      serviceDates: [], invoiceId: 0, invoiceNumber: '', defaultTotal: 0, invoiceTotal: 952.66, allocations: [],
      warnings: ['Only 3 of 6 scheduled visits for the service week of Oct 4, 2026 are selected. This contract uses a flat weekly fee of $875.00. Review before creating the invoice.'],
      items: [{ description: 'Weekly commercial cleaning service fee', quantity: 1, unitPrice: 952.66 }],
      pricedAsWeeklyFlatFee: true, serviceWeekCount: 1
    });
    expect(c.allocationWarnings[0]).toContain('Only 3 of 6 scheduled visits');
    expect(c.canSave).toBe(true);
  });

  it('ticking a contract-scheduled cleaning with no contract chosen selects that contract', () => {
    const c = form(true);
    c.contractId = null;
    c.selectedOrderIds = [];
    c.toggleOrder(c.eligibleOrders[0]);

    expect(c.contractId as number | null).toBe(40);
    expect(c.selectedOrderIds).toEqual([1]);
    // The picker is re-read for that contract (other contracts' cleanings come back blocked).
    const eligible = httpMock.match(r => r.url.includes('/eligible-orders/7'));
    expect(eligible.length).toBeGreaterThan(0);
    expect(eligible[0].request.params.get('contractId')).toBe('40');
  });
});
