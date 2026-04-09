import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CleanerCalendarComponent } from './cleaner-calendar/cleaner-calendar.component';

@Component({
  selector: 'app-cleaner-cabinet',
  standalone: true,
  imports: [CommonModule, CleanerCalendarComponent],
  templateUrl: './cleaner-cabinet.component.html',
  styleUrls: ['./cleaner-cabinet.component.scss']
})
export class CleanerCabinetComponent {
  
}