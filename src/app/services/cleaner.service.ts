import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface AvailableCleaner {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  /** False when the 1-hour-gap rule flags a same-day conflict. Sorting/labelling only —
   *  a conflict is a warning the admin can overrule, never a permission. */
  isAvailable: boolean;
  location?: string | null;
  ranking?: number | string | null;
  experience?: string | null;
  /** Soft: marked busy that day via recurring weekday / vacation. Still assignable. */
  isBusyDay?: boolean;
  busyDayReason?: string | null;
  /** Another Active/Pending job within 1 hour the same day. Warned about loudly and
   *  acknowledged before the assign goes through — NOT blocked (2026-08-31). */
  hasScheduleConflict?: boolean;
  conflictReason?: string | null;
  createdAt?: string;
}

@Injectable({
  providedIn: 'root'
})
export class CleanerService {
  private adminApiUrl = `${environment.apiUrl}/admin`;

  constructor(private http: HttpClient) {}

  getAvailableCleaners(orderId: number): Observable<AvailableCleaner[]> {
    return this.http.get<AvailableCleaner[]>(`${this.adminApiUrl}/orders/${orderId}/available-cleaners`);
  }

  /**
   * @param acknowledgeScheduleConflicts the admin has seen the same-day 1-hour-gap warnings on
   *        the cleaners they picked and wants them assigned anyway. The server refuses a
   *        conflicting assignment without it, so this must only ever be sent off a deliberate
   *        acknowledgement in the UI — never defaulted to true.
   */
  assignCleaners(
    orderId: number,
    cleanerIds: number[],
    tipsForCleaner?: string,
    cleanerHourlyRate?: number,
    acknowledgeScheduleConflicts = false
  ): Observable<any> {
    return this.http.post(`${this.adminApiUrl}/orders/${orderId}/assign-cleaners`, {
      cleanerIds,
      tipsForCleaner,
      cleanerHourlyRate,
      acknowledgeScheduleConflicts
    });
  }

  removeCleanerFromOrder(orderId: number, cleanerId: number): Observable<any> {
    return this.http.delete(`${this.adminApiUrl}/orders/${orderId}/cleaners/${cleanerId}`);
  }
}
