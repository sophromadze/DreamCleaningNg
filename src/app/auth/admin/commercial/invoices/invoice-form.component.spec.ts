import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, Router } from '@angular/router';

import { InvoiceFormComponent } from './invoice-form.component';
import { InvoiceEligibleOrder, InvoiceTaxType, InvoiceStatus } from '../../../../services/invoice.service';
import { ContractClient } from '../../../../services/contract.service';
import { environment } from '../../../../../environments/environment';

const CLIENTS_URL = `${environment.apiUrl}/admin/commercial/invoices/clients`;
const SETTINGS_URL = `${environment.apiUrl}/admin/commercial/billing-settings`;

/**
 * The commercial billing DEFAULTS — the tax mode, rate and terms a new invoice starts from, and
 * the same row the contract form reads. A narrower endpoint than the settings above, because this
 * form needs those five values and never displays the company's bank account.
 */
const DEFAULTS_URL = `${environment.apiUrl}/admin/commercial/billing-settings/defaults`;
const PERMISSIONS_URL = `${environment.apiUrl}/admin/permissions`;

/**
 * CREATE INVOICE — the client picker, and the client that has no contract.
 *
 * The whole point of the 2026-09 change: a commercial client is a first-class thing that can be
 * invoiced with no agreement behind it, and one created from this page must become usable WITHOUT
 * a reload — a reload would discard every line item and date already typed, which is the only
 * reason the shortcut exists rather than a link to the Clients tab.
 */
