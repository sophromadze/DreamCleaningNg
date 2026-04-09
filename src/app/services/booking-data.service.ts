import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class BookingDataService {
  private bookingDataSubject = new BehaviorSubject<any>(null);
  bookingData$ = this.bookingDataSubject.asObservable();

  setBookingData(data: any) {
    this.bookingDataSubject.next(data);
  }

  getBookingData() {
    return this.bookingDataSubject.value;
  }

  clearBookingData() {
    this.bookingDataSubject.next(null);
  }
}