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

// Somebody a salary can be recorded against: current staff, plus anyone who already has salary
// rows on file so a leaver's last payment can still be entered against them.
export interface ExpenseStaffMember {
  id: number;
  fullName: string;
  email?: string | null;
  role?: string | null;   // null once they no longer hold a staff role
  isActive: boolean;
  isFormer: boolean;
  salaryEntryCount: number;
}

export type ExpenseCurrencyCode = 'USD' | 'GEL';

export interface Expense {
  id: number;
  // Already resolved by the server: the linked staff member's CURRENT name while their account
  // exists, otherwise the name snapshotted on the row when it was saved.
  name: string;
  /** As ENTERED, in `currency`. Never converted. */
  amount: number;
  currency: ExpenseCurrencyCode;
  categoryId: number;
  categoryName: string;
  staffUserId?: number | null;
  // The linked staff member is no longer in Users — the row still names them from its snapshot.
  staffUserRemoved: boolean;
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
  // Ignored by the server on a salary row that names a staff member — it writes that person's
  // own name, so the snapshot can never disagree with who was picked.
  name: string;
  amount: number;
  /** Accepted only on Salaries; every other category is forced to USD server-side. */
  currency?: ExpenseCurrencyCode;
  categoryId: number;
  // Salaries category only. Null = a salary paid to somebody with no account, named by hand.
  staffUserId?: number | null;
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
  staffUserId?: number | null;
  categoryId: number;
  categoryName: string;
  date: string;
  /** USD — already converted at the occurrence month's locked rate. What reports sum. */
  amount: number;
  /** The same occurrence in the currency it was entered in. Display only. */
  amountInCurrency: number;
  currency: ExpenseCurrencyCode;
  /** The rate used, when one was. Null on a USD row — nothing was converted. */
  usdPerGel?: number | null;
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
  // Set when this line is one staff member's salary — the line then groups by PERSON, so their
  // rows stay together across a rename or after the account is deleted.
  staffUserId?: number | null;
  staffUserRemoved: boolean;
  /** USD, like every total on this page — a line can mix currencies. */
  monthTotal: number;
  allTimeTotal: number;
  /** Set only when every entry on the line shares ONE non-USD currency. */
  monthTotalInCurrency?: number | null;
  allTimeTotalInCurrency?: number | null;
  currency?: ExpenseCurrencyCode | null;
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

  getStaffMembers(): Observable<ExpenseStaffMember[]> {
    return this.http.get<ExpenseStaffMember[]>(`${this.apiUrl}/staff`);
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
