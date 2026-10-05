import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

/** Mirrors the backend RecurrenceIntervalUnit enum. Sent as the NUMBER the enum uses. */
export enum RecurrenceIntervalUnit {
  Days = 0,
  Weeks = 1,
  Months = 2
}

export interface RecurringOccurrence {
  orderId: number;
  serviceDate: string;
  serviceTime: string;
  occurrenceDate: string | null;
  status: string;
  total: number;
  isPaid: boolean;
  isSkipped?: boolean;
  isTemplate: boolean;
  wasGenerated: boolean;
  paymentMethod: string;
  contractId?: number | null;
  /** Cleaners the series assigned that nobody has notified yet. Drives the panel's warning. */
  autoAssignedNotNotifiedCount: number;
  assignedCleanerCount: number;
}

export interface RecurringSeries {
  recurringLoyaltyDiscountPercent?: number | null;
  /** The same standing discount written as a fixed amount. At most one of the two is ever set. */
  recurringLoyaltyDiscountAmount?: number | null;
  generationWarnings?: string[];
  stoppedAt?: string | null;
  id: number;
  userId: number;
  customerName: string;
  templateOrderId: number;
  intervalValue: number;
  intervalUnit: RecurrenceIntervalUnit;
  intervalLabel: string;
  /** Selected weekdays, 0 = Sunday. Empty = the original single-date schedule. */
  serviceDaysOfWeek?: number[];
  /** Selected days of the month. Empty = the original anchor-day schedule. */
  serviceDaysOfMonth?: number[];
  /** Upcoming cleanings kept generated. Null = a plan saved before the count existed (30-day window). */
  upcomingOccurrenceTarget?: number | null;
  /** Upcoming, non-cancelled cleanings the plan holds right now. */
  upcomingCount?: number;
  contract?: RecurringContractOption | null;
  /** Billing belongs to the linked weekly-flat-fee contract; no per-visit charges or requests. */
  billingControlledByContract?: boolean;
  anchorDate: string;
  serviceTime: string;
  endDate: string | null;
  isActive: boolean;
  copyCleanerAssignments: boolean;
  autoRequestPayment: boolean;
  generatedThroughDate: string | null;
  notes: string | null;
  createdAt: string;
  createdByName: string | null;
  occurrences: RecurringOccurrence[];
  /** Dates inside the horizon with no order yet — empty right after a generation pass. */
  pendingDates: string[];
}

export interface SaveRecurringSeries {
  recurringLoyaltyDiscountPercent?: number | null;
  recurringLoyaltyDiscountAmount?: number | null;
  serviceTime?: string | null;
  futureOrdersAction?: 'Keep' | 'Regenerate' | null;
  intervalValue: number;
  intervalUnit: RecurrenceIntervalUnit;
  serviceDaysOfWeek?: number[] | null;
  serviceDaysOfMonth?: number[] | null;
  upcomingOccurrenceTarget?: number | null;
  contractId?: number | null;
  anchorDate?: string | null;
  endDate?: string | null;
  copyCleanerAssignments: boolean;
  autoRequestPayment: boolean;
  isActive: boolean;
  notes?: string | null;
}

/** A commercial contract a plan may be linked to. */
export interface RecurringContractOption {
  id: number;
  contractNumber: string;
  status: string;
  contractClientId: number;
  serviceAddress?: string | null;
  pricingBasis: 'PerVisit' | 'WeeklyFlatFee' | string;
  isWeeklyFlatFee: boolean;
  visitsPerWeek: number;
  preTaxPrice: number;
  salesTaxAmount: number;
  totalPrice: number;
  weekDefinition: string;
}

export interface RecurringContractOptions {
  contractClientId?: number | null;
  contracts: RecurringContractOption[];
  suggestedContractId?: number | null;
}

/** The most upcoming cleanings a plan may keep generated — mirrors MaxUpcomingOccurrenceTarget. */
export const MAX_UPCOMING_OCCURRENCE_TARGET = 60;

export interface RecurringGenerationResult {
  seriesId: number;
  createdCount: number;
  createdOrderIds: number[];
  /** Dates that already existed. Proof the pass was idempotent rather than lucky. */
  skippedExistingDates: string[];
  warnings: string[];
}

// ── Customer side ────────────────────────────────────────────────────────────────────────────

export interface UpcomingRecurringOrder {
  /**
   * "Billed weekly by contract DCC-…" — an operational cleaning under a weekly flat fee contract.
   * Shown INSTEAD of its $0 price, which would otherwise read as a free cleaning.
   */
  billedByContractLabel?: string | null;
  includedInPayAll?: boolean;
  paymentMethod?: string;
  orderId: number;
  serviceDate: string;
  serviceTime: string;
  serviceTypeName: string;
  status: string;
  total: number;
  amountDue: number;
  isPaid: boolean;
  /** Only the nearest unpaid cleaning starts payable; paying it exposes the next. */
  isPayable: boolean;
  queuePosition: number;
  blockedReason: string | null;
}

