import { Component, OnInit, HostListener, OnChanges, SimpleChanges, ChangeDetectionStrategy, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-date-selector',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './date-selector.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./date-selector.component.scss']
})
export class DateSelectorComponent implements OnInit, OnChanges {
  readonly value = model<string>('');
  readonly minDate = input<string>('');
  readonly isSameDaySelected = input<boolean>(false);
  readonly blockedDates = input<string[]>([]);          // YYYY-MM-DD strings of fully blocked days
  readonly partiallyBlockedDates = input<string[]>([]); // YYYY-MM-DD strings of partially blocked days

  readonly isDropdownOpen = signal(false);
  readonly currentMonth = signal<Date>(new Date());
  selectedDate: Date | null = null;
  readonly calendarDays = signal<Array<{ date: Date; isCurrentMonth: boolean; isSelected: boolean; isDisabled: boolean; isBlocked: boolean; isPartiallyBlocked: boolean }>>([], { equal: () => false });

  ngOnInit() {
    this.updateFromValue();
    this.generateCalendar();
  }

  ngOnChanges(changes: SimpleChanges) {
    // If same day service is selected, update the calendar to show today as selected
    const isSameDaySelected = this.isSameDaySelected();
    if (changes['isSameDaySelected'] && isSameDaySelected) {
      const today = new Date();
      this.selectedDate = new Date(today);
      this.currentMonth.set(new Date(today));
      this.generateCalendar();
    }
    // If same day service is unchecked, update from the current value
    else if (changes['isSameDaySelected'] && !isSameDaySelected) {
      this.updateFromValue();
      this.generateCalendar();
    }
    // If value changes, update from the new value
    else if (changes['value']) {
      this.updateFromValue();
      this.generateCalendar();
    }
    // If blocked dates change, regenerate calendar
    if (changes['blockedDates'] || changes['partiallyBlockedDates']) {
      this.generateCalendar();
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event) {
    const target = event.target as HTMLElement;
    if (!target.closest('.date-selector-container')) {
      this.isDropdownOpen.set(false);
    }
  }

  updateFromValue() {
    const value = this.value();
    if (value) {
      // Handle the value whether it comes as YYYY-MM-DD or as an ISO string
      let dateString = value;
      
      // If it contains 'T', it's an ISO string, extract just the date part
      if (dateString.includes('T')) {
        dateString = dateString.split('T')[0];
      }
      
      // Create date without timezone issues by parsing the date string manually
      const [year, month, day] = dateString.split('-').map(Number);
      this.selectedDate = new Date(year, month - 1, day);
      this.currentMonth.set(new Date(this.selectedDate));
    } else {
      this.selectedDate = null;
      this.currentMonth.set(new Date());
    }
  }

  toggleDropdown(event: Event) {
    event.stopPropagation();
    this.isDropdownOpen.set(!this.isDropdownOpen());
    if (this.isDropdownOpen()) {
      this.generateCalendar();
    }
  }

  generateCalendar() {
    const year = this.currentMonth().getFullYear();
    const month = this.currentMonth().getMonth();
    
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - firstDay.getDay());
    
    const endDate = new Date(lastDay);
    endDate.setDate(endDate.getDate() + (6 - lastDay.getDay()));
    
    this.calendarDays.set([]);
    const currentDate = new Date(startDate);
    
    while (currentDate <= endDate) {
      const isCurrentMonth = currentDate.getMonth() === month;
      const isSelected = this.selectedDate ? 
        currentDate.getFullYear() === this.selectedDate.getFullYear() &&
        currentDate.getMonth() === this.selectedDate.getMonth() &&
        currentDate.getDate() === this.selectedDate.getDate() : false;
      const isDisabled = this.isDateDisabled(currentDate);
      const dateStr = this.toDateString(currentDate);
      const isBlocked = this.blockedDates().includes(dateStr);
      const isPartiallyBlocked = !isBlocked && this.partiallyBlockedDates().includes(dateStr);

      this.calendarDays().push({
        date: new Date(currentDate),
        isCurrentMonth,
        isSelected,
        isDisabled: isDisabled || isBlocked,
        isBlocked,
        isPartiallyBlocked
      });
      
      currentDate.setDate(currentDate.getDate() + 1);
    }
    this.calendarDays.set(this.calendarDays());
  }

  isDateDisabled(date: Date): boolean {
    const minDateValue = this.minDate();
    if (minDateValue) {
      // Create minDate without timezone issues
      const [year, month, day] = minDateValue.split('-').map(Number);
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
      this.value.set(`${year}-${month}-${day}`); // model.set() also emits valueChange
      this.isDropdownOpen.set(false);
      this.generateCalendar();
    }
  }

  previousMonth() {
    this.currentMonth().setMonth(this.currentMonth().getMonth() - 1);
    this.generateCalendar();
  }

  nextMonth() {
    this.currentMonth().setMonth(this.currentMonth().getMonth() + 1);
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
    return this.formatDate(this.value());
  }

  private toDateString(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  getMonthYearString(): string {
    const options: Intl.DateTimeFormatOptions = { 
      year: 'numeric', 
      month: 'long' 
    };
    return this.currentMonth().toLocaleDateString('en-US', options);
  }
} 