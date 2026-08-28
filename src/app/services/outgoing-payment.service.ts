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
  /** What was handed over, frozen at pay time. Null until paid. */
  paidAmount?: number | null;
  paidVia?: CleanerPaymentMethod | number | null;
  paidAt?: string | null;
  paidByName?: string | null;
  paymentNote?: string | null;
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
  isFullyPaid: boolean;
  isPartiallyPaid: boolean;
}

export interface OutgoingPaymentSummary {
  orderCount: number;
  cleanerLineCount: number;
  totalSalary: number;
  totalTips: number;
  totalPayout: number;
  unpaidPayout: number;
  paidPayout: number;
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
}
