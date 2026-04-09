// Fixed version with proper autofill prevention
// src/app/auth/change-email/change-email.component.ts

import { Component, OnInit, AfterViewInit, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-change-email',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './change-email.component.html',
  styleUrls: ['./change-email.component.scss']
})
export class ChangeEmailComponent implements OnInit, AfterViewInit {
  @ViewChild('newEmailElement') newEmailField!: ElementRef;
  @ViewChild('currentPasswordElement') currentPasswordField!: ElementRef;

  // Form step
  newEmail: string = '';
  currentPassword: string = '';
  errorMessage: string = '';
  successMessage: string = '';
  isSubmitting: boolean = false;
  currentUser: any = null;
  showPassword = false;
  
  // Verification step
  currentStep: 'form' | 'verification' = 'form';
  isVerifying = false;
  isSuccess = false;
  isError = false;
  verificationErrorMessage = '';

  constructor(
    private authService: AuthService,
    private router: Router,
    private route: ActivatedRoute
  ) {
    this.currentUser = this.authService.currentUserValue;
  }

  ngOnInit() {
    // Check if this is a verification request
    const token = this.route.snapshot.queryParams['token'];
    
    if (token) {
      this.currentStep = 'verification';
      this.confirmEmailChange(token);
    }
  }

  ngAfterViewInit() {
    // Clear autofill after view init
    setTimeout(() => {
      this.preventAutofill();
    }, 100);
  }

  preventAutofill() {
    if (this.newEmailField?.nativeElement) {
      this.newEmailField.nativeElement.value = '';
    }
    if (this.currentPasswordField?.nativeElement) {
      this.currentPasswordField.nativeElement.value = '';
    }
    
    // Clear model values
    this.newEmail = '';
    this.currentPassword = '';
  }

  makeEditable(event: any) {
    event.target.removeAttribute('readonly');
    event.target.focus();
  }

  onFieldFocus(fieldType: string) {
    if (fieldType === 'email') {
      this.newEmail = '';
    } else if (fieldType === 'password') {
      this.currentPassword = '';
    }
  }

  onSubmit() {
    this.isSubmitting = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.authService.initiateEmailChange(this.newEmail, this.currentPassword).subscribe({
      next: (response) => {
        this.isSubmitting = false;
        this.successMessage = response.message;
        // Reset the entire form to clear validation states
        this.resetFormAfterSuccess();
      },
      error: (error) => {
        this.isSubmitting = false;
        this.errorMessage = error.error?.message || 'Failed to initiate email change. Please try again.';
      }
    });
  }

  resetFormAfterSuccess() {
    // Clear the form data
    this.newEmail = '';
    this.currentPassword = '';
    
    // Reset form validation state
    setTimeout(() => {
      if (this.newEmailField?.nativeElement) {
        this.newEmailField.nativeElement.value = '';
      }
      if (this.currentPasswordField?.nativeElement) {
        this.currentPasswordField.nativeElement.value = '';
      }
    }, 0);
  }

  confirmEmailChange(token: string) {
    this.isVerifying = true;
    this.isSuccess = false;
    this.isError = false;

    this.authService.confirmEmailChange(token).subscribe({
      next: (response) => {
        this.isVerifying = false;
        this.isSuccess = true;
        
        // Log out the user for security (they need to login with new email)
        this.authService.logout();
      },
      error: (error) => {
        this.isVerifying = false;
        this.isError = true;
        this.verificationErrorMessage = error.error?.message || 'Failed to verify email change';
      }
    });
  }

  resetForm() {
    this.currentStep = 'form';
    this.newEmail = '';
    this.currentPassword = '';
    this.errorMessage = '';
    this.successMessage = '';
    this.isSubmitting = false;
    this.isVerifying = false;
    this.isSuccess = false;
    this.isError = false;
    this.verificationErrorMessage = '';
    
    // Clear URL parameters
    this.router.navigate(['/change-email']);
    
    // Prevent autofill again
    setTimeout(() => {
      this.preventAutofill();
    }, 100);
  }

  goToLogin() {
    this.router.navigate(['/login']);
  }

  goBack() {
    this.router.navigate(['/profile']);
  }
}