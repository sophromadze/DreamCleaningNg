import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { RouterModule } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { environment } from '../../environments/environment';
import { BubbleFieldComponent } from '../bubble-field/bubble-field.component';

@Component({
  selector: 'app-contact',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule, BubbleFieldComponent],
  templateUrl: './contact.component.html',
  styleUrl: './contact.component.scss'
})
export class ContactComponent implements OnInit {
  contactForm: FormGroup;
  isSubmitting = false;
  showSuccess = false;
  showError = false;
  errorMessage = '';
  currentUser: any;

  constructor(
    private fb: FormBuilder,
    private http: HttpClient,
    private authService: AuthService
  ) {
    this.contactForm = this.fb.group({
      fullName: ['', [Validators.required]],
      email: [{value: '', disabled: false}, [Validators.required, Validators.email]],
      phone: ['', [
        Validators.required, 
        Validators.pattern(/^\d{10}$/),
        Validators.minLength(10),
        Validators.maxLength(10)
      ]],
      message: ['', [Validators.required]],
      smsConsent: [false, [Validators.requiredTrue]]
    });
  }

  ngOnInit() {
    // Check if user is logged in and pre-fill form
    this.authService.currentUser.subscribe(user => {
      this.currentUser = user;
      if (user) {
        this.contactForm.patchValue({
          fullName: `${user.firstName} ${user.lastName}`.trim(),
          email: user.email,
          phone: user.phone || ''
        });
        // Disable email field for logged-in users
        this.contactForm.get('email')?.disable();
      } else {
        // Enable email field for non-logged-in users
        this.contactForm.get('email')?.enable();
      }
    });
  }

  // Getter for easy access to form fields
  get f() { return this.contactForm.controls; }

  // Format phone number as user types
  onPhoneInput(event: any) {
    let value = event.target.value.replace(/\D/g, '');
    if (value.length > 10) {
      value = value.substring(0, 10);
    }
    this.contactForm.get('phone')?.setValue(value, { emitEvent: false });
  }

  onSubmit() {
    // Mark all fields as touched to show validation errors
    Object.keys(this.contactForm.controls).forEach(key => {
      const control = this.contactForm.get(key);
      if (control && !control.disabled) {
        control.markAsTouched();
      }
    });

    // Check if form is valid (disabled fields are automatically valid)
    if (this.contactForm.valid) {
      this.isSubmitting = true;
      this.showSuccess = false;
      this.showError = false;

      const formData = {
        fullName: this.contactForm.value.fullName,
        email: this.currentUser ? this.currentUser.email : this.contactForm.getRawValue().email,
        phone: this.contactForm.value.phone,
        message: this.contactForm.value.message,
        smsConsent: this.contactForm.value.smsConsent
      };

      this.http.post(`${environment.apiUrl}/contact`, formData)
        .subscribe({
          next: (response) => {
            this.isSubmitting = false;
            this.showSuccess = true;
            this.showError = false;
            
            // Reset form but keep user info if logged in
            if (this.currentUser) {
              this.contactForm.patchValue({
                fullName: `${this.currentUser.firstName} ${this.currentUser.lastName}`.trim(),
                email: this.currentUser.email,
                phone: this.currentUser.phone || '',
                message: '',
                smsConsent: false
              });
              // Keep email field disabled for logged-in users
              this.contactForm.get('email')?.disable();
              // Only reset the message field's touched state
              this.contactForm.get('message')?.markAsUntouched();
              this.contactForm.get('smsConsent')?.markAsUntouched();
            } else {
              this.contactForm.reset();
              // Ensure email field is enabled for non-logged-in users
              this.contactForm.get('email')?.enable();
            }

            // Hide success message after 5 seconds
            setTimeout(() => {
              this.showSuccess = false;
            }, 5000);
          },
          error: (error) => {
            this.isSubmitting = false;
            this.showError = true;
            this.showSuccess = false;
            this.errorMessage = error.error?.message || 'Failed to send message. Please try again.';
            
            // Hide error message after 5 seconds
            setTimeout(() => {
              this.showError = false;
            }, 5000);
          }
        });
    }
  }

  // Helper method to check if a field has errors
  hasError(fieldName: string): boolean {
    const field = this.contactForm.get(fieldName);
    // For disabled fields (like email for logged-in users), don't show validation errors
    if (field?.disabled) {
      return false;
    }
    return !!(field && field.invalid && (field.dirty || field.touched));
  }

  // Get specific error message for a field
  getErrorMessage(fieldName: string): string {
    const field = this.contactForm.get(fieldName);
    // For disabled fields, don't show error messages
    if (field?.disabled) {
      return '';
    }
    if (field?.hasError('required')) {
      return `${this.getFieldLabel(fieldName)} is required`;
    }
    if (fieldName === 'email' && field?.hasError('email')) {
      return 'Please enter a valid email address';
    }
    if (fieldName === 'phone' && field?.hasError('pattern')) {
      return 'Phone number must be exactly 10 digits';
    }
    return '';
  }

  private getFieldLabel(fieldName: string): string {
    const labels: { [key: string]: string } = {
      fullName: 'Full name',
      email: 'Email',
      phone: 'Phone number',
      message: 'Message',
      smsConsent: 'SMS consent'
    };
    return labels[fieldName] || fieldName;
  }
}