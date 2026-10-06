import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideRouter, ActivatedRoute, convertToParamMap } from '@angular/router';

import { InvoiceDetailComponent } from './invoice-detail.component';
import { InvoiceEmailStatus, InvoiceEmailType, InvoiceStatus } from '../../../../services/invoice.service';
import { environment } from '../../../../../environments/environment';

const ADMIN_URL = `${environment.apiUrl}/admin/commercial/invoices`;

/**
 * Who an invoice goes to (2026-10): its own recipient list, shown on the detail page, edited in
 * its own dialog, used by Send and Reminder, and shown per address in the send history.
 */
describe('InvoiceDetailComponent — recipients', () => {
  let fixture: ComponentFixture<InvoiceDetailComponent>;
  let component: InvoiceDetailComponent;
  let http: HttpTestingController;

  const invoice = (overrides: Record<string, unknown> = {}) => ({
    id: 5,
    invoiceNumber: 'DCI-2026-48392175',
    publicUrl: 'https://example.com/invoice/abc',
    clientName: 'Northline Holdings Inc.',
    status: InvoiceStatus.Sent,
    statusLabel: 'Sent',
    invoiceDate: '2026-09-01',
    dueDate: '2026-09-16',
    subTotal: 500, discountAmount: 0, taxAmount: 0, total: 500,
    amountPaid: 0, balanceDue: 500,
    items: [], payments: [], emailHistory: [], activity: [], paymentAttempts: [],
    recipients: ['ap@northline.invalid', 'cfo@northline.invalid'], recipientsAreFallback: false,
    paymentMethods: 3, paymentMethodsLabel: 'Online bank payment (ACH), Card',
    firstSentAt: '2026-09-01T12:00:00Z',
    hasPaymentInProgress: false,
    canEdit: true, canEditMonetaryValues: true, editRequiresWarning: true,
    canSend: true, canRecordPayment: true, canVoid: true, canDelete: false,
    canSendReminder: true, isArchived: false, canHardDelete: false, cannotHardDeleteReason: 'Sent',
    ...overrides
  });

  function open(data: object): void {
    fixture.detectChanges();
    http.expectOne(r => r.url === `${ADMIN_URL}/5`).flush(data);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InvoiceDetailComponent],
      providers: [
        provideHttpClient(withXhr()), provideHttpClientTesting(), provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id: '5' }), queryParamMap: convertToParamMap({}) } }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(InvoiceDetailComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify({ ignoreCancelled: true }));

  it('shows who the invoice goes to and which payment methods it offers', () => {
    open(invoice());
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('ap@northline.invalid, cfo@northline.invalid');
    expect(text).toContain('Online bank payment (ACH), Card');
    expect(text).toContain('Edit recipients');
  });

  it('sends to the list in the dialog, which replaces the stored one', () => {
    open(invoice());
    component.openSend();
    expect(component.sendRecipients()).toEqual(['ap@northline.invalid', 'cfo@northline.invalid']);

    component.sendRecipients.set(['ap@northline.invalid']);
    component.send();

    const request = http.expectOne(`${ADMIN_URL}/5/send`);
    expect(request.request.body.recipients).toEqual(['ap@northline.invalid']);
    request.flush(invoice({ recipients: ['ap@northline.invalid'] }));

    expect(component.notice()).toBe('Invoice sent to ap@northline.invalid.');
    expect(component.modal()).toBe('none');
  });

  it('keeps a warning naming who a partly failed send missed, instead of calling it a failure', () => {
    open(invoice());
    component.openSend();
    component.send();

    http.expectOne(`${ADMIN_URL}/5/send`).flush(invoice({
      actionNotice: 'Sent to ap@northline.invalid, but it could not be sent to cfo@northline.invalid (Mailbox unavailable).'
    }));
    fixture.detectChanges();

    expect(component.error()).toBe('');
    expect(component.warning()).toContain('could not be sent to cfo@northline.invalid');
    expect(fixture.nativeElement.querySelector('.alert-warning')).not.toBeNull();
  });

  it('saves an edited list, and as the client default when asked', () => {
    open(invoice());
    component.openRecipients();
    component.editRecipients.set(['billing@northline.invalid']);
    component.editRecipientsSaveDefault.set(true);
    component.saveRecipients();

    const request = http.expectOne(`${ADMIN_URL}/5/recipients`);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ recipients: ['billing@northline.invalid'], saveAsClientDefault: true });
    request.flush(invoice({ recipients: ['billing@northline.invalid'] }));

    expect(component.invoice()!.recipients).toEqual(['billing@northline.invalid']);
  });

  it('groups one send to several addresses into one history entry, with each address\'s outcome', () => {
    const log = (id: number, recipient: string, failed = false) => ({
      id, sendBatchId: 'b1', emailType: InvoiceEmailType.InvoiceSent, emailTypeLabel: 'Invoice sent',
      recipient, subject: 'Invoice', status: failed ? InvoiceEmailStatus.Failed : InvoiceEmailStatus.Sent,
      failureReason: failed ? 'Mailbox unavailable' : undefined, sentAt: '2026-09-01T12:00:00Z'
    });
    open(invoice({
      emailHistory: [
        log(2, 'ap@northline.invalid'),
        log(3, 'cfo@northline.invalid', true),
        { ...log(1, 'old@northline.invalid'), sendBatchId: null }
      ]
    }));

    const groups = component.emailGroups();
    expect(groups.length).toBe(2);
    expect(groups[0].logs.map(l => l.recipient)).toEqual(['ap@northline.invalid', 'cfo@northline.invalid']);
    expect(groups[0].anyFailed).toBe(true);
    expect(groups[0].allFailed).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('partly failed');
    expect(fixture.nativeElement.textContent).toContain('not sent: Mailbox unavailable');
  });
});
