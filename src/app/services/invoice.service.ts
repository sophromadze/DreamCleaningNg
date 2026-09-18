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

// ── The cleanings an invoice covers (mirrors DTOs/Commercial/InvoiceOrderDtos.cs) ───────────

/** One cleaning offered on the "which visits does this invoice cover?" picker. */
export interface InvoiceEligibleOrder {
  orderId: number;
  serviceDate: string;
  serviceTime: string;
  serviceTypeName: string;
  serviceAddress: string;
  status: string;
  total: number;
  contactName: string;
  isOnThisInvoice: boolean;
  allocatedAmount?: number | null;
  /** "Already included in DCI-2026-…" — a live invoice already claiming this cleaning. */
  billedOnInvoiceNumber?: string | null;
  billedOnInvoiceId?: number | null;
  canSelect: boolean;
  /** Why it cannot be picked. Rendered beside the row rather than hiding it. */
  blockedReason?: string | null;
}

export interface InvoiceEligibleOrders {
  contractClientId: number;
  orders: InvoiceEligibleOrder[];
}

/**
 * An invoice as a surface OUTSIDE the Commercial section sees it — the admin Orders panel's
 * "Send Invoice" and the Invoices tab on a customer's detail panel.
 *
 * `canSend` comes from the server's own InvoiceStatusPolicy and is never re-derived here: a
 * second copy of that state machine in the browser is how a Send button appears on a voided
 * invoice.
 */
export interface LinkedInvoiceSummary {
  id: number;
  invoiceNumber: string;
  contractClientId: number;
  clientName: string;
  invoiceDate: string;
  dueDate: string;
  total: number;
  amountPaid: number;
  balanceDue: number;
  status: number;
  statusLabel: string;
  hasBeenSent: boolean;
  lastSentAt?: string | null;
  paidAt?: string | null;
  canSend: boolean;
  canSendReminder: boolean;
  /** Where it would be emailed. Null = it cannot be sent at all until a billing email exists. */
  billingEmail?: string | null;
  coveredOrderCount: number;
  /** Only on the per-order lookup: what this invoice allocates to the order that was asked about. */
  allocatedAmount?: number | null;
  allocationIsProposal?: boolean | null;
}

/** "Can I bill this cleaning, and on what?" — both halves of the answer in one response. */
export interface OrderInvoices {
  orderId: number;
  contractClientId?: number | null;
  clientName?: string | null;
  /** The client the CUSTOMER ACCOUNT is linked to, when the order carries none of its own. */
  suggestedContractClientId?: number | null;
  suggestedClientName?: string | null;
  canBeInvoiced: boolean;
  blockedReason?: string | null;
  invoices: LinkedInvoiceSummary[];
}

/**
 * NOTE WHAT IS ABSENT: no per-order amount. Allocation is a SERVER rule — equal shares, remainder
 * to the earliest service dates — so a caller cannot express "give this visit $2,000 and that one
 * $500", which is exactly the shape a mis-typed or hand-rolled request would take.
 */
export interface SaveInvoiceOrders {
  orderIds: number[];
  /** The agreed TOTAL for the whole selected group. Null = bill what the cleanings cost. */
  negotiatedGroupTotal?: number | null;
}

export interface InvoiceOrderAllocation {
  serviceAddress?: string;
  orderId: number;
  serviceDate: string;
  description: string;
  originalOrderTotal: number;
  allocatedAmount: number;
  /** True while this is a proposal — the cleaning's own price is untouched until the invoice is sent. */
  isProposal: boolean;
  committedAt?: string | null;
  activatedOrderAt?: string | null;
  orderStatus: string;
}

export interface InvoiceOrdersResult {
  serviceDates: string[];
  items: SaveInvoiceItem[];
  invoiceId: number;
  invoiceNumber: string;
  negotiatedGroupTotal?: number | null;
  /** What the selected cleanings cost today, before any negotiation. */
  defaultTotal: number;
  invoiceTotal: number;
  allocations: InvoiceOrderAllocation[];
  warnings: string[];
}

/** Returned as a 409 when an unsent draft already covers this period — see the contracts page. */
export interface ExistingDraftInvoice {
  isUndated?: boolean;
  invoiceId: number;
  invoiceNumber: string;
  serviceStartDate?: string | null;
  serviceEndDate?: string | null;
  servicePeriodText?: string | null;
  total: number;
  createdAt: string;
  message: string;
}

