import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface AdminShift {
  id: number;
  shiftDate: string;
  adminId: number;
  adminName: string;
  adminRole: string;
  adminColor?: string;
  notes?: string;
  createdByUserId: number;
  createdByUserName: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAdminShift {
  shiftDate: string;
  adminId: number;
  notes?: string;
}

export interface BulkSetShifts {
  shiftDate: string;
  adminIds: number[];
  notes?: string;
}

export interface ShiftAdmin {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  shiftColor?: string;
}

@Injectable({ providedIn: 'root' })
export class ShiftService {
  private apiUrl = `${environment.apiUrl}/admin/shifts`;

  constructor(private http: HttpClient) {}

  getShiftAdmins(): Observable<ShiftAdmin[]> {
    return this.http.get<ShiftAdmin[]>(`${this.apiUrl}/admins`);
  }

  getShifts(from?: string, to?: string): Observable<AdminShift[]> {
    let params = new HttpParams();
    if (from) params = params.set('from', from);
    if (to) params = params.set('to', to);
    return this.http.get<AdminShift[]>(this.apiUrl, { params });
  }

  bulkSetShifts(dto: BulkSetShifts): Observable<AdminShift[]> {
    return this.http.put<AdminShift[]>(`${this.apiUrl}/bulk`, dto);
  }

  createShift(dto: CreateAdminShift): Observable<AdminShift> {
    return this.http.post<AdminShift>(this.apiUrl, dto);
  }

  deleteShift(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }

  deleteShiftsByDate(date: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/date/${date}`);
  }

  setAdminColor(adminId: number, color: string): Observable<any> {
    return this.http.put(`${this.apiUrl}/color/${adminId}`, { color });
  }
}
