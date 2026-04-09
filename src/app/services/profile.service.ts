import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface Profile {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  firstTimeOrder: boolean;
  subscriptionId?: number;
  subscriptionName?: string;
  subscriptionDiscountPercentage?: number;  
  subscriptionExpiryDate?: Date;             
  apartments: Apartment[];
  /** When true, user can receive emails and (in future) SMS from the company. */
  canReceiveCommunications: boolean;
  /** When true, user can receive emails from the company. Optional for backward compat with older API. */
  canReceiveEmails?: boolean;
  /** When true, user can receive SMS/messages from the company. Optional for backward compat with older API. */
  canReceiveMessages?: boolean;
  /** When true, user has a password set. When false, show "Set password" instead of "Change password". */
  hasPassword?: boolean;
}

export interface Apartment {
  id: number;
  name: string;
  address: string;
  aptSuite?: string;
  city: string;
  state: string;
  postalCode: string;
  specialInstructions?: string;
}

export interface UpdateProfile {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  /** Optional. When provided, updates preference to receive emails/SMS. */
  canReceiveCommunications?: boolean;
  /** Optional. When provided, updates preference to receive emails. */
  canReceiveEmails?: boolean;
  /** Optional. When provided, updates preference to receive messages (SMS). */
  canReceiveMessages?: boolean;
}

export interface CreateApartment {
  name: string;
  address: string;
  aptSuite?: string;
  city: string;
  state: string;
  postalCode: string;
  specialInstructions?: string;
}

@Injectable({
  providedIn: 'root'
})
export class ProfileService {
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) { }

  getProfile(): Observable<Profile> {
    return this.http.get<Profile>(`${this.apiUrl}/profile`);
  }

  updateProfile(profile: UpdateProfile): Observable<Profile> {
    return this.http.put<Profile>(`${this.apiUrl}/profile`, profile);
  }

  getApartments(): Observable<Apartment[]> {
    return this.http.get<Apartment[]>(`${this.apiUrl}/profile/apartments`);
  }

  addApartment(apartment: CreateApartment): Observable<Apartment> {
    return this.http.post<Apartment>(`${this.apiUrl}/profile/apartments`, apartment);
  }

  updateApartment(id: number, apartment: Apartment): Observable<Apartment> {
    return this.http.put<Apartment>(`${this.apiUrl}/profile/apartments/${id}`, apartment);
  }

  deleteApartment(id: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/profile/apartments/${id}`);
  }
}