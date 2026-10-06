import { Component, OnInit, HostListener, ChangeDetectionStrategy, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-duration-selector',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './duration-selector.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./duration-selector.component.scss']
})
export class DurationSelectorComponent implements OnInit {
  readonly value = model<number>(60); // Default to 1 hour

  readonly selectedHours = signal<number>(1);
  readonly selectedMinutes = signal<number>(0);
  
  hours: number[] = Array.from({length: 8}, (_, i) => i + 1); // 1 to 8 hours
  minutes: number[] = [0, 30]; // 00 and 30 minutes

  readonly isHoursDropdownOpen = signal(false);
  readonly isMinutesDropdownOpen = signal(false);

  ngOnInit() {
    this.updateFromValue();
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
    this.selectedHours.set(Math.floor(value / 60));
    this.selectedMinutes.set(value % 60);
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

  selectHours(hour: number, event: Event) {
    event.stopPropagation();
    this.selectedHours.set(hour);
    this.isHoursDropdownOpen.set(false);
    this.updateValue();
  }

  selectMinutes(minute: number, event: Event) {
    event.stopPropagation();
    this.selectedMinutes.set(minute);
    this.isMinutesDropdownOpen.set(false);
    this.updateValue();
  }

  updateValue() {
    const newValue = Math.max((this.selectedHours() * 60) + this.selectedMinutes(), 60); // Ensure minimum 1 hour
    this.value.set(newValue); // model.set() also emits valueChange
  }

  formatHours(hour: number): string {
    return `${hour}h`;
  }

  formatMinutes(minute: number): string {
    return minute === 0 ? '00m' : `${minute}m`;
  }

  getDisplayText(): string {
    if (this.selectedMinutes() === 0) {
      return `${this.selectedHours()}h`;
    } else {
      return `${this.selectedHours()}h ${this.selectedMinutes()}m`;
    }
  }
} 