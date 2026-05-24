import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ExpenseService,
  Expense,
  CreateExpense,
  EXPENSE_CATEGORIES,
  ExpenseCategory
} from '../../../services/expense.service';

@Component({
  selector: 'app-expenses',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './expenses.component.html',
  styleUrls: ['./expenses.component.scss']
})
export class ExpensesComponent implements OnInit {
  // Source of truth shown in the table. Reloaded after any mutation.
  expenses: Expense[] = [];
  loading = false;
  error = '';
  successMessage = '';

  // Form state — used for both create (editingId == null) and edit (editingId == row.id).
  showForm = false;
  editingId: number | null = null;
  saving = false;

  form: CreateExpense & { categoryLabel: ExpenseCategory } = this.blankForm();

  categories = EXPENSE_CATEGORIES;
  // Common cadence presets the user can pick without typing a number.
  frequencyPresets: { label: string; months: number }[] = [
    { label: 'Monthly',       months: 1  },
    { label: 'Every 2 months', months: 2 },
    { label: 'Quarterly',     months: 3  },
    { label: 'Every 4 months', months: 4 },
    { label: 'Every 6 months', months: 6 },
    { label: 'Yearly',        months: 12 },
    { label: 'Every 2 years',  months: 24 }
  ];

  // Confirm-delete state — keeps a single inline "Are you sure?" row instead of a modal.
  pendingDeleteId: number | null = null;
  deleting = false;

  constructor(private expenseService: ExpenseService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.expenseService.getAll().subscribe({
      next: (rows) => { this.expenses = rows; this.loading = false; },
      error: (err) => {
        this.error = err.error?.message || 'Failed to load expenses';
        this.loading = false;
      }
    });
  }

  // ─── form open/close ──────────────────────────────────────────────────────

  openAddForm(): void {
    this.editingId = null;
    this.form = this.blankForm();
    this.showForm = true;
  }

  openEditForm(row: Expense): void {
    this.editingId = row.id;
    this.form = {
      name: row.name,
      amount: row.amount,
      category: row.category,
      categoryLabel: row.categoryName,
      startDate: this.toYmd(row.startDate),
      isRecurring: row.isRecurring,
      frequencyMonths: row.frequencyMonths ?? null,
      endDate: row.endDate ? this.toYmd(row.endDate) : null,
      notes: row.notes ?? null
    };
    this.showForm = true;
  }

  closeForm(): void {
    this.showForm = false;
    this.editingId = null;
    this.form = this.blankForm();
  }

  onCategoryChange(label: ExpenseCategory): void {
    this.form.categoryLabel = label;
    this.form.category = ExpenseService.categoryToNumber(label);
  }

  onRecurringToggle(isRecurring: boolean): void {
    this.form.isRecurring = isRecurring;
    if (!isRecurring) {
      this.form.frequencyMonths = null;
      this.form.endDate = null;
    } else if (!this.form.frequencyMonths) {
      this.form.frequencyMonths = 1;
    }
  }

  pickFrequency(months: number): void {
    this.form.frequencyMonths = months;
  }

  // ─── save / delete ────────────────────────────────────────────────────────

  save(): void {
    if (this.saving) return;
    if (!this.form.name?.trim()) { this.flashError('Name is required'); return; }
    if (this.form.amount == null || this.form.amount < 0) { this.flashError('Amount must be 0 or positive'); return; }
    if (!this.form.startDate) { this.flashError('Start date is required'); return; }
    if (this.form.isRecurring && (!this.form.frequencyMonths || this.form.frequencyMonths <= 0)) {
      this.flashError('Recurring expenses need a frequency in months > 0'); return;
    }

    const dto: CreateExpense = {
      name: this.form.name.trim(),
      amount: Number(this.form.amount),
      category: this.form.category,
      startDate: this.form.startDate,
      isRecurring: this.form.isRecurring,
      frequencyMonths: this.form.isRecurring ? Number(this.form.frequencyMonths) : null,
      endDate: this.form.isRecurring && this.form.endDate ? this.form.endDate : null,
      notes: this.form.notes?.trim() || null
    };

    this.saving = true;
    const obs = this.editingId == null
      ? this.expenseService.create(dto)
      : this.expenseService.update(this.editingId, dto);

    obs.subscribe({
      next: () => {
        this.saving = false;
        this.flashSuccess(this.editingId == null ? 'Expense added' : 'Expense updated');
        this.closeForm();
        this.load();
      },
      error: (err) => {
        this.saving = false;
        this.flashError(err.error?.message || 'Failed to save expense');
      }
    });
  }

