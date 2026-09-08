import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

/*
 * Commercial invoicing API client.
 *
 * Mirrors DTOs/Commercial/InvoiceDtos.cs. Enums are sent and received as NUMBERS, matching the
 * contract service's convention and the backend's default System.Text.Json behaviour.
 *
 * Deliberately absent from every write payload: subTotal, taxAmount, total and balanceDue. The
 * server recomputes all of them from the line items, so there is nothing here to send them with -
 * the same shape the backend DTOs use to make a browser-supplied total unrepresentable rather than
 * merely ignored. `previewTotals` below exists so the form can still SHOW a running total; it is a
 * local preview and never authoritative.
 */

// ── Enums (mirror Models/Commercial/CommercialInvoiceEnums.cs) ──

export enum InvoiceStatus {
  Draft = 0,
  Sent = 1,
  Viewed = 2,
  PartiallyPaid = 3,
  Paid = 4,
  Overdue = 5,
  Void = 6
}

export enum InvoiceTaxType { Exempt = 0, Included = 1, Added = 2 }
export enum InvoiceDiscountType { None = 0, FixedAmount = 1, Percentage = 2 }
export enum InvoicePaymentMethod { AchBankTransfer = 0, Card = 1, Other = 2 }

export enum InvoicePaymentRecordMethod {
  AchBankTransfer = 0,
  WireTransfer = 1,
  Check = 2,
  Card = 3,
  Cash = 4,
  Other = 5
}

export enum InvoiceDueTerms {
  DueOnReceipt = 0,
  Net7 = 1,
  Net15 = 2,
  Net30 = 3,
  Custom = 4
}

export enum InvoiceEmailType {
  InvoiceSent = 0,
  InvoiceResent = 1,
  PaymentReceipt = 2,
  Reminder = 3
}

export enum InvoiceEmailStatus { Sent = 0, Failed = 1 }

// ── Interfaces ──

export interface SaveInvoiceItem {
  id?: number;
  description: string;
  quantity: number;
  unitPrice: number;
  sortOrder: number;
}

export interface SaveInvoice {
  contractClientId: number;
  contractId?: number | null;
  contractServiceLocationId?: number | null;
  invoiceDate?: string | null;
  dueTerms: InvoiceDueTerms;
  customDueDate?: string | null;
  serviceStartDate?: string | null;
  serviceEndDate?: string | null;
  serviceAddress?: string | null;
  poNumber?: string | null;
  clientReference?: string | null;
  discountType: InvoiceDiscountType;
  discountValue?: number | null;
  taxType: InvoiceTaxType;
  taxRate?: number | null;
  paymentMethod: InvoicePaymentMethod;
  customerNote?: string | null;
  internalNote?: string | null;
  items: SaveInvoiceItem[];
}

export interface InvoiceListItem {
  id: number;
  invoiceNumber: string;
  contractClientId: number;
  clientName: string;
  serviceAddress?: string;
  contractNumber?: string;
  invoiceDate: string;
  dueDate: string;
  total: number;
  amountPaid: number;
  balanceDue: number;
  status: InvoiceStatus;
  statusLabel: string;
  paymentMethod: InvoicePaymentMethod;
  paidAt?: string;
  lastSentAt?: string;
  hasBeenSent: boolean;
}

export interface InvoiceSummary {
  totalOutstanding: number;
  paidThisMonth: number;
  overdue: number;
  draftCount: number;
  overdueCount: number;
  outstandingCount: number;
}

export interface InvoiceListResponse {
  invoices: InvoiceListItem[];
  summary: InvoiceSummary;
  totalCount: number;
  page: number;
  pageSize: number;
}

export interface InvoiceItem {
  id: number;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  sortOrder: number;
}

export interface InvoicePayment {
  id: number;
  amount: number;
  paymentDate: string;
  paymentMethod: InvoicePaymentRecordMethod;
  paymentMethodLabel: string;
  transactionReference?: string;
  internalNote?: string;
  isReversal: boolean;
  recordedByName?: string;
  createdAt: string;
}

