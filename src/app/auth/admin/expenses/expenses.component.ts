import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import {
  ExpenseService,
  Expense,
  ExpenseCategory,
  CreateExpense,
  GroupedExpenses
} from '../../../services/expense.service';

@Component({
  selector: 'app-expenses',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './expenses.component.html',
  styleUrls: ['./expenses.component.scss']
})
export class ExpensesComponent implements OnInit {
  // Grouped Category → Name → entries view, scoped to the selected month.
  grouped: GroupedExpenses | null = null;
  categories: ExpenseCategory[] = [];

  loading = false;
  error = '';
  successMessage = '';

  // Selected month (1-12) + year for the grouped view.
  selYear = new Date().getFullYear();
  selMonth = new Date().getMonth() + 1;

  // Expand/collapse state. Categories keyed by id, names keyed by "categoryId::name".
  expandedCategories = new Set<number>();
  expandedNames = new Set<string>();

  // Form state — create (editingId == null) and edit (editingId == row.id).
  showForm = false;
  editingId: number | null = null;
  saving = false;
  form: CreateExpense = this.blankForm();

  // Common cadence presets the user can pick without typing a number.
  frequencyPresets: { label: string; months: number }[] = [
    { label: 'Monthly',        months: 1  },
    { label: 'Every 2 months', months: 2  },
    { label: 'Quarterly',      months: 3  },
    { label: 'Every 4 months', months: 4  },
    { label: 'Every 6 months', months: 6  },
    { label: 'Yearly',         months: 12 },
    { label: 'Every 2 years',  months: 24 }
  ];

  // Inline confirm-delete for an expense entry.
  pendingDeleteId: number | null = null;
  deleting = false;

  // Category manager state.
  showCategoryManager = false;
  newCategoryName = '';
  editingCategoryId: number | null = null;
  editingCategoryName = '';
  categorySaving = false;
  pendingDeleteCategoryId: number | null = null;

  constructor(private expenseService: ExpenseService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    forkJoin({
      grouped: this.expenseService.getGrouped(this.selYear, this.selMonth),
      categories: this.expenseService.getCategories()
    }).subscribe({
      next: ({ grouped, categories }) => {
        this.grouped = grouped;
        this.categories = categories;
        this.loading = false;
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to load expenses';
        this.loading = false;
      }
    });
  }

  // ─── month navigation ──────────────────────────────────────────────────────

  prevMonth(): void {
    if (this.selMonth === 1) { this.selMonth = 12; this.selYear--; }
    else { this.selMonth--; }
    this.load();
  }

  nextMonth(): void {
    if (this.selMonth === 12) { this.selMonth = 1; this.selYear++; }
    else { this.selMonth++; }
    this.load();
  }

  goToCurrentMonth(): void {
    const now = new Date();
    this.selYear = now.getFullYear();
    this.selMonth = now.getMonth() + 1;
    this.load();
  }

  get isCurrentMonth(): boolean {
    const now = new Date();
    return this.selYear === now.getFullYear() && this.selMonth === now.getMonth() + 1;
  }

  // ─── expand/collapse ─────────────────────────────────────────────────────────

  toggleCategory(categoryId: number): void {
    if (this.expandedCategories.has(categoryId)) this.expandedCategories.delete(categoryId);
    else this.expandedCategories.add(categoryId);
  }

  isCategoryOpen(categoryId: number): boolean {
    return this.expandedCategories.has(categoryId);
  }

  private nameKey(categoryId: number, name: string): string {
    return `${categoryId}::${name.toLowerCase()}`;
  }

  toggleName(categoryId: number, name: string): void {
    const key = this.nameKey(categoryId, name);
    if (this.expandedNames.has(key)) this.expandedNames.delete(key);
    else this.expandedNames.add(key);
  }

  isNameOpen(categoryId: number, name: string): boolean {
    return this.expandedNames.has(this.nameKey(categoryId, name));
  }

  // ─── form open/close ─────────────────────────────────────────────────────────

  openAddForm(categoryId?: number): void {
    this.editingId = null;
    this.form = this.blankForm();
    if (categoryId != null) this.form.categoryId = categoryId;
    this.showForm = true;
  }

  openEditForm(row: Expense): void {
    this.editingId = row.id;
    this.form = {
      name: row.name,
      amount: row.amount,
      categoryId: row.categoryId,
      startDate: this.toYmd(row.startDate),
      isRecurring: row.isRecurring,
      frequencyMonths: row.frequencyMonths ?? null,
      endDate: row.endDate ? this.toYmd(row.endDate) : null,
      prorateByDay: row.prorateByDay,
      notes: row.notes ?? null
    };
    this.showForm = true;
  }

  closeForm(): void {
    this.showForm = false;
    this.editingId = null;
    this.form = this.blankForm();
  }

  onRecurringToggle(isRecurring: boolean): void {
    this.form.isRecurring = isRecurring;
    if (!isRecurring) {
      this.form.frequencyMonths = null;
      this.form.endDate = null;
      this.form.prorateByDay = false;
    } else if (!this.form.frequencyMonths) {
      this.form.frequencyMonths = 1;
    }
  }

