import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface ExpenseCategory {
  id: number;
  name: string;
  displayOrder: number;
  isSystem: boolean;
  expenseCount: number;
}

export interface Expense {
  id: number;
  name: string;
  amount: number;
  categoryId: number;
  categoryName: string;
  startDate: string;      // ISO date string
  isRecurring: boolean;
  frequencyMonths?: number | null;
  endDate?: string | null;
  prorateByDay: boolean;
  notes?: string | null;
  createdByUserId: number;
  createdByUserName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateExpense {
  name: string;
  amount: number;
  categoryId: number;
  startDate: string;
  isRecurring: boolean;
  frequencyMonths?: number | null;
  endDate?: string | null;
  prorateByDay: boolean;
  notes?: string | null;
}

export interface ExpenseOccurrence {
  expenseId: number;
  name: string;
  categoryId: number;
  categoryName: string;
  date: string;
  amount: number;
  isRecurring: boolean;
}

export interface ExpenseCategoryBreakdown {
  categoryId: number;
  categoryName: string;
  total: number;
  items: ExpenseOccurrence[];
}

export interface ExpenseBreakdown {
  total: number;
  byCategory: ExpenseCategoryBreakdown[];
}

// ── Grouped view (Category → Name → entries) ──
export interface GroupedName {
  name: string;
  monthTotal: number;
  allTimeTotal: number;
  entries: Expense[];
}

export interface GroupedCategory {
  categoryId: number;
  categoryName: string;
  displayOrder: number;
  monthTotal: number;
  names: GroupedName[];
}

export interface GroupedExpenses {
  year: number;
  month: number;
  monthLabel: string;
  monthTotal: number;
  categories: GroupedCategory[];
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

  getGrouped(year: number, month: number): Observable<GroupedExpenses> {
    const params = new HttpParams().set('year', year).set('month', month);
    return this.http.get<GroupedExpenses>(`${this.apiUrl}/grouped`, { params });
  }

  // ── Category management ──
  getCategories(): Observable<ExpenseCategory[]> {
    return this.http.get<ExpenseCategory[]>(`${this.apiUrl}/categories`);
  }

  createCategory(name: string): Observable<ExpenseCategory> {
    return this.http.post<ExpenseCategory>(`${this.apiUrl}/categories`, { name });
  }

  updateCategory(id: number, name: string): Observable<ExpenseCategory> {
    return this.http.put<ExpenseCategory>(`${this.apiUrl}/categories/${id}`, { name });
  }

  deleteCategory(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/categories/${id}`);
  }
}
