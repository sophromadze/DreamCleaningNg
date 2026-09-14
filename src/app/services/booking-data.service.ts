import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

/**
 * Where this booking's payment has got to. Lives on the SERVICE, not the component, because the
 * whole point is to survive the component being destroyed: leaving /booking-confirmation and
 * coming back used to re-mount a fresh component with `isProcessing` back to false, so the
 * customer could start a second charge while the first was still running (2026-08-30).
 *
 * - `idle`      nothing running; the Pay button is live.
 * - `in-flight` the card has been charged (or a $0 booking confirmed) and the order is being
 *               created. Never start a second attempt from here.
 * - `completed` the order exists.
 */
export type BookingPaymentPhase = 'idle' | 'in-flight' | 'completed';

@Injectable({
  providedIn: 'root'
})
export class BookingDataService {
  private bookingDataSubject = new BehaviorSubject<any>(null);
  bookingData$ = this.bookingDataSubject.asObservable();

  private paymentPhaseSubject = new BehaviorSubject<BookingPaymentPhase>('idle');
  paymentPhase$ = this.paymentPhaseSubject.asObservable();
  private completedOrderIdValue: number | null = null;

  setBookingData(data: any) {
    // A new booking starts a new payment story. This is the reset hook for the phase — not
    // clearBookingData(), which runs on the way to the success page and must leave `completed`
    // standing so a back-navigation can still show it.
    this.paymentPhaseSubject.next('idle');
    this.completedOrderIdValue = null;
    this.bookingDataSubject.next(data);
  }

  getBookingData() {
    return this.bookingDataSubject.value;
  }

  clearBookingData() {
    this.bookingDataSubject.next(null);
  }

  get paymentPhase(): BookingPaymentPhase {
    return this.paymentPhaseSubject.value;
  }

  get completedOrderId(): number | null {
    return this.completedOrderIdValue;
  }

  /** The card is about to be charged, or a fully-covered booking confirmed. */
  markPaymentInFlight() {
    this.paymentPhaseSubject.next('in-flight');
  }

  /** The order exists. */
  markPaymentSettled(orderId: number) {
    this.completedOrderIdValue = orderId;
    this.paymentPhaseSubject.next('completed');
  }

  /**
   * Release the guard after a terminal failure (decline, network error, server rejection) so the
   * customer can try again. Must be called on EVERY failure path — a phase left at `in-flight`
   * would lock a customer whose card was merely declined out of paying at all.
   */
  markPaymentIdle() {
    this.paymentPhaseSubject.next('idle');
  }
}