export interface InvoiceEmailLog {
  id: number;
  emailType: InvoiceEmailType;
  emailTypeLabel: string;
  recipient: string;
  subject: string;
  status: InvoiceEmailStatus;
  failureReason?: string;
  sentAt: string;
}

export interface InvoiceActivityLog {
  id: number;
  action: string;
  description: string;
  actorName?: string;
  createdAt: string;
}

export interface InvoiceDetail {
  id: number;
  invoiceNumber: string;
  publicUrl: string;
  status: InvoiceStatus;
  statusLabel: string;

  contractClientId: number;
  clientName: string;
  billingContactName?: string;
  billingEmail?: string;
  billingPhone?: string;
  billingAddress?: string;

  contractId?: number;
  contractNumber?: string;
  contractServiceLocationId?: number;
  serviceAddress?: string;

  invoiceDate: string;
  dueDate: string;
  dueTerms: InvoiceDueTerms;
  serviceStartDate?: string;
  serviceEndDate?: string;

  poNumber?: string;
  clientReference?: string;

  subTotal: number;
  discountType: InvoiceDiscountType;
  discountValue?: number;
  discountAmount: number;
  taxType: InvoiceTaxType;
  taxRate?: number;
  taxAmount: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  overpayment: number;

  currency: string;
  paymentMethod: InvoicePaymentMethod;

  customerNote?: string;
  internalNote?: string;

  firstSentAt?: string;
  lastSentAt?: string;
  firstViewedAt?: string;
  lastViewedAt?: string;
  viewCount: number;
  paidAt?: string;
  voidedAt?: string;
  voidReason?: string;

  createdByName?: string;
  createdAt: string;
  updatedAt: string;
  duplicatedFromInvoiceId?: number;

  items: InvoiceItem[];
  payments: InvoicePayment[];
  emailHistory: InvoiceEmailLog[];
  activity: InvoiceActivityLog[];

  /** Online payment attempts, newest first. Empty for a manual-only invoice. */
  paymentAttempts: InvoicePaymentAttempt[];

  /** True while a Stripe payment is authorized or settling. */
  hasPaymentInProgress: boolean;

  /** Server-decided capabilities. The action menu renders from these, never from its own guesses. */
  canEdit: boolean;
  canEditMonetaryValues: boolean;
  editRequiresWarning: boolean;
  canSend: boolean;
  canRecordPayment: boolean;
  canVoid: boolean;
  canDelete: boolean;
  canSendReminder: boolean;
}

export interface PublicPaymentInstructions {
  method: string;
  bankName?: string;
  accountHolder?: string;
  routingNumber?: string;
  accountNumber?: string;
  accountType?: string;
  achInstructions?: string;
  wireInstructions?: string;
  paymentReference: string;
}

export interface PublicCompany {
  legalName: string;
  dbaName?: string;
  address?: string;
  cityStateZip?: string;
  phone?: string;
  email?: string;
  footerText?: string;
}

/** Attempt lifecycle. Mirrors Models/Commercial/CommercialInvoicePaymentAttempt.cs. */
export enum InvoicePaymentAttemptStatus {
  Created = 0,
  CheckoutOpen = 1,
  Processing = 2,
  Succeeded = 3,
  Failed = 4,
  Expired = 5,
  Canceled = 6
}

export enum InvoicePaymentProvider { Manual = 0, Stripe = 1 }

/**
 * What the customer may do right now. EVERY FLAG IS DECIDED SERVER-SIDE — the page renders what
 * it is told and never derives availability itself, and the checkout endpoint re-checks all of it
 * anyway.
 */
export interface PublicPaymentOptions {
  stripeAchAvailable: boolean;
  stripeCardAvailable: boolean;
  manualAchAvailable: boolean;

  /** True while a Stripe payment is authorized or settling — pay buttons must stay disabled. */
  paymentInProgress: boolean;
  processingAmount?: number;
  processingStartedAt?: string;

  lastAttemptFailed: boolean;
  /** Fixed, customer-safe wording. Never Stripe's own error text. */
  lastFailureMessage?: string;
}