export interface SaveInvoice {
  orderIds?: number[];
  negotiatedGroupTotal?: number | null;
  draftDriftChoices?: string[];
  contractClientId: number;
  contractId?: number | null;
  contractServiceLocationId?: number | null;
  invoiceDate?: string | null;
  dueTerms: InvoiceDueTerms;
  customDueDate?: string | null;
  serviceStartDate?: string | null;
  serviceEndDate?: string | null;

  /**
   * The individual visits this invoice covers, as ISO dates. Editable while the invoice is a
   * draft; an empty list simply falls back to the period bounds above.
   */
  serviceDates?: string[];

  serviceAddress?: string | null;
  poNumber?: string | null;
  clientReference?: string | null;
  discountType: InvoiceDiscountType;
  discountValue?: number | null;
  taxType: InvoiceTaxType;
  taxRate?: number | null;

  /**
   * Persist the tax rate typed here as the default for FUTURE invoices and contracts.
   * Writes to the billing settings only — it can never reach a finalized invoice or a signed
   * contract, both of which carry their own rate snapshot.
   */
  saveTaxRateAsDefault?: boolean;

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

  /** Archived: off the default list, everything preserved. A separate axis from status. */
  isArchived: boolean;
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
  /** The ACH fee paid on top when this came through Stripe. Zero for a manual payment. */
  processingFee: number;
  /** amount + fee — what the customer's bank statement actually shows. */
  totalCharged: number;
  paymentDate: string;
  paymentMethod: InvoicePaymentRecordMethod;
  paymentMethodLabel: string;
  /** Manual or Stripe. Shown plainly — a bank transfer an admin typed in is never dressed up. */
  provider: InvoicePaymentProvider;
  providerLabel: string;
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

  /** The individual visits this invoice covers, when known. */
  serviceDates: string[];
  /** "Service date" / "Service dates" / "Service period" — resolved server-side. */
  serviceDateLabel?: string;
  serviceDateText?: string;

  poNumber?: string;
  clientReference?: string;

  /**
   * Non-blocking warnings raised when this draft was GENERATED — contract price drift, tax drift,
   * a schedule that could not be worked out.
   *
   * They come back on the INVOICE rather than only in the create response, and that is the whole
   * point: "Create Next Invoice" launched from the Contracts LIST navigates away instantly, so a
   * banner on the previous page was a banner nobody read. Cleared once the invoice leaves Draft
   * or an admin saves an edit — at that point the figures have been seen.
   */
  draftWarnings: string[];
  currentContractUnitPrice?: number | null;
  currentContractTaxType?: InvoiceTaxType | null;
  currentContractTaxRate?: number | null;
  cleaningsCovered?: InvoiceOrderAllocation[];

  /** The agreed group total an admin negotiated for the CLEANINGS this invoice covers. */
  negotiatedOrderGroupTotal?: number;

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

  /** Archived: off the admin default list, everything preserved. Not a status. */
  isArchived: boolean;
  archivedAt?: string;

  /**
   * Whether the PERMANENT delete option is offered. `InvoiceHardDeletePolicy` decides on the
   * server and the endpoint applies the same policy. Optional so an older backend degrades to
   * simply not offering it.
   */
  canHardDelete?: boolean;

  /** Why permanent deletion is refused — a payment, Stripe activity, claimed cleanings. */
  cannotHardDeleteReason?: string | null;

  /**
   * A Stripe payment AND a manual one, with more received than billed. Flagged, never
   * auto-corrected: both are real money that arrived, and only a person can decide what to refund.
   */
  potentialDuplicatePayment: boolean;

  /** A Stripe ACH debit is authorized and settling — "Mark as Paid" must warn before recording. */
  hasProcessingStripePayment: boolean;

  contractPricingWarning?: string;
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

/**
 * The company block. THE TRADING NAME LEADS: `primaryName` ("DBA Dream Cleaning NYC") is what
 * renders large and in brand blue, `secondaryName` (the registered entity) small underneath.
 *
 * The hierarchy is resolved on the SERVER so this page, the PDF and the email cannot each decide
 * it differently — do not re-derive it from legalName/dbaName here.
 */
export interface PublicCompany {
  legalName: string;
  dbaName?: string;
  primaryName: string;
  secondaryName?: string;
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

