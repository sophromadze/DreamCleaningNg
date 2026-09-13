import { Component, Input, Output, EventEmitter, OnInit, OnChanges, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { getAllServiceTimeSlots } from '../../shared/booking/service-time-slots';
@Component({
  selector: 'app-time-selector',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './time-selector.component.html',
  styleUrls: ['./time-selector.component.scss'],
})
export class TimeSelectorComponent implements OnInit, OnChanges {
  /** Only used when the host passes no slots at all — the plain customer weekday window. */
  private static readonly DEFAULT_TIME_SLOTS = getAllServiceTimeSlots(false);

  @Input() value: string = '08:00';
  @Input() availableTimeSlots: string[] = [];
  @Input() blockedHours: string[] = [];  // Hours to show as "Busy" (disabled but visible)
  @Output() valueChange = new EventEmitter<string>();

  selectedHour: number = 8;
  selectedMinute: number = 0;
  
  hours: number[] = [];
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
  private minutesByHour = new Map<number, number[]>();

  isHoursDropdownOpen = false;
  isMinutesDropdownOpen = false;

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
    const slots = this.availableTimeSlots.length > 0
      ? this.availableTimeSlots
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

    this.minutesByHour = byHour;
    this.hours = [...byHour.keys()].sort((a, b) => a - b);

    // Don't automatically change the selected time to avoid Angular change detection errors —
    // the hosting page owns that, and picks a valid slot itself.
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event) {
    const target = event.target as HTMLElement;
    if (!target.closest('.selector-container')) {
      this.isHoursDropdownOpen = false;
      this.isMinutesDropdownOpen = false;
    }
  }

  updateFromValue() {
    if (this.value) {
      const [hour, minute] = this.value.split(':').map(Number);
      this.selectedHour = hour;
      this.selectedMinute = minute;
    }
  }

  toggleHoursDropdown(event: Event) {
    event.stopPropagation();
    this.isHoursDropdownOpen = !this.isHoursDropdownOpen;
    this.isMinutesDropdownOpen = false;
  }

  toggleMinutesDropdown(event: Event) {
    event.stopPropagation();
    this.isMinutesDropdownOpen = !this.isMinutesDropdownOpen;
    this.isHoursDropdownOpen = false;
  }

  selectHour(hour: number, event: Event) {
    event.stopPropagation();
    this.selectedHour = hour;

    // Snap the minute onto one this hour actually offers (the last hour of the window has :00
    // only, the first hour of a weekend has :30 only).
    const available = this.getAvailableMinutes();
    if (available.length > 0 && !available.includes(this.selectedMinute)) {
      this.selectedMinute = available[0];
    }

    this.isHoursDropdownOpen = false;
    this.updateValue();
  }

  selectMinute(minute: number, event: Event) {
    event.stopPropagation();
    this.selectedMinute = minute;
    this.isMinutesDropdownOpen = false;
    this.updateValue();
  }

  updateValue() {
    const newValue = `${this.selectedHour.toString().padStart(2, '0')}:${this.selectedMinute.toString().padStart(2, '0')}`;
    this.value = newValue;
    this.valueChange.emit(newValue);
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
    return this.minutesByHour.get(this.selectedHour) ?? this.minutes;
  }

  isHourBlocked(hour: number): boolean {
    // An hour is busy only when EVERY half-hour it offers is busy. Which ones it offers varies
    // by hour (the last hour of the window has :00 only), so ask the map, never assume both.
    const h = hour.toString().padStart(2, '0');
    const minutes = this.minutesByHour.get(hour) ?? this.minutes;
    return minutes.every(minute =>
      this.blockedHours.includes(`${h}:${minute.toString().padStart(2, '0')}`)
    );
  }

  isMinuteBlocked(minute: number): boolean {
    const h = this.selectedHour.toString().padStart(2, '0');
    const m = minute.toString().padStart(2, '0');
    return this.blockedHours.includes(`${h}:${m}`);
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
    return `${this.formatHour(this.selectedHour)}:${this.formatMinute(this.selectedMinute)}`;
  }
} 