import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CleanerService, CleanerCalendarItem, CleanerOrderDetail } from '../../../services/cleaner.service';
import { AuthService } from '../../../services/auth.service';
import { DurationUtils } from '../../../utils/duration.utils';

@Component({
  selector: 'app-cleaner-calendar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './cleaner-calendar.component.html',
  styleUrls: ['./cleaner-calendar.component.scss']
})
export class CleanerCalendarComponent implements OnInit {
  calendarItems: CleanerCalendarItem[] = [];
  calendarDays: any[] = [];
  selectedOrderDetail: CleanerOrderDetail | null = null;
  showOrderModal = false;
  currentUserRole: string = '';
  selectedMonth: number = new Date().getMonth();
  selectedYear: number = new Date().getFullYear();
  
  // Available months and years for dropdowns
  months = [
    { value: 0, name: 'January' },
    { value: 1, name: 'February' },
    { value: 2, name: 'March' },
    { value: 3, name: 'April' },
    { value: 4, name: 'May' },
    { value: 5, name: 'June' },
    { value: 6, name: 'July' },
    { value: 7, name: 'August' },
    { value: 8, name: 'September' },
    { value: 9, name: 'October' },
    { value: 10, name: 'November' },
    { value: 11, name: 'December' }
  ];
  
  years: number[] = [];
  
  constructor(
    private cleanerService: CleanerService,
    private authService: AuthService
  ) {
    // Generate years from 2020 to 5 years in the future
    const currentYear = new Date().getFullYear();
    for (let i = 2020; i <= currentYear + 5; i++) {
      this.years.push(i);
    }
  }

  ngOnInit() {
    this.currentUserRole = this.authService.currentUserValue?.role || '';
    this.loadCalendar();
    this.generateCalendar();
  }

  loadCalendar() {
    // Calculate start and end dates for the selected month
    const startDate = new Date(this.selectedYear, this.selectedMonth, 1);
    const endDate = new Date(this.selectedYear, this.selectedMonth + 1, 0); // Last day of month
    
    this.cleanerService.getCleanerCalendar(startDate, endDate).subscribe({
      next: (items) => {
        this.calendarItems = items;
        this.generateCalendar();
      },
      error: (error) => {
        console.error('Error loading calendar:', error);
      }
    });
  }

  generateCalendar() {
    const calendar = [];
    
    // Get first day of selected month
    const firstDay = new Date(this.selectedYear, this.selectedMonth, 1);
    // Get last day of selected month
    const lastDay = new Date(this.selectedYear, this.selectedMonth + 1, 0);
    
    // Get the number of days in the selected month
    const daysInMonth = lastDay.getDate();
    
    // Generate calendar for all days in the selected month
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(this.selectedYear, this.selectedMonth, day);
      
      // Use local date formatting to avoid timezone issues
      const dateString = this.formatDateToLocalString(date);
      const ordersForDay = this.calendarItems.filter(item => {
        // Parse the service date and convert to local date to avoid timezone issues
        const serviceDate = this.parseServiceDate(item.serviceDate);
        const serviceDateString = this.formatDateToLocalString(serviceDate);
                
        return serviceDateString === dateString;
      });
      
      calendar.push({
        date: date,
        dateString: dateString,
        day: date.getDate(),
        month: date.getMonth(),
        isToday: this.isToday(date),
        isWeekend: this.isWeekend(date),
        orders: ordersForDay
      });
    }
    
    this.calendarDays = calendar;
  }

  onMonthYearChange() {
    this.loadCalendar(); // Reload calendar data for the new month/year
  }

  previousMonth() {
    if (this.selectedMonth === 0) {
      this.selectedMonth = 11;
      this.selectedYear--;
    } else {
      this.selectedMonth--;
    }
    this.loadCalendar(); // Reload calendar data for the new month
  }

  nextMonth() {
    if (this.selectedMonth === 11) {
      this.selectedMonth = 0;
      this.selectedYear++;
    } else {
      this.selectedMonth++;
    }
    this.loadCalendar(); // Reload calendar data for the new month
  }

  goToCurrentMonth() {
    const today = new Date();
    this.selectedMonth = today.getMonth();
    this.selectedYear = today.getFullYear();
    this.loadCalendar(); // Reload calendar data for the current month
  }

  getMonthYearString(): string {
    return `${this.months[this.selectedMonth].name} ${this.selectedYear}`;
  }

  // Helper method to format date to local string (YYYY-MM-DD)
  formatDateToLocalString(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // Helper method to parse service date string and convert to local date
  parseServiceDate(serviceDateString: string): Date {
    // Parse the string to a Date object
    const date = new Date(serviceDateString);
    
    // Create a new date using local components to avoid timezone issues
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  isToday(date: Date): boolean {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  }

  isWeekend(date: Date): boolean {
    const dayOfWeek = date.getDay();
    return dayOfWeek === 0; // 0 = Sunday only
  }

  onOrderClick(orderId: number) {
    this.cleanerService.getOrderDetails(orderId).subscribe({
      next: (detail) => {
        this.selectedOrderDetail = detail;
        this.showOrderModal = true;
      },
      error: (error) => {
        console.error('Error loading order details:', error);
      }
    });
  }

  closeOrderModal() {
    this.showOrderModal = false;
    this.selectedOrderDetail = null;
  }

  formatTime(time: string): string {
    const [hours, minutes] = time.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
  }

  formatDuration(minutes: number): string {
    // Ensure minimum 1 hour (60 minutes) before formatting
    const adjustedMinutes = Math.max(minutes, 60);
    return DurationUtils.formatDurationRounded(adjustedMinutes);
  }

  getServiceDuration(): number {
    if (!this.selectedOrderDetail) return 0;

    const hasCleanerService = this.selectedOrderDetail.services.some(s => 
      s.toLowerCase().includes('cleaner')
    );
    
    const hasHoursService = this.selectedOrderDetail.services.some(s => 
      s.toLowerCase().includes('hour')
    );
    
    if (hasCleanerService && hasHoursService) {
      return this.selectedOrderDetail.totalDuration;
    } else if (hasCleanerService) {
      return this.selectedOrderDetail.totalDuration;
    } else {
      const fallbackDuration = Math.ceil(this.selectedOrderDetail.totalDuration / (this.selectedOrderDetail.maidsCount || 1));
      return fallbackDuration;
    }
  }

  hasCleanerService(): boolean {
    if (!this.selectedOrderDetail) return false;
    return this.selectedOrderDetail.services.some(s => s.toLowerCase().includes('cleaner'));
  }

  hasHoursService(): boolean {
    if (!this.selectedOrderDetail) return false;
    return this.selectedOrderDetail.services.some(s => s.toLowerCase().includes('hour'));
  }

  formatServiceDisplay(service: string): string {
    // Check if it's a bedroom service with quantity 0
    if (service.toLowerCase().includes('bedroom') && service.includes('(x0)')) {
      return 'Studio';
    }
    return service;
  }
}