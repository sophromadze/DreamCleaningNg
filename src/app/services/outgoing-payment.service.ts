import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { CleanerPaymentMethod } from './cleaner-management.service';

/**
 * Outgoing Payments — what the company owes its cleaners for finished jobs.
 *
 * Every figure here is computed SERVER-side by CleanerPayrollCalculator and rendered as given.
 * There is deliberately no frontend mirror of that math: unlike order pricing (which the booking
 * page has to quote live, before anything is saved), payroll is only ever read back and edited
 * through the API, so a second implementation would be dead weight free to drift.
 */

export type OutgoingPaymentPaidFilter = 'all' | 'unpaid' | 'paid';

// ── Staff salaries ──────────────────────────────────────────────────────────
//
// Deliberately a different shape from the cleaner lines below: a cleaner is paid per ORDER for
// hours worked, while an admin is paid a monthly salary in two instalments. What is OWED is
// derived server-side from the Salaries expenses, so this page and the reported cost cannot
// disagree; only the payments are stored.

export interface AdminSalaryInstalment {
  /** 1 = first payment of the month, 2 = second. */
  half: number;
  /** "First payment" / "Second payment" — no calendar dates are claimed. */
  label: string;
  /** Owed, in `currency` — or, once paid, the FROZEN figure that was actually handed over. */
  amount: number;
  currency: string;
  amountUsd: number;
  /** This instalment's half of the salary, before bonuses. */
  salaryAmount: number;
  /** Bonuses riding on this instalment. Always 0 on the first — see the second payment. */
  bonusAmount: number;
  isPaid: boolean;
  paidAt?: string | null;
  paidByName?: string | null;
  paymentNote?: string | null;
}

export interface AdminSalaryPayout {
  /** Stable identity for the person; what the pay/unpay calls address them by. */
  payeeKey: string;
  /** Null for a salary recorded against a typed name rather than an account. */
  staffUserId?: number | null;
  name: string;
  /** Null once they no longer hold a staff role. */
  role?: string | null;
  isFormerStaff: boolean;
  /**
   * Where the salary is actually sent — an IBAN, a card or an ID number. Free text, copied
   * verbatim and never parsed. Null until somebody fills it in.
   */
  paymentDetails?: string | null;
  /** The salary alone, in the currency it was entered in. */
  salaryTotal: number;
  /**
   * Staff bonuses earned this month, in the salary's currency (converted when the two differ —
   * bonus rates are always set in GEL). Paid with the SECOND instalment.
   */
  bonusTotal: number;
  bonusTotalGel: number;
  bonusTotalUsd: number;
  /** Salary + bonuses — what the month owes this person in total. */
  monthTotal: number;
  currency: string;
  monthTotalUsd: number;
  usdPerGel?: number | null;
  /** Always exactly two, always in order. */
  instalments: AdminSalaryInstalment[];
  isFullyPaid: boolean;
  isPartiallyPaid: boolean;
  unpaidAmount: number;
  /** Worth knowing before sending money. Never blocks anything. */
  warnings: string[];
}

export interface AdminSalaryPayoutList {
  year: number;
  month: number;
  monthLabel: string;
  payees: AdminSalaryPayout[];
  totalUsd: number;
  paidUsd: number;
  unpaidUsd: number;
  unpaidInstalmentCount: number;
}

export interface OutgoingPaymentCleaner {
  /** 0 on an unassigned slot — there is no assignment row behind it. */
  orderCleanerId: number;
  cleanerId: number;
  firstName: string;
  lastName: string;
  /**
   * True for a staffing slot with nobody assigned. The figures are real — somebody worked those
   * hours — and the slot CAN be marked paid; it just cannot have its rate or hours edited, since
   * there is no per-cleaner record to hang an override on.
   */
  isUnassigned?: boolean;
  /** Unassigned slots only: which slot this is, 0-based. The pay/unpay endpoints key on it. */
  slotIndex?: number;
  /** The cleaner's saved payout method — a hint for whoever is sending the money. */
  paymentMethod?: CleanerPaymentMethod | number | null;
  paymentDetails?: string | null;
  billableMinutes: number;
  hoursOverridden: boolean;
  hourlyRate: number;
  rateOverridden: boolean;
  /** Rate is off the service type's default — this drives the per-line warning pill. */
  rateDiffersFromDefault: boolean;
  salary: number;
  tips: number;
  /** salary + tips: what actually gets handed to this person. */
  payout: number;
  isPaid: boolean;
  /**
   * Total handed over so far, frozen at pay time. Null until paid. A top-up ADDS to it, so it
   * reads as everything this person has had for this order.
   */
  paidAmount?: number | null;
  paidVia?: CleanerPaymentMethod | number | null;
  paidAt?: string | null;
  paidByName?: string | null;
  paymentNote?: string | null;

  // ===== Settlement =====
  //
  // Resolved server-side by Helpers/CleanerPayoutSettlement. The component RENDERS these and
  // recomputes nothing — a second copy of the rule here could disagree with the figure the pay
  // endpoint actually charges.

