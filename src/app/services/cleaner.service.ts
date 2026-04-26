import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface AvailableCleaner {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  isAvailable: boolean;
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

  assignCleaners(orderId: number, cleanerIds: number[], tipsForCleaner?: string, cleanerHourlyRate?: number): Observable<any> {
    return this.http.post(`${this.adminApiUrl}/orders/${orderId}/assign-cleaners`, {
      cleanerIds,
      tipsForCleaner,
      cleanerHourlyRate
    });
  }

  removeCleanerFromOrder(orderId: number, cleanerId: number): Observable<any> {
    return this.http.delete(`${this.adminApiUrl}/orders/${orderId}/cleaners/${cleanerId}`);
  }
}
