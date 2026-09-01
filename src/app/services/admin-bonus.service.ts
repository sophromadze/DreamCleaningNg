import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

/**
 * One staff member's bonus for a period.
 *
 * A person earns on up to two slots, and they pay DIFFERENT rates: the OWN counts are bookings
 * they took themselves, the TEAM counts are bookings one of their administrators took that they
 * earn a manager's share of. Collapsing the two would make the bonus impossible to check by hand.
 */
export interface AdminBonusSummary {
  adminId: number;
  firstName: string;
  lastName: string;
  shiftColor?: string | null;

  /** 'Administrator' | 'Manager' — the position they hold today. */
  position: string;
  /** The manager this administrator reports to; null for managers and unattached admins. */
  managerId?: number | null;
  managerName?: string | null;
  /** How many administrators report to this person. Only meaningful for a Manager. */
  teamSize: number;

  /** Orders they earn on in the period, any status. */
  assignedCount: number;
  /** Orders that actually pay out, both slots combined. */
  eligibleCount: number;

  ownNewCustomerCount: number;
  ownExistingCustomerCount: number;
  teamNewCustomerCount: number;
  teamExistingCustomerCount: number;

  /** Rates for orders this person books themselves, at the position they hold today. */
  ownNewCustomerRate: number;
  ownExistingCustomerRate: number;
  ownNewCustomerRateIsCustom: boolean;
  ownExistingCustomerRateIsCustom: boolean;

  /** Rates for a manager's share of their administrators' bookings. */
  teamNewCustomerRate: number;
  teamExistingCustomerRate: number;
  teamNewCustomerRateIsCustom: boolean;
  teamExistingCustomerRateIsCustom: boolean;

  bonusAmount: number;
  currency: string;
}

/**
 * The company-wide defaults: three slots x whether the customer was new.
 *
 * The manager's own-booking pair is deliberately NOT "administrator + team share", even though the
 * owner's figures happen to add up that way — each is typed by hand, so raising one never moves
 * another on its own.
 */
export interface AdminBonusRates {
  administratorNewCustomerRate: number;
  administratorExistingCustomerRate: number;
  managerOwnBookingNewCustomerRate: number;
  managerOwnBookingExistingCustomerRate: number;
  managerTeamNewCustomerRate: number;
  managerTeamExistingCustomerRate: number;
  currency: string;
  updatedAt: string;
  updatedByUserId?: number | null;
  updatedByUserName?: string | null;
}

/**
 * A per-person override: one pair for their own bookings, one for a manager's team share. NULL on
 * a field means "follow the company default" — that is how an override is cleared, and it is
 * deliberately different from sending the default's current value, which would pin the person to
 * today's figure forever.
 */
export interface AdminBonusOverride {
  ownBookingNewCustomerRate: number | null;
  ownBookingExistingCustomerRate: number | null;
  teamBookingNewCustomerRate: number | null;
  teamBookingExistingCustomerRate: number | null;
}

@Injectable({ providedIn: 'root' })
export class AdminBonusService {
  private apiUrl = `${environment.apiUrl}/admin-bonus`;

  constructor(private http: HttpClient) {}

  /** Calendar-month default when from/to are omitted (UTC, matches the shifts view). */
  getBonuses(from?: string, to?: string, adminId?: number): Observable<AdminBonusSummary[]> {
    let params = new HttpParams();
    if (from) params = params.set('from', from);
    if (to) params = params.set('to', to);
    if (adminId != null) params = params.set('adminId', adminId);
    return this.http.get<AdminBonusSummary[]>(this.apiUrl, { params });
  }

  /** Used by the admin user-profile page. Omit from/to for all-time totals. */
  getForAdmin(adminId: number, from?: string, to?: string): Observable<AdminBonusSummary> {
    let params = new HttpParams();
    if (from) params = params.set('from', from);
    if (to) params = params.set('to', to);
    return this.http.get<AdminBonusSummary>(`${this.apiUrl}/admin/${adminId}`, { params });
  }

  getRates(): Observable<AdminBonusRates> {
    return this.http.get<AdminBonusRates>(`${this.apiUrl}/rates`);
  }

  /** SuperAdmin only — backend enforces. Restates every month on screen, past ones included. */
  setRates(rates: {
    administratorNewCustomerRate: number;
    administratorExistingCustomerRate: number;
    managerOwnBookingNewCustomerRate: number;
    managerOwnBookingExistingCustomerRate: number;
    managerTeamNewCustomerRate: number;
    managerTeamExistingCustomerRate: number;
  }): Observable<AdminBonusRates> {
    return this.http.put<AdminBonusRates>(`${this.apiUrl}/rates`, rates);
  }

  /**
   * SuperAdmin only — one person's own rates. Send nulls on every field to put them back on the
   * company defaults. Answers with that person's row over the same window, so the panel can redraw
   * without a second request.
   */
  setOverride(adminId: number, override: AdminBonusOverride, from?: string, to?: string):
    Observable<AdminBonusSummary> {
    let params = new HttpParams();
    if (from) params = params.set('from', from);
    if (to) params = params.set('to', to);
    return this.http.put<AdminBonusSummary>(
      `${this.apiUrl}/admin/${adminId}/rates`, override, { params });
  }
}
