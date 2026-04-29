import { Component} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { SERVICE_PRICING } from '../shared/service-pricing.data';

@Component({
  selector: 'app-service-page',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './service-page.component.html',
  styleUrl: './service-page.component.scss'
})
export class ServicePageComponent {
  readonly pricing = SERVICE_PRICING;

  constructor() {}
}