  /** Still to hand over: the whole payout on an unpaid line, the shortfall on a paid one. */
  outstandingPayout: number;
  /** Paid above what the line is now worth — hours edited down after payment. Advisory. */
  overpaidAmount: number;
  /** Nothing left to pay on this line. */
  isSettled: boolean;
  /**
   * Paid once already and worth more now. The ONLY thing that may turn on "still to pay"
   * wording — an ordinary unpaid line must never show it.
   */
  isTopUp: boolean;
}

export interface OutgoingPaymentOrder {
  orderId: number;
  /** The effective, human-facing name — used in warning sentences, not in the table column. */
  serviceTypeName: string;
  isCustomServiceType: boolean;

  // The raw ingredients the SHORT table label is built from. See
  // shared/admin/service-type-short-label.ts — the rules live there, once, so this page and the
  // Orders tab can never label the same order differently.
  rawServiceTypeName: string;
  customServiceDisplayName?: string | null;
  isDeepCleaning: boolean;
  serviceDate: string;
  serviceTime: string;
  status: string;
  /** How the CUSTOMER paid: Normal / Cash / Zelle / Check / Other. */
  paymentMethod: string;
  isPaidByCustomer: boolean;
  customerName: string;
  serviceAddress?: string | null;
  city?: string | null;

  subTotal: number;
  tax: number;
  /** "Current total (no tips)". */
  totalWithoutTips: number;
  tips: number;
  total: number;

  totalDuration: number;
  automaticMinutesPerCleaner: number;
  maidsCount: number;
  /**
   * How many people the work was split across — max(maidsCount, assigned). "· 6h each cleaner"
   * comes from this, NOT from the number of assignment rows.
   */
  splitCount: number;
  orderHourlyRate: number;
  expectedHourlyRate: number;
  totalSalary: number;
  totalPayout: number;

  cleaners: OutgoingPaymentCleaner[];
  /**
   * Staffing slots nobody is assigned to. Reported, counted in the totals, and payable like any
   * other line — the record is keyed by slot index rather than by cleaner. Kept out of `cleaners`
   * so anything walking the assignment list cannot trip over a line with no cleaner behind it;
   * `isFullyPaid` deliberately spans both.
   */
  unassignedCleaners: OutgoingPaymentCleaner[];
  warnings: string[];
  /** Every line SETTLED — paid, and still covered by what was paid. */
  isFullyPaid: boolean;
  isPartiallyPaid: boolean;
  /** Everything still to hand over: unpaid lines plus any shortfalls. */
  outstandingPayout: number;
  /**
   * The part of `outstandingPayout` owed on lines ALREADY PAID — the extra an order edit
   * created. Zero on an order nobody has been paid for.
   */
  topUpPayout: number;
  /** Any line paid above what it is now worth. Advisory; nothing is clawed back. */
  overpaidAmount: number;
}

export interface OutgoingPaymentSummary {
  orderCount: number;
  cleanerLineCount: number;
  totalSalary: number;
  totalTips: number;
  totalPayout: number;
  /** Unpaid lines in full PLUS the shortfall on lines paid before their hours grew. */
  unpaidPayout: number;
  paidPayout: number;
  /** The part of `unpaidPayout` owed on already-paid lines. */
  topUpPayout: number;
  unpaidCleanerCount: number;
  ordersWithWarnings: number;
}

export interface OutgoingPaymentList {
  orders: OutgoingPaymentOrder[];
  summary: OutgoingPaymentSummary;
  totalCount: number;
  page: number;
  pageSize: number;
}

export interface OutgoingPaymentQuery {
  from?: string | null;
  to?: string | null;
  paidStatus?: OutgoingPaymentPaidFilter;
  warningsOnly?: boolean;
  search?: string | null;
  cleanerId?: number | null;
  page?: number;
  pageSize?: number;
}

/**
 * The two `update*` booleans are what separate "leave this alone" from "clear the override".
 * Sending only a value could never express the second, and clearing an override is how a line
 * goes back to tracking the order.
 */
export interface UpdateCleanerPayrollPayload {
  hourlyRate?: number | null;
  billableMinutes?: number | null;
  updateHourlyRate: boolean;
  updateBillableMinutes: boolean;
}

@Injectable({ providedIn: 'root' })
export class OutgoingPaymentService {
  private apiUrl = `${environment.apiUrl}/admin/outgoing-payments`;

  constructor(private http: HttpClient) {}

  getPayments(query: OutgoingPaymentQuery = {}): Observable<OutgoingPaymentList> {
    let params = new HttpParams();
    if (query.from) params = params.set('from', query.from);
    if (query.to) params = params.set('to', query.to);
    if (query.paidStatus) params = params.set('paidStatus', query.paidStatus);
    if (query.warningsOnly) params = params.set('warningsOnly', 'true');
    if (query.search?.trim()) params = params.set('search', query.search.trim());
    if (query.cleanerId) params = params.set('cleanerId', String(query.cleanerId));
    if (query.page) params = params.set('page', String(query.page));
    if (query.pageSize) params = params.set('pageSize', String(query.pageSize));

    return this.http.get<OutgoingPaymentList>(this.apiUrl, { params });
  }

