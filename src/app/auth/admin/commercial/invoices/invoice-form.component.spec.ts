import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';

import { InvoiceFormComponent } from './invoice-form.component';
import { ContractClient } from '../../../../services/contract.service';
import { environment } from '../../../../../environments/environment';

const CLIENTS_URL = `${environment.apiUrl}/admin/commercial/invoices/clients`;
const SETTINGS_URL = `${environment.apiUrl}/admin/commercial/billing-settings`;
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
    httpMock.expectOne(SETTINGS_URL).flush({
      companyLegalName: 'Dream Cleaning NYC',
      defaultTaxType: 0, defaultDueTerms: 1, defaultCustomerNote: 'Thank you.'
    });
  });

  afterEach(() => httpMock.verify());

  it('should create', () => {
    expect(component).toBeTruthy();
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
