import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

/**
 * Company → Customers tab data. Mirrors `Controllers/Admin/AdminCustomerStatsController.cs`.
 *
 * The four words every figure hangs off, kept identical to the backend doc comment:
 *  • **Active**    — booked at least once inside the window.
 *  • **New**       — their first-ever booking falls inside the window.
 *  • **Returning** — they had already booked before the window opened ("came back").
 *  • **Repeat**    — 2+ bookings INSIDE the window (a different question from Returning).
 */
export interface CustomerStatistics {
  from: string | null;
  to: string | null;

  activeCustomers: number;
  newCustomers: number;
  returningCustomers: number;
  repeatCustomers: number;
  /** Returning customers who had been away more than 180 days — won back, not merely still around. */
  reactivatedCustomers: number;

  /**
   * Active customers whose previous booking was within 90 days of the window opening — the
   * headline retention figure. Backward-looking on purpose: a forward-looking cohort cannot be
   * measured until the lookback has elapsed, which would blank the most recent months.
   */
  recentlyActiveCustomers: number;
  recentlyActiveRate: number;

  /**
   * Median days between consecutive bookings over the 12 months ending with this window. Null when
   * the sample is under 10 gaps. Not offered as a comparison row — it is the same figure in every
   * compared column.
   */
  medianDaysBetweenBookings: number | null;
  medianGapSampleSize: number;
  medianWindowFrom: string;
  medianWindowTo: string;

  /** Period-over-period retention. Kept, but never the headline — see the tab's docs. */
  previousActiveCustomers: number;
  retainedCustomers: number;
  lapsedCustomers: number;

  returningRate: number;
  newRate: number;
  repeatRate: number;
  retentionRate: number;
  churnRate: number;
  /** Share of the window's ORDERS placed by returning customers. */
  repeatOrderShare: number;

  totalOrders: number;
  newCustomerOrders: number;
  returningCustomerOrders: number;
  ordersPerCustomer: number;

  /**
   * What customers actually paid, net of refunds — tax-inclusive, the same basis as CRM lifetime
   * value. Deliberately NOT the Finances page's revenue, which strips tax and tips out.
   */
  totalSpend: number;
  newCustomerSpend: number;
  returningCustomerSpend: number;
  averageOrderValue: number;
  spendPerCustomer: number;
  newCustomerAov: number;
  returningCustomerAov: number;

  signups: number;
  signupsWhoBooked: number;
  activationRate: number;

  recurringPlanCustomers: number;
  recurringPlanRate: number;

  // ── CRM follow-ups ──
  // A booking counts as followed-up when a Call/Email/SMS was logged on a CRM lead matching that
  // customer in the 90 days before they placed the order. Correlation, not proof of cause — and it
  // only sees outreach an admin actually logged, so it is a floor.
  /** Call/Email/SMS activities logged on any lead during the window — outreach effort. */
  followUpsLogged: number;
  /** Distinct leads that received one, i.e. how many people were chased. */
  leadsFollowedUp: number;
  followedUpCustomers: number;
  /** Of the customers who came back, how many we had chased first. */
  returningAfterFollowUp: number;
  returningWithoutFollowUp: number;
  followUpAssistedRate: number;
  followUpAssistedSpend: number;

  frequency: CustomerFrequencyBucket[];
  topCustomers: CustomerStatsTopCustomer[];
}

export interface CustomerFrequencyBucket {
  /** '1' | '2' | '3' | '4+' */
  label: string;
  customers: number;
  orders: number;
  spend: number;
}

export interface CustomerStatsTopCustomer {
  userId: number;
  fullName: string;
  /** Empty for no-email customers, whose stored address is a non-routable placeholder. */
  email: string;
  orders: number;
  spend: number;
  isReturning: boolean;
}

export interface CustomerTrendPoint {
  monthStart: string;
  label: string;
  activeCustomers: number;
  newCustomers: number;
  returningCustomers: number;
  repeatCustomers: number;
  orders: number;
  spend: number;
  returningRate: number;
}

@Injectable({ providedIn: 'root' })
export class CustomerStatsService {
  private apiUrl = `${environment.apiUrl}/admin/customer-statistics`;

  constructor(private http: HttpClient) {}

  getStatistics(from?: string, to?: string): Observable<CustomerStatistics> {
    let params = new HttpParams();
    if (from) params = params.set('from', from);
    if (to) params = params.set('to', to);
    return this.http.get<CustomerStatistics>(this.apiUrl, { params });
  }

  getTrend(months = 12): Observable<CustomerTrendPoint[]> {
    return this.http.get<CustomerTrendPoint[]>(
      `${this.apiUrl}/trend`, { params: new HttpParams().set('months', months) });
  }
}
