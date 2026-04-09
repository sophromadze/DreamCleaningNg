import { Component, Input, Output, EventEmitter, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-duration-selector',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './duration-selector.component.html',
  styleUrls: ['./duration-selector.component.scss']
})
export class DurationSelectorComponent implements OnInit {
  @Input() value: number = 60; // Default to 1 hour
  @Output() valueChange = new EventEmitter<number>();

  selectedHours: number = 1;
  selectedMinutes: number = 0;
  
  hours: number[] = Array.from({length: 8}, (_, i) => i + 1); // 1 to 8 hours
  minutes: number[] = [0, 30]; // 00 and 30 minutes

  isHoursDropdownOpen = false;
  isMinutesDropdownOpen = false;

  ngOnInit() {
    this.updateFromValue();
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
    this.selectedHours = Math.floor(this.value / 60);
    this.selectedMinutes = this.value % 60;
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

  selectHours(hour: number, event: Event) {
    event.stopPropagation();
    this.selectedHours = hour;
    this.isHoursDropdownOpen = false;
    this.updateValue();
  }

  selectMinutes(minute: number, event: Event) {
    event.stopPropagation();
    this.selectedMinutes = minute;
    this.isMinutesDropdownOpen = false;
    this.updateValue();
  }

  updateValue() {
    const newValue = Math.max((this.selectedHours * 60) + this.selectedMinutes, 60); // Ensure minimum 1 hour
    this.value = newValue;
    this.valueChange.emit(newValue);
  }

  formatHours(hour: number): string {
    return `${hour}h`;
  }

  formatMinutes(minute: number): string {
    return minute === 0 ? '00m' : `${minute}m`;
  }

  getDisplayText(): string {
    if (this.selectedMinutes === 0) {
      return `${this.selectedHours}h`;
    } else {
      return `${this.selectedHours}h ${this.selectedMinutes}m`;
    }
  }
} 