  /** Every write returns the ORDER's refreshed payout sheet, so one card can be swapped in place. */
  updateCleanerPayroll(
    orderId: number,
    orderCleanerId: number,
    payload: UpdateCleanerPayrollPayload
  ): Observable<OutgoingPaymentOrder> {
    return this.http.put<OutgoingPaymentOrder>(
      `${this.apiUrl}/order/${orderId}/cleaner/${orderCleanerId}`, payload);
  }

  /**
   * Sets the ORDER's hourly rate — the default every assigned cleaner without their own override
   * is paid at. Written through to `Order.CleanerHourlyRate` server-side, so the change lands on
   * the order itself and not just on this page's view of it.
   */
  updateOrderHourlyRate(orderId: number, hourlyRate: number): Observable<OutgoingPaymentOrder> {
    return this.http.put<OutgoingPaymentOrder>(
      `${this.apiUrl}/order/${orderId}/hourly-rate`, { hourlyRate });
  }

  markCleanerPaid(
    orderId: number,
    orderCleanerId: number,
    body: { paidVia?: CleanerPaymentMethod | number | null; paymentNote?: string | null } = {}
  ): Observable<OutgoingPaymentOrder> {
    return this.http.post<OutgoingPaymentOrder>(
      `${this.apiUrl}/order/${orderId}/cleaner/${orderCleanerId}/pay`, body);
  }

  markOrderPaid(orderId: number, body: { paymentNote?: string | null } = {}): Observable<OutgoingPaymentOrder> {
    return this.http.post<OutgoingPaymentOrder>(`${this.apiUrl}/order/${orderId}/pay`, body);
  }

  undoCleanerPayment(orderId: number, orderCleanerId: number): Observable<OutgoingPaymentOrder> {
    return this.http.post<OutgoingPaymentOrder>(
      `${this.apiUrl}/order/${orderId}/cleaner/${orderCleanerId}/unpay`, {});
  }

  /**
   * Records a payout against a staffing slot with nobody on file. Addressed by SLOT INDEX, not by
   * a cleaner id — there is no cleaner. The note is where the person's name goes.
   */
  markUnassignedSlotPaid(
    orderId: number,
    slotIndex: number,
    body: { paidVia?: CleanerPaymentMethod | number | null; paymentNote?: string | null } = {}
  ): Observable<OutgoingPaymentOrder> {
    return this.http.post<OutgoingPaymentOrder>(
      `${this.apiUrl}/order/${orderId}/unassigned/${slotIndex}/pay`, body);
  }

  undoUnassignedSlotPayment(orderId: number, slotIndex: number): Observable<OutgoingPaymentOrder> {
    return this.http.post<OutgoingPaymentOrder>(
      `${this.apiUrl}/order/${orderId}/unassigned/${slotIndex}/unpay`, {});
  }

  // ── Staff salaries ────────────────────────────────────────────────────────
  //
  // A salary is per PERSON per MONTH, paid in two instalments — a different shape from the
  // per-order cleaner wages above, so it gets its own calls rather than being forced into
  // theirs. Every write answers with the whole month, so the page redraws from one response.

  getSalaries(year: number, month: number): Observable<AdminSalaryPayoutList> {
    const params = new HttpParams().set("year", year).set("month", month);
    return this.http.get<AdminSalaryPayoutList>(this.apiUrl + "/salaries", { params });
  }

  markSalaryPaid(
    year: number,
    month: number,
    half: number,
    payeeKey: string,
    body: { paymentNote?: string | null } = {}
  ): Observable<AdminSalaryPayoutList> {
    const params = new HttpParams().set("payeeKey", payeeKey);
    return this.http.post<AdminSalaryPayoutList>(
      this.apiUrl + "/salaries/" + year + "/" + month + "/" + half + "/pay", body, { params });
  }

  /** Sets where an employee's salary is sent. An empty string CLEARS it. */
  updateSalaryPayeeDetails(
    year: number,
    month: number,
    payeeKey: string,
    paymentDetails: string | null
  ): Observable<AdminSalaryPayoutList> {
    const params = new HttpParams().set("payeeKey", payeeKey);
    return this.http.put<AdminSalaryPayoutList>(
      this.apiUrl + "/salaries/" + year + "/" + month + "/payee-details", { paymentDetails }, { params });
  }

  undoSalaryPayment(year: number, month: number, half: number, payeeKey: string): Observable<AdminSalaryPayoutList> {
    const params = new HttpParams().set("payeeKey", payeeKey);
    return this.http.post<AdminSalaryPayoutList>(
      this.apiUrl + "/salaries/" + year + "/" + month + "/" + half + "/unpay", {}, { params });
  }
}
