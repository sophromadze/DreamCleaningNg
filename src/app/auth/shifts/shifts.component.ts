import { Component, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ShiftService, AdminShift, ShiftAdmin } from '../../services/shift.service';
import { AuthService } from '../../services/auth.service';

const FALLBACK_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4',
  '#f43f5e', '#10b981', '#6366f1', '#d946ef'
];

@Component({
  selector: 'app-shifts',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './shifts.component.html',
  styleUrls: ['./shifts.component.scss']
})
export class ShiftsComponent implements OnInit {

  // ── Calendar state ──
  currentMonth: Date = new Date();
  calendarWeeks: Date[][] = [];
  today: Date = new Date();

  // ── Data ──
  shifts: AdminShift[] = [];
  admins: ShiftAdmin[] = [];
  currentUserName = '';

  // ── Single day editor (modal) ──
  selectedDate: Date | null = null;
  selectedShifts: AdminShift[] = [];
  selectedAdminIds: number[] = [];
  shiftNotes = '';

  // ── Multi-select mode ──
  multiSelectMode = false;
  multiSelectedDates: Date[] = [];
  multiModalOpen = false;
  multiAdminIds: number[] = [];
  multiNotes = '';

  // ── Color picker ──
  colorPickerAdminId: number | null = null;
  pickerR = 59;
  pickerG = 130;
  pickerB = 246;
  pickerA = 100;

  // ── Loading / messages ──
  loading = false;
  saving = false;
  successMessage = '';
  errorMessage = '';

  constructor(
    private shiftService: ShiftService,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    const user = this.authService.currentUserValue;
    if (user) {
      this.currentUserName = `${user.firstName} ${user.lastName}`;
    }
    this.buildCalendar();
    this.loadAdmins();
    this.loadShifts();
  }

  // ════════════════════════════════════════
  //  Calendar logic
  // ════════════════════════════════════════

  buildCalendar(): void {
    const year = this.currentMonth.getFullYear();
    const month = this.currentMonth.getMonth();

    const firstDay = new Date(year, month, 1);
    const startDate = new Date(firstDay);
    const dayOfWeek = startDate.getDay();
    const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    startDate.setDate(startDate.getDate() - diff);

    this.calendarWeeks = [];
    const current = new Date(startDate);
    for (let w = 0; w < 6; w++) {
      const week: Date[] = [];
      for (let d = 0; d < 7; d++) {
        week.push(new Date(current));
        current.setDate(current.getDate() + 1);
      }
      if (week.some(d => d.getMonth() === month)) {
        this.calendarWeeks.push(week);
      }
    }
  }

  prevMonth(): void {
    this.currentMonth = new Date(
      this.currentMonth.getFullYear(),
      this.currentMonth.getMonth() - 1,
      1
    );
    this.buildCalendar();
    this.loadShifts();
    this.selectedDate = null;
  }

  nextMonth(): void {
    this.currentMonth = new Date(
      this.currentMonth.getFullYear(),
      this.currentMonth.getMonth() + 1,
      1
    );
    this.buildCalendar();
    this.loadShifts();
    this.selectedDate = null;
  }

  goToToday(): void {
    this.currentMonth = new Date();
    this.today = new Date();
    this.buildCalendar();
    this.loadShifts();
    if (!this.multiSelectMode) {
      this.selectDate(new Date());
    }
  }

  isToday(date: Date): boolean {
    return this.isSameDay(date, this.today);
  }

  isCurrentMonth(date: Date): boolean {
    return date.getMonth() === this.currentMonth.getMonth();
  }

  isSelected(date: Date): boolean {
    return this.selectedDate !== null && this.isSameDay(date, this.selectedDate);
  }

  isPast(date: Date): boolean {
    const todayStart = new Date(this.today.getFullYear(), this.today.getMonth(), this.today.getDate());
    return date < todayStart;
  }

  isSameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() &&
           a.getMonth() === b.getMonth() &&
           a.getDate() === b.getDate();
  }

  getMonthLabel(): string {
    return this.currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  // ════════════════════════════════════════
  //  Data loading
  // ════════════════════════════════════════

  loadAdmins(): void {
    this.shiftService.getShiftAdmins().subscribe({
      next: (admins) => this.admins = admins,
      error: () => this.showError('Failed to load admins')
    });
  }

  loadShifts(): void {
    this.loading = true;
    const year = this.currentMonth.getFullYear();
    const month = this.currentMonth.getMonth();
    const from = new Date(year, month - 1, 1).toISOString();
    const to = new Date(year, month + 2, 0).toISOString();

    this.shiftService.getShifts(from, to).subscribe({
      next: (shifts) => {
        this.shifts = shifts;
        this.loading = false;
        if (this.selectedDate) {
          this.refreshSelectedDateShifts();
        }
      },
      error: () => {
        this.loading = false;
        this.showError('Failed to load shifts');
      }
    });
  }

  // ════════════════════════════════════════
  //  Get shifts for a specific date
  // ════════════════════════════════════════

  getShiftsForDate(date: Date): AdminShift[] {
    const dateStr = this.toDateString(date);
    return this.shifts.filter(s => s.shiftDate.substring(0, 10) === dateStr);
  }

  getShiftAdminNames(date: Date): { name: string; color: string }[] {
    return this.getShiftsForDate(date).map(s => ({
      name: s.adminName.split(' ')[0],
      color: this.getAdminColor(s.adminId, s.adminName)
    }));
  }

  getShiftCount(date: Date): number {
    return this.getShiftsForDate(date).length;
  }

  dateHasNotes(date: Date): boolean {
    return this.getShiftsForDate(date).some(s => s.notes && s.notes.trim().length > 0);
  }

  // ════════════════════════════════════════
  //  Day click handler
  // ════════════════════════════════════════

  onDateClick(date: Date): void {
    if (this.multiSelectMode) {
      this.toggleMultiDate(date);
    } else {
      this.selectDate(date);
    }
  }

  // ════════════════════════════════════════
  //  Single day selection & editing
  // ════════════════════════════════════════

  selectDate(date: Date): void {
    this.selectedDate = date;
    this.successMessage = '';
    this.errorMessage = '';
    this.colorPickerAdminId = null;
    this.refreshSelectedDateShifts();
  }

  refreshSelectedDateShifts(): void {
    if (!this.selectedDate) return;
    this.selectedShifts = this.getShiftsForDate(this.selectedDate);
    this.selectedAdminIds = this.selectedShifts.map(s => s.adminId);
    this.shiftNotes = this.selectedShifts.length > 0 ? (this.selectedShifts[0].notes || '') : '';
  }

  isAdminSelected(adminId: number): boolean {
    return this.selectedAdminIds.includes(adminId);
  }

  toggleAdmin(adminId: number): void {
    const idx = this.selectedAdminIds.indexOf(adminId);
    if (idx >= 0) {
      this.selectedAdminIds.splice(idx, 1);
    } else {
      this.selectedAdminIds.push(adminId);
    }
  }

  hasChanges(): boolean {
    if (!this.selectedDate) return false;
    const currentIds = this.selectedShifts.map(s => s.adminId).sort();
    const newIds = [...this.selectedAdminIds].sort();
    const currentNotes = this.selectedShifts.length > 0 ? (this.selectedShifts[0].notes || '') : '';

    if (currentIds.length !== newIds.length) return true;
    if (currentIds.some((id, i) => id !== newIds[i])) return true;
    if (this.shiftNotes !== currentNotes) return true;
    return false;
  }

  // ════════════════════════════════════════
  //  Save shifts (single day)
  // ════════════════════════════════════════

  saveShifts(): void {
    if (!this.selectedDate || this.saving) return;

    this.saving = true;
    this.successMessage = '';
    this.errorMessage = '';

    const dateStr = this.toDateString(this.selectedDate);

    this.shiftService.bulkSetShifts({
      shiftDate: dateStr,
      adminIds: this.selectedAdminIds,
      notes: this.shiftNotes || undefined
    }).subscribe({
      next: (shifts) => {
        const filteredOut = this.shifts.filter(s => s.shiftDate.substring(0, 10) !== dateStr);
        this.shifts = [...filteredOut, ...shifts];
        this.refreshSelectedDateShifts();
        this.saving = false;
        this.showSuccess('Shifts saved successfully');
      },
      error: (err) => {
        this.saving = false;
        this.showError(err.error?.message || 'Failed to save shifts');
      }
    });
  }

  clearDay(): void {
    this.selectedAdminIds = [];
    this.shiftNotes = '';
  }

  // ════════════════════════════════════════
  //  Multi-select mode
  // ════════════════════════════════════════

  toggleMultiSelectMode(): void {
    this.multiSelectMode = !this.multiSelectMode;
    if (!this.multiSelectMode) {
      this.multiSelectedDates = [];
      this.multiModalOpen = false;
    }
    // Close single-day modal when entering multi-select
    this.selectedDate = null;
  }

  isMultiSelected(date: Date): boolean {
    return this.multiSelectedDates.some(d => this.isSameDay(d, date));
  }

  toggleMultiDate(date: Date): void {
    const idx = this.multiSelectedDates.findIndex(d => this.isSameDay(d, date));
    if (idx >= 0) {
      this.multiSelectedDates.splice(idx, 1);
    } else {
      this.multiSelectedDates.push(date);
    }
    this.multiSelectedDates.sort((a, b) => a.getTime() - b.getTime());
  }

  clearMultiSelection(): void {
    this.multiSelectedDates = [];
  }

  openMultiModal(): void {
    if (this.multiSelectedDates.length === 0) return;
    this.multiAdminIds = [];
    this.multiNotes = '';
    this.multiModalOpen = true;
    this.colorPickerAdminId = null;
  }

  closeMultiModal(): void {
    this.multiModalOpen = false;
    this.colorPickerAdminId = null;
  }

  isMultiAdminSelected(adminId: number): boolean {
    return this.multiAdminIds.includes(adminId);
  }

  toggleMultiAdmin(adminId: number): void {
    const idx = this.multiAdminIds.indexOf(adminId);
    if (idx >= 0) {
      this.multiAdminIds.splice(idx, 1);
    } else {
      this.multiAdminIds.push(adminId);
    }
  }

  saveMultiShifts(): void {
    if (this.multiSelectedDates.length === 0 || this.multiAdminIds.length === 0 || this.saving) return;

    this.saving = true;
    this.successMessage = '';
    this.errorMessage = '';

    const requests = this.multiSelectedDates.map(date =>
      this.shiftService.bulkSetShifts({
        shiftDate: this.toDateString(date),
        adminIds: this.multiAdminIds,
        notes: this.multiNotes || undefined
      })
    );

    forkJoin(requests).subscribe({
      next: (results) => {
        // Update local cache
        const dateStrs = this.multiSelectedDates.map(d => this.toDateString(d));
        const filteredOut = this.shifts.filter(s => !dateStrs.includes(s.shiftDate.substring(0, 10)));
        const allNewShifts = results.flat();
        this.shifts = [...filteredOut, ...allNewShifts];

        this.saving = false;
        this.multiModalOpen = false;
        this.multiSelectedDates = [];
        this.multiSelectMode = false;
        this.showSuccess(`Shifts saved for ${results.length} days`);
      },
      error: (err) => {
        this.saving = false;
        this.showError(err.error?.message || 'Failed to save shifts');
      }
    });
  }

  getMultiSelectedSorted(): Date[] {
    return [...this.multiSelectedDates].sort((a, b) => a.getTime() - b.getTime());
  }

  formatShortDate(date: Date): string {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  onMultiOverlayClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('modal-overlay')) {
      this.closeMultiModal();
    }
  }

  // ════════════════════════════════════════
  //  Color helpers
  // ════════════════════════════════════════

  getAdminColor(adminId: number, fallbackName: string): string {
    const shift = this.shifts.find(s => s.adminId === adminId && s.adminColor);
    if (shift?.adminColor) return shift.adminColor;

    const admin = this.admins.find(a => a.id === adminId);
    if (admin?.shiftColor) return admin.shiftColor;

    return this.getHashColor(fallbackName);
  }

  getAdminColorById(adminId: number): string {
    const admin = this.admins.find(a => a.id === adminId);
    if (admin?.shiftColor) return admin.shiftColor;
    return this.getHashColor((admin?.firstName || '') + ' ' + (admin?.lastName || ''));
  }

  getHashColor(name: string): string {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length];
  }

  getInitials(name: string): string {
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  }

  getAvatarColor(name: string): string {
    return this.getHashColor(name);
  }

  toggleColorPicker(adminId: number, event: Event): void {
    event.stopPropagation();
    if (this.colorPickerAdminId === adminId) {
      this.colorPickerAdminId = null;
      return;
    }
    this.colorPickerAdminId = adminId;
    const currentColor = this.getAdminColorById(adminId);
    const rgb = this.hexToRgb(currentColor);
    this.pickerR = rgb.r;
    this.pickerG = rgb.g;
    this.pickerB = rgb.b;
    this.pickerA = 100;
  }

  getPickerColor(): string {
    return `rgba(${this.pickerR}, ${this.pickerG}, ${this.pickerB}, ${this.pickerA / 100})`;
  }

  getPickerHex(): string {
    return '#' +
      this.pickerR.toString(16).padStart(2, '0') +
      this.pickerG.toString(16).padStart(2, '0') +
      this.pickerB.toString(16).padStart(2, '0');
  }

  applyPickerColor(event: Event): void {
    event.stopPropagation();
    if (!this.colorPickerAdminId) return;

    const color = this.pickerA < 100
      ? `rgba(${this.pickerR},${this.pickerG},${this.pickerB},${(this.pickerA / 100).toFixed(2)})`
      : this.getPickerHex();
    const adminId = this.colorPickerAdminId;

    const admin = this.admins.find(a => a.id === adminId);
    if (admin) admin.shiftColor = color;

    this.shifts.forEach(s => {
      if (s.adminId === adminId) s.adminColor = color;
    });

    this.colorPickerAdminId = null;

    this.shiftService.setAdminColor(adminId, color).subscribe({
      error: () => this.showError('Failed to save color')
    });
  }

  onSliderInput(event: Event): void {
    event.stopPropagation();
  }

  hexToRgb(hex: string): { r: number; g: number; b: number } {
    if (hex.startsWith('rgba') || hex.startsWith('rgb')) {
      const match = hex.match(/[\d.]+/g);
      if (match) {
        return { r: parseInt(match[0]), g: parseInt(match[1]), b: parseInt(match[2]) };
      }
    }
    const clean = hex.replace('#', '');
    return {
      r: parseInt(clean.slice(0, 2), 16),
      g: parseInt(clean.slice(2, 4), 16),
      b: parseInt(clean.slice(4, 6), 16)
    };
  }

  // ════════════════════════════════════════
  //  Modal helpers
  // ════════════════════════════════════════

  closeEditor(): void {
    this.selectedDate = null;
    this.selectedShifts = [];
    this.selectedAdminIds = [];
    this.shiftNotes = '';
    this.colorPickerAdminId = null;
  }

  onOverlayClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('modal-overlay')) {
      this.closeEditor();
    }
  }

  @HostListener('document:keydown.escape')
  onEscKey(): void {
    if (this.multiModalOpen) { this.closeMultiModal(); return; }
    if (this.selectedDate) this.closeEditor();
  }

  // ════════════════════════════════════════
  //  Helpers
  // ════════════════════════════════════════

  toDateString(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  formatSelectedDate(): string {
    if (!this.selectedDate) return '';
    return this.selectedDate.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  }

  showSuccess(msg: string): void {
    this.successMessage = msg;
    setTimeout(() => this.successMessage = '', 3000);
  }

  showError(msg: string): void {
    this.errorMessage = msg;
    setTimeout(() => this.errorMessage = '', 5000);
  }
}
