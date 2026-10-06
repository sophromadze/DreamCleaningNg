import { Component, OnInit, ChangeDetectionStrategy, inject, signal } from '@angular/core';
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
  AdjustExpenseAmount,
  GroupedExpenses
} from '../../../services/expense.service';
import { AuthService } from '../../../services/auth.service';
import { allowsCurrencyChoice, currencySymbol, isSalaryCategory } from '../../../shared/admin/salary-expense.rules';

@Component({
  selector: 'app-expenses',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './expenses.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./expenses.component.scss']
})
export class ExpensesComponent implements OnInit {
  private expenseService = inject(ExpenseService);
  private authService = inject(AuthService);

  // Grouped Category → Name → entries view, scoped to the selected month.
  readonly grouped = signal<GroupedExpenses | null>(null);
  readonly categories = signal<ExpenseCategory[]>([]);
  // People a salary can be recorded against. Loaded with the page so the picker is never empty
  // on first open — the Salaries category is the one an owner reaches for most.
  readonly staffMembers = signal<ExpenseStaffMember[]>([]);

  readonly loading = signal(false);
  readonly error = signal('');
  readonly successMessage = signal('');

  // Selected month (1-12) + year for the grouped view.
  readonly selYear = signal(new Date().getFullYear());
  readonly selMonth = signal(new Date().getMonth() + 1);

  // Expand/collapse state. Categories keyed by id, names keyed by "categoryId::name".
  readonly expandedCategories = signal(new Set<number>(), { equal: () => false });
  readonly expandedNames = signal(new Set<string>(), { equal: () => false });

  // Form state — create (editingId == null) and edit (editingId == row.id).
  readonly showForm = signal(false);
  readonly editingId = signal<number | null>(null);
  readonly saving = signal(false);
  readonly form = signal<CreateExpense>(this.blankForm(), { equal: () => false });

  // Who a salary is for. A staff member's id, 'custom' for somebody with no account (which is
  // also how every salary row predating the picker edits), or '' for "not answered yet" — the
  // three are genuinely different and collapsing the last two would let an unanswered form save
  // itself under a blank name.
  readonly staffChoice = signal<number | 'custom' | ''>('');

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
  readonly pendingDeleteId = signal<number | null>(null);
  readonly deleting = signal(false);

  // Inline "adjust amount from a date" for a recurring entry — raises or reduces it without
  // hand-authoring an EndDate + a duplicate new row.
  readonly adjustingId = signal<number | null>(null);
  readonly adjustAmountValue = signal<number | null>(null);
  readonly adjustEffectiveDate = signal('');
  readonly adjustNotes = signal<string | null>(null);
  readonly adjusting = signal(false);

  // Category manager state.
  readonly showCategoryManager = signal(false);
  readonly newCategoryName = signal('');
  readonly editingCategoryId = signal<number | null>(null);
  readonly editingCategoryName = signal('');
  readonly categorySaving = signal(false);
  readonly pendingDeleteCategoryId = signal<number | null>(null);

  /** SuperAdmins can edit; Admins granted view-only access see the page read-only. */
  canEdit = false;