export interface UpcomingRecurringOrders {
  /** NEAREST FIRST — the server sorts, the page does not re-sort. */
  orders: UpcomingRecurringOrder[];
  payAllTotal: number;
  payAllCount: number;
  canPayAll: boolean;
}

export interface CombinedPayment {
  batchId: number;
  amount: number;
  orderIds: number[];
  paymentIntentId: string | null;
  paymentClientSecret: string | null;
  requiresPayment: boolean;
}

/**
 * Recurring cleanings — the admin's schedule management and the customer's own upcoming list.
 *
 * ONE SERVICE, TWO AUDIENCES, because they are two views of the same feature and splitting them
 * would mean two files that have to agree about the same DTOs. The ROUTES keep them apart, which
 * is where it matters: `api/admin/recurring-series/**` is Admin/SuperAdmin with the ordinary order
 * permissions, `api/my-recurring-orders/**` is scoped to the signed-in customer from their token
 * and takes no user id at all.
 */
export interface RecurringPricePreview {
  sourceDiscounts: { label: string; amount: number; percent: number | null }[];
  baseCleaning: number; loyaltyPercent: number; loyaltySource: string; loyaltyAmount: number;
  tax: number; tips: number; total: number; commercialLoyaltyExcluded: boolean;
  /** True when the applied discount was entered as a fixed amount, so the percentage is derived. */
  loyaltyIsFixedAmount?: boolean;
}

@Injectable({ providedIn: 'root' })
export class RecurringOrderService {
  private readonly admin = `${environment.apiUrl}/admin/recurring-series`;
  private readonly mine = `${environment.apiUrl}/my-recurring-orders`;

  constructor(private http: HttpClient) {}

  // ── Admin ──────────────────────────────────────────────────────────────────────────────────

  list(includeInactive = false): Observable<RecurringSeries[]> {
    return this.http.get<RecurringSeries[]>(`${this.admin}?includeInactive=${includeInactive}`);
  }

  get(seriesId: number): Observable<RecurringSeries> {
    return this.http.get<RecurringSeries>(`${this.admin}/${seriesId}`);
  }

  /** The series an order belongs to, or null. Drives the order panel's Recurrence card. */
  forOrder(orderId: number): Observable<RecurringSeries | null> {
    return this.http.get<RecurringSeries | null>(`${this.admin}/for-order/${orderId}`);
  }

  /** Executed contracts a plan built from this order may be linked to. */
  contractOptions(orderId: number): Observable<RecurringContractOptions> {
    return this.http.get<RecurringContractOptions>(`${this.admin}/from-order/${orderId}/contracts`);
  }

  createFromOrder(orderId: number, dto: SaveRecurringSeries): Observable<RecurringSeries> {
    return this.http.post<RecurringSeries>(`${this.admin}/from-order/${orderId}`, dto);
  }

  update(seriesId: number, dto: SaveRecurringSeries): Observable<RecurringSeries> {
    return this.http.put<RecurringSeries>(`${this.admin}/${seriesId}`, dto);
  }

  /**
   * The estimate for one cleaning under a proposed discount. The discount is sent the way the
   * admin wrote it — percentage OR fixed amount, never both — because the server resolves a fixed
   * amount against the quoted subtotal, which is the only place the equivalent percentage exists.
   */
  preview(orderId: number, recurringLoyaltyDiscountPercent: number | null,
          recurringLoyaltyDiscountAmount: number | null = null): Observable<RecurringPricePreview> {
    return this.http.post<RecurringPricePreview>(this.admin + '/from-order/' + orderId + '/preview',
      { recurringLoyaltyDiscountPercent, recurringLoyaltyDiscountAmount });
  }

  setState(seriesId: number, action: 'pause' | 'resume' | 'stop'): Observable<RecurringSeries> {
    return this.http.post<RecurringSeries>(`${this.admin}/${seriesId}/state/${action}`, {});
  }

  skip(seriesId: number, orderId: number): Observable<void> {
    return this.http.post<void>(`${this.admin}/${seriesId}/occurrences/${orderId}/skip`, {});
  }

  /** Fills this series' horizon now. Safe to press twice — generation is idempotent. */
  generate(seriesId: number): Observable<RecurringGenerationResult> {
    return this.http.post<RecurringGenerationResult>(`${this.admin}/${seriesId}/generate`, {});
  }

  // ── Customer ───────────────────────────────────────────────────────────────────────────────

  upcoming(): Observable<UpcomingRecurringOrders> {
    return this.http.get<UpcomingRecurringOrders>(this.mine);
  }

  /**
   * Starts ONE payment covering every unpaid upcoming recurring cleaning.
   *
   * NOTE WHAT IS NOT SENT: no amount, and no list of order ids. The server derives both from the
   * signed-in customer's own orders, so nothing this page does can change what is charged.
   */
  payAll(recurringSeriesId?: number): Observable<CombinedPayment> {
    return this.http.post<CombinedPayment>(`${this.mine}/pay-all`,
      recurringSeriesId ? { recurringSeriesId } : {});
  }
}
