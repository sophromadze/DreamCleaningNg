import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface AdminBonusSummary {
  adminId: number;
  firstName: string;
  lastName: string;
  shiftColor?: string | null;
  assignedCount: number;
  eligibleCount: number;
  bonusAmount: number;
  ratePerOrder: number;
  currency: string;
}

export interface AdminBonusRate {
  ratePerOrder: number;
  currency: string;
  updatedAt: string;
  updatedByUserId?: number | null;
  updatedByUserName?: string | null;
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

  getRate(): Observable<AdminBonusRate> {
    return this.http.get<AdminBonusRate>(`${this.apiUrl}/rate`);
  }

  /** SuperAdmin only — backend enforces. */
  setRate(ratePerOrder: number): Observable<AdminBonusRate> {
    return this.http.put<AdminBonusRate>(`${this.apiUrl}/rate`, { ratePerOrder });
  }
}
