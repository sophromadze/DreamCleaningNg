import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type ExpenseCategory =
  | 'Subscriptions'
  | 'Supplies'
  | 'Infrastructure'
  | 'Marketing'
  | 'Salaries'
  | 'Other';

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'Subscriptions',
  'Supplies',
  'Infrastructure',
  'Marketing',
  'Salaries',
  'Other'
];

export interface Expense {
  id: number;
  name: string;
  amount: number;
  category: number;       // numeric enum value (kept for round-trip with backend)
  categoryName: ExpenseCategory;
  startDate: string;      // ISO date string
  isRecurring: boolean;
  frequencyMonths?: number | null;
  endDate?: string | null;
  notes?: string | null;
  createdByUserId: number;
  createdByUserName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateExpense {
  name: string;
  amount: number;
  category: number;
  startDate: string;
  isRecurring: boolean;
  frequencyMonths?: number | null;
  endDate?: string | null;
  notes?: string | null;
}

export interface ExpenseOccurrence {
  expenseId: number;
  name: string;
  category: number;
  categoryName: ExpenseCategory;
  date: string;
  amount: number;
  isRecurring: boolean;
}

export interface ExpenseCategoryBreakdown {
  category: number;
  categoryName: ExpenseCategory;
  total: number;
  items: ExpenseOccurrence[];
}

export interface ExpenseBreakdown {
  total: number;
  byCategory: ExpenseCategoryBreakdown[];
}

@Injectable({ providedIn: 'root' })
export class ExpenseService {
  private apiUrl = `${environment.apiUrl}/expenses`;

  constructor(private http: HttpClient) {}

  getAll(): Observable<Expense[]> {
    return this.http.get<Expense[]>(this.apiUrl);
  }

  getById(id: number): Observable<Expense> {
    return this.http.get<Expense>(`${this.apiUrl}/${id}`);
  }

  create(dto: CreateExpense): Observable<Expense> {
    return this.http.post<Expense>(this.apiUrl, dto);
  }

  update(id: number, dto: CreateExpense): Observable<Expense> {
    return this.http.put<Expense>(`${this.apiUrl}/${id}`, dto);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }

  getBreakdown(from?: string, to?: string): Observable<ExpenseBreakdown> {
    let params = new HttpParams();
    if (from) params = params.set('from', from);
    if (to)   params = params.set('to', to);
    return this.http.get<ExpenseBreakdown>(`${this.apiUrl}/breakdown`, { params });
  }

  /** Convert a category label to its numeric enum index — used when sending to backend. */
  static categoryToNumber(c: ExpenseCategory): number {
    return EXPENSE_CATEGORIES.indexOf(c);
  }
}
