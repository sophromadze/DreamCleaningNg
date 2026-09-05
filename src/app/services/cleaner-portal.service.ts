import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { Order } from './order.service';

/**
 * The read-only cleaner portal (api/cleaner-portal).
 *
 * NO ORDER DATA IS WRITTEN HERE, and deliberately so: cleaners are told about work, they do not
 * administer it, and a SuperAdmin editing an order does it in the admin orders panel where the
 * pricing and approval rules live. The one write is setLanguage, which sets a display preference
 * on the caller's own cleaner record - the rule is about the data, not the verb.
 *
 * Mirrors DTOs/CleanerPortalDtos.cs.
 */

/** Who is looking, in which of the portal's two modes, and which cleaner record is behind them. */
export interface CleanerPortalContext {
  isCleanerView: boolean;
  isSystemWideView: boolean;
  /** Null for a SuperAdmin, and null for a cleaner account nobody has linked yet. */
  cleanerId?: number | null;
  cleanerName?: string | null;

  /**
   * The language to render in, already resolved SERVER-side from the cleaner's own choice falling
   * back to their nationality. The client never re-derives it: the same map picks the language of
   * their assignment email, and the two must not disagree.
   */
  language?: string | null;

  /** Their EXPLICIT choice, or null when they are following their nationality ("Automatic"). */
  preferredLanguage?: string | null;
}

export interface CleanerPortalServiceLine {
  name: string;
  quantity: number;

  /**
   * Catalogue key ("bedrooms", "bathrooms", "sqft", "cleaners", "hours", "levels") - what
   * formatServiceLine renders "2 Bedrooms" / "Studio" from, in the reader's own language. Matched
   * on the KEY and never the name or Id, which differ between dev and production.
   */
  serviceKey?: string | null;
}

/**
 * A job as a CLEANER sees it - the same field set the assignment email already sends them, and
 * nothing wider. No pricing, no invoicing, no free-text customer notes.
 */
export interface CleanerPortalJob {
  orderId: number;
  serviceDate: string;
  /** "HH:mm" - formatted for display by formatTime12h. */
  serviceTime: string;
  serviceTypeName: string;
  services: CleanerPortalServiceLine[];
  extraServices: string[];
  /** First name only, matching the assignment email. */
  customerName: string;
  address: string;
  /**
   * Whether the cleaner has to bring cleaning solutions and supplies. Derived server-side from
   * whether the customer bought the Cleaning Supplies extra - the same source the assignment
   * email's "Supplies: required / not required" line reads.
   */
  bringCleaningSupplies: boolean;
  /** Paper towels, garbage bags, toilet brush — the "Cleaning Essentials" extra. Never a broom or vacuum. */
  bringCleaningEssentials: boolean;

  /** THIS cleaner's payroll hours - what they were told and are paid for, in minutes. */
  serviceDurationMinutes: number;

  /** "Apartment" / "House", or null on a legacy order that never recorded it. */
  propertyType?: string | null;

  /** Levels to clean, for a house only. Stairs are the reason the crew wants it up front. */
  levelsQuantity?: number | null;

  /** Floor types, already flattened from the stored CSV to display text. */
  floorTypes: string[];

  /** How to get in - "doorman", "I will be home", a lockbox code. */
  entryMethod?: string | null;

  /** The customer's own note on the order. */
  customerInstructions?: string | null;

  /** What the office typed for this cleaner when staffing the job. Null on the admin list, which
   *  covers every cleaner at once and so is addressed to none of them. */
  cleanerInstructions?: string | null;

  /** Performed. Drives the calendar dot's colour, and whether the card opens into anything. */
  isCompleted: boolean;
}

/**
 * A cleaner's own work in one call. HISTORY IS FULL JOBS, not the bare dates it started as: a
 * finished cleaning takes its place in the month calendar beside the upcoming ones. The narrowing
 * is in the UI - a completed card opens into nothing, because the briefing is for work ahead.
 */
export interface CleanerPortalMyJobs {
  current: CleanerPortalJob[];
  past: CleanerPortalJob[];
}

/** One row of the SuperAdmin's system-wide list. */
export interface CleanerPortalAdminJob extends CleanerPortalJob {
  status: string;
  assignedCleaners: string[];
  maidsCount: number;
  isPaid: boolean;
}

export interface CleanerPortalAssignedCleaner {
  cleanerId: number;
  name: string;
  phone?: string | null;
  email?: string | null;
  assignedAt: string;
  assignmentNotificationSentAt?: string | null;
}

/** The SuperAdmin's read-only detail: the cleaner view, plus the whole order. */
export interface CleanerPortalOrderDetail {
  cleanerView: CleanerPortalJob;
  order: Order;
  assignedCleaners: CleanerPortalAssignedCleaner[];
  adminNotes?: string | null;
}

@Injectable({ providedIn: 'root' })
export class CleanerPortalService {
  private readonly apiUrl = `${environment.apiUrl}/cleaner-portal`;

  constructor(private http: HttpClient) {}

  getContext(): Observable<CleanerPortalContext> {
    return this.http.get<CleanerPortalContext>(`${this.apiUrl}/context`);
  }

  getMyJobs(): Observable<CleanerPortalMyJobs> {
    return this.http.get<CleanerPortalMyJobs>(`${this.apiUrl}/my-jobs`);
  }

  getAllJobs(from?: string | null, to?: string | null, search?: string | null): Observable<CleanerPortalAdminJob[]> {
    let params = new HttpParams();
    if (from) params = params.set('from', from);
    if (to) params = params.set('to', to);
    if (search) params = params.set('search', search);
    return this.http.get<CleanerPortalAdminJob[]>(`${this.apiUrl}/all-jobs`, { params });
  }

  /**
   * The cleaner's chosen language. Null CLEARS it back to their nationality's default - which is
   * why "Automatic" sends null rather than re-sending whatever that default resolves to today.
   *
   * The only write in this service, and it writes no order data: it is a display preference on the
   * caller's own cleaner record.
   */
  setLanguage(language: string | null): Observable<{ language: string; preferredLanguage: string | null }> {
    return this.http.put<{ language: string; preferredLanguage: string | null }>(
      `${this.apiUrl}/language`, { language });
  }

  getOrderDetail(orderId: number): Observable<CleanerPortalOrderDetail> {
    return this.http.get<CleanerPortalOrderDetail>(`${this.apiUrl}/orders/${orderId}`);
  }
}