  /**
   * True only while an ACH debit is genuinely SETTLING — never merely because a Checkout Session
   * was opened. Opening Stripe and closing the tab submits nothing, and treating that as "in
   * flight" locked an unpaid invoice out of being paid for 24 hours.
   */
  paymentInProgress: boolean;

  /**
   * What the bank will debit, in three parts, so the customer can reconcile the ONE line on their
   * statement against an invoice for a smaller amount. All three come from the attempt as it was
   * authorized, not from today's settings.
   */
  processingAmount?: number;
  processingFeeAmount?: number;
  processingTotalCharged?: number;
  processingStartedAt?: string;

  lastAttemptFailed: boolean;
  /** Fixed, customer-safe wording. Never Stripe's own error text. */
  lastFailureMessage?: string;

  /**
   * The ACH processing fee for paying THIS balance by Stripe bank debit, computed server-side.
   *
   * DISPLAY ONLY. The page must show it before the customer authorizes anything, and must never
   * send it anywhere — the checkout endpoint recalculates from the invoice's own balance, so a
   * tampered page can change what is on screen and nothing else.
   */
  achProcessingFee: number;

  /** balance + fee — what the customer's bank will actually be debited. */
  achTotalWithFee: number;

  /** "ACH Processing Fee". Never render a bare "Fee" — a vague label reads as a hidden markup. */
  achProcessingFeeLabel: string;

  /** "No processing fee from Dream Cleaning NYC" — deliberately not "No fee". */
  manualAchFeeNote: string;
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
  /** The invoice balance being settled. */
  amount: number;
  /** The ACH fee the server computed and added. */
  processingFee: number;
  /** balance + fee — the authoritative figure, whatever the page had displayed. */
  totalCharged: number;
}

export interface PublicInvoice {
  invoiceNumber: string;
  status: InvoiceStatus;
  statusLabel: string;
  invoiceDate: string;
  dueDate: string;
  serviceStartDate?: string;
  serviceEndDate?: string;

  /** The individual visits, when the schedule is known. */
  serviceDates: string[];

  /**
   * "Service date" / "Service dates" / "Service period" and the formatted text, resolved on the
   * server so the page, the PDF and the email describe the same invoice identically. BOTH are
   * absent when the invoice records no period — render nothing rather than inventing one.
   */
  serviceDateLabel?: string;
  serviceDateText?: string;

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

  /** The customer-facing Stripe ACH fee. Never editable by the customer, never sent by a browser. */
  achCustomerFeeEnabled: boolean;
  achCustomerFeeRatePercent: number;
  achCustomerFeeCapAmount: number;

  defaultTaxType: InvoiceTaxType;
  defaultTaxRate?: number;
  /** 0 = tax-inclusive, 1 = pre-tax. Mirrors ContractPriceMode. */
  defaultContractPriceMode: number;
  defaultDueTerms: InvoiceDueTerms;
  defaultCustomerNote?: string;
  invoiceFooterText?: string;
  updatedAt: string;
  canEdit: boolean;
}

/**
 * The commercial billing defaults a NEW contract or invoice starts from.
 *
 * ONE SOURCE, TWO CONSUMERS: contract creation reads the price mode and rate, invoice creation
 * reads the tax type and rate, and editing either with "save as default" writes back. That is
 * what stops a contract quoting tax-inclusive while its invoices add 8.875% on top.
 *
 * Deliberately narrower than `BillingSettings` — neither form displays bank details, so neither
 * is handed them.
 */
export interface CommercialBillingDefaults {
  defaultTaxType: InvoiceTaxType;
  defaultTaxRate?: number;
  defaultContractPriceMode: number;
  defaultDueTerms: InvoiceDueTerms;
  achCustomerFeeEnabled: boolean;
  achCustomerFeeRatePercent: number;
  achCustomerFeeCapAmount: number;
}

/** One row of the business customer's own My Invoices list. */
export interface MyInvoiceListItem {
  invoiceNumber: string;
  /** How the customer opens it: /invoice/{token}, the same address the emailed link uses. */
  publicToken: string;
  contractNumber?: string;
  serviceAddress?: string;
  invoiceDate: string;
  dueDate: string;
  serviceStartDate?: string;
  serviceEndDate?: string;
  serviceDateLabel?: string;
  serviceDateText?: string;
  total: number;
  amountPaid: number;
  balanceDue: number;
  currency: string;
  status: InvoiceStatus;
  statusLabel: string;
  /** A bank debit is authorized and settling — shown as "Processing" rather than as unpaid. */
  paymentInProgress: boolean;
  paidAt?: string;
}

/** The result of "Create Next Invoice" on a contract: a DRAFT, plus what to look at first. */
export interface CreateNextInvoiceResult {
  invoice: InvoiceDetail;
  clonedFromInvoiceNumber?: string;
  /** Non-blocking. Nothing here stops the draft existing — the admin is about to review it. */
  warnings: string[];
  /** True when the schedule could not supply service dates and they must be chosen by hand. */
  needsServiceDates: boolean;
}

export interface InvoiceListFilters {
  search?: string;
  status?: InvoiceStatus | null;
  clientId?: number | null;
  paymentMethod?: InvoicePaymentMethod | null;
  fromDate?: string | null;
  toDate?: string | null;

