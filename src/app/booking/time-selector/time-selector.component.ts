import { Component, Input, Output, EventEmitter, OnInit, OnChanges, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
@Component({
  selector: 'app-time-selector',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './time-selector.component.html',
  styleUrls: ['./time-selector.component.scss'],
})
export class TimeSelectorComponent implements OnInit, OnChanges {
  @Input() value: string = '08:00';
  @Input() availableTimeSlots: string[] = [];
  @Output() valueChange = new EventEmitter<string>();

  selectedHour: number = 8;
  selectedMinute: number = 0;
  
  hours: number[] = [];
  minutes: number[] = [0, 30]; // 00 and 30 minutes

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
    if (this.availableTimeSlots.length > 0) {
      // Extract unique hours from available time slots
      const uniqueHours = [...new Set(this.availableTimeSlots.map(slot => parseInt(slot.split(':')[0])))];
      this.hours = uniqueHours.sort((a, b) => a - b);
      
      // Don't automatically change the selected time to avoid Angular change detection errors
      // Let the user manually select from available slots
    } else {
      // Fallback to default hours if no slots provided
      this.hours = Array.from({length: 10}, (_, i) => i + 8); // 8 to 17
    }
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
    
    // If 6 PM is selected and current minute is 30, reset to 00
    if (hour === 18 && this.selectedMinute === 30) {
      this.selectedMinute = 0;
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
    // If 6 PM (18:00) is selected, only allow 00 minutes
    if (this.selectedHour === 18) {
      return [0];
    }
    
    // Check if this is the earliest available hour and earliest time has 30 minutes
    if (this.availableTimeSlots.length > 0) {
      const earliestTime = this.availableTimeSlots[0];
      const [earliestHour, earliestMinute] = earliestTime.split(':').map(Number);
      
      // If selected hour is the earliest hour and earliest minute is 30, only allow 30
      if (this.selectedHour === earliestHour && earliestMinute === 30) {
        return [30];
      }
      
      // If selected hour is the earliest hour and earliest minute is 0, allow both
      if (this.selectedHour === earliestHour && earliestMinute === 0) {
        return [0, 30];
      }
    }
    
    // For all other hours, allow both 00 and 30 minutes
    return [0, 30];
  }

  getDisplayTime(): string {
    return `${this.formatHour(this.selectedHour)}:${this.formatMinute(this.selectedMinute)}`;
  }
} 