  askDelete(id: number): void {
    this.pendingDeleteId = id;
  }

  cancelDelete(): void {
    this.pendingDeleteId = null;
  }

  confirmDelete(): void {
    if (this.pendingDeleteId == null || this.deleting) return;
    const id = this.pendingDeleteId;
    this.deleting = true;
    this.expenseService.delete(id).subscribe({
      next: () => {
        this.deleting = false;
        this.pendingDeleteId = null;
        this.flashSuccess('Expense deleted');
        this.load();
      },
      error: (err) => {
        this.deleting = false;
        this.flashError(err.error?.message || 'Failed to delete expense');
      }
    });
  }

  // ─── derived display helpers ──────────────────────────────────────────────

  recurrenceLabel(row: Expense): string {
    if (!row.isRecurring || !row.frequencyMonths) return 'One-time';
    const m = row.frequencyMonths;
    if (m === 1)  return 'Monthly';
    if (m === 3)  return 'Quarterly';
    if (m === 12) return 'Yearly';
    if (m === 24) return 'Every 2 years';
    return `Every ${m} months`;
  }

  cadenceStatus(row: Expense): string {
    if (!row.isRecurring) return '';
    if (row.endDate) {
      const ends = new Date(row.endDate);
      const today = new Date();
      if (ends < today) return `Ended ${this.formatDate(row.endDate)}`;
      return `Until ${this.formatDate(row.endDate)}`;
    }
    return 'Active';
  }

  formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  totalThisMonth(): number {
    // Best-effort client-side projection for the header card. Authoritative figure comes
    // from the statistics breakdown; this is just at-a-glance for the management page.
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    let total = 0;
    for (const row of this.expenses) {
      total += this.amountInWindow(row, monthStart, monthEnd);
    }
    return Math.round(total * 100) / 100;
  }

  private amountInWindow(row: Expense, fromIncl: Date, toExcl: Date): number {
    const start = new Date(row.startDate);
    if (!row.isRecurring || !row.frequencyMonths || row.frequencyMonths <= 0) {
      return (start >= fromIncl && start < toExcl) ? row.amount : 0;
    }
    const endCap = row.endDate ? new Date(row.endDate) : null;
    let sum = 0;
    for (let k = 0; k < 600; k++) {
      const occ = new Date(start);
      occ.setMonth(occ.getMonth() + row.frequencyMonths * k);
      if (occ >= toExcl) break;
      if (endCap && occ > endCap) break;
      if (occ >= fromIncl) sum += row.amount;
    }
    return sum;
  }

  // ─── tiny helpers ─────────────────────────────────────────────────────────

  private blankForm(): CreateExpense & { categoryLabel: ExpenseCategory } {
    return {
      name: '',
      amount: 0,
      category: 0,
      categoryLabel: 'Subscriptions',
      startDate: this.toYmd(new Date().toISOString()),
      isRecurring: false,
      frequencyMonths: null,
      endDate: null,
      notes: null
    };
  }

  private toYmd(value: string | Date): string {
    const d = typeof value === 'string' ? new Date(value) : value;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private flashSuccess(msg: string) {
    this.successMessage = msg;
    setTimeout(() => this.successMessage = '', 3000);
  }

  private flashError(msg: string) {
    this.error = msg;
    setTimeout(() => this.error = '', 5000);
  }
}
