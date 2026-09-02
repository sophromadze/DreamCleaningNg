import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import {
  ExpenseService,
  Expense,
  ExpenseCategory,
  ExpenseStaffMember,
  ExpenseCurrencyCode,
  CreateExpense,
  GroupedExpenses
} from '../../../services/expense.service';
import { AuthService } from '../../../services/auth.service';
import { allowsCurrencyChoice, currencySymbol, isSalaryCategory } from '../../../shared/admin/salary-expense.rules';

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
  // People a salary can be recorded against. Loaded with the page so the picker is never empty
  // on first open — the Salaries category is the one an owner reaches for most.
  staffMembers: ExpenseStaffMember[] = [];

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

  // Who a salary is for. A staff member's id, 'custom' for somebody with no account (which is
  // also how every salary row predating the picker edits), or '' for "not answered yet" — the
  // three are genuinely different and collapsing the last two would let an unanswered form save
  // itself under a blank name.
  staffChoice: number | 'custom' | '' = '';

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

  /** SuperAdmins can edit; Admins granted view-only access see the page read-only. */
  canEdit = false;

  constructor(
    private expenseService: ExpenseService,
    private authService: AuthService
  ) {
    this.canEdit = this.authService.currentUserValue?.role === 'SuperAdmin';
  }

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    forkJoin({
      grouped: this.expenseService.getGrouped(this.selYear, this.selMonth),
      categories: this.expenseService.getCategories(),
      staff: this.expenseService.getStaffMembers()
    }).subscribe({
      next: ({ grouped, categories, staff }) => {
        this.grouped = grouped;
        this.categories = categories;
        this.staffMembers = staff;
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
    this.staffChoice = '';
    this.showForm = true;
  }

  openEditForm(row: Expense): void {
    this.editingId = row.id;
    this.form = {
      name: row.name,
      amount: row.amount,
      currency: row.currency ?? 'USD',
      categoryId: row.categoryId,
      staffUserId: row.staffUserId ?? null,
      startDate: this.toYmd(row.startDate),
      isRecurring: row.isRecurring,
      frequencyMonths: row.frequencyMonths ?? null,
      endDate: row.endDate ? this.toYmd(row.endDate) : null,
      prorateByDay: row.prorateByDay,
      notes: row.notes ?? null
    };
    // A salary row with no link is one typed by hand — including every row written before the
    // picker existed. It edits as 'custom' so re-saving it can't silently blank its name.
    this.staffChoice = isSalaryCategory(row.categoryId)
      ? (row.staffUserId ?? 'custom')
      : '';
    this.showForm = true;
  }

  closeForm(): void {
    this.showForm = false;
    this.editingId = null;
    this.form = this.blankForm();
    this.staffChoice = '';
  }

  // ─── salary staff picker ─────────────────────────────────────────────────────

  get isSalaryForm(): boolean {
    return isSalaryCategory(this.form.categoryId);
  }

  onCategoryChange(): void {
    if (!this.isSalaryForm) {
      // Leaving Salaries drops the link AND the currency, matching the server, which refuses to
      // store either on any other category. Whatever name is on screen is what the row keeps.
      this.staffChoice = '';
      this.form.staffUserId = null;
      this.form.currency = 'USD';
      return;
    }
    // Arriving at Salaries on an existing row that already has a typed name keeps that name
    // rather than throwing it away — the owner can still switch to a staff member.
    if (this.staffChoice === '' && this.form.name?.trim()) this.staffChoice = 'custom';
  }

  // ─── currency ────────────────────────────────────────────────────────────────

  /** Only a salary offers a currency choice; everything else is USD. */
  get canChooseCurrency(): boolean {
    return allowsCurrencyChoice(this.form.categoryId);
  }

  get formCurrency(): ExpenseCurrencyCode {
    return this.form.currency ?? 'USD';
  }

  setCurrency(currency: ExpenseCurrencyCode): void {
    this.form.currency = currency;
  }

  /** Display only — nothing is converted on this side. */
  symbolFor(currency: string | null | undefined): string {
    return currencySymbol(currency);
  }

  get selectedStaff(): ExpenseStaffMember | null {
    if (typeof this.staffChoice !== 'number') return null;
    return this.staffMembers.find(s => s.id === this.staffChoice) ?? null;
  }

  /** The name field is only shown when there is a name to type — a picked staff member names the row. */
  get showsNameField(): boolean {
    return !this.isSalaryForm || this.staffChoice === 'custom';
  }

  get currentStaff(): ExpenseStaffMember[] {
    return this.staffMembers.filter(s => !s.isFormer);
  }

  get formerStaff(): ExpenseStaffMember[] {
    return this.staffMembers.filter(s => s.isFormer);
  }

  staffOptionLabel(s: ExpenseStaffMember): string {
    const notes: string[] = [];
    if (s.role) notes.push(s.role === 'SuperAdmin' ? 'Super Admin' : s.role);
    if (!s.isActive) notes.push('blocked');
    if (s.isFormer && !s.role) notes.push('no longer staff');
    return notes.length ? `${s.fullName} (${notes.join(' · ')})` : s.fullName;
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
    if (this.form.categoryId == null) { this.flashError('Pick a category'); return; }

    const staff = this.selectedStaff;
    if (this.isSalaryForm && this.staffChoice === '') {
      this.flashError('Pick who this salary is for'); return;
    }
    if (this.isSalaryForm && typeof this.staffChoice === 'number' && !staff) {
      this.flashError('That staff member is no longer on the list. Reload the page and pick again.'); return;
    }
    // A picked staff member names the row, so only a typed name has to be there.
    if (!staff && !this.form.name?.trim()) { this.flashError('Name is required'); return; }
    if (this.form.amount == null || this.form.amount < 0) { this.flashError('Amount must be 0 or positive'); return; }
    if (!this.form.startDate) { this.flashError('Start date is required'); return; }
    if (this.form.isRecurring && (!this.form.frequencyMonths || this.form.frequencyMonths <= 0)) {
      this.flashError('Recurring expenses need a frequency in months > 0'); return;
    }

    const dto: CreateExpense = {
      // The server overwrites this from the account when a staff member is picked; sending their
      // name keeps the request self-describing rather than blank.
      name: (staff ? staff.fullName : this.form.name).trim(),
      amount: Number(this.form.amount),
      // The server forces USD on every non-salary category anyway; sending what is on screen
      // keeps the request honest rather than relying on that.
      currency: this.canChooseCurrency ? this.formCurrency : 'USD',
      categoryId: Number(this.form.categoryId),
      staffUserId: staff ? staff.id : null,
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
      currency: 'USD',
      categoryId: this.categories[0]?.id ?? 0,
      staffUserId: null,
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
