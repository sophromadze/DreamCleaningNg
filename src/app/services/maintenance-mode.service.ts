import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface MaintenanceModeStatus {
  isEnabled: boolean;
  message?: string;
  startedAt?: Date;
  endedAt?: Date;
  startedBy?: string;
}

export interface ToggleMaintenanceModeRequest {
  isEnabled: boolean;
  message?: string;
}

@Injectable({
  providedIn: 'root'
})
export class MaintenanceModeService {
  private apiUrl = `${environment.apiUrl}/maintenancemode`;

  constructor(private http: HttpClient) { }

  getStatus(): Observable<MaintenanceModeStatus> {
    return this.http.get<MaintenanceModeStatus>(`${this.apiUrl}/status`);
  }

  toggleMaintenanceMode(request: ToggleMaintenanceModeRequest): Observable<MaintenanceModeStatus> {
    return this.http.post<MaintenanceModeStatus>(`${this.apiUrl}/toggle`, request);
  }

  isEnabled(): Observable<boolean> {
    return this.http.get<boolean>(`${this.apiUrl}/is-enabled`);
  }
} 