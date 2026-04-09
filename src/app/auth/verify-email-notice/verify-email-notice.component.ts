import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { RouterLink, Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-verify-email-notice',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterLink],
  templateUrl: './verify-email-notice.component.html',
  styleUrls: ['./verify-email-notice.component.scss']
})
export class VerifyEmailNoticeComponent {
  otpForm: FormGroup;
  isVerifying = false;
  isResending = false;
  successMessage = '';
  errorMessage = '';
  userEmail: string = '';

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router
  ) {
    // Email comes from the logged-in user (auto-logged in during registration)
    this.userEmail = this.authService.currentUserValue?.email || '';

    this.otpForm = this.fb.group({
      code: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(6), Validators.pattern(/^\d{6}$/)]]
    });
  }

  onOtpSubmit() {
    if (!this.otpForm.valid) return;
    if (!this.userEmail) {
      this.errorMessage = 'Email address not found. Please go back and register again.';
      return;
    }

    this.isVerifying = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.authService.verifyLoginOtp(this.userEmail, this.otpForm.value.code).subscribe({
      next: (response) => {
        this.isVerifying = false;
        // After verification, RequiresPasswordSetup is false (local user has a password)
        this.router.navigate(['/']);
      },
      error: (error) => {
        this.isVerifying = false;
        this.errorMessage = error.error?.message || 'Invalid code. Please try again.';
      }
    });
  }

  resendCode() {
    if (!this.userEmail) {
      this.errorMessage = 'Email address not found. Please go back and register again.';
      return;
    }

    this.isResending = true;
    this.successMessage = '';
    this.errorMessage = '';

    this.authService.resendVerification(this.userEmail).subscribe({
      next: () => {
        this.successMessage = 'A new code has been sent to your email.';
        this.isResending = false;
      },
      error: () => {
        this.errorMessage = 'Failed to send a new code. Please try again.';
        this.isResending = false;
      }
    });
  }
}
