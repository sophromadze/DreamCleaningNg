import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// Interfaces
export interface SpecialOffer {
  id: number;
  name: string;
  description: string;
  isPercentage: boolean;
  discountValue: number;
  type: string;
  validFrom?: Date;
  validTo?: Date;
  isActive: boolean;
  icon?: string;
  badgeColor?: string;
  totalUsersGranted?: number;
  timesUsed?: number;
  createdAt: Date;
}

export interface UserSpecialOffer {
  id: number;
  specialOfferId: number;
  name: string;
  description: string;
  isPercentage: boolean;
  discountValue: number;
  expiresAt?: Date;
  isUsed: boolean;
  icon?: string;
  badgeColor?: string;
  minimumOrderAmount?: number;
}

export interface PublicSpecialOffer {
  id: number;
  name: string;
  description: string;
  isPercentage: boolean;
  discountValue: number;
  type: string;
  icon?: string;
  badgeColor?: string;
  minimumOrderAmount?: number;
  requiresFirstTimeCustomer: boolean;
}

export interface CreateSpecialOffer {
  name: string;
  description: string;
  isPercentage: boolean;
  discountValue: number;
  type: number; // 0=FirstTime, 1=Seasonal, 2=Holiday, 3=Custom
  validFrom?: Date;
  validTo?: Date;
  icon?: string;
  badgeColor?: string;
  minimumOrderAmount?: number;
  requiresFirstTimeCustomer: boolean;
}

export interface UpdateSpecialOffer {
  name: string;
  description: string;
  isPercentage: boolean;
  discountValue: number;
  type?: number; 
  validFrom?: Date;
  validTo?: Date;
  icon?: string;
  badgeColor?: string;
  minimumOrderAmount?: number;
  isActive: boolean;
}

export enum OfferType {
  FirstTime = 0,
  Seasonal = 1,
  Holiday = 2,
  Custom = 3
}

// Service
@Injectable({
  providedIn: 'root'
})
export class SpecialOfferService {
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  // Admin methods
  getAllSpecialOffers(): Observable<SpecialOffer[]> {
    return this.http.get<SpecialOffer[]>(`${this.apiUrl}/admin/special-offers`);
  }

  getSpecialOfferById(id: number): Observable<SpecialOffer> {
    return this.http.get<SpecialOffer>(`${this.apiUrl}/admin/special-offers/${id}`);
  }

  createSpecialOffer(offer: CreateSpecialOffer): Observable<SpecialOffer> {
    return this.http.post<SpecialOffer>(`${this.apiUrl}/admin/special-offers`, offer);
  }

  updateSpecialOffer(id: number, offer: UpdateSpecialOffer): Observable<SpecialOffer> {
    return this.http.put<SpecialOffer>(`${this.apiUrl}/admin/special-offers/${id}`, offer);
  }

  deleteSpecialOffer(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/admin/special-offers/${id}`);
  }

  grantOfferToAllUsers(id: number): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/admin/special-offers/${id}/grant-to-all`, {});
  }

  grantOfferToUser(offerId: number, userId: number): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/admin/special-offers/${offerId}/grant-to-user/${userId}`, {});
  }

  // User methods
  getMySpecialOffers(): Observable<UserSpecialOffer[]> {
    return this.http.get<UserSpecialOffer[]>(`${this.apiUrl}/profile/special-offers`);
  }

  // Public methods
  getPublicSpecialOffers(): Observable<PublicSpecialOffer[]> {
    return this.http.get<PublicSpecialOffer[]>(`${this.apiUrl}/special-offers/public`);
  }

  enableSpecialOffer(id: number): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/admin/special-offers/${id}/enable`, {});
  }
  
  disableSpecialOffer(id: number): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/admin/special-offers/${id}/disable`, {});
  }

  // Get first-time discount percentage
  getFirstTimeDiscountPercentage(): Observable<number> {
    return new Observable(observer => {
      this.getAllSpecialOffers().subscribe({
        next: (offers) => {
          const firstTimeOffer = offers.find(o => o.type === 'FirstTime' && o.isActive);
          observer.next(firstTimeOffer?.discountValue || 20);
          observer.complete();
        },
        error: (error) => {
          observer.next(20); // Default to 20% if error
          observer.complete();
        }
      });
    });
  }
}