  /**
   * TRUE shows ONLY archived invoices, false (the default) only active ones. A separate axis
   * from status, so the Archived tab is a place to find something filed away rather than extra
   * rows mixed into the live billing list.
   */
  archived?: boolean;
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
    // Always sent: the server defaults to false, but being explicit keeps the Archived tab's
    // request self-describing in the network log.
    params = params.set('archived', filters.archived === true);
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

  // ── The cleanings an invoice covers ──────────────────────────────────────────────────────

  /**
   * Which of this client's cleanings an invoice could cover.
   *
   * Returns unsellable rows too, each carrying the reason — "Already included in
   * DCI-2026-74521863", "already paid", "cancelled". A cleaning silently missing from the picker
   * is the thing an admin cannot debug.
   */
  eligibleOrders(
    contractClientId: number,
    opts: { invoiceId?: number; from?: string; to?: string } = {}
  ): Observable<InvoiceEligibleOrders> {
    let params = new HttpParams();
    if (opts.invoiceId) params = params.set('invoiceId', opts.invoiceId);
    if (opts.from) params = params.set('from', opts.from);
    if (opts.to) params = params.set('to', opts.to);

    return this.http.get<InvoiceEligibleOrders>(
      `${this.adminUrl}/eligible-orders/${contractClientId}`, { params });
  }

  /**
   * Sets which cleanings a DRAFT covers, and optionally the agreed group total.
   *
   * NOTHING IS WRITTEN TO THE ORDERS by this call. The allocation is a proposal until the invoice
   * is SENT — an admin who types an agreed figure, reconsiders and abandons the draft has
   * re-priced no bookings. Note the payload carries no per-order amount: the equal-shares split
   * is a server rule.
   */
  saveOrders(id: number, dto: SaveInvoiceOrders): Observable<InvoiceOrdersResult> {
    return this.http.put<InvoiceOrdersResult>(`${this.adminUrl}/${id}/orders`, dto);
  }

  previewOrders(dto: SaveInvoice, invoiceId?: number): Observable<InvoiceOrdersResult> {
    return this.http.post<InvoiceOrdersResult>(`${this.adminUrl}/orders/preview`, dto,
      invoiceId ? { params: { invoiceId } } : {});
  }

