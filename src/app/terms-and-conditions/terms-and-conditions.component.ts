import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-terms-and-conditions',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './terms-and-conditions.component.html',
  styleUrls: ['./terms-and-conditions.component.scss']
})
export class TermsAndConditionsComponent {
  websiteUrl = 'https://dreamcleaningnyc.com';
  emailAddress = 'hello@dreamcleaningnyc.com';
  phoneNumber = '929-930-1525';
  effectiveDate = 'February 14, 2026';  
  companyName = 'Dream Cleaning';
  state = 'New York';
  serviceCities = ['Brooklyn', 'Manhattan', 'Queens'];
}