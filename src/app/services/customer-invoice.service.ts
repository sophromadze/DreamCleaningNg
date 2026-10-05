import { inject, Service } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

/**
 * REGULAR customer invoices — Admin → Invoices (2026-09). Not the commercial invoices
 * (`invoice.service.ts`): a regular invoice is a bill wrapped around ONE order's own payment. Its
 * status is derived server-side from the order and the part-payment request behind it — never
 * computed here — and there is no amount a client could send except the split amounts, which the
 * server checks against the order's balance.
 */

export type CustomerInvoiceKind = 'Full' | 'Split' | 'Additional';

export type CustomerInvoiceStatus = 'NotSent' | 'Sent' | 'Paid' | 'Void' | 'Cancelled';

export interface CustomerInvoice {
  id: number;
  invoiceNumber: string;
  kind: CustomerInvoiceKind;
  status: CustomerInvoiceStatus;
  orderId: number;
  userId: number;
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  serviceTypeName: string;
  serviceDate: string;
  amount: number;
  amountDue: number;
  orderTotal: number;
  orderAmountDue: number;
  /** Null on an Additional invoice (it bills the order-edit top-up, not a part-payment request). */
  partialPaymentId: number | null;
  paidVia?: string | null;
  paymentReference?: string | null;
  paidAt?: string | null;
  note?: string | null;
  publicUrl: string;
  createdAt: string;
  createdByName?: string | null;
  firstSentAt?: string | null;
  lastSentAt?: string | null;
  sendCount: number;
  voidedAt?: string | null;
  voidReason?: string | null;
  canSend: boolean;
  canVoid: boolean;
  canRecordPayment: boolean;
}

export interface CustomerInvoiceOrderOption {
  orderId: number;
  serviceTypeName: string;
  serviceDate: string;
  status: string;
  total: number;
  amountDue: number;
  availableToInvoice: number;
  canInvoice: boolean;
  /** A PAID order an edit made dearer: the invoice bills the extra only, as one amount. */
  isAdditionalCharge?: boolean;
  cannotInvoiceReason?: string | null;
  openInvoiceNumbers: string[];
}

export interface CreateCustomerInvoiceRequest {
  orderId: number;
  /** Omitted/empty = one invoice for the whole balance. */
  splitAmounts?: number[];
  note?: string | null;
  sendEmail: boolean;
  sendSms: boolean;
}

export interface PublicPaymentInstructions {
  method: string;
  bankName?: string | null;
  accountHolder?: string | null;
  routingNumber?: string | null;
  accountNumber?: string | null;
  accountType?: string | null;
  achInstructions?: string | null;
  wireInstructions?: string | null;
  paymentReference: string;
}

export interface PublicCompany {
  legalName: string;
  dbaName?: string | null;
  address?: string | null;
  cityStateZip?: string | null;
  phone?: string | null;
  email?: string | null;
  footerText?: string | null;
  primaryName?: string;
}

export interface PublicCustomerInvoice {
  invoiceNumber: string;
  status: CustomerInvoiceStatus;
  kind: CustomerInvoiceKind;
  issuedAt: string;
  orderNumber: number;
  serviceTypeName: string;
  serviceDate: string;
  serviceTime: string;
  serviceAddress: string;
  billedToName: string;
  billedToEmail?: string | null;
  billedToPhone?: string | null;
  subTotal: number;
  discounts: number;
  credits: number;
  tax: number;
  tips: number;
  orderTotal: number;
  orderAmountPaid: number;
  amount: number;
  amountDue: number;
  note?: string | null;
  paidAt?: string | null;
  cardPaymentPath?: string | null;
  bankTransfer?: PublicPaymentInstructions | null;
  company?: PublicCompany | null;
  /** Online bank payment (Stripe ACH) can be started now. */
  achAvailable?: boolean;
  /** A bank payment was authorized and is settling — no payment button is offered meanwhile. */
  achProcessing?: boolean;
  /** "ACH Processing Fee" quote and total debit for the amount due. Display only. */
  achProcessingFee?: number;
  achTotalCharge?: number;
}

/** Where to send the customer for an online bank payment. */
export interface StartCustomerInvoiceAchResponse {
  checkoutUrl: string;
  amount: number;
  processingFee: number;
  totalCharged: number;
}