  /** The allocation as it currently stands — proposal or committed. */
  orders(id: number): Observable<InvoiceOrderAllocation[]> {
    return this.http.get<InvoiceOrderAllocation[]>(`${this.adminUrl}/${id}/orders`);
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

  /**
   * Records money received — the same call behind "Mark as Paid", which is the balance prefilled
   * rather than a status assignment. There is deliberately no endpoint that writes Status = Paid.
   *
   * Two acknowledgements the server refuses without: `allowOverpayment` when the amount exceeds
   * the balance, and `acknowledgeProcessingPayment` when a Stripe ACH debit is still settling.
   */
  recordPayment(id: number, body: {
    amount: number;
    paymentDate?: string;
    paymentMethod: InvoicePaymentRecordMethod;
    transactionReference?: string;
    internalNote?: string;
    allowOverpayment: boolean;
    acknowledgeProcessingPayment?: boolean;
  }): Observable<InvoiceDetail> {
    return this.http.post<InvoiceDetail>(`${this.adminUrl}/${id}/payments`, body);
  }

  /**
   * "Create Next Invoice" on a recurring contract.
   *
   * Produces a DRAFT and emails nobody — the admin reviews it and presses Send. A 400 means an
   * issued invoice already covers the period it worked out; resend with `allowDuplicatePeriod`
   * when there is a real reason to bill the same period twice.
   */
  createNextFromContract(contractId: number, allowDuplicatePeriod = false, acknowledgeUndatedDraft = false):
    Observable<CreateNextInvoiceResult> {
    return this.http.post<CreateNextInvoiceResult>(
      `${this.adminUrl}/from-contract/${contractId}`, { allowDuplicatePeriod,
        ...(acknowledgeUndatedDraft ? { acknowledgeUndatedDraft: true } : {}) });
  }

  reversePayment(id: number, paymentId: number, reason: string): Observable<InvoiceDetail> {
    return this.http.post<InvoiceDetail>(
      `${this.adminUrl}/${id}/payments/${paymentId}/reverse`, { reason });
  }

  void(id: number, reason: string): Observable<InvoiceDetail> {
    return this.http.post<InvoiceDetail>(`${this.adminUrl}/${id}/void`, { reason });
  }

  /**
   * ARCHIVE. Takes the invoice off the default list and changes nothing else — not the status,
   * not a figure, not a payment row, and not the public token the client reads it through.
   */
  archive(id: number): Observable<InvoiceDetail> {
    return this.http.post<InvoiceDetail>(`${this.adminUrl}/${id}/archive`, {});
  }

  unarchive(id: number): Observable<InvoiceDetail> {
    return this.http.post<InvoiceDetail>(`${this.adminUrl}/${id}/unarchive`, {});
  }

  /**
   * PERMANENT delete, for a test or mistaken invoice that never touched money. No undo.
   *
   * `confirmation` must read `DELETE <invoice number>` and is verified by the SERVER as well as
   * the dialog, alongside `InvoiceHardDeletePolicy` — a hand-rolled request cannot get past
   * either.
   */
  permanentlyDelete(id: number, confirmation: string): Observable<{ message: string }> {
    const params = new HttpParams().set('confirmation', confirmation);
    return this.http.delete<{ message: string }>(`${this.adminUrl}/${id}/permanent`, { params });
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

  // ── Looking from an order or a customer back at their invoices ─────────────────────────────

  /** Drives the Orders panel's "Send Invoice". A read — nothing is created or emailed. */
  invoicesForOrder(orderId: number): Observable<OrderInvoices> {
    return this.http.get<OrderInvoices>(`${this.adminUrl}/for-order/${orderId}`);
  }

  /**
   * Every invoice belonging to a customer, from both directions — their linked commercial
   * client's invoices and any invoice covering one of their own cleanings. An empty array is the
   * signal to hide the Invoices tab entirely.
   */
  invoicesForUser(userId: number): Observable<LinkedInvoiceSummary[]> {
    return this.http.get<LinkedInvoiceSummary[]>(`${this.adminUrl}/for-user/${userId}`);
  }

  /**
   * The commercial client a customer account is linked to. Resolves to null when there is none —
   * the endpoint answers 204, which HttpClient surfaces as a null body rather than an error.
   */
  clientForUser(userId: number): Observable<InvoiceClientOption | null> {
    return this.http.get<InvoiceClientOption | null>(`${this.adminUrl}/client-for-user/${userId}`);
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

  /**
   * The tax/price-mode/fee defaults a NEW contract or invoice starts from.
   *
   * A narrower read than the full settings, and open to any admin who can open either creation
   * form — it carries no bank details, which neither form displays.
   */
  getBillingDefaults(): Observable<CommercialBillingDefaults> {
    return this.http.get<CommercialBillingDefaults>(`${this.settingsUrl}/defaults`);
  }

  // ── The business customer's own invoices ──

  /**
   * Cheap boolean behind the header menu entry. Runs for every logged-in user on every page, so
   * it must stay a boolean and never fetch the list.
   */
  hasMyInvoices(): Observable<{ hasInvoices: boolean }> {
    return this.http.get<{ hasInvoices: boolean }>(`${environment.apiUrl}/my-invoices/has-invoices`);
  }

  /** Every ISSUED invoice belonging to the signed-in business account. Drafts are never returned. */
  myInvoices(): Observable<MyInvoiceListItem[]> {
    return this.http.get<MyInvoiceListItem[]>(`${environment.apiUrl}/my-invoices`);
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
): { lineAmounts: number[]; subTotal: number; discountAmount: number; taxAmount: number; total: number; preTaxTotal: number } {
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

  return { lineAmounts, subTotal, discountAmount, taxAmount, total: Math.max(0, total), preTaxTotal: round2(Math.max(0, total) - taxAmount) };
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
