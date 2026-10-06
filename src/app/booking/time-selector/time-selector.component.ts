import { Component, OnInit, OnChanges, HostListener, ChangeDetectionStrategy, signal, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { getAllServiceTimeSlots } from '../../shared/booking/service-time-slots';
@Component({
  selector: 'app-time-selector',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './time-selector.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./time-selector.component.scss'],
})
export class TimeSelectorComponent implements OnInit, OnChanges {
  /** Only used when the host passes no slots at all — the plain customer weekday window. */
  private static readonly DEFAULT_TIME_SLOTS = getAllServiceTimeSlots(false);

  readonly value = model<string>('08:00');
  readonly availableTimeSlots = input<string[]>([]);
  readonly blockedHours = input<string[]>([]);  // Hours to show as "Busy" (disabled but visible)

  readonly selectedHour = signal<number>(8);
  readonly selectedMinute = signal<number>(0);
  
  readonly hours = signal<number[]>([]);
  minutes: number[] = [0, 30]; // 00 and 30 minutes

  /**
   * Which half-hours each offered hour actually has, derived from `availableTimeSlots`.
   *
   * Every "which minutes may I pick?" question is answered from here rather than from a literal
   * hour, because the window is no longer one fixed range: a customer stops at 6:00 PM (so 6 PM
   * offers :00 only), a weekend customer starts at 9:30 AM (so 9 AM offers :30 only), and an
   * admin runs to 8:00 PM (so 6 PM offers BOTH and 8 PM offers :00 only). Hard-coding hour 18
   * got two of those three wrong the moment admin hours existed.
   */
  private readonly minutesByHour = signal(new Map<number, number[]>());

  readonly isHoursDropdownOpen = signal(false);
  readonly isMinutesDropdownOpen = signal(false);

  ngOnInit() {
    this.updateFromValue();
    this.updateAvailableHours();
  }

  ngOnChanges(changes: any) {
    if (changes['value'] && changes['value'].currentValue) {
      this.updateFromValue();
    }
    this.updateAvailableHours();
  }

  updateAvailableHours() {
    const slots = this.availableTimeSlots().length > 0
      ? this.availableTimeSlots()
      : TimeSelectorComponent.DEFAULT_TIME_SLOTS;

    const byHour = new Map<number, number[]>();
    for (const slot of slots) {
      const [hour, minute] = slot.split(':').map(Number);
      if (!Number.isFinite(hour) || !Number.isFinite(minute)) continue;
      const minutes = byHour.get(hour) ?? [];
      if (!minutes.includes(minute)) minutes.push(minute);
      byHour.set(hour, minutes);
    }
    for (const minutes of byHour.values()) minutes.sort((a, b) => a - b);

    this.minutesByHour.set(byHour);
    this.hours.set([...byHour.keys()].sort((a, b) => a - b));

    // Don't automatically change the selected time to avoid Angular change detection errors —
    // the hosting page owns that, and picks a valid slot itself.
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event) {
    const target = event.target as HTMLElement;
    if (!target.closest('.selector-container')) {
      this.isHoursDropdownOpen.set(false);
      this.isMinutesDropdownOpen.set(false);
    }
  }

  updateFromValue() {
    const value = this.value();
    if (value) {
      const [hour, minute] = value.split(':').map(Number);
      this.selectedHour.set(hour);
      this.selectedMinute.set(minute);
    }
  }

  toggleHoursDropdown(event: Event) {
    event.stopPropagation();
    this.isHoursDropdownOpen.set(!this.isHoursDropdownOpen());
    this.isMinutesDropdownOpen.set(false);
  }

  toggleMinutesDropdown(event: Event) {
    event.stopPropagation();
    this.isMinutesDropdownOpen.set(!this.isMinutesDropdownOpen());
    this.isHoursDropdownOpen.set(false);
  }

  selectHour(hour: number, event: Event) {
    event.stopPropagation();
    this.selectedHour.set(hour);

    // Snap the minute onto one this hour actually offers (the last hour of the window has :00
    // only, the first hour of a weekend has :30 only).
    const available = this.getAvailableMinutes();
    if (available.length > 0 && !available.includes(this.selectedMinute())) {
      this.selectedMinute.set(available[0]);
    }

    this.isHoursDropdownOpen.set(false);
    this.updateValue();
  }

  selectMinute(minute: number, event: Event) {
    event.stopPropagation();
    this.selectedMinute.set(minute);
    this.isMinutesDropdownOpen.set(false);
    this.updateValue();
  }

  updateValue() {
    const newValue = `${this.selectedHour().toString().padStart(2, '0')}:${this.selectedMinute().toString().padStart(2, '0')}`;
    this.value.set(newValue); // model.set() also emits valueChange
  }

  formatHour(hour: number): string {
    const period = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return `${displayHour} ${period}`;
  }

  formatMinute(minute: number): string {
    return minute === 0 ? '00' : '30';
  }

  getAvailableMinutes(): number[] {
    return this.minutesByHour().get(this.selectedHour()) ?? this.minutes;
  }

  isHourBlocked(hour: number): boolean {
    // An hour is busy only when EVERY half-hour it offers is busy. Which ones it offers varies
    // by hour (the last hour of the window has :00 only), so ask the map, never assume both.
    const h = hour.toString().padStart(2, '0');
    const minutes = this.minutesByHour().get(hour) ?? this.minutes;
    return minutes.every(minute =>
      this.blockedHours().includes(`${h}:${minute.toString().padStart(2, '0')}`)
    );
  }

  isMinuteBlocked(minute: number): boolean {
    const h = this.selectedHour().toString().padStart(2, '0');
    const m = minute.toString().padStart(2, '0');
    return this.blockedHours().includes(`${h}:${m}`);
  }

  selectHourIfNotBlocked(hour: number, event: Event) {
    if (this.isHourBlocked(hour)) {
      event.stopPropagation();
      return; // Don't allow selection of fully blocked hours
    }
    this.selectHour(hour, event);
  }

  selectMinuteIfNotBlocked(minute: number, event: Event) {
    if (this.isMinuteBlocked(minute)) {
      event.stopPropagation();
      return;
    }
    this.selectMinute(minute, event);
  }

  getDisplayTime(): string {
    return `${this.formatHour(this.selectedHour())}:${this.formatMinute(this.selectedMinute())}`;
  }
} 