export interface InvoicePaymentAttempt {
  id: number;
  provider: InvoicePaymentProvider;
  paymentMethod: InvoicePaymentRecordMethod;
  paymentMethodLabel: string;
  amount: number;
  currency: string;
  status: InvoicePaymentAttemptStatus;
  statusLabel: string;
  stripePaymentIntentId?: string;
  /** Bank/card name and last four only — all Stripe exposes, all anyone needs. */
  paymentSourceLabel?: string;
  failureCode?: string;
  failureMessage?: string;
  createdAt: string;
  completedAt?: string;
  isInFlight: boolean;
}

export interface StartInvoiceCheckoutResponse {
  checkoutUrl: string;
  attemptId: number;
  amount: number;
}

export interface PublicInvoice {
  invoiceNumber: string;
  status: InvoiceStatus;
  statusLabel: string;
  invoiceDate: string;
  dueDate: string;
  serviceStartDate?: string;
  serviceEndDate?: string;
  clientName: string;
  billingContactName?: string;
  billingAddress?: string;
  serviceAddress?: string;
  contractNumber?: string;
  poNumber?: string;
  clientReference?: string;
  items: InvoiceItem[];
  subTotal: number;
  discountAmount: number;
  taxType: InvoiceTaxType;
  taxRate?: number;
  taxAmount: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  currency: string;
  paidAt?: string;
  customerNote?: string;
  paymentMethod: InvoicePaymentMethod;
  paymentInstructions?: PublicPaymentInstructions;
  paymentOptions: PublicPaymentOptions;
  company: PublicCompany;
}

export interface InvoiceLocationOption { id: number; label: string; address: string; }

/** One service location unjoined, for the edit form. See `primaryLocation`. */
export interface InvoiceClientLocationFields {
  id: number;
  businessBrand?: string;
  locationName?: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

export interface InvoiceContractOption {
  id: number;
  contractNumber: string;
  statusLabel: string;
  serviceAddress?: string;
  serviceLocationId?: number;
  serviceDescription?: string;
  agreedAmount?: number;
  taxRate?: number;
  taxType?: InvoiceTaxType;
  paymentTerms?: string;
}

export interface InvoiceClientOption {
  id: number;
  legalEntityName: string;
  billingContactName?: string;
  billingEmail?: string;
  billingPhone?: string;
  billingAddress?: string;
  locations: InvoiceLocationOption[];
  contracts: InvoiceContractOption[];

  // ── The Commercial → Clients screen's extra fields. The invoice form ignores all of them; one
  //    endpoint serves both because they render the same join, and two would drift. ──

  /** Only ever false on the Clients screen with "show inactive" on. */
  isActive: boolean;

  /** Set when this client came from a business-flagged customer account. Null = standalone. */
  sourceUserId?: number | null;
  linkedAccountName?: string;

  /** The ACCOUNT's own email, shown beside the billing one rather than merged into it. */
  linkedAccountEmail?: string;

  /** How much history a delete leaves behind. A count, never an amount. */
  invoiceCount: number;

  // Round-tripped by the edit form.
  entityType?: string;
  formationState?: string;
  principalAddress?: string;
  city?: string;
  state?: string;
  zip?: string;
  noticeEmail?: string;
  /** The first service location field by field — `locations` carries the same row formatted. */
  primaryLocation?: InvoiceClientLocationFields | null;
  billingContactFirstName?: string;
  billingContactLastName?: string;
  billingContactTitle?: string;
}

export interface BillingSettings {
  companyLegalName: string;
  companyDbaName?: string;
  companyAddress?: string;
  companyCity?: string;
  companyState?: string;
  companyZip?: string;
  companyPhone?: string;
  companyEmail?: string;
  bankName?: string;
  bankAccountHolder?: string;
  bankRoutingNumber?: string;
  bankAccountNumber?: string;
  /** True when the account number above is masked to its last four digits. */
  bankAccountNumberMasked: boolean;
  bankAccountType?: string;
  achInstructions?: string;
  wireInstructions?: string;
  bankWireRoutingNumber?: string;