describe('InvoiceFormComponent', () => {
  let component: InvoiceFormComponent;
  let fixture: ComponentFixture<InvoiceFormComponent>;
  let httpMock: HttpTestingController;

  const CLIENT_A = {
    id: 7,
    legalEntityName: 'Existing Client LLC',
    billingContactName: 'Ari Existing',
    billingEmail: 'ari@existing.invalid',
    billingPhone: '7185550100',
    billingAddress: '1 Old Street, Brooklyn, NY 11226',
    locations: [{ id: 70, label: 'Old Street', address: '1 Old Street, Brooklyn, NY 11226' }],
    contracts: [{ id: 900, contractNumber: 'DCC-2026-11112222', statusLabel: 'Executed' }]
  };

  /** The brand new one: a billing contact, one location, and no contracts at all. */
  const CLIENT_NEW = {
    id: 91,
    legalEntityName: 'Chick Tastic LLC',
    billingContactName: 'Casey Client',
    billingEmail: 'casey@chicktastic.invalid',
    billingPhone: '7185550123',
    billingAddress: '1569 Flatbush Ave., Brooklyn, NY 11210',
    locations: [{ id: 910, label: 'Flatbush Ave.', address: '1569 Flatbush Ave., Brooklyn, NY 11210' }],
    contracts: []
  };

  const createdClient: ContractClient = {
    id: 91,
    legalEntityName: 'Chick Tastic LLC',
    entityType: 'a limited liability company',
    principalAddress: '1569 Flatbush Ave.',
    city: 'Brooklyn',
    state: 'NY',
    zip: '11210',
    isActive: true,
    sourceUserId: null,
    serviceLocations: [],
    contacts: []
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InvoiceFormComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])]
    }).compileComponents();

    fixture = TestBed.createComponent(InvoiceFormComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);

    fixture.detectChanges();

    httpMock.expectOne(PERMISSIONS_URL).flush({ role: 'Admin', permissions: { canCreate: true } });
    httpMock.expectOne(CLIENTS_URL).flush([CLIENT_A]);

    // Tax-inclusive at 8.875%, from the ONE saved source of commercial billing defaults.
    httpMock.expectOne(DEFAULTS_URL).flush({
      defaultTaxType: 1, defaultTaxRate: 8.875, defaultContractPriceMode: 0, defaultDueTerms: 2,
      achCustomerFeeEnabled: true, achCustomerFeeRatePercent: 0.8, achCustomerFeeCapAmount: 5
    });

    // The customer note still comes from the full settings read; nothing else here does.
    httpMock.expectOne(SETTINGS_URL).flush({
      companyLegalName: 'Dream Cleaning NYC',
      defaultTaxType: 1, defaultDueTerms: 2, defaultCustomerNote: 'Thank you.'
    });
  });

  /**
   * Picking a client also loads the CLEANINGS that client has, for the "which visits does this
   * invoice cover?" picker. It is optional information — an invoice can perfectly well be raised
   * without linking any cleaning, and the component treats a failure as non-fatal — so these
   * tests, which are about the client dropdown, drain it rather than asserting on it.
   */
  function drainEligibleOrderRequests(): void {
    for (const request of httpMock.match(r => r.url.includes('/eligible-orders/'))) {
      request.flush({ contractClientId: 0, orders: [] });
    }
  }

  afterEach(() => {
    drainEligibleOrderRequests();
    httpMock.verify();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  const PREVIEW_URL = `${environment.apiUrl}/admin/commercial/invoices/orders/preview`;
  function linkedRows(prices = [925.43, 925.43, 925.43]): InvoiceEligibleOrder[] {
    return ['2026-09-13', '2026-09-27', '2026-10-04'].map((date, i) => ({
      orderId: i + 1, serviceDate: date, serviceTime: '09:00:00', serviceTypeName: 'Commercial cleaning',
      serviceAddress: 'Test address', status: 'Pending', total: prices[i], contactName: 'Test',
      isOnThisInvoice: false, canSelect: true
    }));
  }
  function previewResponse(rows: InvoiceEligibleOrder[], amounts = rows.map(o => o.total)) {
    return { invoiceId: 0, invoiceNumber: '', defaultTotal: rows.reduce((s, o) => s + o.total, 0),
      invoiceTotal: amounts.reduce((s, n) => s + n, 0), warnings: [],
      serviceDates: rows.map(o => o.serviceDate),
      items: rows.map((o, i) => ({ description: `Commercial cleaning - ${o.serviceDate}`, quantity: 1, unitPrice: amounts[i], sortOrder: i })),
      allocations: rows.map((o, i) => ({ orderId: o.orderId, serviceDate: o.serviceDate, description: 'Cleaning',
        originalOrderTotal: o.total, allocatedAmount: amounts[i], isProposal: true, orderStatus: o.status })) };
  }
  function prepareLinkedDraft(prices?: number[]): void {
    component.clientId = 7;
    component.eligibleOrders = linkedRows(prices);
    component.lines = [{ description: 'Cloned old single line', quantity: 1, unitPrice: 925.43 }];
    component.serviceDates = ['2026-09-13']; component.serviceStartDate = '2026-09-13'; component.serviceEndDate = '2026-09-13';
    component.taxType = InvoiceTaxType.Included; component.taxRate = 8.875;
  }

  it('derives all selected lines and dates immediately on an unsaved cloned draft', async () => {
    prepareLinkedDraft(); component.selectAllEligible();
    expect(component.lines.length).toBe(3); expect(component.totals.total).toBe(2776.29);
    expect(component.serviceDates).toEqual(['2026-09-13', '2026-09-27', '2026-10-04']);
    expect(component.serviceStartDate).toBe('2026-09-13'); expect(component.serviceEndDate).toBe('2026-10-04');
    const request = httpMock.expectOne(PREVIEW_URL);
    expect(request.request.body.orderIds).toEqual([1, 2, 3]);
    request.flush(previewResponse(component.eligibleOrders)); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(component.totals.preTaxTotal).toBe(2549.98); expect(component.totals.taxAmount).toBe(226.31);
    expect(component.balanceDue).toBe(2776.29);
    expect(fixture.nativeElement.querySelector('.service-dates')).toBeNull();
    expect(fixture.nativeElement.querySelector('#serviceStart').disabled).toBeTrue();
    expect(fixture.nativeElement.querySelector('#serviceEnd').disabled).toBeTrue();
    expect(fixture.nativeElement.querySelector('.totals').textContent).toContain('$2,549.98');
    component.toggleOrder(component.eligibleOrders[2]);
    expect(component.serviceEndDate).toBe('2026-09-27'); expect(component.totals.total).toBe(1850.86);
    httpMock.expectOne(PREVIEW_URL).flush(previewResponse(component.eligibleOrders.slice(0, 2)));
    component.clearOrderSelection(); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.service-dates')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#serviceStart').disabled).toBeFalse();
    expect(component.lines[0].description).toBe('Cloned old single line');
    expect(component.serviceDates).toEqual(['2026-09-13']);
  });

  it('sums unequal current prices and lets the server allocate an agreed total before first save', () => {
    prepareLinkedDraft([900, 950, 1000]); component.selectAllEligible();
    expect(component.totals.total).toBe(2850);
    httpMock.expectOne(PREVIEW_URL).flush(previewResponse(component.eligibleOrders));
    component.negotiatingTotal = true; component.negotiatedGroupTotal = 2500; component.previewAllocation();
    const request = httpMock.expectOne(PREVIEW_URL); expect(request.request.body.negotiatedGroupTotal).toBe(2500);
    request.flush(previewResponse(component.eligibleOrders, [833.34, 833.33, 833.33]));
    expect(component.totals.total).toBe(2500); expect(component.balanceDue).toBe(2500);
    component.cancelNegotiatedTotal();
    httpMock.expectOne(PREVIEW_URL).flush(previewResponse(component.eligibleOrders));
    expect(component.totals.total).toBe(2850);
  });

  it('ignores an older preview after the selected dates have changed', () => {
    prepareLinkedDraft(); component.selectAllEligible(); const old = httpMock.expectOne(PREVIEW_URL);
    component.toggleOrder(component.eligibleOrders[2]); const fresh = httpMock.expectOne(PREVIEW_URL);
    fresh.flush(previewResponse(component.eligibleOrders.slice(0, 2)));
    old.flush(previewResponse(component.eligibleOrders));
    expect(component.lines.length).toBe(2); expect(component.totals.total).toBe(1850.86);
    expect(component.serviceEndDate).toBe('2026-09-27');
  });

  it('saves the selection and invoice together without a second mutating selection request', () => {
    prepareLinkedDraft(); component.selectAllEligible();
    httpMock.expectOne(PREVIEW_URL).flush(previewResponse(component.eligibleOrders));
    spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    component.saveDraft();
    const request = httpMock.expectOne(`${environment.apiUrl}/admin/commercial/invoices`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body.orderIds).toEqual([1, 2, 3]);
    expect(request.request.body.items.length).toBe(3);
    expect(request.request.body.serviceEndDate).toBe('2026-10-04');
    request.flush({ id: 12 });
    httpMock.expectNone(`${environment.apiUrl}/admin/commercial/invoices/12/orders`);
    expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(['/admin/commercial/invoices', 12]);
  });

  it('keeps finalized snapshots intact even when their underlying order prices differ', () => {
    prepareLinkedDraft(); component.selectedOrderIds = [1, 2, 3];
    component.existing = { status: InvoiceStatus.Sent } as any;
    component.previewAllocation(); component.toggleOrder(component.eligibleOrders[2]);
    httpMock.expectNone(PREVIEW_URL);
    expect(component.lines.length).toBe(1); expect(component.selectedOrderIds).toEqual([1, 2, 3]);
  });

  describe('a client created from this page is usable immediately', () => {
    it('refreshes the roster, selects the new client and loads its details — no reload', () => {
      expect(component.clientId).toBeNull();

      component.onClientCreated(createdClient);

      // The roster is refetched because the create call returns a ContractClient, not the joined
      // option shape this form renders.
      httpMock.expectOne(CLIENTS_URL).flush([CLIENT_A, CLIENT_NEW]);

      expect(component.clientId).toBe(91);
      expect(component.selectedClient?.legalEntityName).toBe('Chick Tastic LLC');
      expect(component.selectedClient?.billingEmail).toBe('casey@chicktastic.invalid');

      // Its single location is picked up and drives the service address, exactly as a manual
      // pick would.
      expect(component.availableLocations.length).toBe(1);
      expect(component.locationId).toBe(910);
      expect(component.serviceAddress).toBe('1569 Flatbush Ave., Brooklyn, NY 11210');
    });

    it('leaves Related Contract on "no contract"', () => {
      component.onClientCreated(createdClient);
      httpMock.expectOne(CLIENTS_URL).flush([CLIENT_A, CLIENT_NEW]);

      // A brand new client has none, and an invoice does not need one. This must not block
      // anything downstream.
      expect(component.contractId).toBeNull();
      expect(component.availableContracts).toEqual([]);
    });

    it('still selects the client if the refresh fails, rather than losing it', () => {
      component.onClientCreated(createdClient);

      httpMock.expectOne(CLIENTS_URL).flush(
        { message: 'nope' }, { status: 500, statusText: 'Server Error' });

      expect(component.clientId).toBe(91);
    });

    it('clears a previous client\'s contract and location on switching', () => {
      component.clientId = 7;
      component.onClientChange();
      expect(component.locationId).toBe(70);

      component.onClientCreated(createdClient);
      httpMock.expectOne(CLIENTS_URL).flush([CLIENT_A, CLIENT_NEW]);

      // Both belonged to the previous client; the server refuses another client's contract anyway.
      expect(component.contractId).toBeNull();
      expect(component.locationId).toBe(910);
    });
  });

  describe('the "New client" button', () => {
    it('is offered to an admin who holds Create', () => {
      expect(component.canCreateClient).toBeTrue();

      component.openClientModal();
      expect(component.showClientModal).toBeTrue();
    });

    it('does nothing for a view-only admin', () => {
      component.canCreateClient = false;

      component.openClientModal();

      expect(component.showClientModal).toBeFalse();
    });

    it('does nothing once the invoice is monetarily locked', () => {
      // A paid invoice's client cannot change, so neither can the shortcut that would change it.
      component.monetaryLocked = true;

      component.openClientModal();

      expect(component.showClientModal).toBeFalse();
    });
  });
});
