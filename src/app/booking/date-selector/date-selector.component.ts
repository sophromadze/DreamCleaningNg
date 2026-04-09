import { Component, Input, Output, EventEmitter, OnInit, HostListener, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-date-selector',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './date-selector.component.html',
  styleUrls: ['./date-selector.component.scss']
})
export class DateSelectorComponent implements OnInit, OnChanges {
  @Input() value: string = '';
  @Input() minDate: string = '';
  @Input() isSameDaySelected: boolean = false;
  @Output() valueChange = new EventEmitter<string>();

  isDropdownOpen = false;
  currentMonth: Date = new Date();
  selectedDate: Date | null = null;
  calendarDays: Array<{ date: Date; isCurrentMonth: boolean; isSelected: boolean; isDisabled: boolean }> = [];

  ngOnInit() {
    this.updateFromValue();
    this.generateCalendar();
  }

  ngOnChanges(changes: SimpleChanges) {
    // If same day service is selected, update the calendar to show today as selected
    if (changes['isSameDaySelected'] && this.isSameDaySelected) {
      const today = new Date();
      this.selectedDate = new Date(today);
      this.currentMonth = new Date(today);
      this.generateCalendar();
    }
    // If same day service is unchecked, update from the current value
    else if (changes['isSameDaySelected'] && !this.isSameDaySelected) {
      this.updateFromValue();
      this.generateCalendar();
    }
    // If value changes, update from the new value
    else if (changes['value']) {
      this.updateFromValue();
      this.generateCalendar();
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event) {
    const target = event.target as HTMLElement;
    if (!target.closest('.date-selector-container')) {
      this.isDropdownOpen = false;
    }
  }

  updateFromValue() {
    if (this.value) {
      // Handle the value whether it comes as YYYY-MM-DD or as an ISO string
      let dateString = this.value;
      
      // If it contains 'T', it's an ISO string, extract just the date part
      if (dateString.includes('T')) {
        dateString = dateString.split('T')[0];
      }
      
      // Create date without timezone issues by parsing the date string manually
      const [year, month, day] = dateString.split('-').map(Number);
      this.selectedDate = new Date(year, month - 1, day);
      this.currentMonth = new Date(this.selectedDate);
    } else {
      this.selectedDate = null;
      this.currentMonth = new Date();
    }
  }

  toggleDropdown(event: Event) {
    event.stopPropagation();
    this.isDropdownOpen = !this.isDropdownOpen;
    if (this.isDropdownOpen) {
      this.generateCalendar();
    }
  }

  generateCalendar() {
    const year = this.currentMonth.getFullYear();
    const month = this.currentMonth.getMonth();
    
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - firstDay.getDay());
    
    const endDate = new Date(lastDay);
    endDate.setDate(endDate.getDate() + (6 - lastDay.getDay()));
    
    this.calendarDays = [];
    const currentDate = new Date(startDate);
    
    while (currentDate <= endDate) {
      const isCurrentMonth = currentDate.getMonth() === month;
      const isSelected = this.selectedDate ? 
        currentDate.getFullYear() === this.selectedDate.getFullYear() &&
        currentDate.getMonth() === this.selectedDate.getMonth() &&
        currentDate.getDate() === this.selectedDate.getDate() : false;
      const isDisabled = this.isDateDisabled(currentDate);
      
      this.calendarDays.push({
        date: new Date(currentDate),
        isCurrentMonth,
        isSelected,
        isDisabled
      });
      
      currentDate.setDate(currentDate.getDate() + 1);
    }
  }

  isDateDisabled(date: Date): boolean {
    if (this.minDate) {
      // Create minDate without timezone issues
      const [year, month, day] = this.minDate.split('-').map(Number);
      const minDate = new Date(year, month - 1, day);
      return date < minDate;
    }
    return false;
  }

  selectDate(date: Date) {
    if (!this.isDateDisabled(date)) {
      this.selectedDate = new Date(date);
      // Format date as YYYY-MM-DD without timezone issues
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      this.value = `${year}-${month}-${day}`;
            
      this.valueChange.emit(this.value);
      this.isDropdownOpen = false;
      this.generateCalendar();
    }
  }

  previousMonth() {
    this.currentMonth.setMonth(this.currentMonth.getMonth() - 1);
    this.generateCalendar();
  }

  nextMonth() {
    this.currentMonth.setMonth(this.currentMonth.getMonth() + 1);
    this.generateCalendar();
  }

  formatDate(dateString: string): string {
    if (!dateString) return 'Select date';
    
    // Handle ISO string format
    if (dateString.includes('T')) {
      dateString = dateString.split('T')[0];
    }
    
    // Parse date without timezone issues
    const [year, month, day] = dateString.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    const options: Intl.DateTimeFormatOptions = { 
      weekday: 'short', 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    };
    return date.toLocaleDateString('en-US', options);
  }

  getDisplayDate(): string {
    return this.formatDate(this.value);
  }

  getMonthYearString(): string {
    const options: Intl.DateTimeFormatOptions = { 
      year: 'numeric', 
      month: 'long' 
    };
    return this.currentMonth.toLocaleDateString('en-US', options);
  }
} 