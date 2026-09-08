import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, Router } from '@angular/router';

import { CommercialClientsComponent } from './commercial-clients.component';
import { InvoiceClientOption } from '../../../../services/invoice.service';
import { environment } from '../../../../../environments/environment';

const CLIENTS_URL = `${environment.apiUrl}/admin/commercial/invoices/clients`;
const INACTIVE_URL = `${CLIENTS_URL}?includeInactive=true`;
const PERMISSIONS_URL = `${environment.apiUrl}/admin/permissions`;
const directoryUrl = (id: number) => `${environment.apiUrl}/crm/contract-directory/clients/${id}`;

/**
 * COMMERCIAL → CLIENTS — the single screen for managing commercial customers.
 *
 * The two properties worth pinning here are both about not surprising an admin:
 *
 *  1. **One list, two origins.** A client auto-linked to a business-flagged account and a
 *     standalone one typed in by hand sit side by side and behave identically. The badge is the
 *     only difference in the UI.
 *  2. **Delete says what it will do first.** For a LINKED client it also removes that customer's
 *     business designation — which is exactly what stops the client reappearing on the next sync —
 *     so the confirmation names the customer before anything happens.
 */
describe('CommercialClientsComponent', () => {
  let component: CommercialClientsComponent;
  let fixture: ComponentFixture<CommercialClientsComponent>;
  let httpMock: HttpTestingController;

  const base = {
    billingContactName: 'Ari Existing',
    billingEmail: 'ari@existing.invalid',
    billingPhone: '7185550100',
    billingAddress: '1 Old Street, Brooklyn, NY 11226',
    locations: [],
    contracts: [],
    isActive: true,
    invoiceCount: 0
  };

  const LINKED: InvoiceClientOption = {
    ...base,
    id: 7,
    legalEntityName: 'Chick Tastic LLC',
    sourceUserId: 55,
    linkedAccountName: 'Casey Client',
    linkedAccountEmail: 'casey@chicktastic.invalid',
    contracts: [{ id: 900, contractNumber: 'DCC-2026-11112222', statusLabel: 'Fully signed' }],
    invoiceCount: 3
  };

  const STANDALONE: InvoiceClientOption = {
    ...base,
    id: 91,
    legalEntityName: 'No Account Ltd',
    sourceUserId: null
  };

  const REMOVED: InvoiceClientOption = { ...STANDALONE, id: 92, isActive: false };

  const start = (
    perms: Record<string, boolean> = { canCreate: true, canUpdate: true, canDeactivate: true },
    rows: InvoiceClientOption[] = [LINKED, STANDALONE]
  ) => {
    fixture.detectChanges();
    httpMock.expectOne(PERMISSIONS_URL).flush({ role: 'Admin', permissions: perms });
    httpMock.expectOne(CLIENTS_URL).flush(rows);
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommercialClientsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])]
    }).compileComponents();

    fixture = TestBed.createComponent(CommercialClientsComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('should create', () => {
    start();
    expect(component).toBeTruthy();
  });

  describe('one list, two origins', () => {
    it('lists linked and standalone clients together', () => {
      start();

      expect(component.clients.length).toBe(2);
      expect(component.isLinked(LINKED)).toBeTrue();
      expect(component.isLinked(STANDALONE)).toBeFalse();
    });

    it('lists a client with no contracts like any other', () => {
      start();
      expect(component.clients.find(c => c.id === 91)?.contracts).toEqual([]);
    });

    it('finds a client by the linked account holder\'s name', () => {
      start();
      component.search = 'casey';

      expect(component.filtered.map(c => c.id)).toEqual([7]);
    });

    it('asks for inactive clients only when the toggle is on', () => {
      start();

      // The default request carried no flag at all — that is what keeps a removed client out of
      // every other picker in the app.
      component.showInactive = true;
      component.onShowInactiveChange();

      httpMock.expectOne(INACTIVE_URL).flush([LINKED, STANDALONE, REMOVED]);
      expect(component.clients.length).toBe(3);
    });
  });

  describe('permissions', () => {
    it('offers create, edit and delete to an admin who holds them', () => {
      start();

      expect(component.canCreate).toBeTrue();
      expect(component.canUpdate).toBeTrue();
      expect(component.canDeactivate).toBeTrue();
    });

    it('refuses every action for a view-only admin', () => {
      start({ canCreate: false, canUpdate: false, canDeactivate: false });

      component.openCreate();
      expect(component.modalOpen).toBeFalse();

      component.openEdit(LINKED);
      expect(component.modalOpen).toBeFalse();

      component.askDelete(LINKED);
      expect(component.pendingDelete).toBeNull();
    });

    it('assumes nothing when the permission map cannot be read', () => {
      fixture.detectChanges();
      httpMock.expectOne(PERMISSIONS_URL).flush(
        { message: 'nope' }, { status: 500, statusText: 'Server Error' });
      httpMock.expectOne(CLIENTS_URL).flush([]);

      expect(component.canCreate).toBeFalse();
      expect(component.canUpdate).toBeFalse();
      expect(component.canDeactivate).toBeFalse();
    });
  });

  describe('editing', () => {
    it('opens the shared modal with the client to edit', () => {
      start();

      component.openEdit(LINKED);

      expect(component.modalOpen).toBeTrue();
      expect(component.editing).toBe(LINKED);
    });

    it('opens it empty for a new client', () => {
      start();

      component.openCreate();

      expect(component.modalOpen).toBeTrue();
      expect(component.editing).toBeNull();
    });

    it('reloads after a save', () => {
      start();

      component.onClientSaved(7);
      httpMock.expectOne(CLIENTS_URL).flush([LINKED, STANDALONE]);

      expect(component.expandedId).toBe(7);
    });

    it('clears the search after a creation so the new client cannot be hidden', () => {
      start();
      component.search = 'existing';

      component.onClientCreated(91);
      httpMock.expectOne(CLIENTS_URL).flush([LINKED, STANDALONE]);

      expect(component.search).toBe('');
      expect(component.expandedId).toBe(91);
    });
  });

  describe('delete', () => {
    it('confirms before doing anything', () => {
      start();

      component.askDelete(LINKED);

      expect(component.pendingDelete).toBe(LINKED);
      httpMock.expectNone(directoryUrl(7));
    });

    it('soft-deletes through the directory endpoint and reloads', () => {
      start();
      component.askDelete(LINKED);

      component.confirmDelete();

      const request = httpMock.expectOne(directoryUrl(7));
      expect(request.request.method).toBe('DELETE');
      request.flush({ message: 'Removed.', businessFlagRemoved: true });

      httpMock.expectOne(CLIENTS_URL).flush([STANDALONE]);
      expect(component.pendingDelete).toBeNull();
      expect(component.notice).toBe('Removed.');
    });

    it('does nothing on cancel', () => {
      start();
      component.askDelete(LINKED);

      component.cancelDelete();

      expect(component.pendingDelete).toBeNull();
      httpMock.expectNone(directoryUrl(7));
    });

    it('restores a standalone client', () => {
      start({ canCreate: true, canUpdate: true, canDeactivate: true }, [REMOVED]);

      component.restore(REMOVED);

      httpMock.expectOne(`${directoryUrl(92)}/restore`).flush({ message: 'Listed again.' });
      httpMock.expectOne(CLIENTS_URL).flush([]);
    });

    it('never offers restore for a linked client', () => {
      // It comes back by turning the business flag on again, which reactivates the same row. Two
      // routes to one state is how the two end up disagreeing.
      start();

      component.restore({ ...LINKED, isActive: false });

      httpMock.expectNone(`${directoryUrl(7)}/restore`);
    });
  });

  it('carries the client through to the invoice form', () => {
    start();
    const router = TestBed.inject(Router);
    spyOn(router, 'navigate');

    component.createInvoice(LINKED);

    expect(router.navigate).toHaveBeenCalledWith(
      ['/admin/commercial/invoices/create'], { queryParams: { clientId: 7 } });
  });
});
