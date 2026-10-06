import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { RouterLink, Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-verify-email-notice',
  standalone: true,
  imports: [FormsModule, ReactiveFormsModule, RouterLink],
  templateUrl: './verify-email-notice.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./verify-email-notice.component.scss']
})
export class VerifyEmailNoticeComponent {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private router = inject(Router);

  otpForm: FormGroup;
  readonly isVerifying = signal(false);
  readonly isResending = signal(false);
  readonly successMessage = signal('');
  readonly errorMessage = signal('');
  userEmail: string = '';

  constructor() {
    // Email comes from the logged-in user (auto-logged in during registration)
    this.userEmail = this.authService.currentUserValue?.email || '';

    this.otpForm = this.fb.group({
      code: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(6), Validators.pattern(/^\d{6}$/)]]
    });
  }

  onOtpSubmit() {
    if (!this.otpForm.valid) return;
    if (!this.userEmail) {
      this.errorMessage.set('Email address not found. Please go back and register again.');
      return;
    }

    this.isVerifying.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');

    this.authService.verifyLoginOtp(this.userEmail, this.otpForm.value.code).subscribe({
      next: (response) => {
        this.isVerifying.set(false);
        // After verification, RequiresPasswordSetup is false (local user has a password)
        this.router.navigate(['/']);
      },
      error: (error) => {
        this.isVerifying.set(false);
        this.errorMessage.set(error.error?.message || 'Invalid code. Please try again.');
      }
    });
  }

  resendCode() {
    if (!this.userEmail) {
      this.errorMessage.set('Email address not found. Please go back and register again.');
      return;
    }

    this.isResending.set(true);
    this.successMessage.set('');
    this.errorMessage.set('');

    this.authService.resendVerification(this.userEmail).subscribe({
      next: () => {
        this.successMessage.set('A new code has been sent to your email.');
        this.isResending.set(false);
      },
      error: () => {
        this.errorMessage.set('Failed to send a new code. Please try again.');
        this.isResending.set(false);
      }
    });
  }
}
