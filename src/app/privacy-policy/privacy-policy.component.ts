import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-privacy-policy',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './privacy-policy.component.html',
  styleUrls: ['./privacy-policy.component.scss']
})
export class PrivacyPolicyComponent {
  websiteUrl = 'https://dreamcleaningnearme.com';
  emailAddress = 'hello@dreamcleaningnearme.com';
  phoneNumber = '929-930-1525';
  effectiveDate = 'February 14, 2026';
  companyName = 'Dream Cleaning';
  state = 'New York';
  serviceCities = ['Brooklyn', 'Manhattan', 'Queens'];
}