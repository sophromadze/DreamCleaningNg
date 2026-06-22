import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface CustomerTag {
  id: number;
  userId: number;
  label: string;
  color?: string;
  createdByAdminName?: string;
  createdAt: string;
}

export interface CrmCustomer {
  id: number;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone?: string;
  lifetimeValue: number;
  orderCount: number;
  lastOrderDate?: string;
  createdAt: string;
  isSubscribed: boolean;
  subscriptionName?: string;
  bubblePoints: number;
  lifecycleStage: string;
  segments: string[];
  tags: CustomerTag[];
}

export interface CrmCustomerOrder {
  id: number;
  serviceDate: string;
  total: number;
  status: string;
  serviceTypeName: string;
  serviceAddress?: string;
}

export interface CrmCustomerDetail extends CrmCustomer {
  averageOrderValue: number;
  firstOrderDate?: string;
  consecutiveOrderCount: number;
  loyaltyDiscountPercentage: number;
  bubbleCredits: number;
  canReceiveEmails: boolean;
  canReceiveMessages: boolean;
  recentOrders: CrmCustomerOrder[];
}

export interface CrmCustomerPage {
  total: number;
  page: number;
  pageSize: number;
  items: CrmCustomer[];
}

export interface CrmSegment {
  key: string;
  label: string;
  description: string;
  count: number;
  totalValue: number;
}

export interface CustomerListFilters {
  search?: string;
  segment?: string;
  sort?: 'recent' | 'value' | 'orders' | 'name' | 'oldest';
  page?: number;
  pageSize?: number;
}

@Injectable({ providedIn: 'root' })
export class CrmCustomerService {
  private apiUrl = `${environment.apiUrl}/crm/customers`;

  constructor(private http: HttpClient) {}

  getCustomers(filters?: CustomerListFilters): Observable<CrmCustomerPage> {
    let params = new HttpParams();
    if (filters?.search) params = params.set('search', filters.search);
    if (filters?.segment) params = params.set('segment', filters.segment);
    if (filters?.sort) params = params.set('sort', filters.sort);
    if (filters?.page) params = params.set('page', filters.page);
    if (filters?.pageSize) params = params.set('pageSize', filters.pageSize);
    return this.http.get<CrmCustomerPage>(this.apiUrl, { params });
  }

  getCustomer(id: number): Observable<CrmCustomerDetail> {
    return this.http.get<CrmCustomerDetail>(`${this.apiUrl}/${id}`);
  }

  getSegments(): Observable<CrmSegment[]> {
    return this.http.get<CrmSegment[]>(`${this.apiUrl}/segments`);
  }

  getTagSuggestions(): Observable<string[]> {
    return this.http.get<string[]>(`${this.apiUrl}/tags/suggestions`);
  }

  addTag(customerId: number, label: string, color?: string): Observable<CustomerTag> {
    return this.http.post<CustomerTag>(`${this.apiUrl}/${customerId}/tags`, { label, color });
  }

  deleteTag(tagId: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/tags/${tagId}`);
  }
}