/** One row of the customer's own Invoices tab. */
export interface MyCustomerInvoice {
  invoiceNumber: string;
  kind: CustomerInvoiceKind;
  status: CustomerInvoiceStatus;
  orderId: number;
  serviceTypeName: string;
  serviceDate: string;
  issuedAt: string;
  amount: number;
  amountDue: number;
  paidAt?: string | null;
  paidVia?: string | null;
  publicUrl: string;
}

/** Human labels for the derived statuses — one place, so the list and the page agree. */
export const CUSTOMER_INVOICE_STATUS_LABELS: Record<CustomerInvoiceStatus, string> = {
  NotSent: 'Not sent',
  Sent: 'Awaiting payment',
  Paid: 'Paid',
  Void: 'Void',
  Cancelled: 'Order cancelled'
};

@Service()
export class CustomerInvoiceService {
  private http = inject(HttpClient);

  private adminUrl = `${environment.apiUrl}/admin/customer-invoices`;
  private publicUrl = `${environment.apiUrl}/public/customer-invoices`;

  list(filters: { search?: string; status?: string; userId?: number; orderId?: number } = {}): Observable<CustomerInvoice[]> {
    let params = new HttpParams();
    if (filters.search) params = params.set('search', filters.search);
    if (filters.status) params = params.set('status', filters.status);
    if (filters.userId) params = params.set('userId', String(filters.userId));
    if (filters.orderId) params = params.set('orderId', String(filters.orderId));
    return this.http.get<CustomerInvoice[]>(this.adminUrl, { params });
  }

  ordersForUser(userId: number): Observable<CustomerInvoiceOrderOption[]> {
    return this.http.get<CustomerInvoiceOrderOption[]>(`${this.adminUrl}/orders-for-user/${userId}`);
  }

  create(request: CreateCustomerInvoiceRequest): Observable<{ message: string; invoices: CustomerInvoice[] }> {
    return this.http.post<{ message: string; invoices: CustomerInvoice[] }>(this.adminUrl, request);
  }

  send(id: number, sendEmail: boolean, sendSms: boolean): Observable<{ message: string; invoice: CustomerInvoice }> {
    return this.http.post<{ message: string; invoice: CustomerInvoice }>(`${this.adminUrl}/${id}/send`, { sendEmail, sendSms });
  }

  void(id: number, reason: string | null): Observable<{ message: string; invoice: CustomerInvoice }> {
    return this.http.post<{ message: string; invoice: CustomerInvoice }>(`${this.adminUrl}/${id}/void`, { reason });
  }

  /**
   * A bank transfer (or any money received outside the website) recorded against THIS invoice's
   * own part-payment request — the existing order endpoint, which completes the order (Active,
   * confirmation sent) when this is the last amount owed.
   */
  recordPayment(invoice: CustomerInvoice, paymentMethod: string, paymentReference: string | null, paymentNotes: string | null) {
    return this.http.post<{ message: string; status: string; orderFullyPaid: boolean }>(
      `${environment.apiUrl}/admin/orders/${invoice.orderId}/partial-payments/${invoice.partialPaymentId}/record-manual-payment`,
      { paymentMethod, paymentReference, paymentNotes });
  }

  /** The signed-in customer's OWN invoices (profile → Invoices). Scoped by the token server-side. */
  listMine(): Observable<MyCustomerInvoice[]> {
    return this.http.get<MyCustomerInvoice[]>(`${environment.apiUrl}/customer-invoices/mine`);
  }

  getPublic(token: string): Observable<PublicCustomerInvoice> {
    return this.http.get<PublicCustomerInvoice>(`${this.publicUrl}/${encodeURIComponent(token)}`);
  }

  /** Opens a Stripe-hosted bank (ACH) payment for the invoice. The server decides the amount. */
  startAchCheckout(token: string): Observable<StartCustomerInvoiceAchResponse> {
    return this.http.post<StartCustomerInvoiceAchResponse>(
      `${this.publicUrl}/${encodeURIComponent(token)}/ach-checkout`, {});
  }

  /** The invoice as a real PDF (the same document the invoice email attaches). */
  downloadPublicPdf(token: string): Observable<Blob> {
    return this.http.get(`${this.publicUrl}/${encodeURIComponent(token)}/pdf`, { responseType: 'blob' });
  }
}