  pickFrequency(months: number): void {
    this.form.frequencyMonths = months;
    // Proration only makes sense for monthly cadence.
    if (months !== 1) this.form.prorateByDay = false;
  }

  get canProrate(): boolean {
    return this.form.isRecurring && Number(this.form.frequencyMonths) === 1;
  }

  // ─── save / delete expense ─────────────────────────────────────────────────

  save(): void {
    if (this.saving) return;
    if (!this.form.name?.trim()) { this.flashError('Name is required'); return; }
    if (this.form.amount == null || this.form.amount < 0) { this.flashError('Amount must be 0 or positive'); return; }
    if (this.form.categoryId == null) { this.flashError('Pick a category'); return; }
    if (!this.form.startDate) { this.flashError('Start date is required'); return; }
    if (this.form.isRecurring && (!this.form.frequencyMonths || this.form.frequencyMonths <= 0)) {
      this.flashError('Recurring expenses need a frequency in months > 0'); return;
    }

    const dto: CreateExpense = {
      name: this.form.name.trim(),
      amount: Number(this.form.amount),
      categoryId: Number(this.form.categoryId),
      startDate: this.form.startDate,
      isRecurring: this.form.isRecurring,
      frequencyMonths: this.form.isRecurring ? Number(this.form.frequencyMonths) : null,
      endDate: this.form.isRecurring && this.form.endDate ? this.form.endDate : null,
      prorateByDay: this.canProrate && this.form.prorateByDay,
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

  askDelete(id: number): void { this.pendingDeleteId = id; }
  cancelDelete(): void { this.pendingDeleteId = null; }

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

  // ─── category manager ────────────────────────────────────────────────────────

  openCategoryManager(): void {
    this.showCategoryManager = true;
    this.newCategoryName = '';
    this.editingCategoryId = null;
    this.pendingDeleteCategoryId = null;
  }

  closeCategoryManager(): void {
    this.showCategoryManager = false;
  }

  addCategory(): void {
    const name = this.newCategoryName.trim();
    if (!name || this.categorySaving) { if (!name) this.flashError('Category name is required'); return; }
    this.categorySaving = true;
    this.expenseService.createCategory(name).subscribe({
      next: () => {
        this.categorySaving = false;
        this.newCategoryName = '';
        this.flashSuccess('Category added');
        this.reloadCategories();
      },
      error: (err) => {
        this.categorySaving = false;
        this.flashError(err.error?.message || 'Failed to add category');
      }
    });
  }

  startEditCategory(cat: ExpenseCategory): void {
    this.editingCategoryId = cat.id;
    this.editingCategoryName = cat.name;
  }

  cancelEditCategory(): void {
    this.editingCategoryId = null;
    this.editingCategoryName = '';
  }

  saveCategoryName(): void {
    if (this.editingCategoryId == null || this.categorySaving) return;
    const name = this.editingCategoryName.trim();
    if (!name) { this.flashError('Category name is required'); return; }
    const id = this.editingCategoryId;
    this.categorySaving = true;
    this.expenseService.updateCategory(id, name).subscribe({
      next: () => {
        this.categorySaving = false;
        this.editingCategoryId = null;
        this.flashSuccess('Category renamed');
        this.reloadCategories();
        this.load();
      },
      error: (err) => {
        this.categorySaving = false;
        this.flashError(err.error?.message || 'Failed to rename category');
      }
    });
  }

  askDeleteCategory(id: number): void { this.pendingDeleteCategoryId = id; }
  cancelDeleteCategory(): void { this.pendingDeleteCategoryId = null; }

  confirmDeleteCategory(): void {
    if (this.pendingDeleteCategoryId == null || this.categorySaving) return;
    const id = this.pendingDeleteCategoryId;
    this.categorySaving = true;
    this.expenseService.deleteCategory(id).subscribe({
      next: () => {
        this.categorySaving = false;
        this.pendingDeleteCategoryId = null;
        this.flashSuccess('Category deleted');
        this.reloadCategories();
        this.load();
      },
      error: (err) => {
        this.categorySaving = false;
        this.flashError(err.error?.message || 'Failed to delete category');
      }
    });
  }

  private reloadCategories(): void {
    this.expenseService.getCategories().subscribe({
      next: (rows) => this.categories = rows
    });
  }

  // ─── derived display helpers ─────────────────────────────────────────────────

  recurrenceLabel(row: Expense): string {
    if (!row.isRecurring || !row.frequencyMonths) return 'One-time';
    const m = row.frequencyMonths;
    let base: string;
    if (m === 1) base = 'Monthly';
    else if (m === 3) base = 'Quarterly';
    else if (m === 12) base = 'Yearly';
    else if (m === 24) base = 'Every 2 years';
    else base = `Every ${m} months`;
    return row.prorateByDay ? `${base} · prorated` : base;
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

  // ─── tiny helpers ─────────────────────────────────────────────────────────────

  private blankForm(): CreateExpense {
    return {
      name: '',
      amount: 0,
      categoryId: this.categories[0]?.id ?? 0,
      startDate: this.toYmd(new Date().toISOString()),
      isRecurring: false,
      frequencyMonths: null,
      endDate: null,
      prorateByDay: false,
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