  /** Which methods commercial invoices offer. Card is off by default — an owner's decision. */
  stripeAchEnabled: boolean;
  stripeCardEnabled: boolean;
  manualAchEnabled: boolean;

  /** Whether manual ACH has everything a customer needs to actually send money. */
  manualAchComplete: boolean;

  /** Field NAMES only — never values. */
  missingManualAchFields: string[];

  defaultTaxType: InvoiceTaxType;
  defaultTaxRate?: number;
  defaultDueTerms: InvoiceDueTerms;
  defaultCustomerNote?: string;
  invoiceFooterText?: string;
  updatedAt: string;
  canEdit: boolean;
}

export interface InvoiceListFilters {
  search?: string;
  status?: InvoiceStatus | null;
  clientId?: number | null;
  paymentMethod?: InvoicePaymentMethod | null;
  fromDate?: string | null;
  toDate?: string | null;
  page?: number;
  pageSize?: number;
}

@Injectable({ providedIn: 'root' })
export class InvoiceService {
  private http = inject(HttpClient);

  private readonly adminUrl = `${environment.apiUrl}/admin/commercial/invoices`;
  private readonly settingsUrl = `${environment.apiUrl}/admin/commercial/billing-settings`;
  private readonly publicUrl = `${environment.apiUrl}/public/invoices`;

  // ── Admin ──

  list(filters: InvoiceListFilters = {}): Observable<InvoiceListResponse> {
    let params = new HttpParams();
    if (filters.search) params = params.set('search', filters.search);
    if (filters.status !== null && filters.status !== undefined) {
      params = params.set('status', filters.status);
    }
    if (filters.clientId) params = params.set('clientId', filters.clientId);
    if (filters.paymentMethod !== null && filters.paymentMethod !== undefined) {
      params = params.set('paymentMethod', filters.paymentMethod);
    }
    if (filters.fromDate) params = params.set('fromDate', filters.fromDate);
    if (filters.toDate) params = params.set('toDate', filters.toDate);
    params = params.set('page', filters.page ?? 1);
    params = params.set('pageSize', filters.pageSize ?? 25);

    return this.http.get<InvoiceListResponse>(this.adminUrl, { params });
  }

  get(id: number): Observable<InvoiceDetail> {
    return this.http.get<InvoiceDetail>(`${this.adminUrl}/${id}`);
  }

  create(dto: SaveInvoice): Observable<InvoiceDetail> {
    return this.http.post<InvoiceDetail>(this.adminUrl, dto);
  }

  update(id: number, dto: SaveInvoice): Observable<InvoiceDetail> {
    return this.http.put<InvoiceDetail>(`${this.adminUrl}/${id}`, dto);
  }

