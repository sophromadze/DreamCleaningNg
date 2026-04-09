import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class LocationService {
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) { }

  getStates(): Observable<string[]> {
    return this.http.get<string[]>(`${this.apiUrl}/location/states`).pipe(
      catchError(() => of(['New York'])) // Fallback to default
    );
  }

  getCities(state: string): Observable<string[]> {
    return this.http.get<string[]>(`${this.apiUrl}/location/cities/${state}`).pipe(
      catchError(() => of(['Manhattan', 'Brooklyn', 'Queens'])) // Fallback to default
    );
  }

  getAllCities(): Observable<string[]> {
    return this.http.get<string[]>(`${this.apiUrl}/location/cities`).pipe(
      catchError(() => of(['Manhattan', 'Brooklyn', 'Queens'])) // Fallback to default
    );
  }
}