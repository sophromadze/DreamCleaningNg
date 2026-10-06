import { Component, OnInit, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminService } from '../../../services/admin.service';

interface BlockedSlot {
  id: number;
  date: string;
  isFullDay: boolean;
  blockedHours: string | null;
  reason: string | null;
  createdBy: string;
  createdAt: string;
}

// All possible 30-min slots from 8:00 AM to 6:00 PM
const ALL_TIME_SLOTS = [
  '08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30',
  '16:00', '16:30', '17:00', '17:30', '18:00'
];

@Component({
  selector: 'app-scheduling',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './scheduling.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./scheduling.component.scss']
})
export class SchedulingComponent implements OnInit {
  private adminService = inject(AdminService);

  readonly blockedSlots = signal<BlockedSlot[]>([]);
  readonly isLoading = signal(false);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');

  // Form state
  readonly showForm = signal(false);
  readonly editingSlot = signal<BlockedSlot | null>(null);
  readonly formDate = signal('');
  readonly formIsFullDay = signal(true);
  readonly formSelectedHours = signal<Set<string>>(new Set(), { equal: () => false });
  readonly formReason = signal('');

  allTimeSlots = ALL_TIME_SLOTS;

  ngOnInit() {
    this.loadBlockedSlots();
  }

  loadBlockedSlots() {
    this.isLoading.set(true);
    const from = new Date().toISOString().split('T')[0];
    const to = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    this.adminService.getBlockedTimeSlots(from, to).subscribe({
      next: (slots) => {
        this.blockedSlots.set(slots);
        this.isLoading.set(false);
      },
      error: () => {
        this.errorMessage.set('Failed to load blocked time slots.');
        this.isLoading.set(false);
      }
    });
  }

  openAddForm() {
    this.editingSlot.set(null);
    this.formDate.set('');
    this.formIsFullDay.set(true);
    this.formSelectedHours.set(new Set());
    this.formReason.set('');
    this.showForm.set(true);
  }

  openEditForm(slot: BlockedSlot) {
    this.editingSlot.set(slot);
    this.formDate.set(slot.date);
    this.formIsFullDay.set(slot.isFullDay);
    this.formSelectedHours.set(new Set(slot.blockedHours ? slot.blockedHours.split(',') : []));
    this.formReason.set(slot.reason || '');
    this.showForm.set(true);
  }

  cancelForm() {
    this.showForm.set(false);
    this.editingSlot.set(null);
  }

  toggleHour(hour: string) {
    if (this.formSelectedHours().has(hour)) {
      this.formSelectedHours().delete(hour);
      this.formSelectedHours.set(this.formSelectedHours());
    } else {
      this.formSelectedHours().add(hour);
      this.formSelectedHours.set(this.formSelectedHours());
    }
  }

  selectAllHours() {
    ALL_TIME_SLOTS.forEach(h => this.formSelectedHours().add(h));
    this.formSelectedHours.set(this.formSelectedHours());
  }

  clearAllHours() {
    this.formSelectedHours().clear();
    this.formSelectedHours.set(this.formSelectedHours());
  }

  save() {
    if (!this.formDate()) {
      this.errorMessage.set('Please select a date.');
      return;
    }

    if (!this.formIsFullDay() && this.formSelectedHours().size === 0) {
      this.errorMessage.set('Please select at least one hour to block, or choose "Block Entire Day".');
      return;
    }

    // If all hours are selected, treat as full day
    const effectiveFullDay = this.formIsFullDay() || this.formSelectedHours().size === ALL_TIME_SLOTS.length;

    const dto = {
      date: this.formDate(),
      isFullDay: effectiveFullDay,
      blockedHours: effectiveFullDay ? undefined : Array.from(this.formSelectedHours()).sort().join(','),
      reason: this.formReason() || undefined
    };

    const request$ = this.editingSlot()
      ? this.adminService.updateBlockedTimeSlot(this.editingSlot()!.id, dto)
      : this.adminService.createBlockedTimeSlot(dto);

    request$.subscribe({
      next: () => {
        this.successMessage.set(this.editingSlot() ? 'Block updated successfully.' : 'Block created successfully.');
        this.showForm.set(false);
        this.editingSlot.set(null);
        this.loadBlockedSlots();
        setTimeout(() => this.successMessage.set(''), 3000);
      },
      error: (err) => {
        this.errorMessage.set(err?.error?.message || 'Failed to save blocked time slot.');
        setTimeout(() => this.errorMessage.set(''), 5000);
      }
    });
  }

  deleteSlot(slot: BlockedSlot) {
    if (!confirm(`Are you sure you want to unblock ${this.formatDate(slot.date)}?`)) return;

    this.adminService.deleteBlockedTimeSlot(slot.id).subscribe({
      next: () => {
        this.successMessage.set('Block removed successfully.');
        this.loadBlockedSlots();
        setTimeout(() => this.successMessage.set(''), 3000);
      },
      error: () => {
        this.errorMessage.set('Failed to delete blocked time slot.');
        setTimeout(() => this.errorMessage.set(''), 5000);
      }
    });
  }

  formatDate(dateStr: string): string {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
  }

  formatTime(time: string): string {
    const [h, m] = time.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${displayH}:${m.toString().padStart(2, '0')} ${period}`;
  }

  getBlockedHoursList(slot: BlockedSlot): string {
    if (slot.isFullDay) return 'Entire Day';
    if (!slot.blockedHours) return 'None';
    return slot.blockedHours.split(',').map(h => this.formatTime(h)).join(', ');
  }

  isPastDate(dateStr: string): boolean {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date < today;
  }
}
