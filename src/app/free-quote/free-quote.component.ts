import { Component, OnInit, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { RouterModule } from '@angular/router';
import { environment } from '../../environments/environment';
import { BubbleFieldComponent } from '../bubble-field/bubble-field.component';

@Component({
  selector: 'app-free-quote',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule, BubbleFieldComponent],
  templateUrl: './free-quote.component.html',
  styleUrl: './free-quote.component.scss'
})
export class FreeQuoteComponent implements OnInit {
  quoteForm: FormGroup;
  isSubmitting = false;
  showSuccess = false;
  showError = false;
  errorMessage = '';

  constructor(
    private fb: FormBuilder,
    private http: HttpClient,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.quoteForm = this.fb.group({
      firstName: ['', [Validators.required]],
      lastName: [''],
      phone: ['', [
        Validators.required, 
        Validators.pattern(/^\d{10}$/),
        Validators.minLength(10),
        Validators.maxLength(10)
      ]],
      email: ['', [Validators.required, Validators.email]],
      homeAddress: ['', [Validators.required]],
      cleaningType: ['', [Validators.required]],
      message: ['', [Validators.required]]
    });
  }

  ngOnInit() {
    // Component initialization
  }

  onPhoneInput(event: Event) {
    const input = event.target as HTMLInputElement;
    let value = input.value.replace(/\D/g, '');
    
    if (value.length > 10) {
      value = value.substring(0, 10);
    }
    
    this.quoteForm.patchValue({ phone: value }, { emitEvent: false });
  }

  onSubmit() {
    if (this.quoteForm.invalid) {
      this.markFormGroupTouched(this.quoteForm);
      return;
    }

    this.isSubmitting = true;
    this.showError = false;
    this.showSuccess = false;

    const formValue = this.quoteForm.getRawValue();
    
    const quoteData = {
      firstName: formValue.firstName,
      lastName: formValue.lastName || '',
      phone: formValue.phone,
      email: formValue.email,
      homeAddress: formValue.homeAddress,
      cleaningType: formValue.cleaningType,
      message: formValue.message
    };

    this.http.post(`${environment.apiUrl}/contact/quote-request`, quoteData)
      .subscribe({
        next: (response) => {
          this.isSubmitting = false;
          this.showSuccess = true;
          this.showError = false;

          // GA4 conversion event for Google Ads (only in browser, not SSR)
          if (isPlatformBrowser(this.platformId) && typeof window.gtag === 'function') {
            try {
              window.gtag('event', 'quote_form_submit', {
                event_category: 'lead',
                event_label: 'free_quote_request',
                value: 30
              });
            } catch {
              // Ignore tracking errors
            }
          }
          
          // Reset form
          this.quoteForm.reset();
          this.quoteForm.markAsUntouched();

          // Hide success message after 5 seconds
          setTimeout(() => {
            this.showSuccess = false;
          }, 5000);
        },
        error: (error) => {
          this.isSubmitting = false;
          this.showError = true;
          this.showSuccess = false;
          this.errorMessage = error.error?.message || 'Failed to send quote request. Please try again.';
          
          // Hide error message after 5 seconds
          setTimeout(() => {
            this.showError = false;
          }, 5000);
        }
      });
  }

  // Helper methods
  hasError(fieldName: string): boolean {
    const field = this.quoteForm.get(fieldName);
    return !!(field && field.invalid && field.touched);
  }

  getErrorMessage(fieldName: string): string {
    const field = this.quoteForm.get(fieldName);
    if (!field || !field.errors) return '';

    if (field.errors['required']) {
      const fieldLabels: { [key: string]: string } = {
        'firstName': 'First name',
        'phone': 'Phone number',
        'email': 'Email',
        'homeAddress': 'Home address',
        'cleaningType': 'Cleaning type',
        'message': 'Message'
      };
      return `${fieldLabels[fieldName] || fieldName} is required`;
    }
    if (field.errors['email']) {
      return 'Please enter a valid email address';
    }
    if (field.errors['pattern'] || field.errors['minLength'] || field.errors['maxLength']) {
      return 'Please enter a valid 10-digit phone number';
    }
    return '';
  }

  private markFormGroupTouched(formGroup: FormGroup) {
    Object.keys(formGroup.controls).forEach(key => {
      const control = formGroup.get(key);
      control?.markAsTouched();
    });
  }
}
