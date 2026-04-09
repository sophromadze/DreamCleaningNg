import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { passwordValidator } from '../../utils/password-validator';

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './reset-password.component.html',
  styleUrls: ['./reset-password.component.scss']
})
export class ResetPasswordComponent implements OnInit {
  resetForm: FormGroup;
  isLoading = false;
  isSuccess = false;
  errorMessage = '';
  token: string = '';
  /** Email for this reset/set-password link (loaded from API when token present). Shown read-only. */
  resetEmail: string | null = null;
  /** True when link is for setting initial password (e.g. admin-created user). */
  isSetPassword = false;
  /** True while fetching email for token. */
  loadingEmail = false;
  /** True if token was checked and invalid/expired. */
  tokenInvalid = false;
  showPassword = false;
  showConfirmPassword = false;

  constructor(
    private fb: FormBuilder,
    private route: ActivatedRoute,
    private authService: AuthService,
    private router: Router
  ) {
    this.resetForm = this.fb.group({
      password: ['', [Validators.required, passwordValidator()]],
      confirmPassword: ['', Validators.required]
    }, { validators: this.passwordMatchValidator });
  }

  ngOnInit() {
    this.token = this.route.snapshot.queryParams['token'] || '';
    if (!this.token) {
      this.errorMessage = 'Invalid reset link';
      this.tokenInvalid = true;
      return;
    }
    this.loadingEmail = true;
    this.authService.getResetPasswordInfo(this.token).subscribe({
      next: (res) => {
        this.resetEmail = res.email ?? null;
        this.isSetPassword = res.isSetPassword === true;
        this.loadingEmail = false;
        if (!this.resetEmail) this.tokenInvalid = true;
      },
      error: () => {
        this.loadingEmail = false;
        this.tokenInvalid = true;
        this.errorMessage = 'This link is invalid or has expired.';
      }
    });
  }

  passwordMatchValidator(form: FormGroup) {
    const password = form.get('password');
    const confirmPassword = form.get('confirmPassword');
    
    if (password && confirmPassword && password.value !== confirmPassword.value) {
      confirmPassword.setErrors({ passwordMismatch: true });
    } else if (confirmPassword?.errors?.['passwordMismatch']) {
      confirmPassword.setErrors(null);
    }
    
    return null;
  }

  getPasswordErrors(): string[] {
    const passwordControl = this.resetForm.get('password');
    if (passwordControl?.errors?.['passwordRequirements']) {
      return passwordControl.errors['passwordRequirements'].errors;
    }
    return [];
  }

  // Helper methods for template validation checks
  hasMinLength(): boolean {
    const password = this.resetForm.get('password')?.value;
    return password ? password.length >= 8 : false;
  }

  hasUppercase(): boolean {
    const password = this.resetForm.get('password')?.value;
    return password ? /[A-Z]/.test(password) : false;
  }

  hasLowercase(): boolean {
    const password = this.resetForm.get('password')?.value;
    return password ? /[a-z]/.test(password) : false;
  }

  hasNumber(): boolean {
    const password = this.resetForm.get('password')?.value;
    return password ? /\d/.test(password) : false;
  }

  hasLatinOnly(): boolean {
    const password = this.resetForm.get('password')?.value;
    return password ? /^[\x20-\x7E]+$/.test(password) : false;
  }

  onSubmit() {
    if (this.resetForm.valid && this.token) {
      this.isLoading = true;
      this.errorMessage = '';
      
      this.authService.resetPassword(this.token, this.resetForm.value.password).subscribe({
        next: () => {
          this.isSuccess = true;
          this.isLoading = false;
          setTimeout(() => {
            this.router.navigate(['/login']);
          }, 3000);
        },
        error: (error) => {
          this.errorMessage = error.error?.message || 'Failed to reset password. The link may be expired.';
          this.isLoading = false;
        }
      });
    }
  }
}