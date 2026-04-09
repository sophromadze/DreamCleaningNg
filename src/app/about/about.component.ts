import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { BubbleFieldComponent } from '../bubble-field/bubble-field.component';

@Component({
  selector: 'app-about',
  standalone: true,
  imports: [CommonModule, BubbleFieldComponent],
  templateUrl: './about.component.html',
  styleUrl: './about.component.scss'
})
export class AboutComponent {
  constructor(private router: Router) {}

  navigateToBooking() {
    this.router.navigate(['/booking']);
  }
}