  deleteDraft(id: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.adminUrl}/${id}`);
  }

  send(id: number, body: { recipientEmail?: string; attachPdf: boolean; message?: string }):
    Observable<InvoiceDetail> {
    return this.http.post<InvoiceDetail>(`${this.adminUrl}/${id}/send`, body);
  }

  sendReminder(id: number, body: { recipientEmail?: string; force: boolean }): Observable<InvoiceDetail> {
    return this.http.post<InvoiceDetail>(`${this.adminUrl}/${id}/reminder`, body);
  }

  sendReceipt(id: number): Observable<InvoiceDetail> {
    return this.http.post<InvoiceDetail>(`${this.adminUrl}/${id}/receipt`, {});
  }

  recordPayment(id: number, body: {
    amount: number;
    paymentDate?: string;
    paymentMethod: InvoicePaymentRecordMethod;
    transactionReference?: string;
    internalNote?: string;
    allowOverpayment: boolean;
  }): Observable<InvoiceDetail> {
    return this.http.post<InvoiceDetail>(`${this.adminUrl}/${id}/payments`, body);
  }

  reversePayment(id: number, paymentId: number, reason: string): Observable<InvoiceDetail> {
    return this.http.post<InvoiceDetail>(
      `${this.adminUrl}/${id}/payments/${paymentId}/reverse`, { reason });
  }

  void(id: number, reason: string): Observable<InvoiceDetail> {
    return this.http.post<InvoiceDetail>(`${this.adminUrl}/${id}/void`, { reason });
  }

  duplicate(id: number): Observable<InvoiceDetail> {
    return this.http.post<InvoiceDetail>(`${this.adminUrl}/${id}/duplicate`, {});
  }

  /** Blob rather than a plain link: the PDF endpoint needs the Authorization header. */
  downloadPdf(id: number): Observable<Blob> {
    return this.http.get(`${this.adminUrl}/${id}/pdf`, { responseType: 'blob' });
  }

  /**
   * The commercial client roster — auto-linked business accounts and standalone clients in one
   * list, which is the whole point: an admin should not have to know which is which to bill one.
   *
   * `includeInactive` is for the Clients screen's toggle ONLY. The invoice form never passes it,
   * so a retired client can never be offered as something new to bill.
   */
  clients(includeInactive = false): Observable<InvoiceClientOption[]> {
    const params = includeInactive ? new HttpParams().set('includeInactive', 'true') : undefined;
    return this.http.get<InvoiceClientOption[]>(`${this.adminUrl}/clients`, { params });
  }

  runOverdueSweep(): Observable<{ message: string; changed: number }> {
    return this.http.post<{ message: string; changed: number }>(
      `${this.adminUrl}/run-overdue-sweep`, {});
  }

  // ── Billing settings ──

  getBillingSettings(): Observable<BillingSettings> {
    return this.http.get<BillingSettings>(this.settingsUrl);
  }

  saveBillingSettings(dto: Partial<BillingSettings>): Observable<BillingSettings> {
    return this.http.put<BillingSettings>(this.settingsUrl, dto);
  }

  // ── Public (token-addressed, no auth) ──

  getPublic(token: string): Observable<PublicInvoice> {
    return this.http.get<PublicInvoice>(`${this.publicUrl}/${token}`);
  }

  /**
   * Starts a Stripe-hosted payment and returns the URL to navigate to.
   *
   * NOTE WHAT IS NOT SENT: any amount. The server reads the invoice's balance itself, so the
   * browser cannot express a different figure even if someone edits the request.
   */
  startCheckout(token: string, method: InvoicePaymentRecordMethod):
    Observable<StartInvoiceCheckoutResponse> {
    return this.http.post<StartInvoiceCheckoutResponse>(
      `${this.publicUrl}/${token}/checkout`, { method });
  }

  publicPdfUrl(token: string): string {
    return `${this.publicUrl}/${token}/pdf`;
  }

  downloadPublicPdf(token: string): Observable<Blob> {
    return this.http.get(`${this.publicUrl}/${token}/pdf`, { responseType: 'blob' });
  }
}

// ── Shared display helpers ──

/**
 * The line/subtotal/tax/total chain, mirroring Helpers/Commercial/InvoiceCalculator.cs step for
 * step so the form previews exactly what the server will persist.
 *
 * PREVIEW ONLY. The server recomputes every one of these on save and its answer wins; this exists
 * so the admin sees a running total while typing, not so the browser can decide a price. Keep the
 * two in step - same order of operations, same half-away-from-zero rounding, and tax on the
 * DISCOUNTED subtotal.
 */
export function previewTotals(
  items: { quantity: number; unitPrice: number }[],
  discountType: InvoiceDiscountType,
  discountValue: number | null | undefined,
  taxType: InvoiceTaxType,
  taxRate: number | null | undefined
): { lineAmounts: number[]; subTotal: number; discountAmount: number; taxAmount: number; total: number } {
  const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

  const lineAmounts = items.map(i => round2((i.quantity || 0) * (i.unitPrice || 0)));
  const subTotal = round2(lineAmounts.reduce((sum, a) => sum + a, 0));

  let discountAmount = 0;
  const value = discountValue ?? 0;
  if (discountType === InvoiceDiscountType.FixedAmount && value > 0) {
    discountAmount = round2(value);
  } else if (discountType === InvoiceDiscountType.Percentage && value > 0) {
    discountAmount = round2(subTotal * Math.min(value, 100) / 100);
  }
  discountAmount = Math.min(Math.max(discountAmount, 0), subTotal);

  const discounted = round2(subTotal - discountAmount);
  const rate = (taxRate ?? 0) > 0 ? (taxRate as number) : 0;

  let taxAmount = 0;
  let total = discounted;

  if (taxType === InvoiceTaxType.Added) {
    taxAmount = round2(discounted * rate / 100);
    total = round2(discounted + taxAmount);
  } else if (taxType === InvoiceTaxType.Included) {
    // Split by SUBTRACTION, never as round2(preTax * rate) - see InvoiceCalculator for why that
    // drifts a cent and makes the printed subtotal and tax fail to add up to the total.
    total = discounted;
    taxAmount = round2(discounted - round2(discounted / (1 + rate / 100)));
  }

  return { lineAmounts, subTotal, discountAmount, taxAmount, total: Math.max(0, total) };
}

/** CSS modifier for a status badge. Keeps the palette decision in one place. */
export function invoiceStatusClass(status: InvoiceStatus): string {
  switch (status) {
    case InvoiceStatus.Draft: return 'status-draft';
    case InvoiceStatus.Sent: return 'status-sent';
    case InvoiceStatus.Viewed: return 'status-viewed';
    case InvoiceStatus.PartiallyPaid: return 'status-partial';
    case InvoiceStatus.Paid: return 'status-paid';
    case InvoiceStatus.Overdue: return 'status-overdue';
    case InvoiceStatus.Void: return 'status-void';
    default: return 'status-draft';
  }
}

export const DUE_TERMS_OPTIONS: { value: InvoiceDueTerms; label: string }[] = [
  { value: InvoiceDueTerms.DueOnReceipt, label: 'Due on receipt' },
  { value: InvoiceDueTerms.Net7, label: 'Net 7' },
  { value: InvoiceDueTerms.Net15, label: 'Net 15' },
  { value: InvoiceDueTerms.Net30, label: 'Net 30' },
  { value: InvoiceDueTerms.Custom, label: 'Custom date' }
];

export const PAYMENT_RECORD_METHODS: { value: InvoicePaymentRecordMethod; label: string }[] = [
  { value: InvoicePaymentRecordMethod.AchBankTransfer, label: 'ACH Bank Transfer' },
  { value: InvoicePaymentRecordMethod.WireTransfer, label: 'Wire Transfer' },
  { value: InvoicePaymentRecordMethod.Check, label: 'Check' },
  { value: InvoicePaymentRecordMethod.Card, label: 'Card' },
  { value: InvoicePaymentRecordMethod.Cash, label: 'Cash' },
  { value: InvoicePaymentRecordMethod.Other, label: 'Other' }
];

/**
 * Adds days to a date the way the backend's ResolveDueDate does, so the form's Due Date box shows
 * what the server is going to store rather than guessing at it.
 *
 * THE ARITHMETIC IS DONE ENTIRELY IN UTC, and that is load-bearing. The obvious version —
 * `new Date(d + 'T00:00:00')`, `setDate(+days)`, `toISOString().slice(0,10)` — parses as LOCAL
 * midnight and then formats as UTC, so on any machine east of Greenwich the result lands on the
 * previous day: Net 7 from Sep 7 came back as Sep 13. The business runs on New York time while
 * this office is UTC+4, so the bug reproduced on every developer machine and would have shipped a
 * due date a day early on every invoice.
 *
 * These are DATE-ONLY values with no time component by intent, so they are parsed and formatted
 * through Date.UTC and the UTC getters, never through the local-time constructor.
 */
export function resolveDueDate(invoiceDate: string, terms: InvoiceDueTerms, custom?: string | null): string {
  if (terms === InvoiceDueTerms.Custom) return custom || invoiceDate;

  const days = terms === InvoiceDueTerms.Net7 ? 7
    : terms === InvoiceDueTerms.Net15 ? 15
      : terms === InvoiceDueTerms.Net30 ? 30
        : 0;

  const [year, month, day] = invoiceDate.slice(0, 10).split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + days));

  const pad = (n: number) => String(n).padStart(2, '0');
  return `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())}`;
}
