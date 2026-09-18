import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, Router } from '@angular/router';
import { ActivatedRoute, convertToParamMap } from '@angular/router';

import { InvoiceDetailComponent } from './invoice-detail.component';
import { InvoiceStatus } from '../../../../services/invoice.service';
import { environment } from '../../../../../environments/environment';

const ADMIN_URL = `${environment.apiUrl}/admin/commercial/invoices`;

/**
 * VOID / ARCHIVE / FULL DELETE — the three end-of-life choices for an invoice.
 *
 * They mean genuinely different things and used to hide behind one button: an admin who wanted a
 * test invoice gone could only VOID it, which permanently reserves a number for something that
 * never existed. The dialog names all three and makes the destructive one cost something.
 *
 * VOID'S BEHAVIOUR IS UNCHANGED and is asserted here as a regression, because the whole risk of
 * adding two neighbours to it is that one of them quietly becomes the default path.
 */
describe('InvoiceDetailComponent — void, archive or delete', () => {
  let fixture: ComponentFixture<InvoiceDetailComponent>;
  let component: InvoiceDetailComponent;
  let http: HttpTestingController;
  let router: Router;

  const invoice = (overrides: Partial<any> = {}): any => ({
    id: 5,
    invoiceNumber: 'DCI-2026-48392175',
    publicUrl: 'https://example.com/invoice/abc',
    clientName: 'Northline Holdings Inc.',
    status: InvoiceStatus.Draft,
    statusLabel: 'Draft',
    invoiceDate: '2026-09-01',
    dueDate: '2026-09-16',
    subTotal: 500, discountAmount: 0, taxAmount: 0, total: 500,
    amountPaid: 0, balanceDue: 500,
    items: [], payments: [], emails: [], activity: [], paymentAttempts: [],
    coveredOrders: [],
    hasPaymentInProgress: false,
    canEdit: true, canEditMonetaryValues: true, editRequiresWarning: false,
    canSend: true, canRecordPayment: false, canVoid: true, canDelete: true,
    canSendReminder: false,
    isArchived: false,
    canHardDelete: true,
    cannotHardDeleteReason: null,
    ...overrides
  });

  /** Loads the component with a given invoice already on screen. */
  function open(data: any): void {
    fixture.detectChanges();
    http.expectOne(r => r.url === `${ADMIN_URL}/5`).flush(data);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InvoiceDetailComponent],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        {
          // The component reads route.snapshot, not the observable — so that is what the double
          // has to provide, queryParamMap included (it looks for a `sendError` hand-over).
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap({ id: '5' }),
              queryParamMap: convertToParamMap({})
            }
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(InvoiceDetailComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.resolveTo(true);
  });

  afterEach(() => http.verify({ ignoreCancelled: true }));

  // ── the choice ─────────────────────────────────────────────────────────────

  it('opens a choice dialog rather than voiding immediately', () => {
    open(invoice());

    component.openDispose();
    fixture.detectChanges();

    expect(component.modal).toBe('dispose');
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Choose what to do with this invoice');

    // Nothing was sent — opening a dialog is not an action.
    http.expectNone(r => r.url.includes('/void'));
    http.expectNone(r => r.url.includes('/archive'));
    http.expectNone(r => r.url.includes('/permanent'));
  });

  // ── void is unchanged ──────────────────────────────────────────────────────

  /**
   * The existing Void flow still runs exactly as it did: the reason is still required, and the
   * same endpoint with the same body is still what gets called.
   */
  it('still voids through the unchanged endpoint, and still demands a reason', () => {
    open(invoice());

    component.openDispose();
    component.chooseVoid();
    expect(component.modal).toBe('void');

    // No reason typed: nothing happens.
    component.voidInvoice();
    http.expectNone(r => r.url.includes('/void'));

    component.voidReason = 'Issued in error';
    component.voidInvoice();

    const req = http.expectOne(r => r.url === `${ADMIN_URL}/5/void`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ reason: 'Issued in error' });
    req.flush(invoice({ status: InvoiceStatus.Void, canVoid: false }));

    expect(component.notice).toContain('number stays permanently reserved');
  });

  // ── archive ────────────────────────────────────────────────────────────────

  it('archives without touching the status or the figures', () => {
    open(invoice({ status: InvoiceStatus.Paid, amountPaid: 500, balanceDue: 0 }));

    component.openDispose();
    component.archiveInvoice();

    const req = http.expectOne(r => r.url === `${ADMIN_URL}/5/archive`);
    expect(req.request.method).toBe('POST');
    req.flush(invoice({ status: InvoiceStatus.Paid, isArchived: true, amountPaid: 500 }));

    expect(component.modal).toBe('none');
    expect(component.notice).toContain('archived');

    // An archived Paid invoice is still Paid — archive is a filing decision, not a status.
    expect(component.invoice?.status).toBe(InvoiceStatus.Paid);
    expect(component.invoice?.isArchived).toBe(true);
  });

  it('unarchives back onto the active list', () => {
    open(invoice({ isArchived: true }));

    component.unarchiveInvoice();

    const req = http.expectOne(r => r.url === `${ADMIN_URL}/5/unarchive`);
    expect(req.request.method).toBe('POST');
    req.flush(invoice({ isArchived: false }));

    expect(component.invoice?.isArchived).toBe(false);
    expect(component.notice).toContain('unarchived');
  });

  // ── full delete ────────────────────────────────────────────────────────────

  it('requires the invoice number to be typed before deleting', () => {
    open(invoice());
    component.openDispose();

    expect(component.hardDeleteConfirmationPhrase).toBe('DELETE DCI-2026-48392175');

    component.hardDeleteConfirmation = 'DELETE';
    expect(component.hardDeleteConfirmed).toBe(false);
    component.permanentlyDeleteInvoice();
    http.expectNone(r => r.url.includes('/permanent'));

    // Case and surrounding space are not the test — reading the number off the invoice is.
    component.hardDeleteConfirmation = '  delete dci-2026-48392175 ';
    expect(component.hardDeleteConfirmed).toBe(true);
  });

  it('permanently deletes an unused test invoice and returns to the list', () => {
    open(invoice());
    component.openDispose();
    component.hardDeleteConfirmation = 'DELETE DCI-2026-48392175';

    component.permanentlyDeleteInvoice();

    const req = http.expectOne(r => r.url === `${ADMIN_URL}/5/permanent`);
    expect(req.request.method).toBe('DELETE');
    expect(req.request.params.get('confirmation')).toBe('DELETE DCI-2026-48392175');
    req.flush({ message: 'Invoice DCI-2026-48392175 was permanently deleted.' });

    expect(router.navigate).toHaveBeenCalledWith(['/admin/commercial/invoices']);
  });

  /**
   * AN INVOICE WITH FINANCIAL ACTIVITY SHOWS THE REASON, not a disabled button.
   *
   * The server decides; the dialog only renders its answer. A greyed-out control with no
   * explanation sends an admin hunting for a permission problem that does not exist.
   */
  it('explains why full delete is unavailable on a paid invoice', () => {
    open(invoice({
      status: InvoiceStatus.Paid,
      amountPaid: 500,
      balanceDue: 0,
      canVoid: false,
      canDelete: false,
      canHardDelete: false,
      cannotHardDeleteReason:
        'This invoice has financial activity and cannot be permanently deleted. Void or archive it instead.'
    }));

    component.openDispose();
    fixture.detectChanges();

    expect(component.canHardDelete).toBe(false);

    const dom = fixture.nativeElement as HTMLElement;
    expect(dom.querySelector('#invoiceHardDeleteConfirm')).toBeNull();
    expect(dom.querySelector('.blocked-reason')?.textContent)
      .toContain('financial activity');

    // And it cannot be fired past the UI either.
    component.hardDeleteConfirmation = 'DELETE DCI-2026-48392175';
    component.permanentlyDeleteInvoice();
    http.expectNone(r => r.url.includes('/permanent'));
  });

  /** An older backend omits the flag, so the option is simply not offered. */
  it('does not offer full delete when the server did not say it was allowed', () => {
    const data = invoice();
    delete data.canHardDelete;
    open(data);

    expect(component.canHardDelete).toBe(false);
  });
});