  constructor() {
    this.canEdit = this.authService.currentUserValue?.role === 'SuperAdmin';
  }

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    forkJoin({
      grouped: this.expenseService.getGrouped(this.selYear(), this.selMonth()),
      categories: this.expenseService.getCategories(),
      staff: this.expenseService.getStaffMembers()
    }).subscribe({
      next: ({ grouped, categories, staff }) => {
        this.grouped.set(grouped);
        this.categories.set(categories);
        this.staffMembers.set(staff);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err.error?.message || 'Failed to load expenses');
        this.loading.set(false);
      }
    });
  }

  // ─── month navigation ──────────────────────────────────────────────────────

  prevMonth(): void {
    if (this.selMonth() === 1) { this.selMonth.set(12); this.selYear.update(v => v - 1); }
    else { this.selMonth.update(v => v - 1); }
    this.load();
  }

  nextMonth(): void {
    if (this.selMonth() === 12) { this.selMonth.set(1); this.selYear.update(v => v + 1); }
    else { this.selMonth.update(v => v + 1); }
    this.load();
  }

  goToCurrentMonth(): void {
    const now = new Date();
    this.selYear.set(now.getFullYear());
    this.selMonth.set(now.getMonth() + 1);
    this.load();
  }

  get isCurrentMonth(): boolean {
    const now = new Date();
    return this.selYear() === now.getFullYear() && this.selMonth() === now.getMonth() + 1;
  }

  // ─── expand/collapse ─────────────────────────────────────────────────────────

  toggleCategory(categoryId: number): void {
    if (this.expandedCategories().has(categoryId)) { this.expandedCategories().delete(categoryId); this.expandedCategories.set(this.expandedCategories()); }
    else { this.expandedCategories().add(categoryId); this.expandedCategories.set(this.expandedCategories()); }
  }

  isCategoryOpen(categoryId: number): boolean {
    return this.expandedCategories().has(categoryId);
  }

  private nameKey(categoryId: number, name: string): string {
    return `${categoryId}::${name.toLowerCase()}`;
  }

  toggleName(categoryId: number, name: string): void {
    const key = this.nameKey(categoryId, name);
    if (this.expandedNames().has(key)) { this.expandedNames().delete(key); this.expandedNames.set(this.expandedNames()); }
    else { this.expandedNames().add(key); this.expandedNames.set(this.expandedNames()); }
  }

  isNameOpen(categoryId: number, name: string): boolean {
    return this.expandedNames().has(this.nameKey(categoryId, name));
  }

  // ─── form open/close ─────────────────────────────────────────────────────────

  openAddForm(categoryId?: number): void {
    this.editingId.set(null);
    this.form.set(this.blankForm());
    if (categoryId != null) { this.form().categoryId = categoryId; this.form.set(this.form()); }
    this.staffChoice.set('');
    this.showForm.set(true);
  }

  openEditForm(row: Expense): void {
    this.editingId.set(row.id);
    this.form.set({
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
    });
    // A salary row with no link is one typed by hand — including every row written before the
    // picker existed. It edits as 'custom' so re-saving it can't silently blank its name.
    this.staffChoice.set(isSalaryCategory(row.categoryId)
      ? (row.staffUserId ?? 'custom')
      : '');
    this.showForm.set(true);
  }

  closeForm(): void {
    this.showForm.set(false);
    this.editingId.set(null);
    this.form.set(this.blankForm());
    this.staffChoice.set('');
  }

  // ─── salary staff picker ─────────────────────────────────────────────────────

  get isSalaryForm(): boolean {
    return isSalaryCategory(this.form().categoryId);
  }

  onCategoryChange(): void {
    if (!this.isSalaryForm) {
      // Leaving Salaries drops the link AND the currency, matching the server, which refuses to
      // store either on any other category. Whatever name is on screen is what the row keeps.
      this.staffChoice.set('');
      this.form().staffUserId = null;
      this.form.set(this.form());
      this.form().currency = 'USD';
      this.form.set(this.form());
      return;
    }
    // Arriving at Salaries on an existing row that already has a typed name keeps that name
    // rather than throwing it away — the owner can still switch to a staff member.
    if (this.staffChoice() === '' && this.form().name?.trim()) this.staffChoice.set('custom');
  }

  // ─── currency ────────────────────────────────────────────────────────────────

  /** Only a salary offers a currency choice; everything else is USD. */
  get canChooseCurrency(): boolean {
    return allowsCurrencyChoice(this.form().categoryId);
  }

  get formCurrency(): ExpenseCurrencyCode {
    return this.form().currency ?? 'USD';
  }

  setCurrency(currency: ExpenseCurrencyCode): void {
    this.form().currency = currency;
    this.form.set(this.form());
  }

  /** Display only — nothing is converted on this side. */
  symbolFor(currency: string | null | undefined): string {
    return currencySymbol(currency);
  }

  get selectedStaff(): ExpenseStaffMember | null {
    if (typeof this.staffChoice() !== 'number') return null;
    return this.staffMembers().find(s => s.id === this.staffChoice()) ?? null;
  }

  /** The name field is only shown when there is a name to type — a picked staff member names the row. */
  get showsNameField(): boolean {
    return !this.isSalaryForm || this.staffChoice() === 'custom';
  }

  get currentStaff(): ExpenseStaffMember[] {
    return this.staffMembers().filter(s => !s.isFormer);
  }

  get formerStaff(): ExpenseStaffMember[] {
    return this.staffMembers().filter(s => s.isFormer);
  }

  staffOptionLabel(s: ExpenseStaffMember): string {
    const notes: string[] = [];
    if (s.role) notes.push(s.role === 'SuperAdmin' ? 'Super Admin' : s.role);
    if (!s.isActive) notes.push('blocked');
    if (s.isFormer && !s.role) notes.push('no longer staff');
    return notes.length ? `${s.fullName} (${notes.join(' · ')})` : s.fullName;
  }

  onRecurringToggle(isRecurring: boolean): void {
    this.form().isRecurring = isRecurring;
    this.form.set(this.form());
    if (!isRecurring) {
      this.form().frequencyMonths = null;
      this.form.set(this.form());
      this.form().endDate = null;
      this.form.set(this.form());
      this.form().prorateByDay = false;
      this.form.set(this.form());
    } else if (!this.form().frequencyMonths) {
      this.form().frequencyMonths = 1;
      this.form.set(this.form());
    }
  }

  pickFrequency(months: number): void {
    this.form().frequencyMonths = months;
    this.form.set(this.form());
    // Proration only makes sense for monthly cadence.
    if (months !== 1) { this.form().prorateByDay = false; this.form.set(this.form()); }
  }

  get canProrate(): boolean {
    return this.form().isRecurring && Number(this.form().frequencyMonths) === 1;
  }

  // ─── save / delete expense ─────────────────────────────────────────────────

  save(): void {
    if (this.saving()) return;
    if (this.form().categoryId == null) { this.flashError('Pick a category'); return; }

    const staff = this.selectedStaff;
    if (this.isSalaryForm && this.staffChoice() === '') {
      this.flashError('Pick who this salary is for'); return;
    }
    if (this.isSalaryForm && typeof this.staffChoice() === 'number' && !staff) {
      this.flashError('That staff member is no longer on the list. Reload the page and pick again.'); return;
    }
    // A picked staff member names the row, so only a typed name has to be there.
    if (!staff && !this.form().name?.trim()) { this.flashError('Name is required'); return; }
    if (this.form().amount == null) { this.flashError('Amount is required'); return; }
    if (!this.form().startDate) { this.flashError('Start date is required'); return; }
    if (this.form().isRecurring && (!this.form().frequencyMonths || this.form().frequencyMonths! <= 0)) {
      this.flashError('Recurring expenses need a frequency in months > 0'); return;
    }

    const dto: CreateExpense = {
      // The server overwrites this from the account when a staff member is picked; sending their
      // name keeps the request self-describing rather than blank.
      name: (staff ? staff.fullName : this.form().name).trim(),
      amount: Number(this.form().amount),
      // The server forces USD on every non-salary category anyway; sending what is on screen
      // keeps the request honest rather than relying on that.
      currency: this.canChooseCurrency ? this.formCurrency : 'USD',
      categoryId: Number(this.form().categoryId),
      staffUserId: staff ? staff.id : null,
      startDate: this.form().startDate,
      isRecurring: this.form().isRecurring,
      frequencyMonths: this.form().isRecurring ? Number(this.form().frequencyMonths) : null,
      endDate: this.form().isRecurring && this.form().endDate ? this.form().endDate : null,
      prorateByDay: this.canProrate && this.form().prorateByDay,
      notes: this.form().notes?.trim() || null
    };

    this.saving.set(true);
    const obs = this.editingId() == null
      ? this.expenseService.create(dto)
      : this.expenseService.update(this.editingId()!, dto);

    obs.subscribe({
      next: () => {
        this.saving.set(false);
        this.flashSuccess(this.editingId() == null ? 'Expense added' : 'Expense updated');
        this.closeForm();
        this.load();
      },
      error: (err) => {
        this.saving.set(false);
        this.flashError(err.error?.message || 'Failed to save expense');
      }
    });
  }

  askDelete(id: number): void { this.pendingDeleteId.set(id); this.adjustingId.set(null); }
  cancelDelete(): void { this.pendingDeleteId.set(null); }

  // ─── adjust amount from a date (raise/reduce a recurring entry) ────────────

  /** Only a currently-open recurring entry can be adjusted — a row already ended is history. */
  canAdjustAmount(row: Expense): boolean {
    if (!row.isRecurring) return false;
    if (!row.endDate) return true;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return new Date(row.endDate) >= today;
  }

  openAdjustAmount(row: Expense): void {
    this.adjustingId.set(row.id);
    this.adjustAmountValue.set(null);
    this.adjustEffectiveDate.set(this.toYmd(this.defaultEffectiveDate()));
    this.adjustNotes.set(null);
    this.pendingDeleteId.set(null);
  }

  cancelAdjustAmount(): void {
    this.adjustingId.set(null);
  }

  confirmAdjustAmount(): void {
    if (this.adjustingId() == null || this.adjusting()) return;
    if (this.adjustAmountValue() == null) { this.flashError('New amount is required'); return; }
    if (!this.adjustEffectiveDate()) { this.flashError('Effective date is required'); return; }

    const dto: AdjustExpenseAmount = {
      newAmount: Number(this.adjustAmountValue()),
      effectiveDate: this.adjustEffectiveDate(),
      notes: this.adjustNotes()?.trim() || null
    };

    this.adjusting.set(true);
    this.expenseService.adjustAmount(this.adjustingId()!, dto).subscribe({
      next: () => {
        this.adjusting.set(false);
        this.adjustingId.set(null);
        this.flashSuccess('Amount adjusted — a new entry starts on the effective date');
        this.load();
      },
      error: (err) => {
        this.adjusting.set(false);
        this.flashError(err.error?.message || 'Failed to adjust amount');
      }
    });
  }

  /** First of next month — the common case (salary/subscription cadences almost always land there). */
  private defaultEffectiveDate(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 1);
  }

  confirmDelete(): void {
    const id = this.pendingDeleteId();
    if (id == null || this.deleting()) return;
    this.deleting.set(true);
    this.expenseService.delete(id).subscribe({
      next: () => {
        this.deleting.set(false);
        this.pendingDeleteId.set(null);
        this.flashSuccess('Expense deleted');
        this.load();
      },
      error: (err) => {
        this.deleting.set(false);
        this.flashError(err.error?.message || 'Failed to delete expense');
      }
    });
  }

  // ─── category manager ────────────────────────────────────────────────────────

  openCategoryManager(): void {
    this.showCategoryManager.set(true);
    this.newCategoryName.set('');
    this.editingCategoryId.set(null);
    this.pendingDeleteCategoryId.set(null);
  }

  closeCategoryManager(): void {
    this.showCategoryManager.set(false);
  }

  addCategory(): void {
    const name = this.newCategoryName().trim();
    if (!name || this.categorySaving()) { if (!name) this.flashError('Category name is required'); return; }
    this.categorySaving.set(true);
    this.expenseService.createCategory(name).subscribe({
      next: () => {
        this.categorySaving.set(false);
        this.newCategoryName.set('');
        this.flashSuccess('Category added');
        this.reloadCategories();
      },
      error: (err) => {
        this.categorySaving.set(false);
        this.flashError(err.error?.message || 'Failed to add category');
      }
    });
  }

  startEditCategory(cat: ExpenseCategory): void {
    this.editingCategoryId.set(cat.id);
    this.editingCategoryName.set(cat.name);
  }

  cancelEditCategory(): void {
    this.editingCategoryId.set(null);
    this.editingCategoryName.set('');
  }

  saveCategoryName(): void {
    const id = this.editingCategoryId();
    if (id == null || this.categorySaving()) return;
    const name = this.editingCategoryName().trim();
    if (!name) { this.flashError('Category name is required'); return; }
    this.categorySaving.set(true);
    this.expenseService.updateCategory(id, name).subscribe({
      next: () => {
        this.categorySaving.set(false);
        this.editingCategoryId.set(null);
        this.flashSuccess('Category renamed');
        this.reloadCategories();
        this.load();
      },
      error: (err) => {
        this.categorySaving.set(false);
        this.flashError(err.error?.message || 'Failed to rename category');
      }
    });
  }

  askDeleteCategory(id: number): void { this.pendingDeleteCategoryId.set(id); }
  cancelDeleteCategory(): void { this.pendingDeleteCategoryId.set(null); }

  confirmDeleteCategory(): void {
    const id = this.pendingDeleteCategoryId();
    if (id == null || this.categorySaving()) return;
    this.categorySaving.set(true);
    this.expenseService.deleteCategory(id).subscribe({
      next: () => {
        this.categorySaving.set(false);
        this.pendingDeleteCategoryId.set(null);
        this.flashSuccess('Category deleted');
        this.reloadCategories();
        this.load();
      },
      error: (err) => {
        this.categorySaving.set(false);
        this.flashError(err.error?.message || 'Failed to delete category');
      }
    });
  }

  private reloadCategories(): void {
    this.expenseService.getCategories().subscribe({
      next: (rows) => this.categories.set(rows)
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
      categoryId: this.categories()[0]?.id ?? 0,
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
    this.successMessage.set(msg);
    setTimeout(() => this.successMessage.set(''), 3000);
  }

  private flashError(msg: string) {
    this.error.set(msg);
    setTimeout(() => this.error.set(''), 5000);
  }
}
