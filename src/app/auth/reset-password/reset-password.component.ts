import { Component, OnInit, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { passwordValidator } from '../../utils/password-validator';

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './reset-password.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./reset-password.component.scss']
})
export class ResetPasswordComponent implements OnInit {
  private fb = inject(FormBuilder);
  private route = inject(ActivatedRoute);
  private authService = inject(AuthService);
  private router = inject(Router);

  resetForm: FormGroup;
  readonly isLoading = signal(false);
  readonly isSuccess = signal(false);
  readonly errorMessage = signal('');
  token: string = '';
  /** Email for this reset/set-password link (loaded from API when token present). Shown read-only. */
  readonly resetEmail = signal<string | null>(null);
  /** True when link is for setting initial password (e.g. admin-created user). */
  readonly isSetPassword = signal(false);
  /** True while fetching email for token. */
  readonly loadingEmail = signal(false);
  /** True if token was checked and invalid/expired. */
  readonly tokenInvalid = signal(false);
  readonly showPassword = signal(false);
  readonly showConfirmPassword = signal(false);

  constructor() {
    this.resetForm = this.fb.group({
      password: ['', [Validators.required, passwordValidator()]],
      confirmPassword: ['', Validators.required]
    }, { validators: this.passwordMatchValidator });
  }

  ngOnInit() {
    this.token = this.route.snapshot.queryParams['token'] || '';
    if (!this.token) {
      this.errorMessage.set('Invalid reset link');
      this.tokenInvalid.set(true);
      return;
    }
    this.loadingEmail.set(true);
    this.authService.getResetPasswordInfo(this.token).subscribe({
      next: (res) => {
        this.resetEmail.set(res.email ?? null);
        this.isSetPassword.set(res.isSetPassword === true);
        this.loadingEmail.set(false);
        if (!this.resetEmail()) this.tokenInvalid.set(true);
      },
      error: () => {
        this.loadingEmail.set(false);
        this.tokenInvalid.set(true);
        this.errorMessage.set('This link is invalid or has expired.');
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
      this.isLoading.set(true);
      this.errorMessage.set('');
      
      this.authService.resetPassword(this.token, this.resetForm.value.password).subscribe({
        next: () => {
          this.isSuccess.set(true);
          this.isLoading.set(false);
          setTimeout(() => {
            this.router.navigate(['/login']);
          }, 3000);
        },
        error: (error) => {
          this.errorMessage.set(error.error?.message || 'Failed to reset password. The link may be expired.');
          this.isLoading.set(false);
        }
      });
    }
  }
}